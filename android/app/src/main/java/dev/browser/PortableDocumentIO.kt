package dev.browser

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

internal object PortableDocumentIO {
    fun read(input: InputStream, maxBytes: Int, cancelled: () -> Boolean = { false }): String {
        val buffer = ByteArray(16 * 1024)
        val output = ByteArrayOutputStream()
        while (true) {
            if (cancelled()) throw IOException("File operation cancelled")
            val count = input.read(buffer)
            if (count < 0) break
            if (count > maxBytes - output.size()) throw IOException("File exceeds size limit")
            output.write(buffer, 0, count)
        }
        if (cancelled()) throw IOException("File operation cancelled")
        return Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(output.toByteArray())).toString()
    }
    fun write(output: OutputStream, bytes: ByteArray, cancelled: () -> Boolean = { false }) {
        var offset = 0
        while (offset < bytes.size) {
            if (cancelled()) throw IOException("File operation cancelled")
            val count = minOf(16 * 1024, bytes.size - offset)
            output.write(bytes, offset, count)
            offset += count
        }
        if (cancelled()) throw IOException("File operation cancelled")
        output.flush()
    }
}
