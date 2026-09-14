package dev.browser

import android.app.Activity
import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.util.Log
import com.facebook.react.bridge.Arguments
import java.io.File
import java.io.IOException
import java.util.IdentityHashMap
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Executors
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSession.PromptDelegate.*

/** Main-thread request routing; provider I/O and accepted-file cleanup run separately. */
object FilePromptCoordinator {
    private val main = Handler(Looper.getMainLooper())
    private val limits = UploadLimits()
    // Bound stuck provider threads and the queue. Reject additional work instead of growing threads forever.
    private val worker = ThreadPoolExecutor(2, 2, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue(2), { job ->
        Thread(job, "yeoyu-file-picker").apply { isDaemon = true }
    })
    private val cleanup = Executors.newSingleThreadExecutor { job -> Thread(job, "yeoyu-upload-cleanup").apply { isDaemon = true } }
    private val cancelWorker = ThreadPoolExecutor(2, 2, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue(4), { job ->
        Thread(job, "yeoyu-upload-cancel").apply { isDaemon = true }
    })
    private var staging: UploadStaging? = null
    private val retained = IdentityHashMap<GeckoSession, MutableList<StagedUpload>>()
    private val activeCopies = IdentityHashMap<GeckoSession, Int>()
    private var nextCode = 0x5000
    private class Pending(val session: GeckoSession, val prompt: FilePrompt, val requestCode: Int,
        val result: GeckoResult<PromptResponse>, val isCurrent: () -> Boolean) {
        val cancellation = UploadCancellation()
        @Volatile var canceled = false
        var copying = false
        var timeout: Runnable? = null
    }
    private var pending: Pending? = null

