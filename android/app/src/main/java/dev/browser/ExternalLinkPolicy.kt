package dev.browser

import java.net.URI
import java.net.IDN
import java.net.URL

internal data class ExternalAppTarget(val uri: String, val targetPackage: String?)

/** Pure input policy. A packaged browsable intent is the only custom-scheme escape hatch. */
internal object ExternalLinkPolicy {
    private val directSchemes = setOf("mailto", "tel", "sms", "smsto", "geo", "market")
    private val forbiddenSchemes = setOf("javascript", "file", "content", "data", "blob", "about", "chrome", "resource", "jar", "view-source", "intent", "android-app")
    private fun parsed(value: String?): URI? {
        if (value.isNullOrEmpty() || value.length > 16_384 || value.any { it.isISOControl() }) return null
        return runCatching { URI(value) }.getOrNull()
    }

    fun webUri(value: String?): String? {
        val uri = parsed(value) ?: return null
        if (uri.scheme?.lowercase() !in setOf("http", "https")) return null
        val web = runCatching { URL(value) }.getOrNull() ?: return null
        if (uri.rawUserInfo != null || uri.rawAuthority?.contains('@') == true || web.userInfo != null) return null
        if (web.host.isNullOrBlank() || web.port < -1 || web.port > 65535) return null
        if (uri.host == null && runCatching { IDN.toASCII(web.host, IDN.USE_STD3_ASCII_RULES) }.getOrNull().isNullOrEmpty()) return null
        val scheme = uri.scheme.lowercase()
        val host = web.host.lowercase()
        val port = web.port.takeUnless { it == -1 || (scheme == "http" && it == 80) || (scheme == "https" && it == 443) }
        // Preserve Unicode host text: Java IDN2003 conversion can disagree with the
        // WHATWG/Gecko UTS46 interpretation (for example sharp-s versus "ss").
        return "$scheme://$host${port?.let { ":$it" }.orEmpty()}${uri.rawPath.orEmpty().ifEmpty { "/" }}" +
            (uri.rawQuery?.let { "?$it" }.orEmpty()) + (uri.rawFragment?.let { "#$it" }.orEmpty())
    }

    fun appTarget(uri: String, userGesture: Boolean, subframe: Boolean,
        targetPackage: String?, packagedIntent: Boolean, ownPackage: String): ExternalAppTarget? {
        if (!userGesture || subframe) return null
        val parsed = parsed(uri) ?: return null
        val scheme = parsed.scheme?.lowercase() ?: return null
        if (scheme in forbiddenSchemes || parsed.rawSchemeSpecificPart.isNullOrEmpty()) return null
        if (targetPackage != null && (targetPackage == ownPackage ||
            !Regex("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+").matches(targetPackage))) return null
        if (scheme !in directSchemes && !(packagedIntent && targetPackage != null)) return null
        if (scheme in setOf("http", "https") && webUri(uri) == null) return null
        return ExternalAppTarget(uri, targetPackage)
    }
}

/** Bounded loop prevention, scoped to the originating tab and document URL. */
internal class ExternalLaunchGuard {
    private val recent = linkedMapOf<String, Long>()
    @Synchronized fun acquire(tabId: String, document: String, target: String, now: Long): Boolean {
        recent.entries.removeAll { now - it.value >= 5_000 }
        val key = "$tabId\u0000$document\u0000$target"
        if (recent.containsKey(key)) return false
        if (recent.size >= 128) recent.remove(recent.keys.first())
        recent[key] = now
        return true
    }
}
