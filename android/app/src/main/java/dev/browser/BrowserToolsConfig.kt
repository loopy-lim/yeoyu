package dev.browser

import java.net.URI
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

internal data class BrowserSiteConfig(val origin: String, val desktop: Boolean, val trackingProtection: Boolean?, val keepAlive: Boolean = false)

internal data class BrowserToolsConfig(
    val restoreSessions: Boolean = false,
    // New installs default to Standard (ETP DEFAULT). A stored "engine-default"
    // still means OFF — the mapping must keep honoring an explicit old choice.
    val trackingProtection: String = "standard",
    val textScale: Double = 1.0,
    val sites: List<BrowserSiteConfig> = emptyList(),
    val automaticMemorySaving: Boolean = false,
) {
    fun siteFor(url: String): BrowserSiteConfig? = canonicalBrowserOrigin(url)?.let { origin -> sites.firstOrNull { it.origin == origin } }
    fun toJson(): String = JSONObject().apply {
        put("schema", 1)
        put("restoreSessions", restoreSessions)
        put("automaticMemorySaving", automaticMemorySaving)
        put("trackingProtection", trackingProtection)
        put("textScale", textScale)
        put("sites", JSONArray().apply { sites.forEach { site -> put(JSONObject().apply {
            put("origin", site.origin)
            put("desktop", site.desktop)
            put("keepAlive", site.keepAlive)
            put("trackingProtection", site.trackingProtection ?: JSONObject.NULL)
        }) } })
    }.toString()

    companion object {
        fun parse(json: String): BrowserToolsConfig {
            try {
                require(json.toByteArray(Charsets.UTF_8).size <= 128 * 1024)
                val objectValue = JSONObject(json)
                require(objectValue.get("schema") == 1)
                require(objectValue.get("restoreSessions") is Boolean)
                val protection = objectValue.getString("trackingProtection")
                require(protection in setOf("engine-default", "standard", "strict"))
                require(objectValue.get("textScale") is Number)
                val scale = objectValue.getDouble("textScale")
                require(scale.isFinite() && scale in 0.5..2.0)
                val array = objectValue.getJSONArray("sites")
                require(array.length() <= 256)
                val sites = (0 until array.length()).map { index ->
                    val entry = array.getJSONObject(index)
                    val raw = entry.getString("origin")
                    val uri = URI(raw)
                    require(uri.rawPath.isNullOrEmpty() || uri.rawPath == "/")
                    require(uri.rawQuery == null && uri.rawFragment == null && uri.rawUserInfo == null)
                    val origin = canonicalBrowserOrigin(raw) ?: throw IllegalArgumentException()
                    require(entry.get("desktop") is Boolean)
                    val tracking = if (entry.isNull("trackingProtection")) null else {
                        require(entry.get("trackingProtection") is Boolean)
                        entry.getBoolean("trackingProtection")
                    }
                    BrowserSiteConfig(origin, entry.getBoolean("desktop"), tracking, if (entry.has("keepAlive")) { require(entry.get("keepAlive") is Boolean); entry.getBoolean("keepAlive") } else false)
                }
                require(sites.map { it.origin }.distinct().size == sites.size)
                val automatic = if (objectValue.has("automaticMemorySaving")) { require(objectValue.get("automaticMemorySaving") is Boolean); objectValue.getBoolean("automaticMemorySaving") } else false
                return BrowserToolsConfig(objectValue.getBoolean("restoreSessions"), protection, scale, sites, automatic)
            } catch (_: Exception) {
                throw IllegalArgumentException("Browser settings are invalid or use an unsupported version")
            }
        }
    }
}

internal fun canonicalBrowserOrigin(url: String): String? = try {
    val uri = URI(url)
    val scheme = uri.scheme?.lowercase(Locale.ROOT)
    val host = uri.host?.lowercase(Locale.ROOT)
    if (scheme !in setOf("http", "https") || host.isNullOrBlank() || uri.rawUserInfo != null || uri.port !in -1..65_535) null
    else {
        val port = uri.port.takeUnless { it == -1 || (scheme == "https" && it == 443) || (scheme == "http" && it == 80) }
        "$scheme://$host" + (port?.let { ":$it" } ?: "")
    }
} catch (_: Exception) { null }
