package dev.browser

import java.net.URI
import java.util.Locale

/** Permission decisions belong to an origin, never to a collapsed site name. */
internal fun permissionOrigin(value: String?): String? {
    if (value == null) return null
    return try {
        val parsed = URI(value)
        val scheme = parsed.scheme?.lowercase(Locale.ROOT) ?: return null
        if (scheme != "https" && scheme != "http") return null
        val host = parsed.host?.lowercase(Locale.ROOT) ?: return null
        val port = parsed.port
        if (port < -1 || port > 65535) return null
        val defaultPort = if (scheme == "https") 443 else 80
        val suffix = if (port == -1 || port == defaultPort) "" else ":$port"
        "$scheme://$host$suffix"
    } catch (_: Exception) { null }
}
