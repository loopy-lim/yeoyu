package dev.browser

import java.io.IOException

/** Keep the in-memory preferences view consistent with a failed durable commit. */
internal class SnapshotPersistence(
    private val read: (String) -> String?,
    private val write: (Map<String, String?>) -> Boolean,
) {
    fun save(json: String) {
        val before = mapOf("snapshot" to read("snapshot"), "snapshot.lastGood" to read("snapshot.lastGood"))
        val candidate = mapOf("snapshot" to json, "snapshot.lastGood" to (before["snapshot"] ?: before["snapshot.lastGood"]))
        try {
            if (write(candidate)) return
        } catch (_: Exception) { /* Restore the prior memory view before reporting failure. */ }
        try { write(before) } catch (_: Exception) {}
        throw IOException("Snapshot write failed; previous data has been retained")
    }
}
