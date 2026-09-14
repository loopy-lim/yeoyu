package dev.browser

import java.io.InputStream
import java.io.OutputStream
import java.io.IOException
import java.net.URI
import java.net.URLDecoder

internal data class SavedDownload(val filename: String, val location: String, val uri: String, val bytes: Long)

internal interface DownloadDestination {
    val output: OutputStream
    fun complete(bytes: Long): SavedDownload
    fun abort()
}

internal class DownloadCancelledException : IOException("Download cancelled")

internal class DownloadCancellation {
    private val lock = Any()
    private var cancelled = false
    private var finished = false
    private var body: InputStream? = null
    fun attach(input: InputStream) {
        val close = synchronized(lock) { body = input; cancelled }
        if (close) runCatching { input.close() }
    }
    fun cancel(): Boolean {
        val input = synchronized(lock) {
            if (cancelled || finished) return false
            cancelled = true
            body
        }
        runCatching { input?.close() }
        return true
    }
    fun throwIfCancelled() { synchronized(lock) { if (cancelled) throw DownloadCancelledException() } }
    fun <T> complete(block: () -> T): T = synchronized(lock) {
        if (cancelled) throw DownloadCancelledException()
        block().also { finished = true; body = null }
    }
    fun detach() { synchronized(lock) { body = null } }
}

/** Consumes the received response once, with bounded memory and rollback. */
internal object DownloadTransfer {
    fun save(body: InputStream, cancellation: DownloadCancellation = DownloadCancellation(),
        progress: (Long) -> Unit = {}, expectedBytes: Long? = null,
        createDestination: () -> DownloadDestination): SavedDownload {
        var destination: DownloadDestination? = null
        cancellation.attach(body)
        try {
            val bytes = body.use { input ->
                cancellation.throwIfCancelled()
                val target = createDestination().also { destination = it }
                target.output.use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var count = 0L
                    while (true) {
                        cancellation.throwIfCancelled()
                        val read = input.read(buffer)
                        cancellation.throwIfCancelled()
                        if (read < 0) break
                        if (read == 0) continue
                        output.write(buffer, 0, read)
                        count += read
                        progress(count)
                    }
                    count
                }
            }
            if (expectedBytes != null && bytes != expectedBytes)
                throw IOException("Download size did not match the response ($bytes of $expectedBytes bytes)")
            return cancellation.complete { checkNotNull(destination).complete(bytes) }
        } catch (failure: Exception) {
            try { destination?.abort() } catch (cleanup: Exception) { failure.addSuppressed(cleanup) }
            cancellation.throwIfCancelled()
            throw failure
        } finally {
            cancellation.detach()
        }
    }

    fun filename(uri: String, disposition: String?): String {
        val extended = disposition?.let {
            Regex("(?:^|;)\\s*filename\\*\\s*=\\s*(?:\"([^\"]*)\"|([^;]*))", RegexOption.IGNORE_CASE)
                .find(it)?.let { match -> match.groups[1]?.value ?: match.groups[2]?.value }
        }?.trim()?.let { value ->
            val parts = value.split("'", limit = 3)
            if (parts.size == 3 && (parts[0].equals("UTF-8", true) || parts[0].equals("ISO-8859-1", true))) {
                runCatching { URLDecoder.decode(parts[2].replace("+", "%2B"), parts[0]) }.getOrNull()
            } else null
        }
        val plain = disposition?.let {
            Regex("(?:^|;)\\s*filename\\s*=\\s*(?:\"((?:\\\\.|[^\"])*)\"|([^;]*))", RegexOption.IGNORE_CASE)
                .find(it)?.let { match -> match.groups[1]?.value ?: match.groups[2]?.value }
        }?.replace("\\\"", "\"")?.replace("\\\\", "\\")
        val path = runCatching {
            val source = URI(uri)
            if (source.scheme.equals("http", true) || source.scheme.equals("https", true)) {
                source.path?.substringAfterLast('/')
            } else null
        }.getOrNull()
        return (extended ?: plain ?: path ?: "download")
            .replace(Regex("[\\p{Cntrl}/\\\\]"), "_")
            .trim().take(180)
            .takeUnless { it.isEmpty() || it == "." || it == ".." } ?: "download"
    }

    fun mimeType(contentType: String?): String {
        val value = contentType?.substringBefore(';')?.trim()?.lowercase().orEmpty()
        return value.takeIf { Regex("[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+").matches(it) }
            ?: "application/octet-stream"
    }
}
