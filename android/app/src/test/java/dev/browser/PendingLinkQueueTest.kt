package dev.browser

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.io.DataOutputStream
import java.io.DataInputStream

class PendingLinkQueueTest {
    @Test fun javascriptRejectedHeadIsQuarantinedAndValidNeighborsContinueAfterRestart() {
        val folder = Files.createTempDirectory("incoming-js-rejection").toFile()
        try {
            val file = File(folder, "queue")
            val notices = mutableListOf<RejectedPendingLink>()
            val queue = PendingLinkQueue(file) { notices.add(it) }
            queue.enqueue("https://example.com/a", "before")
            val bad = queue.enqueue("https://[fe80::1%25en0]/", "scoped-ipv6")!!
            queue.enqueue("https://example.com/b", "after")
            queue.acknowledge("before")
            queue.reject(bad.id)
            assertEquals(listOf("after"), queue.pending().map { it.id })
            assertEquals(listOf("after"), PendingLinkQueue(file).pending().map { it.id })
            val notice = notices.single()
            assertEquals("scoped-ipv6", notice.id)
            assertEquals("JS_WEB_ADDRESS_REJECTED", notice.reason)
            DataInputStream(File(folder, notice.quarantineFile).inputStream()).use {
                assertEquals(1, it.readInt())
                assertEquals(bad.id, it.readUTF())
                assertEquals(bad.url, it.readUTF())
                assertEquals("JS_WEB_ADDRESS_REJECTED", it.readUTF())
                assertEquals(-1, it.read())
            }
            queue.reject(bad.id)
            queue.reject("unknown")
            assertEquals(1, notices.size)
            assertEquals(listOf("after"), queue.pending().map { it.id })
        } finally { folder.deleteRecursively() }
    }

    @Test fun rejectCannotRemoveOrQuarantineAnItemBehindTheHead() {
        val folder = Files.createTempDirectory("incoming-reject-order").toFile()
        try {
            val file = File(folder, "queue")
            val notices = mutableListOf<RejectedPendingLink>()
            val queue = PendingLinkQueue(file) { notices.add(it) }
            queue.enqueue("https://example.com/", "before")
            queue.enqueue("https://999.1/", "later")
            val saved = file.readBytes()
            try { queue.reject("later"); fail("out-of-order rejection accepted") }
            catch (_: IllegalStateException) { }
            assertEquals(listOf("before", "later"), queue.pending().map { it.id })
            assertArrayEquals(saved, file.readBytes())
            assertTrue(notices.isEmpty())
            assertFalse(folder.listFiles()!!.any { it.name.startsWith("queue.rejected-") })
        } finally { folder.deleteRecursively() }
    }

    @Test fun failedQuarantineLeavesTheHeadSavedAndRetryable() {
        val folder = Files.createTempDirectory("incoming-reject-quarantine-failure").toFile()
        try {
            val file = File(folder, "queue")
            val notices = mutableListOf<RejectedPendingLink>()
            val queue = PendingLinkQueue(file) { notices.add(it) }
            val bad = queue.enqueue("https://example.123/", "numeric-host")!!
            queue.reject(bad.id)
            assertEquals(1, notices.size)
            val quarantine = File(folder, notices.single().quarantineFile)
            queue.enqueue(bad.url, bad.id)
            notices.clear()
            assertTrue(quarantine.delete())
            assertTrue(quarantine.mkdir())
            File(quarantine, "block-replacement").writeText("occupied")
            try { queue.reject(bad.id); fail("failed quarantine was ignored") }
            catch (_: java.io.IOException) { }
            assertEquals(listOf(bad), queue.pending())
            assertEquals(listOf(bad), PendingLinkQueue(file).pending())
            assertTrue(notices.isEmpty())
            quarantine.deleteRecursively()
            queue.reject(bad.id)
            assertTrue(PendingLinkQueue(file).pending().isEmpty())
            assertEquals("JS_WEB_ADDRESS_REJECTED", notices.single().reason)
        } finally { folder.deleteRecursively() }
    }

    @Test fun failedQueueRewriteKeepsTheHeadAndQuarantineForRetry() {
        val folder = Files.createTempDirectory("incoming-reject-rewrite-failure").toFile()
        try {
            val file = File(folder, "queue")
            val notices = mutableListOf<RejectedPendingLink>()
            val queue = PendingLinkQueue(file) { notices.add(it) }
            val bad = queue.enqueue("https://999.1/", "numeric-host")!!
            val saved = File(folder, "last-saved")
            assertTrue(file.renameTo(saved))
            assertTrue(file.mkdir())
            File(file, "block-replacement").writeText("occupied")
            try { queue.reject(bad.id); fail("failed queue rewrite was ignored") }
            catch (_: java.io.IOException) { }
            assertEquals(listOf(bad), queue.pending())
            assertEquals(listOf(bad), PendingLinkQueue(saved).pending())
            assertTrue(notices.isEmpty())
            assertEquals(1, folder.listFiles()!!.count { it.name.startsWith("queue.rejected-") })
            file.deleteRecursively()
            assertTrue(saved.renameTo(file))
            queue.reject(bad.id)
            assertTrue(PendingLinkQueue(file).pending().isEmpty())
            assertEquals(1, folder.listFiles()!!.count { it.name.startsWith("queue.rejected-") })
            assertEquals(1, notices.size)
        } finally { folder.deleteRecursively() }
    }

    @Test fun credentialIncomingLinksAreRejectedBeforeTheyCanPoisonTheQueue() {
        val queue = PendingLinkQueue()
        assertNull(queue.enqueue("https://user:pass@example.com/"))
        assertNull(queue.enqueue("https://user@example.com/"))
        assertNull(queue.enqueue("https://user%3Apass@한글.example/"))
        assertTrue(queue.pending().isEmpty())
        try { queue.enqueue("https://example.com/", "bad id"); fail("invalid request ID accepted") }
        catch (_: IllegalArgumentException) { }
    }

