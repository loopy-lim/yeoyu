package dev.browser

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import org.junit.Assert.*
import org.junit.Test

class PortableDocumentIOTest {
    @Test fun readsExactBoundedUtf8AndRejectsOverflowOrInvalidEncoding() {
        val bytes = "한글 🚀".toByteArray(Charsets.UTF_8)
        assertEquals("한글 🚀", PortableDocumentIO.read(ByteArrayInputStream(bytes), bytes.size))
        assertThrows(IOException::class.java) { PortableDocumentIO.read(ByteArrayInputStream(bytes), bytes.size - 1) }
        assertThrows(Exception::class.java) { PortableDocumentIO.read(ByteArrayInputStream(byteArrayOf(0xc3.toByte(), 0x28)), 20) }
    }
    @Test fun cancellationInterruptsReadAndWriteWithoutReturningSuccess() {
        assertThrows(IOException::class.java) { PortableDocumentIO.read(ByteArrayInputStream(byteArrayOf(1)), 100) { true } }
        val output = ByteArrayOutputStream()
        assertThrows(IOException::class.java) { PortableDocumentIO.write(output, "hello".toByteArray()) { true } }
        assertEquals(0, output.size())
    }
    @Test fun writesAllBytesAndFlushes() {
        val output = ByteArrayOutputStream()
        val bytes = "a".repeat(100_000).toByteArray()
        PortableDocumentIO.write(output, bytes)
        assertArrayEquals(bytes, output.toByteArray())
    }
}
