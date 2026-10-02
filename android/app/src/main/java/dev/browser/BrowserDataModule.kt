package dev.browser

import android.app.Activity
import android.content.Intent
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.*
import java.io.Closeable
import java.io.IOException
import java.lang.ref.WeakReference
import java.util.Collections
import java.util.WeakHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** User-selected portable files only. Browser state validation belongs to Rust. */
class BrowserDataModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
    private class Operation(owner: Activity, val requestCode: Int, val promise: Promise, val bytes: ByteArray?) {
        val owner = WeakReference(owner)
        var awaitingResult = true
        val cancelled = AtomicBoolean(false)
        val stream = AtomicReference<Closeable?>()
        fun cancel() { cancelled.set(true); try { stream.getAndSet(null)?.close() } catch (_: Exception) {} }
    }
    private var pending: Operation? = null
    private var nextRequest = 47130
    private val main = Handler(Looper.getMainLooper())
    private val timeout = Runnable { cancelPending() }
    private val io = Executors.newSingleThreadExecutor { work -> Thread(work, "yeoyu-portable-files").apply { isDaemon = true } }
    private val listener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            val operation = pending ?: return
            if (requestCode != operation.requestCode || operation.owner.get() !== activity || !operation.awaitingResult) return
            if (activity.isFinishing || activity.isDestroyed) { cancelPending(); return }
            operation.awaitingResult = false
            if (resultCode != Activity.RESULT_OK) { finish(operation, Result.success(null)); return }
            val uri = data?.data
            if (uri == null || uri.scheme != "content") { finish(operation, Result.failure(IOException("No supported document was selected"))); return }
            io.execute {
                val result = runCatching {
                    if (operation.cancelled.get()) throw IOException("File operation was cancelled")
                    val resolver = reactApplicationContext.contentResolver
                    if (operation.bytes == null) {
                        val stream = resolver.openInputStream(uri) ?: throw IOException("The selected file could not be opened")
                        operation.stream.set(stream)
                        stream.use { PortableDocumentIO.read(it, MAX_BYTES) { operation.cancelled.get() } }
                    } else {
                        val stream = resolver.openOutputStream(uri, "wt") ?: throw IOException("The selected destination could not be opened")
                        operation.stream.set(stream)
                        stream.use { PortableDocumentIO.write(it, operation.bytes) { operation.cancelled.get() } }
                        "saved"
                    }
                }
                operation.stream.set(null)
                UiThreadUtil.runOnUiThread { finish(operation, result) }
            }
        }
    }
    override fun getName() = "BrowserData"
    override fun initialize() {
        synchronized(instances) { instances.add(this) }
        reactApplicationContext.addActivityEventListener(listener)
        reactApplicationContext.addLifecycleEventListener(this)
    }
    @ReactMethod fun chooseImport(promise: Promise) = launch(promise, null) {
        Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
            .putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/json", "text/html", "text/plain", "application/octet-stream"))
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    @ReactMethod fun chooseExport(contents: String, html: Boolean, promise: Promise) {
        // Bound the bridge input before allocating its UTF-8 copy.
        if (contents.length > MAX_BYTES) { promise.reject("PORTABLE_FILE", "The export exceeds the 8 MB file limit"); return }
        val bytes = contents.toByteArray(Charsets.UTF_8)
        if (bytes.size > MAX_BYTES) { promise.reject("PORTABLE_FILE", "The export exceeds the 8 MB file limit"); return }
        launch(promise, bytes) {
            Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(if (html) "text/html" else "application/json")
                .putExtra(Intent.EXTRA_TITLE, if (html) "Yeoyu-bookmarks.html" else "Yeoyu-work.json")
                .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
    }
    private fun launch(promise: Promise, bytes: ByteArray?, intent: () -> Intent) {
        UiThreadUtil.runOnUiThread {
            if (pending != null) { promise.reject("PORTABLE_FILE", "Another file operation is still open"); return@runOnUiThread }
            val activity = reactApplicationContext.currentActivity
            if (activity == null || activity.isFinishing || activity.isDestroyed) {
                promise.reject("PORTABLE_FILE", "Open the browser window and try again"); return@runOnUiThread
            }
            if (nextRequest > 65530) { promise.reject("PORTABLE_FILE", "Restart the browser before opening another file"); return@runOnUiThread }
            val operation = Operation(activity, nextRequest++, promise, bytes)
            pending = operation
            main.postDelayed(timeout, 5 * 60_000L)
            try { activity.startActivityForResult(intent(), operation.requestCode) }
            catch (_: Exception) { finish(operation, Result.failure(IOException("The document picker could not be opened"))) }
        }
    }
    private fun finish(operation: Operation, result: Result<String?>) {
        if (pending !== operation) return
        pending = null
        main.removeCallbacks(timeout)
        result.fold({ operation.promise.resolve(it) }, {
            // Provider errors can embed filenames/URIs. Keep errors content-free.
            operation.promise.reject("PORTABLE_FILE", if (operation.bytes == null)
                "The file could not be read. It may be too large, invalid UTF-8 or unavailable. Existing data has been kept."
            else "The export could not be completed. The selected destination may contain an incomplete file.")
        })
    }
    private fun cancelPending() {
        val operation = pending ?: return
        operation.cancel()
        finish(operation, Result.failure(IOException("Browser window closed")))
    }
    override fun onHostResume() {}
    override fun onHostPause() {} // The document picker legitimately pauses the browser.
    override fun onHostDestroy() { cancelPending() }
    override fun invalidate() {
        synchronized(instances) { instances.remove(this) }
        reactApplicationContext.removeActivityEventListener(listener)
        reactApplicationContext.removeLifecycleEventListener(this)
        UiThreadUtil.runOnUiThread { cancelPending() }
        io.shutdownNow()
        super.invalidate()
    }
    companion object {
        private const val MAX_BYTES = 8 * 1024 * 1024
        private val instances = Collections.newSetFromMap(WeakHashMap<BrowserDataModule, Boolean>())

        /** A shared ReactHost survives other roots. Retire only this owner's waiting picker;
         * once a document was selected, application-owned I/O keeps its normal lifetime. */
        internal fun cancelForActivity(activity: Activity) {
            UiThreadUtil.runOnUiThread {
                val modules = synchronized(instances) { instances.toList() }
                modules.forEach { module ->
                    val operation = module.pending
                    if (operation?.awaitingResult == true && operation.owner.get() === activity) module.cancelPending()
                }
            }
        }
    }
}
