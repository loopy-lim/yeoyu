package dev.browser

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import org.junit.Assert.*
import org.junit.Test

class DownloadTransferTest {
    @Test fun earlyEofNeverCommitsAResponseShorterThanItsKnownLength() {
        var aborted = false
        try {
            DownloadTransfer.save(ByteArrayInputStream(byteArrayOf(1, 2, 3)), expectedBytes = 10) {
                object : DownloadDestination {
                    override val output = ByteArrayOutputStream()
                    override fun complete(bytes: Long): SavedDownload = error("truncated response committed")
                    override fun abort() { aborted = true }
                }
            }
            fail("short body must fail")
        } catch (_: IOException) { }
        assertTrue(aborted)
    }

    @Test fun cancellationAfterReadDoesNotPublishAPartialFile() {
        val cancellation = DownloadCancellation()
        var aborted = false
        var published = false
        val body = object : ByteArrayInputStream(byteArrayOf(1, 2, 3)) {
            override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
                val count = super.read(bytes, offset, length)
                cancellation.cancel()
                return count
            }
        }
        try {
            DownloadTransfer.save(body, cancellation) {
                object : DownloadDestination {
                    override val output = ByteArrayOutputStream()
                    override fun complete(bytes: Long): SavedDownload {
                        published = true
                        return SavedDownload("partial", "Downloads", "content://partial", bytes)
                    }
                    override fun abort() { aborted = true }
                }
            }
            fail("cancelled transfer must fail")
        } catch (_: DownloadCancelledException) { }
        assertTrue(aborted)
        assertFalse(published)
    }

    @Test fun cancellingARegisteredBlockedBodyClosesItAndIsIdempotent() {
        var closed = false
        val body = object : ByteArrayInputStream(byteArrayOf(1)) {
            override fun close() { closed = true }
        }
        val cancellation = DownloadCancellation()
        cancellation.attach(body)
        assertTrue(cancellation.cancel())
        assertTrue(closed)
        assertFalse(cancellation.cancel())
    }

    @Test fun cancellationCannotUndoAnAlreadyCommittedFile() {
        val cancellation = DownloadCancellation()
        assertEquals("saved", cancellation.complete { "saved" })
        assertFalse(cancellation.cancel())
    }

    @Test fun savesTheReceivedBodyOnceAndCommitsOnlyAfterStreamsClose() {
        val payload = byteArrayOf(0, 1, 2, 127, -128, -1)
        var bodyClosed = false
        var outputClosed = false
        val body = object : ByteArrayInputStream(payload) {
            override fun close() { bodyClosed = true; super.close() }
        }
        val output = object : ByteArrayOutputStream() {
            override fun close() { outputClosed = true; super.close() }
        }
        var committed = false
        val saved = DownloadTransfer.save(body) {
            object : DownloadDestination {
                override val output = output
                override fun complete(bytes: Long): SavedDownload {
                    assertTrue(bodyClosed)
                    assertTrue(outputClosed)
                    committed = true
                    return SavedDownload("file.bin", "Downloads", "content://saved", bytes)
                }
                override fun abort() { fail("successful transfer must not roll back") }
            }
        }
        assertTrue(committed)
        assertArrayEquals(payload, output.toByteArray())
        assertEquals(6L, saved.bytes)
    }

    @Test fun partialReadFailureClosesBothStreamsAndRemovesTheUnfinishedFile() {
        var bodyClosed = false
        var outputClosed = false
        var rolledBack = false
        val body = object : ByteArrayInputStream(byteArrayOf(1, 2, 3)) {
            override fun read(bytes: ByteArray, offset: Int, length: Int): Int = throw IOException("network ended")
            override fun close() { bodyClosed = true }
        }
        val output = object : ByteArrayOutputStream() {
            override fun close() { outputClosed = true }
        }
        try {
            DownloadTransfer.save(body) {
                object : DownloadDestination {
                    override val output = output
                    override fun complete(bytes: Long): SavedDownload = error("incomplete download committed")
                    override fun abort() { rolledBack = true }
                }
            }
            fail("expected failed body read")
        } catch (failure: IOException) { assertEquals("network ended", failure.message) }
        assertTrue(bodyClosed)
        assertTrue(outputClosed)
        assertTrue(rolledBack)
    }

    @Test fun destinationAllocationFailureStillClosesTheReceivedBody() {
        var closed = false
        val body = object : ByteArrayInputStream(byteArrayOf(1)) {
            override fun close() { closed = true }
        }
        try {
            DownloadTransfer.save(body) { throw IOException("storage unavailable") }
            fail("expected storage error")
        } catch (failure: IOException) { assertEquals("storage unavailable", failure.message) }
        assertTrue(closed)
    }

    @Test fun filenamesDecodeRfc5987AndCannotEscapeTheDownloadsDirectory() {
        assertEquals("보고서.pdf", DownloadTransfer.filename("https://example.com/export", "attachment; filename=old.pdf; filename*=UTF-8''%EB%B3%B4%EA%B3%A0%EC%84%9C.pdf"))
        assertEquals("a+b.txt", DownloadTransfer.filename("https://example.com", "attachment; filename*=UTF-8''a+b.txt"))
        assertEquals(".._.._report.txt", DownloadTransfer.filename("https://example.com", "attachment; filename=../../report.txt"))
        assertEquals("report.txt", DownloadTransfer.filename("https://example.com/report.txt?secret=ignored", null))
        assertEquals("download", DownloadTransfer.filename("blob:https://example.com/id", null))
        assertFalse(DownloadTransfer.filename("https://example.com", "attachment; filename=bad\u0000name").contains('\u0000'))
    }
}
