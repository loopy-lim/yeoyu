package dev.browser

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import org.mozilla.geckoview.WebResponse

/** Saves Gecko's actual response. Auth, POST and blob bodies are never fetched again. */
internal object DownloadCoordinator {
    private val main = Handler(Looper.getMainLooper())
    private val workers = ThreadPoolExecutor(2, 2, 30, TimeUnit.SECONDS, ArrayBlockingQueue(8)) { job ->
        Thread(job, "yeoyu-download").apply { isDaemon = true }
    }

    private val stateWorker = java.util.concurrent.Executors.newSingleThreadExecutor { job ->
        Thread(job, "yeoyu-download-state").apply { isDaemon = true }
    }
    private class Job(val cancellation: DownloadCancellation) { @Volatile var work: Runnable? = null }
    // Admission happens before the disk worker queue, so queued response bodies stay bounded too.
    private val slots = java.util.concurrent.Semaphore(10)
    private val jobs = java.util.concurrent.ConcurrentHashMap<String, Job>()
    private var journal: DownloadJournal? = null
    private var records = emptyList<DownloadRecord>()

    fun initialize(context: Context) {
        val app = context.applicationContext
        stateWorker.execute {
            try { ensureLoaded(app) }
            catch (failure: Exception) { reportFailure(null, "Download history could not be read: ${failure.message}") }
        }
    }

    private fun ensureLoaded(app: Context) {
        if (journal != null) return
        val store = DownloadJournal(File(app.filesDir, "browser-downloads-v1"))
        val recovered = store.recover(System.currentTimeMillis())
        records = recovered.map { record ->
            if (!record.active && record.state != "completed" && record.pendingUri != null && cleanupPending(app, record.pendingUri))
                record.copy(pendingUri = null) else record
        }
        if (records != recovered) store.write(records)
        journal = store
    }

    private fun update(id: String, transform: (DownloadRecord) -> DownloadRecord) {
        val next = records.map { if (it.id == id) transform(it) else it }
        checkNotNull(journal).write(next)
        records = checkNotNull(journal).retain(next)
    }

    /** Reads on the native module queue; file IO is serialized with every mutation. */
    fun list(context: Context): String = stateWorker.submit<String> {
        ensureLoaded(context.applicationContext)
        org.json.JSONArray().apply { records.asReversed().forEach { record ->
            put(org.json.JSONObject().apply {
                put("id", record.id); put("filename", record.filename); put("mimeType", record.mimeType)
                put("state", record.state); put("bytes", record.bytes)
                record.totalBytes?.let { put("totalBytes", it) }
                record.uri?.let { put("uri", it) }; record.error?.let { put("error", it) }
                put("createdAt", record.createdAt); put("updatedAt", record.updatedAt)
            })
        } }.toString()
    }.get()