    @Test fun unsafePersistedRecordsAreQuarantinedWhileValidNeighborsRemainInOrder() {
        val folder = Files.createTempDirectory("incoming-link-migration").toFile()
        try {
            val file = File(folder, "queue")
            DataOutputStream(file.outputStream()).use { output ->
                output.writeInt(1); output.writeInt(4)
                listOf("before" to "https://example.com/a", "credential" to "https://user:pass@example.com/secret",
                    "invalid id" to "https://example.com/middle", "after" to "https://example.com/b").forEach {
                    output.writeUTF(it.first); output.writeUTF(it.second)
                }
            }
            val notices = mutableListOf<RejectedPendingLink>()
            val queue = PendingLinkQueue(file) { notices.add(it) }
            assertEquals(listOf("before", "after"), queue.pending().map { it.id })
            assertEquals(listOf("credential", "invalid id"), notices.map { it.id })
            assertEquals(listOf("UNSAFE_WEB_ADDRESS", "INVALID_REQUEST_ID"), notices.map { it.reason })
            assertEquals(listOf("before", "after"), PendingLinkQueue(file).pending().map { it.id })
            val rejected = folder.listFiles()!!.filter { it.name.startsWith("queue.rejected-") }
            assertEquals(2, rejected.size)
            val saved = rejected.map { rejectedFile -> DataInputStream(rejectedFile.inputStream()).use {
                assertEquals(1, it.readInt())
                it.readUTF() to it.readUTF()
            } }.toMap()
            assertEquals("https://user:pass@example.com/secret", saved["credential"])
            assertEquals("https://example.com/middle", saved["invalid id"])
            queue.acknowledge("before")
            assertEquals(listOf("after"), PendingLinkQueue(file).pending().map { it.id })
        } finally { folder.deleteRecursively() }
    }

    @Test fun canonicalHttpSchemeHostAndPortsReachTheRustAdmissionFormat() {
        val queue = PendingLinkQueue()
        assertEquals("https://example.com/path?q=1", queue.enqueue("HTTPS://EXAMPLE.COM:443/path?q=1")!!.url)
        assertEquals("http://localhost/", queue.enqueue("HTTP://LOCALHOST:80/")!!.url)
        assertEquals("https://한글.example/경로", queue.enqueue("HTTPS://한글.EXAMPLE/경로")!!.url)
    }

    @Test fun repeatedReadsKeepColdAndWarmLinksUntilTheirOwnAcknowledgement() {
        val queue = PendingLinkQueue()
        val first = queue.enqueue("https://example.com/a")!!
        val second = queue.enqueue("https://example.com/a")!!
        assertNotEquals(first.id, second.id)
        assertEquals(listOf(first, second), queue.pending())
        assertEquals(listOf(first, second), queue.pending())
        queue.acknowledge("unknown")
        queue.acknowledge(first.id)
        queue.acknowledge(first.id)
        assertEquals(listOf(second), queue.pending())
    }

    @Test fun aBurstDoesNotSilentlyDropUnacknowledgedLinks() {
        val queue = PendingLinkQueue()
        repeat(513) { queue.enqueue("https://example.com/$it") }
        assertEquals(513, queue.pending().size)
        assertEquals("https://example.com/0", queue.pending().first().url)
    }

    @Test fun restartPreservesDeliveryIdsAndOutOfOrderAcknowledgementCannotLoseTheHead() {
        val folder = Files.createTempDirectory("incoming-links").toFile()
        try {
            val file = File(folder, "links")
            val queue = PendingLinkQueue(file)
            val first = queue.enqueue("https://example.com/a", "delivery-a")!!
            val second = queue.enqueue("https://example.com/b", "delivery-b")!!
            assertEquals(first, queue.enqueue(first.url, first.id))
            try { queue.acknowledge(second.id); fail("must preserve FIFO") }
            catch (_: IllegalStateException) { }
            assertEquals(listOf(first, second), PendingLinkQueue(file).pending())
            queue.acknowledge(first.id)
            assertEquals(listOf(second), PendingLinkQueue(file).pending())
        } finally { folder.deleteRecursively() }
    }

    @Test fun incomingLinkCannotLoadCodeOrAnInvalidWebAuthority() {
        val queue = PendingLinkQueue()
        listOf("javascript:alert(1)", "file:///data/a", "intent://app", "https:///path", "https://example.com\n/x").forEach {
            assertNull(queue.enqueue(it))
        }
        assertNotNull(queue.enqueue("https://[::1]:8443/path"))
        assertNotNull(queue.enqueue("http://localhost:8080/"))
        assertNotNull(queue.enqueue("https://한글.example/경로"))
    }

    @Test fun failedAcknowledgementKeepsTheInMemoryAndLastSavedRequest() {
        val base = Files.createTempDirectory("incoming-link-failure").toFile()
        try {
            val folder = File(base, "live").apply { mkdir() }
            val file = File(folder, "queue")
            val queue = PendingLinkQueue(file)
            val link = queue.enqueue("https://example.com/a", "stable-id")!!
            val moved = File(base, "kept")
            assertTrue(folder.renameTo(moved))
            folder.writeText("unavailable directory")
            try { queue.acknowledge(link.id); fail("must expose persistence failure") }
            catch (_: java.io.IOException) { }
            assertEquals(listOf(link), queue.pending())
            assertEquals(listOf(link), PendingLinkQueue(File(moved, "queue")).pending())
        } finally { base.deleteRecursively() }
    }
}
