package dev.browser

import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.UUID

internal data class UploadSource(val filename: String, val open: () -> InputStream)

internal class StagedUpload(private val directory: File, val files: List<File>, private val released: () -> Unit = {}) : AutoCloseable {
    private var closed = false
    @Synchronized override fun close() {
        if (closed) return
        if (!directory.deleteRecursively()) throw IOException("Could not remove upload copies")
        closed = true
        released()
    }
}

internal class UploadStaging(private val root: File, private val limits: UploadLimits = UploadLimits()) {
    private var reservedBytes = 0L
    init {
        // Constructed once per app process. No page in this process can
        // still refer to a copy left by an earlier process.
        if (!root.isDirectory && !root.mkdirs()) throw IOException("Upload storage is unavailable")
        root.listFiles()?.forEach {
            if (!it.deleteRecursively()) throw IOException("Could not clear old upload copies")
        }
    }

    fun stage(sources: List<UploadSource>, canceled: () -> Boolean = { false },
        cancellation: UploadCancellation = UploadCancellation()): StagedUpload {
        if (sources.isEmpty() || sources.size > limits.maxFiles) throw UploadLimitException("Choose up to ${limits.maxFiles} files")
        cancellation.check()
        val directory = File(root, UUID.randomUUID().toString())
        if (!directory.mkdir()) throw IOException("Could not prepare the selected files")
        var batchBytes = 0L
        val deadline = UploadDeadline.schedule(limits.timeoutMillis) { cancellation.cancel() }
        fun checkCanceled() {
            if (canceled()) cancellation.cancel()
            cancellation.check()
        }
        try {
            val files = sources.mapIndexed { index, source ->
                checkCanceled()
                // Each selected file gets its own folder, so duplicate
                // filenames keep their web-visible name without overwriting.
                val folder = File(directory, index.toString())
                if (!folder.mkdir()) throw IOException("Could not prepare the selected file")
                val file = File(folder, safeName(source.filename))
                var fileBytes = 0L
                source.open().use { input ->
                    cancellation.register(input)
                    file.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            checkCanceled()
                            val read = input.read(buffer)
                            if (read < 0) break
                            checkCanceled()
                            if (read == 0) continue
                            if (read > limits.maxFileBytes - fileBytes)
                                throw UploadLimitException("Each file must be ${limits.maxFileBytes / (1024 * 1024)} MB or smaller")
                            if (read > limits.maxBatchBytes - batchBytes)
                                throw UploadLimitException("The selected files exceed the upload size limit")
                            reserve(read.toLong())
                            batchBytes += read; fileBytes += read
                            output.write(buffer, 0, read)
                        }
                    }
                    cancellation.unregister(input)
                }
                file
            }
            checkCanceled()
            val retainedBytes = batchBytes
            return StagedUpload(directory, files) { release(retainedBytes) }
        } catch (failure: Exception) {
            if (!directory.deleteRecursively())
                failure.addSuppressed(IOException("Could not remove the incomplete upload copy"))
            else release(batchBytes)
            throw failure
        } finally {
            deadline.cancel(false)
        }
    }

    @Synchronized private fun reserve(bytes: Long) {
        if (bytes > limits.maxStoreBytes - reservedBytes)
            throw UploadLimitException("Upload storage is full. Close tabs with selected files and try again")
        // Preserve working room for session snapshots and other browser writes.
        if (root.usableSpace < bytes + 64L * 1024 * 1024)
            throw UploadLimitException("There is not enough free space to prepare these files")
        reservedBytes += bytes
    }
    @Synchronized private fun release(bytes: Long) { reservedBytes -= bytes }

    private fun safeName(value: String): String = value
        .replace(Regex("[\\p{Cntrl}/\\\\]"), "_").trim().take(80)
        .takeUnless { it.isEmpty() || it == "." || it == ".." } ?: "upload"
}