    fun start(activity: Activity, session: GeckoSession, prompt: FilePrompt,
        isCurrent: () -> Boolean): GeckoResult<PromptResponse> {
        pending?.let { finish(it) { it.prompt.dismiss() } }
        // Never wrap: old picker answers cannot match a later request in this process.
        if (nextCode > 0x7fff) return GeckoResult.fromValue(prompt.dismiss())
        val request = Pending(session, prompt, nextCode++, GeckoResult(), isCurrent)
        pending = request
        prompt.setDelegate(object : PromptInstanceDelegate {
            override fun onPromptDismiss(prompt: BasePrompt) { finish(request) { request.prompt.dismiss() } }
        })
        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            val accepted = prompt.mimeTypes.orEmpty().filter { it.isNotBlank() }
            type = accepted.singleOrNull() ?: "*/*"
            if (accepted.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, accepted.toTypedArray())
            if (prompt.type == FilePrompt.Type.MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        try { activity.startActivityForResult(Intent.createChooser(intent, prompt.title), request.requestCode) }
        catch (_: Exception) { finish(request) { prompt.dismiss() } }
        return request.result
    }

    fun hasSessionFilesOrPending(session: GeckoSession): Boolean =
        pending?.session === session || retained[session]?.isNotEmpty() == true || (activeCopies[session] ?: 0) > 0

    fun hasPending(session: GeckoSession): Boolean = pending?.session === session
    fun cancelPending(session: GeckoSession) {
        pending?.takeIf { it.session === session }?.let { finish(it) { it.prompt.dismiss() } }
    }
    fun cancel(session: GeckoSession) = cancelPending(session)

    /** Call only after GeckoSession.close; navigation and React bridge reload keep approved copies. */
    fun releaseSession(session: GeckoSession) {
        cancelPending(session)
        retained.remove(session)?.forEach(::closeLater)
    }

    private fun closeLater(copy: StagedUpload) {
        cleanup.execute { try { copy.close() } catch (_: IOException) { Log.w("YeoyuUpload", "Upload cleanup failed; retained budget remains reserved") } }
    }
    private fun cancelCopy(request: Pending) {
        // The flag retires the UI immediately; closing a remote provider must never block main.
        request.canceled = true
        try { cancelWorker.execute { request.cancellation.cancel() } }
        catch (_: java.util.concurrent.RejectedExecutionException) {
            // Every stage has its own deadline. A saturated cancel pool still cannot approve a late copy.
            Log.w("YeoyuUpload", "Provider cancellation queue is full")
        }
    }
    private fun finish(request: Pending, response: () -> PromptResponse): Boolean {
        if (pending !== request) return false
        pending = null
        request.timeout?.let(main::removeCallbacks)
        cancelCopy(request)
        return try {
            val current = request.isCurrent()
            request.result.complete(if (current) response() else request.prompt.dismiss())
            current
        } catch (failure: Exception) {
            request.result.completeExceptionally(failure)
            false
        }
    }
    private fun reportFailure(message: String) {
        GeckoSessionRegistry.emit?.invoke("BrowserFileSelectionFailed", Arguments.createMap().apply { putString("error", message) })
    }

    fun handle(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        val request = pending?.takeIf { it.requestCode == requestCode } ?: return
        if (request.copying) return
        val clip = data?.clipData
        if (clip != null && clip.itemCount > limits.maxFiles) {
            finish(request) { request.prompt.dismiss() }
            reportFailure("Choose up to ${limits.maxFiles} files")
            return
        }
        val uris = if (clip != null) (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
            else listOfNotNull(data?.data)
        if (resultCode != Activity.RESULT_OK || uris.isEmpty() || !request.isCurrent()) {
            finish(request) { request.prompt.dismiss() }; return
        }
        request.copying = true
        val app = activity.applicationContext
        val selected = if (request.prompt.type == FilePrompt.Type.MULTIPLE) uris else uris.take(1)
        val timeout = Runnable {
            if (pending === request) {
                finish(request) { request.prompt.dismiss() }
                reportFailure("Preparing the selected files took too long. Try a local file or fewer files")
            }
        }
        request.timeout = timeout
        main.postDelayed(timeout, limits.timeoutMillis)
        activeCopies[request.session] = (activeCopies[request.session] ?: 0) + 1
        try { worker.execute {
            try {
                if (request.canceled) return@execute
                val store = synchronized(this) {
                    staging ?: UploadStaging(File(app.cacheDir, "browser-upload-staging"), limits).also { staging = it }
                }
                val signal = CancellationSignal()
                val signalResource = AutoCloseable { signal.cancel() }
                request.cancellation.register(signalResource)
                val sources = selected.map { uri ->
                    request.cancellation.check()
                    UploadSource(displayName(app.contentResolver, uri, signal)) {
                        // AFD preserves offsets and can cancel a blocked provider open, unlike openInputStream.
                        val descriptor = app.contentResolver.openAssetFileDescriptor(uri, "r", signal)
                            ?: throw IOException("Selected file unavailable")
                        try { descriptor.createInputStream() } catch (failure: Exception) { descriptor.close(); throw failure }
                    }
                }
                val copy = store.stage(sources, { request.canceled }, request.cancellation)
                request.cancellation.unregister(signalResource)
                main.post {
                    if (pending !== request || !request.isCurrent() || request.cancellation.isCanceled) {
                        closeLater(copy)
                        finish(request) { request.prompt.dismiss() }
                        return@post
                    }
                    val accepted = finish(request) {
                        val response = request.prompt.confirm(app, copy.files.map { Uri.fromFile(it) }.toTypedArray())
                        retained.getOrPut(request.session) { mutableListOf() }.add(copy)
                        response
                    }
                    if (!accepted) {
                        retained[request.session]?.remove(copy)
                        closeLater(copy)
                    }
                }
            } catch (failure: Exception) {
                main.post {
                    if (pending !== request) return@post
                    finish(request) { request.prompt.dismiss() }
                    reportFailure(if (failure is UploadLimitException) failure.message ?: "Upload limit reached"
                        else "The selected file could not be prepared. Try a local file or fewer files")
                }
            } finally { main.post { decrementCopies(request.session) } }
        } } catch (_: java.util.concurrent.RejectedExecutionException) {
            decrementCopies(request.session)
            finish(request) { request.prompt.dismiss() }
            reportFailure("The file provider is busy. Try again when the previous selection finishes")
        }
    }
    private fun decrementCopies(session: GeckoSession) {
        val remaining = (activeCopies[session] ?: 1) - 1
        if (remaining > 0) activeCopies[session] = remaining else activeCopies.remove(session)
    }
    private fun displayName(resolver: ContentResolver, uri: Uri, signal: CancellationSignal): String {
        try {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null, signal)?.use { cursor ->
                val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (column >= 0 && cursor.moveToFirst()) cursor.getString(column)?.let { return it }
            }
        } catch (failure: android.os.OperationCanceledException) { throw failure }
        catch (_: Exception) {}
        return uri.lastPathSegment ?: "upload"
    }
}
