package dev.browser

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class DownloadJournalTest {
    private fun record(id: String, state: String = "running") = DownloadRecord(
        id, "file-$id.txt", "text/plain", state, 7, 100, null, null, 1, 2)

    @Test fun processRestartMarksUnfinishedTransfersInterruptedAndKeepsCompletedFiles() {
        val folder = Files.createTempDirectory("download-journal").toFile()
        try {
            val file = File(folder, "downloads")
            val store = DownloadJournal(file)
            store.write(listOf(record("a"), record("b", "completed").copy(uri = "content://downloads/2")))
            val restored = DownloadJournal(file).recover(10)
            assertEquals("interrupted", restored[0].state)
            assertNotNull(restored[0].error)
            assertEquals("completed", restored[1].state)
            assertEquals("content://downloads/2", restored[1].uri)
            assertEquals(restored, DownloadJournal(file).read())
        } finally { folder.deleteRecursively() }
    }

    @Test fun retentionKeepsEveryActiveJobAndNewestTerminalRecords() {
        val folder = Files.createTempDirectory("download-retention").toFile()
        try {
            val store = DownloadJournal(File(folder, "downloads"), maxRecords = 3)
            store.write(listOf(record("active"), record("old", "failed"), record("recent", "completed"), record("new", "cancelled")))
            assertEquals(listOf("active", "recent", "new"), store.read().map { it.id })
        } finally { folder.deleteRecursively() }
    }

    @Test fun corruptJournalIsReportedAndNeverSilentlyReplacedWithEmptyHistory() {
        val folder = Files.createTempDirectory("download-corrupt").toFile()
        try {
            val file = File(folder, "downloads").apply { writeText("broken") }
            try { DownloadJournal(file).recover(10); fail("must reject corrupt data") }
            catch (_: java.io.IOException) { }
            assertEquals("broken", file.readText())
        } finally { folder.deleteRecursively() }
    }
}
