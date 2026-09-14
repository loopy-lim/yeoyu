package dev.browser

import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class UploadStagingTest {
    private fun withRoot(body: (File) -> Unit) {
        val directory = Files.createTempDirectory("yeoyu-upload-test").toFile()
        try { body(directory) } finally { directory.deleteRecursively() }
    }

    @Test fun providerBytesBecomeReadableFilesWithOriginalNamesAndClosedStreams() = withRoot { root ->
        val bytes = byteArrayOf(0, 1, 2, -128, -1)
        var closed = false
        val store = UploadStaging(File(root, "uploads"))
        val staged = store.stage(listOf(UploadSource("yeoyu-post-contract.txt") {
            object : ByteArrayInputStream(bytes) {
                override fun close() { closed = true; super.close() }
            }
        }))
        val file = staged.files.single()
        assertEquals("yeoyu-post-contract.txt", file.name)
        assertTrue(file.isFile)
        assertArrayEquals(bytes, file.readBytes())
        assertTrue(closed)
        staged.close()
        assertFalse(file.exists())
    }

    @Test fun partialSelectionFailureDeletesOnlyItsBatchAndClosesTheBrokenStream() = withRoot { root ->
        val uploadRoot = File(root, "uploads")
        val store = UploadStaging(uploadRoot)
        val previous = store.stage(listOf(UploadSource("previous.txt") { ByteArrayInputStream(byteArrayOf(1)) }))
        var closed = false
        try {
            store.stage(listOf(
                UploadSource("first.txt") { ByteArrayInputStream(byteArrayOf(2)) },
                UploadSource("broken.txt") {
                    object : ByteArrayInputStream(byteArrayOf(3)) {
                        override fun read(buffer: ByteArray, offset: Int, length: Int): Int = throw IOException("provider failed")
                        override fun close() { closed = true }
                    }
                },
            ))
            fail("expected provider failure")
        } catch (failure: IOException) { assertEquals("provider failed", failure.message) }
        assertTrue(closed)
        assertArrayEquals(byteArrayOf(1), previous.files.single().readBytes())
        assertEquals(1, uploadRoot.listFiles()!!.size)
    }

    @Test fun cancelDuringCopyClosesTheInputAndRemovesPartialFiles() = withRoot { root ->
        var canceled = false
        var closed = false
        val uploadRoot = File(root, "uploads")
        val store = UploadStaging(uploadRoot)
        try {
            store.stage(listOf(UploadSource("large.bin") {
                object : ByteArrayInputStream(ByteArray(128 * 1024)) {
                    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                        canceled = true
                        return super.read(buffer, offset, length)
                    }
                    override fun close() { closed = true }
                }
            }), { canceled })
            fail("expected canceled transfer")
        } catch (_: IOException) {}
        assertTrue(closed)
        assertTrue(uploadRoot.listFiles()!!.isEmpty())
    }

    @Test fun duplicateNamesRemainDistinctAndHostileNamesStayInsideTheUploadDirectory() = withRoot { root ->
        val uploadRoot = File(root, "uploads")
        val store = UploadStaging(uploadRoot)
        val staged = store.stage(listOf(
            UploadSource("report.txt") { ByteArrayInputStream(byteArrayOf(1)) },
            UploadSource("report.txt") { ByteArrayInputStream(byteArrayOf(2)) },
            UploadSource("../../보고서.txt") { ByteArrayInputStream(byteArrayOf(3)) },
        ))
        assertEquals("report.txt", staged.files[0].name)
        assertEquals("report.txt", staged.files[1].name)
        assertNotEquals(staged.files[0], staged.files[1])
        assertArrayEquals(byteArrayOf(1), staged.files[0].readBytes())
        assertArrayEquals(byteArrayOf(2), staged.files[1].readBytes())
        assertTrue(staged.files.all { it.canonicalPath.startsWith(uploadRoot.canonicalPath + File.separator) })
    }

    @Test fun aNewProcessClearsOldStagingCopiesWithoutTouchingOtherFiles() = withRoot { root ->
        val uploadRoot = File(root, "uploads")
        val previous = File(uploadRoot, "old-process/file.txt").apply { parentFile!!.mkdirs(); writeText("old") }
        val unrelated = File(root, "keep.txt").apply { writeText("keep") }
        UploadStaging(uploadRoot)
        assertFalse(previous.exists())
        assertEquals("keep", unrelated.readText())
    }
}
