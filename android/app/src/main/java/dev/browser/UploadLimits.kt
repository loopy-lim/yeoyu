package dev.browser

import java.io.InterruptedIOException
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

internal data class UploadLimits(val maxFileBytes: Long = 256L * 1024 * 1024,
    val maxBatchBytes: Long = 512L * 1024 * 1024, val maxStoreBytes: Long = 1024L * 1024 * 1024,
    val maxFiles: Int = 100, val timeoutMillis: Long = 120_000) {
    init {
        require(maxFileBytes > 0 && maxBatchBytes > 0 && maxStoreBytes > 0 && maxFiles > 0 && timeoutMillis > 0)
    }
}
internal class UploadLimitException(message: String) : IOException(message)

/** Resources registered after cancellation are also closed, covering a provider that opens late. */
internal class UploadCancellation {
    @Volatile var isCanceled: Boolean = false; private set
    private val resources = mutableSetOf<AutoCloseable>()
    fun register(resource: AutoCloseable) {
        val close = synchronized(this) { if (isCanceled) true else { resources.add(resource); false } }
        if (close) runCatching { resource.close() }
    }
    fun unregister(resource: AutoCloseable) { synchronized(this) { resources.remove(resource) } }
    fun cancel() {
        val closing = synchronized(this) {
            isCanceled = true
            resources.toList().also { resources.clear() }
        }
        closing.forEach { runCatching { it.close() } }
    }
    fun check() { if (isCanceled) throw InterruptedIOException("File selection canceled or timed out") }
}

internal object UploadDeadline {
    private val scheduler = Executors.newScheduledThreadPool(2) { task ->
        Thread(task, "yeoyu-upload-timeout").apply { isDaemon = true }
    }
    fun schedule(delayMillis: Long, cancel: () -> Unit) = scheduler.schedule(cancel, delayMillis, TimeUnit.MILLISECONDS)
}
