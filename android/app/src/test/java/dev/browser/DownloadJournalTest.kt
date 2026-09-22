package dev.browser

import java.io.File
import java.io.DataOutputStream
import java.io.ByteArrayOutputStream
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

    @Test fun explicitRepairPreservesExactTruncatedBytesBeforeStartingNewHistory() {
        val folder = Files.createTempDirectory("download-repair").toFile()
        try {
            val file = File(folder, "downloads")
            val store = DownloadJournal(file)
            store.write(listOf(record("unfinished")))
            val original = file.readBytes().dropLast(3).toByteArray()
            file.writeBytes(original)
            val backup = store.resetDamagedHistory()
            assertNotNull(backup)
            assertArrayEquals(original, File(folder, backup!!).readBytes())
            assertEquals(emptyList<DownloadRecord>(), store.read())
            store.write(listOf(record("new", "completed")))
            assertEquals("new", store.read().single().id)
        } finally { folder.deleteRecursively() }
    }

    @Test fun unknownNewerVersionCannotBeResetEvenAfterExplicitRequest() {
        val folder = Files.createTempDirectory("download-version").toFile()
        try {
            val file = File(folder, "downloads")
            DataOutputStream(file.outputStream()).use { it.writeInt(2); it.writeUTF("future format") }
            val original = file.readBytes()
            try { DownloadJournal(file).resetDamagedHistory(); fail("must preserve newer history") }
            catch (failure: DownloadHistoryException) { assertEquals("unsupported", failure.state) }
            assertArrayEquals(original, file.readBytes())
            assertEquals(1, folder.listFiles()!!.size)
        } finally { folder.deleteRecursively() }
    }

    @Test fun failedBackupNeverReplacesDamagedHistory() {
        val folder = Files.createTempDirectory("download-backup-failed").toFile()
        try {
            val file = File(folder, "downloads").apply { writeBytes(byteArrayOf(0, 0, 0)) }
            val original = file.readBytes()
            val store = DownloadJournal(file, backup = { _, _ -> throw java.io.IOException("disk full") })
            try { store.resetDamagedHistory(); fail("must not reset without a backup") }
            catch (_: java.io.IOException) { }
            assertArrayEquals(original, file.readBytes())
        } finally { folder.deleteRecursively() }
    }

    @Test fun incompleteBackupIsRejectedWithoutChangingOriginal() {
        val folder = Files.createTempDirectory("download-backup-incomplete").toFile()
        try {
            val file = File(folder, "downloads").apply { writeBytes(byteArrayOf(0, 0, 0)) }
            val original = file.readBytes()
            val store = DownloadJournal(file, backup = { _, target -> target.writeBytes(byteArrayOf(0)) })
            try { store.resetDamagedHistory(); fail("must verify the backup") }
            catch (_: java.io.IOException) { }
            assertArrayEquals(original, file.readBytes())
        } finally { folder.deleteRecursively() }
    }

    @Test fun validHistoryIsNeverResetByAStaleRecoveryRequest() {
        val folder = Files.createTempDirectory("download-valid").toFile()
        try {
            val store = DownloadJournal(File(folder, "downloads"))
            val entries = listOf(record("saved", "completed").copy(uri = "content://media/external/downloads/4"))
            store.write(entries)
            assertNull(store.resetDamagedHistory())
            assertEquals(entries, store.read())
        } finally { folder.deleteRecursively() }
    }

    @Test fun corruptionMatrixPreservesAllBytesUntilExplicitBackupAndReset() {
        fun encoded(write: (DataOutputStream) -> Unit): ByteArray = ByteArrayOutputStream().also { buffer ->
            DataOutputStream(buffer).use(write)
        }.toByteArray()
        val cases = listOf(byteArrayOf(), byteArrayOf(0, 0, 0),
            encoded { it.writeInt(1) },
            encoded { it.writeInt(1); it.writeInt(-1) },
            encoded { it.writeInt(1); it.writeInt(10_001) },
            encoded { it.writeInt(1); it.writeInt(0); it.writeByte(42) })
        val folder = Files.createTempDirectory("download-corruption-matrix").toFile()
        try {
            for ((index, bytes) in cases.withIndex()) {
                val file = File(folder, "downloads-$index").apply { writeBytes(bytes) }
                val store = DownloadJournal(file)
                try { store.read(); fail("must reject damaged case $index") }
                catch (failure: DownloadHistoryException) { assertEquals("damaged", failure.state) }
                assertArrayEquals(bytes, file.readBytes())
                val backup = store.resetDamagedHistory()!!
                assertArrayEquals(bytes, File(folder, backup).readBytes())
                assertEquals(emptyList<DownloadRecord>(), store.read())
            }
        } finally { folder.deleteRecursively() }
    }

    @Test fun invalidRecordsAndDuplicateIdsCannotAuthorizePartialRecovery() {
        val folder = Files.createTempDirectory("download-record-corruption").toFile()
        try {
            for ((index, entries) in listOf(listOf(record("a"), record("a")),
                listOf(record("a", "unknown")), listOf(record("a").copy(bytes = -1))).withIndex()) {
                val store = DownloadJournal(File(folder, "downloads-$index"))
                store.write(entries)
                try { store.read(); fail("must reject invalid records") }
                catch (failure: DownloadHistoryException) { assertEquals("damaged", failure.state) }
            }
        } finally { folder.deleteRecursively() }
    }
}
