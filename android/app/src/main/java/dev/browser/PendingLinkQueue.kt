package dev.browser

import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID

internal data class PendingLink(val id: String, val url: String)
internal data class RejectedPendingLink(val id: String, val reason: String, val quarantineFile: String)

/** Disk replacement succeeds before the in-memory queue is changed. Never evicts unacked work. */
internal class PendingLinkQueue(private val file: File? = null,
    private val onRejected: (RejectedPendingLink) -> Unit = {}) {
    private var links = read()

    @Synchronized fun enqueue(url: String, id: String = UUID.randomUUID().toString()): PendingLink? {
        val accepted = ExternalLinkPolicy.webUri(url) ?: return null
        require(validRequestId(id)) { "Invalid external link request ID" }
        links.firstOrNull { it.id == id }?.let {
            require(it.url == accepted) { "External link request ID was reused" }
            return it
        }
        val link = PendingLink(id, accepted)
        val next = links + link
        write(next)
        links = next
        return link
    }

    @Synchronized fun pending(): List<PendingLink> = links.toList()

    /** A stricter downstream URL parser may reject a native-admitted address. */
    @Synchronized fun reject(id: String) {
        val record = links.firstOrNull { it.id == id } ?: return
        check(links.first().id == id) { "External links must be rejected in order" }
        val rejected = quarantine(record, "JS_WEB_ADDRESS_REJECTED")
        val next = links.drop(1)
        write(next)
        links = next
        onRejected(rejected)
    }

    @Synchronized fun acknowledge(id: String) {
        if (links.none { it.id == id }) return
        check(links.first().id == id) { "External links must be acknowledged in order" }
        val next = links.drop(1)
        write(next)
        links = next
    }

    private fun read(): List<PendingLink> {
        val source = file?.takeIf { it.exists() } ?: return emptyList()
        if (source.length() > 64 * 1024 * 1024) throw IOException("External link queue is too large to read")
        val loaded = DataInputStream(source.inputStream().buffered()).use { input ->
            if (input.readInt() != 1) throw IOException("Unsupported external link queue")
            val count = input.readInt()
            if (count < 0 || count > 1_000_000) throw IOException("Invalid external link count")
            val loaded = List(count) {
                val id = input.readUTF()
                val url = input.readUTF()
                PendingLink(id, url)
            }
            if (input.read() != -1)
                throw IOException("Invalid saved external link queue")
            loaded
        }
        val seen = mutableSetOf<String>()
        val rejected = mutableListOf<RejectedPendingLink>()
        val safe = loaded.mapNotNull { record ->
            val canonical = ExternalLinkPolicy.webUri(record.url)
            val reason = when {
                !validRequestId(record.id) -> "INVALID_REQUEST_ID"
                canonical == null -> "UNSAFE_WEB_ADDRESS"
                !seen.add(record.id) -> "DUPLICATE_REQUEST_ID"
                else -> null
            }
            if (reason != null) {
                // Quarantine the exact rejected bytes before removing the record. A failed
                // quarantine/rewrite fails visibly and leaves the original queue intact.
                rejected.add(quarantine(record, reason))
                null
            } else PendingLink(record.id, checkNotNull(canonical))
        }
        if (safe != loaded) write(safe)
        rejected.forEach(onRejected)
        return safe
    }

    private fun quarantine(record: PendingLink, reason: String): RejectedPendingLink {
        val source = file ?: throw IOException("A durable store is required to reject external links")
        val digest = java.security.MessageDigest.getInstance("SHA-256")
            .digest((record.id + "\u0000" + record.url).toByteArray(Charsets.UTF_8))
            .take(12).joinToString("") { "%02x".format(it.toInt() and 255) }
        val quarantine = File(source.parentFile, "${source.name}.rejected-$digest")
        atomicBrowserFile(quarantine) { output ->
            output.writeInt(1); output.writeUTF(record.id); output.writeUTF(record.url); output.writeUTF(reason)
        }
        return RejectedPendingLink(record.id, reason, quarantine.name)
    }

    private fun validRequestId(id: String): Boolean = Regex("[A-Za-z0-9_-]{1,128}").matches(id)

    private fun write(value: List<PendingLink>) {
        val target = file ?: return
        atomicBrowserFile(target) { output ->
            output.writeInt(1)
            output.writeInt(value.size)
            value.forEach { output.writeUTF(it.id); output.writeUTF(it.url) }
        }
    }
}

internal fun atomicBrowserFile(target: File, write: (DataOutputStream) -> Unit) {
    val directory = target.absoluteFile.parentFile ?: throw IOException("No storage directory")
    if (!directory.isDirectory && !directory.mkdirs()) throw IOException("Cannot create browser storage")
    val temporary = File.createTempFile(".${target.name}-", ".tmp", directory)
    try {
        FileOutputStream(temporary).use { stream ->
            val output = DataOutputStream(stream)
            write(output)
            output.flush()
            stream.fd.sync()
        }
        Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    } finally { temporary.delete() }
}
