package dev.browser

import java.net.URI
import java.util.Locale

/** Only local dashboard exports qualify; the caller must pass Gecko's actual response body. */
internal object BrowserExtensionDownloads {
    fun ownsDocument(baseUrl: String, url: String?): Boolean {
        val base = extensionUri(baseUrl) ?: return false
        val page = url?.let(::extensionUri) ?: return false
        return base.host.equals(page.host, ignoreCase = true)
    }

    fun allowedNavigation(baseUrl: String, triggerUri: String?, uri: String, redirect: Boolean): Boolean =
        !redirect && ownsDocument(baseUrl, triggerUri) && allowedResponse(baseUrl, uri)

    fun allowedResponse(baseUrl: String, uri: String): Boolean {
        if (extensionUri(baseUrl) == null) return false
        if (uri.startsWith("blob:", ignoreCase = true)) {
            val blob = uri.substring(5)
            val parsed = extensionUri(blob) ?: return false
            return ownsDocument(baseUrl, blob) && !parsed.path.isNullOrBlank() && parsed.path != "/" &&
                parsed.rawQuery == null && parsed.rawFragment == null
        }
        if (!uri.startsWith("data:", ignoreCase = true)) return false
        val comma = uri.indexOf(',')
        if (comma !in 5..256) return false
        val parts = uri.substring(5, comma).lowercase(Locale.ROOT).split(';')
        return parts.first() in setOf("text/plain", "application/json") &&
            parts.drop(1).all { it == "base64" || it == "charset=utf-8" || it == "charset=us-ascii" }
    }

    private fun extensionUri(url: String): URI? = runCatching { URI(url) }.getOrNull()?.takeIf {
        it.scheme.equals("moz-extension", ignoreCase = true) && !it.host.isNullOrEmpty() && it.rawUserInfo == null && it.port == -1
    }
}