    /** Takes ownership of the actual received response, including queued/cancelled/error paths. */
    fun save(context: Context, response: WebResponse, emit: (String, WritableMap) -> Unit) {
        val app = context.applicationContext
        val id = java.util.UUID.randomUUID().toString()
        val filename = DownloadTransfer.filename(response.uri, response.header("Content-Disposition"))
        val mime = DownloadTransfer.mimeType(response.header("Content-Type"))
        val body = response.body
        val total = response.header("Content-Length")?.toLongOrNull()?.takeIf { it >= 0 &&
            (response.header("Content-Encoding").isNullOrEmpty() || response.header("Content-Encoding").equals("identity", true)) }
        val now = System.currentTimeMillis()
        val record = DownloadRecord(id, filename, mime, "queued", 0, total, null, null, now, now)
        if (!slots.tryAcquire()) {
            runCatching { body?.close() }
            stateWorker.execute {
                try {
                    ensureLoaded(app)
                    val rejected = record.copy(state = "failed", error = "Too many downloads are in progress. Try again after one finishes.")
                    checkNotNull(journal).write(records + rejected)
                    records = checkNotNull(journal).retain(records + rejected)
                    changed()
                } catch (failure: Exception) { reportFailure(id, "Download history could not be saved: ${failure.message}") }
                reportFailure(id, "Too many downloads are in progress. Try again after one finishes.")
            }
            return
        }
        val cancellation = DownloadCancellation()
        body?.let { cancellation.attach(it) }
        val job = Job(cancellation)
        jobs[id] = job
        stateWorker.execute {
            try {
                ensureLoaded(app)
                checkNotNull(journal).write(records + record)
                records = checkNotNull(journal).retain(records + record)
                changed()
                if (body == null) throw IOException("The download response contains no body")
                cancellation.throwIfCancelled()
                response.setReadTimeoutMillis(30_000)
                val work = Runnable {
                    try {
                        stateWorker.submit {
                            cancellation.throwIfCancelled()
                            update(id) { it.copy(state = "running", updatedAt = System.currentTimeMillis()) }
                            changed()
                        }.get()
                        var lastProgress = 0L
                        val result = DownloadTransfer.save(body, cancellation, { bytes ->
                            val tick = android.os.SystemClock.elapsedRealtime()
                            if (tick - lastProgress >= 500) {
                                lastProgress = tick
                                stateWorker.execute {
                                    // Progress is volatile; durable running state is sufficient for crash recovery.
                                    records = records.map { if (it.id == id && it.active) it.copy(bytes = bytes) else it }
                                    changed()
                                }
                            }
                        }, expectedBytes = total) {
                            val remember: (String) -> Unit = { uri ->
                                stateWorker.submit { update(id) { it.copy(pendingUri = uri) } }.get()
                            }
                            if (Build.VERSION.SDK_INT >= 29) mediaStoreDestination(app, filename, mime, remember)
                            else externalDestination(app, filename, remember)
                        }
                        stateWorker.execute {
                            val complete = records.map { if (it.id == id) it.copy(filename = result.filename,
                                state = "completed", bytes = result.bytes, uri = result.uri, pendingUri = null,
                                error = null, updatedAt = System.currentTimeMillis()) else it }
                            // The file is committed even if persisting its history fails. Do not report it as partial.
                            records = checkNotNull(journal).retain(complete)
                            try { checkNotNull(journal).write(records) }
                            catch (failure: Exception) { reportFailure(id, "File saved, but download history could not be saved: ${failure.message}") }
                            changed()
                            main.post { emit("BrowserDownload", Arguments.createMap().apply {
                                putString("id", id); putString("filename", result.filename)
                                putString("location", result.location); putString("uri", result.uri)
                                putDouble("bytes", result.bytes.toDouble())
                            }) }
                        }
                    } catch (failure: Exception) {
                        val cancelled = runCatching { cancellation.throwIfCancelled() }.isFailure
                        stateWorker.execute { finishFailure(id, failure, cancelled) }
                    } finally {
                        runCatching { body.close() }
                        cancellation.detach()
                        if (jobs.remove(id, job)) slots.release()
                    }
                }
                job.work = work
                workers.execute(work)
            } catch (failure: Exception) {
                runCatching { body?.close() }
                cancellation.detach()
                if (jobs.remove(id, job)) slots.release()
                finishFailure(id, failure, runCatching { cancellation.throwIfCancelled() }.isFailure)
            }
        }
    }

    private fun finishFailure(id: String, failure: Exception, cancelled: Boolean) {
        val message = if (cancelled) "Download cancelled" else failure.cause?.message ?: failure.message ?: "Download failed"
        val next = records.map { if (it.id == id && it.state != "completed") it.copy(
            state = if (cancelled) "cancelled" else "failed", error = message.take(4000),
            updatedAt = System.currentTimeMillis()) else it }
        records = journal?.retain(next) ?: next
        try { journal?.write(records) }
        catch (storage: Exception) { reportFailure(id, "Download history could not be saved: ${storage.message}") }
        changed()
        if (!cancelled) reportFailure(id, message)
    }

    fun cancel(id: String): Boolean {
        val job = jobs[id] ?: return false
        if (!job.cancellation.cancel()) return false
        job.work?.let { work -> if (workers.remove(work) && jobs.remove(id, job)) slots.release() }
        stateWorker.execute { finishFailure(id, DownloadCancelledException(), true) }
        return true
    }

    fun open(activity: android.app.Activity, id: String) {
        val record = stateWorker.submit<DownloadRecord> {
            ensureLoaded(activity.applicationContext)
            records.firstOrNull { it.id == id && it.state == "completed" }
                ?: throw IOException("This download has not completed")
        }.get()
        val uri = Uri.parse(record.uri ?: throw IOException("The saved file is unavailable"))
        val content = if (uri.scheme == "file") {
            val file = File(uri.path ?: throw IOException("The saved file is unavailable"))
            if (!file.isFile) throw IOException("The downloaded file was moved or deleted")
            androidx.core.content.FileProvider.getUriForFile(activity, "${activity.packageName}.downloads", file)
        } else {
            if (uri.scheme != "content" || uri.authority != "media") throw IOException("Unsupported saved file location")
            activity.contentResolver.openAssetFileDescriptor(uri, "r")?.use { }
                ?: throw IOException("The downloaded file was moved or deleted")
            uri
        }
        val intent = android.content.Intent(android.content.Intent.ACTION_VIEW)
            .setDataAndType(content, record.mimeType)
            .addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .apply { clipData = android.content.ClipData.newRawUri("Downloaded file", content) }
        main.post {
            try { activity.startActivity(android.content.Intent.createChooser(intent, "Open downloaded file")) }
            catch (failure: Exception) { reportFailure(id, failure.message ?: "No app can open this file") }
        }
    }

