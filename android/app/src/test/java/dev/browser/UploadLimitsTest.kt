package dev.browser

import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

class UploadLimitsTest {
    private fun withStore(limits: UploadLimits, body: (UploadStaging, java.io.File) -> Unit) {
        val root = Files.createTempDirectory("yeoyu-upload-limits").toFile()
        try { body(UploadStaging(root, limits), root) } finally { root.deleteRecursively() }
    }
    private fun source(size: Int) = UploadSource("bytes.bin") { ByteArrayInputStream(ByteArray(size)) }

    @Test fun actualBytesEnforceFileAndBatchLimitsAndRemovePartialCopies() =
        withStore(UploadLimits(maxFileBytes = 8, maxBatchBytes = 12)) { store, root ->
            for (sources in listOf(listOf(source(9)), listOf(source(7), source(7)))) {
                try { store.stage(sources); fail("oversized copy accepted") } catch (_: IOException) {}
                assertTrue(root.listFiles()!!.isEmpty())
            }
        }

    @Test fun approvedCopiesSurviveNewFailuresAndOnlyReleaseFreesTheirBudget() =
        withStore(UploadLimits(maxStoreBytes = 10)) { store, root ->
            val approved = store.stage(listOf(source(6)))
            try { store.stage(listOf(source(5))); fail("retained budget ignored") } catch (_: IOException) {}
            assertEquals(6, approved.files.single().length())
            assertEquals(1, root.listFiles()!!.size)
            approved.close(); approved.close()
            val next = store.stage(listOf(source(10)))
            assertEquals(10, next.files.single().length())
            next.close()
        }

    @Test fun timeoutClosesARealBlockedReadAndRemovesItsPartialDirectory() =
        withStore(UploadLimits(timeoutMillis = 100)) { store, root ->
            val closed = CountDownLatch(1)
            val blocked = object : InputStream() {
                override fun read(): Int { closed.await(3, TimeUnit.SECONDS); throw IOException("closed") }
                override fun read(b: ByteArray, off: Int, len: Int): Int = read()
                override fun close() { closed.countDown() }
            }
            val began = System.nanoTime()
            try { store.stage(listOf(UploadSource("blocked", { blocked }))); fail("timeout missing") } catch (_: IOException) {}
            assertEquals(0, closed.count)
            assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - began) < 2000)
            assertTrue(root.listFiles()!!.isEmpty())
        }

    @Test fun explicitCancellationClosesRegisteredInputAndRejectsLateRegistrations() {
        val cancellation = UploadCancellation()
        var closed = 0
        cancellation.register(AutoCloseable { closed++ })
        cancellation.cancel()
        cancellation.register(AutoCloseable { closed++ })
        cancellation.cancel()
        assertEquals(2, closed)
        assertTrue(cancellation.isCanceled)
    }
}
