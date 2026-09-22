package dev.browser

import java.io.DataInputStream
import java.io.File
import java.io.IOException
import java.io.EOFException
import java.io.UTFDataFormatException

internal data class DownloadRecord(
    val id: String,
    val filename: String,
    val mimeType: String,
    val state: String,
    val bytes: Long,
    val totalBytes: Long?,
    val uri: String?,
    val error: String?,
    val createdAt: Long,
    val updatedAt: Long,
    val pendingUri: String? = null,
) {
    val active: Boolean get() = state == "queued" || state == "running"
}

/** Accessed only by the coordinator's state worker. Partial/corrupt history is never treated as empty. */
internal class DownloadHistoryException(val state: String, message: String, cause: Throwable? = null) : IOException(message, cause)

internal class DownloadJournal(private val file: File, private val maxRecords: Int = 100,
    private val backup: (File, File) -> Unit = { source, target ->
        atomicBrowserFile(target) { output -> source.inputStream().use { it.copyTo(output) } }
    }) {
    var backupName: String? = null
        private set

    /** Explicit user recovery only. Never interpret partial records or follow their pending URIs. */
    fun resetDamagedHistory(): String? {
        try { read(); return null }
        catch (failure: DownloadHistoryException) { if (failure.state != "damaged") throw failure }
        val preserved = File(file.absoluteFile.parentFile, "${file.name}.damaged-${java.util.UUID.randomUUID()}")
        backup(file, preserved)
        if (!preserved.isFile || file.length() != preserved.length() || !digest(file).contentEquals(digest(preserved)))
            throw IOException("The download history backup could not be verified. The original history was kept.")
        backupName = preserved.name
        write(emptyList())
        return preserved.name
    }

    private fun digest(source: File): ByteArray {
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        source.inputStream().use { input ->
            val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest()
    }
    fun retain(records: List<DownloadRecord>): List<DownloadRecord> {
        val active = records.filter { it.active }
        val retained = records.filterNot { it.active }.takeLast((maxRecords - active.size).coerceAtLeast(0)).map { it.id }.toSet()
        return records.filter { it.active || it.id in retained }
    }

    fun read(): List<DownloadRecord> {
        if (!file.exists()) return emptyList()
        return try { DataInputStream(file.inputStream().buffered()).use { input ->
            val version = input.readInt()
            if (version > 1) throw DownloadHistoryException("unsupported", "This download history needs a newer version of Yeoyu. Update the app, then retry. History and downloaded files were kept.")
            if (version != 1) throw DownloadHistoryException("damaged", "Invalid download history version")
            if (file.length() > 4 * 1024 * 1024) throw DownloadHistoryException("damaged", "Download history is too large")
            val count = input.readInt()
            if (count < 0 || count > 10_000) throw DownloadHistoryException("damaged", "Invalid download count")
            val records = List(count) {
                DownloadRecord(input.readUTF(), input.readUTF(), input.readUTF(), input.readUTF(),
                    input.readLong(), input.readLong().takeIf { it >= 0 },
                    input.readUTF().ifEmpty { null }, input.readUTF().ifEmpty { null },
                    input.readLong(), input.readLong(), input.readUTF().ifEmpty { null })
            }
            if (records.any { it.id.isEmpty() || it.bytes < 0 || it.state !in setOf("queued", "running", "completed", "failed", "cancelled", "interrupted") } ||
                records.map { it.id }.toSet().size != records.size || input.read() != -1)
                throw DownloadHistoryException("damaged", "Invalid download history")
            records
        } } catch (failure: EOFException) {
            throw DownloadHistoryException("damaged", "Download history is incomplete", failure)
        } catch (failure: UTFDataFormatException) {
            throw DownloadHistoryException("damaged", "Download history contains invalid text", failure)
        }
    }

    fun recover(now: Long): List<DownloadRecord> {
        val before = read()
        val after = before.map { if (it.active) it.copy(state = "interrupted", updatedAt = now,
            error = "The app stopped before this download finished. Download it again from the web page.") else it }
        if (after != before) write(after)
        return retain(after)
    }

    fun write(records: List<DownloadRecord>) {
        val kept = retain(records)
        atomicBrowserFile(file) { output ->
            output.writeInt(1)
            output.writeInt(kept.size)
            kept.forEach {
                output.writeUTF(it.id); output.writeUTF(it.filename); output.writeUTF(it.mimeType); output.writeUTF(it.state)
                output.writeLong(it.bytes); output.writeLong(it.totalBytes ?: -1)
                output.writeUTF(it.uri.orEmpty()); output.writeUTF(it.error.orEmpty().take(4000))
                output.writeLong(it.createdAt); output.writeLong(it.updatedAt); output.writeUTF(it.pendingUri.orEmpty())
            }
        }
    }
}
