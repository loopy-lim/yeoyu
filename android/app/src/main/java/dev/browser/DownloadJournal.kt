package dev.browser

import java.io.DataInputStream
import java.io.File
import java.io.IOException

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
internal class DownloadJournal(private val file: File, private val maxRecords: Int = 100) {
    fun retain(records: List<DownloadRecord>): List<DownloadRecord> {
        val active = records.filter { it.active }
        val retained = records.filterNot { it.active }.takeLast((maxRecords - active.size).coerceAtLeast(0)).map { it.id }.toSet()
        return records.filter { it.active || it.id in retained }
    }

    fun read(): List<DownloadRecord> {
        if (!file.exists()) return emptyList()
        if (file.length() > 4 * 1024 * 1024) throw IOException("Download history is too large")
        return DataInputStream(file.inputStream().buffered()).use { input ->
            if (input.readInt() != 1) throw IOException("Unsupported download history")
            val count = input.readInt()
            if (count < 0 || count > 10_000) throw IOException("Invalid download count")
            val records = List(count) {
                DownloadRecord(input.readUTF(), input.readUTF(), input.readUTF(), input.readUTF(),
                    input.readLong(), input.readLong().takeIf { it >= 0 },
                    input.readUTF().ifEmpty { null }, input.readUTF().ifEmpty { null },
                    input.readLong(), input.readLong(), input.readUTF().ifEmpty { null })
            }
            if (records.any { it.id.isEmpty() || it.bytes < 0 || it.state !in setOf("queued", "running", "completed", "failed", "cancelled", "interrupted") } ||
                records.map { it.id }.toSet().size != records.size || input.read() != -1)
                throw IOException("Invalid download history")
            records
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