    private fun changed() {
        main.post { GeckoSessionRegistry.emit?.invoke("BrowserDownloadsChanged", Arguments.createMap()) }
    }

    private fun reportFailure(id: String?, error: String) {
        main.post { GeckoSessionRegistry.emit?.invoke("BrowserDownloadFailed", Arguments.createMap().apply {
            id?.let { putString("id", it) }; putString("error", error)
        }) }
    }

    private fun cleanupPending(app: Context, value: String): Boolean = try {
        val uri = Uri.parse(value)
        if (uri.scheme == "file") {
            val file = File(uri.path.orEmpty())
            val folder = app.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)?.canonicalFile
            if (file.canonicalFile.parentFile == folder && file.name.startsWith(".yeoyu-download-") && file.name.endsWith(".part"))
                !file.exists() || file.delete() else false
        } else if (Build.VERSION.SDK_INT >= 29 && uri.scheme == "content" && uri.authority == "media") {
            app.contentResolver.query(uri, arrayOf(MediaStore.Downloads.IS_PENDING, MediaStore.MediaColumns.OWNER_PACKAGE_NAME), null, null, null)?.use { cursor ->
                if (!cursor.moveToFirst()) true
                else if (cursor.getInt(0) == 1 && cursor.getString(1) == app.packageName)
                    app.contentResolver.delete(uri, null, null) > 0
                else cursor.getInt(0) == 0 // Never delete a file already published to Downloads.
            } ?: false
        } else false
    } catch (_: Exception) { false }

    private fun WebResponse.header(name: String): String? =
        headers.entries.firstOrNull { it.key.equals(name, true) }?.value

    @android.annotation.TargetApi(29)
    private fun mediaStoreDestination(context: Context, filename: String, mime: String, remember: (String) -> Unit): DownloadDestination {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, filename)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IOException("Downloads storage is unavailable")
        val output = try {
            remember(uri.toString())
            resolver.openOutputStream(uri, "w") ?: throw IOException("Could not open the downloaded file")
        } catch (failure: Exception) {
            try { resolver.delete(uri, null, null) } catch (cleanup: Exception) { failure.addSuppressed(cleanup) }
            throw failure
        }
        return object : DownloadDestination {
            override val output: OutputStream = output
            override fun complete(bytes: Long): SavedDownload {
                val finished = ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }
                if (resolver.update(uri, finished, null, null) != 1) throw IOException("Could not finish saving the download")
                val actualName = runCatching { resolver.query(uri, arrayOf(MediaStore.Downloads.DISPLAY_NAME), null, null, null)?.use {
                    if (it.moveToFirst()) it.getString(0) else filename
                } }.getOrNull() ?: filename
                return SavedDownload(actualName, "Downloads", uri.toString(), bytes)
            }
            override fun abort() { resolver.delete(uri, null, null) }
        }
    }

    private fun externalDestination(context: Context, filename: String, remember: (String) -> Unit): DownloadDestination {
        val folder = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
            ?: throw IOException("App downloads storage is unavailable")
        if (!folder.isDirectory && !folder.mkdirs()) throw IOException("Could not create the app downloads folder")
        val pending = File.createTempFile(".yeoyu-download-", ".part", folder)
        val output = try { remember(Uri.fromFile(pending).toString()); FileOutputStream(pending) } catch (failure: Exception) {
            pending.delete()
            throw failure
        }
        return object : DownloadDestination {
            override val output: OutputStream = output
            private var reserved: File? = null
            override fun complete(bytes: Long): SavedDownload {
                val saved = reserveFilename(folder, filename).also { reserved = it }
                if (!pending.renameTo(saved)) throw IOException("Could not finish saving the download")
                return SavedDownload(saved.name, "App downloads (${folder.absolutePath})", Uri.fromFile(saved).toString(), bytes)
            }
            override fun abort() {
                pending.delete()
                reserved?.delete()
            }
        }
    }

    private fun reserveFilename(folder: File, filename: String): File {
        val extension = filename.substringAfterLast('.', "").takeIf { it.isNotEmpty() && it.length <= 16 }
        val stem = if (extension == null) filename else filename.removeSuffix(".$extension")
        for (index in 0..9999) {
            val suffix = if (index == 0) "" else " ($index)"
            val name = stem + suffix + (extension?.let { ".$it" } ?: "")
            val file = File(folder, name)
            if (file.createNewFile()) return file
        }
        throw IOException("Too many downloads already have this filename")
    }
}
