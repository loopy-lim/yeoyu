package dev.browser

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

internal const val SESSION_ENGINE_VERSION = "155.0.20260903215306"
internal const val MAX_SESSION_STATE_BYTES = 2 * 1024 * 1024

internal data class StoredSessionState(val id: String, val url: String, val state: String, val savedAt: Long) {
    val byteSize: Int = state.toByteArray(Charsets.UTF_8).size
}
internal data class SessionStateRead(val states: Map<String, StoredSessionState>, val issues: List<String>)

/** Single IO worker owns this directory. No Gecko or Android classes are needed. */
internal class SessionStateStore(
    private val directory: File,
    private val engineVersion: String,
    private val maxStateBytes: Int = MAX_SESSION_STATE_BYTES,
    private val maxTotalBytes: Long = 20L * 1024 * 1024,
    private val maxAgeMillis: Long = 30L * 24 * 60 * 60 * 1000,
) {
    fun write(value: StoredSessionState, now: Long) {
        require(value.id.isNotEmpty() && value.id.length <= 256) { "Invalid session identifier" }
        require(value.url.toByteArray(Charsets.UTF_8).size <= 16_384) { "Session URL is too large" }
        require(value.byteSize <= maxStateBytes) { "Session state is too large" }
        val bytes = ByteArrayOutputStream().also { output ->
            DataOutputStream(output).use { data ->
                data.writeInt(0x59535331)
                data.writeInt(1)
                data.writeString(engineVersion)
                data.writeLong(value.savedAt)
                data.writeString(value.id)
                data.writeString(value.url)
                data.writeString(value.state)
            }
        }.toByteArray()
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        AtomicBrowserFile.write(fileFor(value.id), bytes + digest)
        enforceBudget(now, fileFor(value.id).name)
    }

    fun readAll(now: Long): SessionStateRead {
        files().filter { it.extension == "new" && it.isFile }.forEach(::delete)
        val issues = mutableListOf<String>()
        val result = linkedMapOf<String, StoredSessionState>()
        for (file in files().filter { it.extension == "state" }) {
            try {
                val value = read(file)
                if (value.savedAt > now + 60_000 || now - value.savedAt > maxAgeMillis) {
                    delete(file)
                } else result[value.id] = value
            } catch (_: Exception) {
                // Keep only a small, bounded local recovery copy; never log its contents.
                issues.add("A saved tab could not be restored and was quarantined")
                val target = File(directory, file.name + "." + System.nanoTime() + ".bad")
                Files.move(file.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
                target.setLastModified(now)
            }
        }
        enforceBudget(now)
        val retained = files().filter { it.extension == "state" }.map { it.name }.toSet()
        return SessionStateRead(result.filter { fileFor(it.key).name in retained }, issues)
    }

    fun remove(id: String) { delete(fileFor(id)) }
    fun reconcile(ids: Set<String>) {
        val keep = ids.map { fileFor(it).name }.toSet()
        files().filter { it.extension == "state" && it.name !in keep }.forEach(::delete)
    }
    fun clear() { files().filter { it.extension in setOf("state", "bad", "new") }.forEach(::delete) }

    private fun read(file: File): StoredSessionState {
        if (file.length() !in 40..(maxStateBytes + 32_768L)) throw IOException("Invalid session file size")
        val bytes = file.readBytes()
        val body = bytes.copyOfRange(0, bytes.size - 32)
        if (!MessageDigest.isEqual(MessageDigest.getInstance("SHA-256").digest(body), bytes.copyOfRange(bytes.size - 32, bytes.size)))
            throw IOException("Invalid session checksum")
        return DataInputStream(ByteArrayInputStream(body)).use { input ->
            if (input.readInt() != 0x59535331 || input.readInt() != 1 || input.readString(128) != engineVersion)
                throw IOException("Incompatible session format")
            val savedAt = input.readLong()
            val id = input.readString(1_024)
            val url = input.readString(16_384)
            val state = input.readString(maxStateBytes)
            if (input.available() != 0 || id.isEmpty() || fileFor(id).name != file.name)
                throw IOException("Invalid session identity")
            StoredSessionState(id, url, state, savedAt)
        }
    }

    private fun fileFor(id: String): File {
        val name = MessageDigest.getInstance("SHA-256").digest(id.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
        return File(directory, "$name.state")
    }

    private fun files(): List<File> {
        if (!directory.exists()) return emptyList()
        return directory.listFiles()?.toList() ?: throw IOException("Session directory cannot be read")
    }

    private fun enforceBudget(now: Long, newest: String? = null) {
        var total = 0L
        files().filter { it.extension == "state" }.sortedWith(compareByDescending<File> { it.name == newest }.thenByDescending { it.lastModified() }).forEach { file ->
            total += file.length()
            if (total > maxTotalBytes) delete(file)
        }
        var quarantineBytes = 0L
        files().filter { it.extension == "bad" }.sortedByDescending { it.lastModified() }.forEachIndexed { index, file ->
            quarantineBytes += file.length()
            if (index >= 3 || quarantineBytes > 6L * 1024 * 1024 || now - file.lastModified() > 7L * 24 * 60 * 60 * 1000)
                delete(file)
        }
    }

    private fun delete(file: File) {
        if (file.exists() && !file.delete()) throw IOException("Saved session could not be removed")
    }

    private fun DataOutputStream.writeString(value: String) {
        val bytes = value.toByteArray(Charsets.UTF_8)
        writeInt(bytes.size)
        write(bytes)
    }
    private fun DataInputStream.readString(max: Int): String {
        val length = readInt()
        if (length < 0 || length > max || length > available()) throw IOException("Invalid session field size")
        val bytes = ByteArray(length)
        readFully(bytes)
        return bytes.toString(Charsets.UTF_8)
    }
}

internal object AtomicBrowserFile {
    fun write(file: File, bytes: ByteArray) {
        val parent = file.parentFile ?: throw IOException("Storage directory is missing")
        if (!parent.isDirectory && !parent.mkdirs()) throw IOException("Storage directory cannot be created")
        val temporary = File(parent, file.name + ".new")
        try {
            FileOutputStream(temporary).use { stream ->
                stream.write(bytes)
                stream.flush()
                stream.fd.sync()
            }
            Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } finally {
            if (temporary.isFile) temporary.delete()
        }
    }
}

/** Persists the no-autoload barrier independently of opt-in page restoration. */
internal class PausedSessionStore(private val file: File) {
    fun read(): Set<String> {
        if (!file.exists()) return emptySet()
        if (file.length() > 1024 * 1024) throw IOException("Paused tab list is too large")
        val data = JSONObject(file.readText(Charsets.UTF_8))
        if (data.get("schema") != 1) throw IOException("Unsupported paused tab list")
        val ids = data.getJSONArray("ids")
        if (ids.length() > 10_000) throw IOException("Paused tab list is too large")
        return (0 until ids.length()).map { index ->
            (ids.get(index) as? String)?.takeIf { it.isNotEmpty() && it.length <= 256 }
                ?: throw IOException("Invalid paused tab identifier")
        }.toSet()
    }

    fun write(ids: Set<String>) {
        require(ids.size <= 10_000 && ids.all { it.isNotEmpty() && it.length <= 256 }) { "Invalid paused tab list" }
        val bytes = JSONObject().apply {
            put("schema", 1)
            put("ids", JSONArray(ids.sorted()))
        }.toString().toByteArray(Charsets.UTF_8)
        require(bytes.size <= 1024 * 1024) { "Paused tab list is too large" }
        AtomicBrowserFile.write(file, bytes)
    }
}
