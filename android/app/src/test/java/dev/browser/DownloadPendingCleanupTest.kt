package dev.browser

import java.io.File
import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class DownloadPendingCleanupTest {
    @Test fun onlyAnExactTemporaryFileInsideAppDownloadsCanBeRemoved() {
        val root = Files.createTempDirectory("download-cleanup").toFile()
        try {
            val folder = File(root, "Downloads").apply { mkdir() }
            val pending = File(folder, ".yeoyu-download-123.part").apply { writeText("partial") }
            assertEquals(pending, DownloadPendingCleanup.temporaryFile(pending.toURI().toString(), folder))
            assertNull(DownloadPendingCleanup.temporaryFile(pending.toURI().toString(), null))
            assertNull(DownloadPendingCleanup.temporaryFile(File(folder, "finished.pdf").toURI().toString(), folder))
            val outside = File(root, ".yeoyu-download-outside.part").apply { writeText("keep") }
            assertNull(DownloadPendingCleanup.temporaryFile(outside.toURI().toString(), folder))
            val linked = File(folder, ".yeoyu-download-linked.part")
            Files.createSymbolicLink(linked.toPath(), outside.toPath())
            assertNull(DownloadPendingCleanup.temporaryFile(linked.toURI().toString(), folder))
            assertEquals("keep", outside.readText())
            assertNull(DownloadPendingCleanup.temporaryFile("file://other-host${pending.path}", folder))
        } finally { root.deleteRecursively() }
    }

    @Test fun contentCleanupRequiresAnIndividualDownloadRowWithoutExtraUriSelectors() {
        assertTrue(DownloadPendingCleanup.mediaStoreItem("content://media/external/downloads/12"))
        assertTrue(DownloadPendingCleanup.mediaStoreItem("content://media/external_primary/downloads/12"))
        for (uri in listOf("content://media/external/downloads", "content://media/external/file/12",
            "content://media/internal/downloads/12", "content://other/external/downloads/12",
            "content://media/external/downloads/12?where=all", "content://media/external/downloads/12#x",
            "content://media/external/downloads/../file/12")) assertFalse(uri, DownloadPendingCleanup.mediaStoreItem(uri))
    }

    @Test fun publishedOrOtherAppRowsNeverGrantCleanupAuthority() {
        assertTrue(DownloadPendingCleanup.ownedPending(1, "dev.yeoyu", "dev.yeoyu"))
        assertFalse(DownloadPendingCleanup.ownedPending(0, "dev.yeoyu", "dev.yeoyu"))
        assertFalse(DownloadPendingCleanup.ownedPending(1, "other.app", "dev.yeoyu"))
        assertFalse(DownloadPendingCleanup.ownedPending(1, null, "dev.yeoyu"))
    }
}
