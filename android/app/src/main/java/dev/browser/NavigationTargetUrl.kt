package dev.browser

import java.io.ByteArrayOutputStream
import java.net.URI
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets

/** Error documents are presentation URLs, never the tab's next restore target. */
internal fun navigationTargetUrl(reported: String?, knownTarget: String): String {
    if (reported == null) return knownTarget
    val location = reported.substringBefore('#')
    val page = location.substringBefore('?')
    if (!page.equals("about:neterror", ignoreCase = true) &&
        !page.equals("about:certerror", ignoreCase = true)) return reported
    val originals = location.substringAfter('?', "").split('&').filter { it.substringBefore('=') == "u" }
    if (originals.size != 1) return knownTarget
    val target = decodeErrorTarget(originals.single().substringAfter('=', "")) ?: return knownTarget
    val uri = runCatching { URI(target) }.getOrNull() ?: return knownTarget
    return target.takeIf {
        (uri.scheme.equals("http", ignoreCase = true) || uri.scheme.equals("https", ignoreCase = true)) &&
            !uri.host.isNullOrBlank() && uri.port in -1..65535
    } ?: knownTarget
}

private fun decodeErrorTarget(value: String): String? {
    val bytes = ByteArrayOutputStream(value.length)
    var cursor = 0
    while (cursor < value.length) {
        val escape = value.indexOf('%', cursor)
        if (escape == -1) {
            bytes.write(value.substring(cursor).toByteArray(StandardCharsets.UTF_8))
            break
        }
        bytes.write(value.substring(cursor, escape).toByteArray(StandardCharsets.UTF_8))
        if (escape + 2 >= value.length) return null
        val high = value[escape + 1].digitToIntOrNull(16) ?: return null
        val low = value[escape + 2].digitToIntOrNull(16) ?: return null
        bytes.write((high shl 4) or low)
        cursor = escape + 3
    }
    // The nested URL is percent-escaped once, not form encoded: retain literal
    // '+' and reject malformed UTF-8 instead of silently changing the target.
    return runCatching {
        StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes.toByteArray())).toString()
    }.getOrNull()
}
