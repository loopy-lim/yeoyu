package dev.browser

import org.json.JSONObject
import kotlin.math.roundToInt

internal data class ReaderStyle(
    val bg: String = "#f7f6f7",
    val fg: String = "#3d3642",
    val muted: String = "#564e5c",
    val accent: String = "#7d697f",
    val border: String = "#e2dee6",
    val sunken: String = "#eeebf0",
    val fontSizePx: Int = 18,
    val readTimeFormat: String = "{n} min read",
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("bg", bg)
        put("fg", fg)
        put("muted", muted)
        put("accent", accent)
        put("border", border)
        put("sunken", sunken)
        put("fontSizePx", fontSizePx)
        put("readTimeFormat", readTimeFormat)
    }
}

internal data class ReaderTabState(
    val readerable: Boolean = false,
    val active: Boolean = false,
)

private val COLOR_VALUE_RE = Regex(
    "^#[0-9a-fA-F]{6}$|^rgba?\\(\\s*\\d{1,3}\\s*,\\s*\\d{1,3}\\s*,\\s*\\d{1,3}(?:\\s*,\\s*[0-9.]+)?\\s*\\)$"
)

internal fun isValidReaderColor(value: String): Boolean = COLOR_VALUE_RE.matches(value.trim())

internal fun fontSizeForTextScale(textScale: Double): Int {
    val safe = if (textScale.isFinite()) textScale.coerceIn(0.5, 2.0) else 1.0
    return (18.0 * safe).roundToInt().coerceIn(12, 36)
}

internal fun parseReaderStyle(json: String): ReaderStyle? = runCatching {
    val obj = JSONObject(json)
    val bg = obj.getString("bg").trim()
    val fg = obj.getString("fg").trim()
    val muted = obj.getString("muted").trim()
    val accent = obj.getString("accent").trim()
    val border = obj.getString("border").trim()
    val sunken = obj.getString("sunken").trim()
    val fontSizePx = obj.getInt("fontSizePx")
    val readTimeFormat = obj.optString("readTimeFormat", "{n} min read")
        .takeIf { it.contains("{n}") && it.length <= 40 } ?: "{n} min read"
    if (!listOf(bg, fg, muted, accent, border, sunken).all(::isValidReaderColor)) return null
    if (fontSizePx !in 12..36) return null
    ReaderStyle(bg, fg, muted, accent, border, sunken, fontSizePx, readTimeFormat)
}.getOrNull()

internal fun isEligibleReaderUrl(url: String?): Boolean {
    if (url.isNullOrBlank()) return false
    val lower = url.trim().lowercase()
    return lower.startsWith("http://") || lower.startsWith("https://")
}
