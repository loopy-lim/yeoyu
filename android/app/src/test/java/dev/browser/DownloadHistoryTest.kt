package dev.browser

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class DownloadHistoryTest {
    private fun record(id: String, state: String = "running") = DownloadRecord(
        id, "$id.txt", "text/plain", state, 1, 100, null, null, 1, 2,
        pendingUri = "content://media/external/downloads/123")

    @Test fun damagedHistoryStaysBlockedUntilExplicitRecoveryAndNeverRunsPendingCleanup() {
        val folder = Files.createTempDirectory("download-history").toFile()
        try {
            val file = File(folder, "downloads")
            val journal = DownloadJournal(file)
            journal.write(listOf(record("unfinished"), record("saved", "completed")))
            val original = file.readBytes().dropLast(1).toByteArray()
            file.writeBytes(original)
            val history = DownloadHistory(journal)
            val cleaned = mutableListOf<DownloadRecord>()
            repeat(2) { assertFalse(history.load(10) { cleaned.add(it); it }) }
            assertEquals("damaged", history.state)
            assertTrue(history.canReset)
            assertNull(history.writableJournal)
            assertEquals(emptyList<DownloadRecord>(), cleaned)
            assertArrayEquals(original, file.readBytes())
            assertTrue(history.recover(20) { cleaned.add(it); it })
            assertEquals("ready", history.state)
            assertEquals(emptyList<DownloadRecord>(), cleaned)
            assertArrayEquals(original, File(folder, history.backupName!!).readBytes())
        } finally { folder.deleteRecursively() }
    }

    @Test fun retryAndRecoveryNeverReloadOrInterruptInProcessJobs() {
        val folder = Files.createTempDirectory("download-live").toFile()
        try {
            val file = File(folder, "downloads")
            val history = DownloadHistory(DownloadJournal(file))
            assertTrue(history.load(10))
            val active = listOf(record("active"))
            history.records = active
            history.writableJournal!!.write(active)
            repeat(2) { assertTrue(history.load(20)); assertTrue(history.recover(20)) }
            assertEquals(active, history.records)
            assertEquals(active, DownloadJournal(file).read())
            assertNull(history.backupName)
        } finally { folder.deleteRecursively() }
    }

    @Test fun unreadableStorageCanBeRetriedWithoutResettingHistory() {
        val folder = Files.createTempDirectory("download-unavailable").toFile()
        try {
            val file = File(folder, "downloads").apply { mkdir() }
            val history = DownloadHistory(DownloadJournal(file))
            assertFalse(history.load(10))
            assertEquals("unavailable", history.state)
            assertFalse(history.canReset)
            assertFalse(history.recover(10))
            assertTrue(file.isDirectory)
            file.delete()
            DownloadJournal(file).write(listOf(record("saved", "completed")))
            assertTrue(history.load(20))
            assertEquals("saved", history.records.single().id)
        } finally { folder.deleteRecursively() }
    }

    @Test fun validInterruptedRecoveryOnlyCleansUnfinishedRecords() {
        val folder = Files.createTempDirectory("download-interrupted").toFile()
        try {
            val journal = DownloadJournal(File(folder, "downloads"))
            journal.write(listOf(record("unfinished"), record("completed", "completed")))
            val history = DownloadHistory(journal)
            val cleaned = mutableListOf<String>()
            assertTrue(history.load(10) { cleaned.add(it.id); it.copy(pendingUri = null) })
            assertEquals(listOf("unfinished"), cleaned)
            assertEquals("interrupted", history.records[0].state)
            assertEquals("completed", history.records[1].state)
            assertNull(history.records[0].pendingUri)
            assertEquals(history.records, journal.read())
        } finally { folder.deleteRecursively() }
    }
}
