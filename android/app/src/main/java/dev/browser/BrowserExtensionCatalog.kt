package dev.browser

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder
import javax.net.ssl.HttpsURLConnection
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

internal data class BrowserExtensionCandidate(
    val id: String,
    val name: String,
    val version: String,
    val downloadUrl: String,
    val sourceUrl: String,
)

/** Known catalog entries are local; only resolve performs blocking metadata IO. */
internal object BrowserExtensionCatalog {
    const val UBLOCK_ID = "uBlock0@raymondhill.net"
    const val DARK_READER_ID = "addon@darkreader.org"
    private data class CatalogEntry(val slug: String, val id: String, val name: String, val description: String) {
        val sourceUrl get() = "https://addons.mozilla.org/firefox/addon/$slug/"
    }
    private val catalog = listOf(
        CatalogEntry("ublock-origin", UBLOCK_ID, "uBlock Origin", "Block ads and trackers with site controls and customizable filter lists."),
        CatalogEntry("darkreader", DARK_READER_ID, "Dark Reader", "Adjust website colors and brightness, with per-site controls. Additional page processing can affect performance."),
    )
    private const val MAX_METADATA_BYTES = 512 * 1024
    private const val IO_TIMEOUT_MS = 10_000
    private const val REQUEST_BUDGET_NS = 30_000_000_000L
    private const val SEARCH_LIMIT = 20
    private class MetadataFetchException(message: String) : IOException(message)
    // Keep aligned with org.mozilla.geckoview:geckoview:155.0.* in app/build.gradle.
    private val engineVersion = listOf(155, 0, 0, 0)

    fun entriesJson(): JSONArray = JSONArray().apply {
        catalog.forEach { entry -> put(JSONObject().apply {
            put("slug", entry.slug)
            put("id", entry.id)
            put("name", entry.name)
            put("description", entry.description)
            put("sourceUrl", entry.sourceUrl)
        }) }
    }

    /** Call on the extension worker. Gecko owns package download and signature verification. */
    fun resolve(source: String): BrowserExtensionCandidate {
        val slug = requestedSlug(source)
        return candidateFromMetadata(source, fetchMetadata("https://addons.mozilla.org/api/v5/addons/addon/${encodedSlug(slug)}/"))
    }

    /** Display-only search over Android-compatible extensions. Installing a
     * result still goes through resolve(), the single strict trust boundary. */
    fun search(query: String): String {
        val trimmed = query.trim()
        require(trimmed.length in 1..100 && trimmed.none { it.isISOControl() }) {
            "Search words are too long or unreadable. Shorten the query and try again."
        }
        val results = fetchMetadata("https://addons.mozilla.org/api/v5/addons/search/?app=android&type=extension&sort=recommended&page_size=$SEARCH_LIMIT&q=${URLEncoder.encode(trimmed, "UTF-8")}")
        return searchResultsFromMetadata(results).toString()
    }

    /** Malformed individual entries are skipped; an unreadable envelope is an error,
     * mirroring the no-fallback policy for add-on details. */
    internal fun searchResultsFromMetadata(json: String): JSONArray {
        require(json.toByteArray(Charsets.UTF_8).size <= MAX_METADATA_BYTES) {
            "Mozilla search results exceed the supported size. Update Yeoyu and try again."
        }
        val envelope = try { JSONTokener(json).nextValue() as? JSONObject } catch (_: JSONException) { null }
            ?: throw IllegalArgumentException("Mozilla returned an unreadable extension list. Try again later.")
        val items = envelope.optJSONArray("results")
            ?: throw IllegalArgumentException("Mozilla returned an unreadable extension list. Try again later.")
        val seen = mutableSetOf<String>()
        val results = JSONArray()
        for (index in 0 until items.length()) {
            if (results.length() >= SEARCH_LIMIT) break
            val item = runCatching { items.optJSONObject(index) }.getOrNull() ?: continue
            val candidate = runCatching { searchResult(item) }.getOrNull() ?: continue
            if (seen.add(candidate.opt("slug") as String)) results.put(candidate)
        }
        return results
    }

    private fun searchResult(item: JSONObject): JSONObject {
        require(item.opt("type") == "extension" && item.opt("is_disabled") == false) {
            "Only available extensions are listed."
        }
        val slug = item.opt("slug") as? String
        require(slug != null && validSlug(slug)) { "Mozilla returned an invalid extension entry." }
        val name = localizedName(item)
        val summary = optionalText(item.optJSONObject("summary"), 512)
        val guid = item.opt("guid") as? String
        require(guid == null || (guid.length in 1..256 && guid.none { it.isWhitespace() || it.isISOControl() })) {
            "Mozilla returned an invalid extension identity."
        }
        val iconUrl = item.opt("icon_url") as? String
        require(iconUrl == null || validIconUrl(iconUrl)) { "Mozilla returned an unsupported extension icon address." }
        val android = item.optJSONObject("current_version")?.optJSONObject("compatibility")?.optJSONObject("android")
        require(android != null && supportsEngine(android.opt("min") as? String, android.opt("max") as? String)) {
            "The extension does not support this browser version."
        }
        return JSONObject().put("slug", slug).put("name", name).put("summary", summary).apply {
            if (guid != null) put("guid", guid)
            if (iconUrl != null) put("icon_url", iconUrl)
        }
    }

    private fun optionalText(value: JSONObject?, max: Int): String {
        val text = (value?.opt("en-US") as? String)
            ?: value?.names()?.let { names ->
                (0 until names.length())
                    .mapNotNull { index -> names.optString(index).takeIf(String::isNotEmpty) }
                    .firstNotNullOfOrNull { key -> value.opt(key) as? String }
            }
            ?: ""
        return text.take(max).filterNot { it.isISOControl() }
    }

    private fun validSlug(slug: String): Boolean =
        Regex("[\\p{L}\\p{N}_~-]{1,200}").matches(slug) && !Regex("\\p{N}+").matches(slug)

    /** Icons are rendered by React; only Mozilla's own CDN may be loaded. */
    internal fun validIconUrl(value: String): Boolean = try {
        val uri = URI(value)
        value.length <= 2048 && uri.scheme == "https" &&
            uri.host in setOf("addons.cdn.mozilla.net", "addons.mozilla.org") &&
            uri.port in setOf(-1, 443) && uri.rawUserInfo == null &&
            !uri.rawPath.isNullOrEmpty() && uri.rawPath != "/" &&
            uri.rawQuery == null && uri.rawFragment == null
    } catch (_: Exception) { false }

    private fun fetchMetadata(url: String): String {
        val connection = URL(url).openConnection() as HttpsURLConnection
        val deadline = System.nanoTime() + REQUEST_BUDGET_NS
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = IO_TIMEOUT_MS
            connection.readTimeout = IO_TIMEOUT_MS
            connection.requestMethod = "GET"
            connection.useCaches = false
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Accept-Encoding", "identity")
            val status = connection.responseCode
            if (status != 200) {
                throw MetadataFetchException(when (status) {
                    in 300..399 -> "Mozilla changed the add-on metadata address. Update Yeoyu before trying again."
                    401, 403, 404 -> "The extension is currently unavailable from Mozilla Add-ons. Try again later."
                    else -> "Mozilla Add-ons returned HTTP $status. Try again later."
                })
            }
            if (connection.contentType?.substringBefore(';')?.trim()?.lowercase() != "application/json")
                throw MetadataFetchException("Mozilla did not return add-on details. Try again later.")
            if (connection.contentLengthLong > MAX_METADATA_BYTES)
                throw MetadataFetchException("Mozilla add-on details exceed the supported size. Update Yeoyu and try again.")
            val bytes = ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val buffer = ByteArray(8192)
                while (true) {
                    if (System.nanoTime() >= deadline) throw SocketTimeoutException()
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (bytes.size() + count > MAX_METADATA_BYTES)
                        throw MetadataFetchException("Mozilla add-on details exceed the supported size. Update Yeoyu and try again.")
                    bytes.write(buffer, 0, count)
                }
            }
            return String(bytes.toByteArray(), Charsets.UTF_8)
        } catch (error: SocketTimeoutException) {
            throw IOException("Mozilla Add-ons took too long to respond. Check your connection and try again.", error)
        } catch (error: MetadataFetchException) {
            throw error
        } catch (error: IOException) {
            throw IOException("Could not contact Mozilla Add-ons. Check your connection and try again.", error)
        } finally {
            connection.disconnect()
        }
    }

    /** Pure policy boundary, shared with tests. Never infer a download URL from a failure. */
    internal fun candidateFromMetadata(source: String, json: String): BrowserExtensionCandidate {
        val slug = requestedSlug(source)
        val entry = catalog.find { it.slug == slug }
        require(json.toByteArray(Charsets.UTF_8).size <= MAX_METADATA_BYTES) {
            "Mozilla add-on details exceed the supported size. Update Yeoyu and try again."
        }
        try {
            val reader = JSONTokener(json)
            val addon = reader.nextValue() as? JSONObject
                ?: throw IllegalArgumentException("Mozilla returned invalid add-on details. Try again later.")
            require(reader.nextClean() == '\u0000') { "Mozilla returned invalid add-on details. Try again later." }
            require(addon.opt("slug") == slug && addon.opt("type") == "extension") {
                "Mozilla did not return the requested extension. Themes and other add-on types are not supported."
            }
            val id = addon.opt("guid") as? String
            require(id != null && id.length in 1..256 && id.none { it.isWhitespace() || it.isISOControl() }) {
                "Mozilla returned an invalid extension identity. Installation was stopped."
            }
            require(entry == null || id == entry.id) { "Mozilla returned a different extension. Installation was stopped." }
            val name = entry?.name ?: localizedName(addon)
            require(addon.opt("is_disabled") == false) { "The extension is unavailable or disabled on Mozilla Add-ons." }
            val version = addon.optJSONObject("current_version")
                ?: throw IllegalArgumentException("Mozilla has no current extension version available. Try again later.")
            require(!version.has("is_disabled") || version.opt("is_disabled") == false) {
                "The current extension version is disabled. Try again later."
            }
            val android = version.optJSONObject("compatibility")?.optJSONObject("android")
                ?: throw IllegalArgumentException("The current extension version does not declare Android support.")
            require(supportsEngine(android.opt("min") as? String, android.opt("max") as? String)) {
                "The current extension version does not support this browser version. Update Yeoyu and try again."
            }
            val file = version.optJSONObject("file")
                ?: throw IllegalArgumentException("Mozilla has no downloadable extension package. Try again later.")
            require(file.opt("status") == "public") { "The extension package is not publicly approved by Mozilla." }
            // file.is_mozilla_signed_extension identifies a Mozilla INTERNAL
            // signing certificate; false does not mean an ordinary AMO XPI is unsigned.
            // Engine install verification remains authoritative for the package signature.
            val versionName = version.opt("version") as? String
            require(versionName != null && versionName.isNotBlank() && versionName.length <= 128 &&
                versionName.none { it.isISOControl() }) { "Mozilla returned an invalid extension version. Try again later." }
            val downloadUrl = file.opt("url") as? String
            val fileId = (file.opt("id") as? Number)?.toString()?.toLongOrNull()
            require(downloadUrl != null && fileId != null && validDownloadUrl(downloadUrl, fileId)) {
                "Mozilla returned an unsupported extension download address. Update Yeoyu before trying again."
            }
            return BrowserExtensionCandidate(id, name, versionName, downloadUrl,
                "https://addons.mozilla.org/firefox/addon/${encodedSlug(slug)}/")
        } catch (error: JSONException) {
            throw IllegalArgumentException("Mozilla add-on details were incomplete or unreadable. Try again later.", error)
        }
    }

    /** Preserve catalog slug calls; everything else must be an official detail link.
     * Tracking query/fragment data is discarded and never sent to the metadata API. */
    private fun requestedSlug(source: String): String {
        catalog.find { it.slug == source }?.let { return it.slug }
        val link = source.trim()
        val message = "Paste a Mozilla Add-ons extension page link. Direct files and other stores are not supported."
        require(link.length <= 2048 && link.none { it.isWhitespace() || it.isISOControl() || it == '\\' }) { message }
        val uri = try { URI(link) } catch (_: Exception) { throw IllegalArgumentException(message) }
        require(uri.scheme == "https" && uri.host == "addons.mozilla.org" && uri.port in setOf(-1, 443) && uri.rawUserInfo == null) { message }
        val path = Regex("/(?:[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*/)?(?:firefox|android)/addon/([^/]+)/?")
            .matchEntire(uri.rawPath.orEmpty()) ?: throw IllegalArgumentException(message)
        val slug = try { URLDecoder.decode(path.groupValues[1], "UTF-8") } catch (_: Exception) { throw IllegalArgumentException(message) }
        require(validSlug(slug)) { message }
        return slug
    }

    private fun encodedSlug(slug: String): String = URLEncoder.encode(slug, "UTF-8").replace("%7E", "~")

    private fun localizedName(addon: JSONObject): String {
        val names = addon.optJSONObject("name")
        val name = ((names?.opt(addon.optString("default_locale", "en-US")) as? String)
            ?: (names?.opt("en-US") as? String))?.trim()
        require(name != null && name.length in 1..256 && name.none { it.isISOControl() }) {
            "Mozilla returned an unreadable extension name. Installation was stopped."
        }
        return name
    }

    private fun validDownloadUrl(value: String, fileId: Long): Boolean = try {
        val uri = URI(value)
        val path = Regex("/firefox/downloads/file/([1-9][0-9]*)/[A-Za-z0-9][A-Za-z0-9._-]*\\.xpi").matchEntire(uri.rawPath.orEmpty())
        value.length <= 2048 && uri.scheme == "https" && uri.host == "addons.mozilla.org" &&
            uri.port in setOf(-1, 443) && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null &&
            path != null && path.groupValues[1].toLongOrNull() == fileId && fileId > 0
    } catch (_: Exception) { false }

    private data class VersionBound(val parts: List<Int>, val prerelease: Boolean = false, val wildcard: Boolean = false)

    private fun versionBound(value: String, allowWildcard: Boolean): VersionBound? {
        if (allowWildcard && value == "*") return VersionBound(emptyList(), wildcard = true)
        if (allowWildcard && value.endsWith(".*")) {
            val prefix = versionBound(value.removeSuffix(".*"), false) ?: return null
            return prefix.takeUnless { it.prerelease }?.copy(wildcard = true)
        }
        val match = Regex("([0-9]+(?:\\.[0-9]+){0,3})(?:(a|b|pre|rc)[0-9]*)?").matchEntire(value) ?: return null
        val parts = match.groupValues[1].split('.').map { it.toIntOrNull() ?: return null }
        return VersionBound(parts, prerelease = match.groupValues[2].isNotEmpty())
    }

    private fun compareEngine(bound: VersionBound): Int {
        val length = if (bound.wildcard) bound.parts.size else engineVersion.size
        for (index in 0 until length) {
            val result = engineVersion[index].compareTo(bound.parts.getOrElse(index) { 0 })
            if (result != 0) return result
        }
        return if (bound.prerelease) 1 else 0
    }

    private fun supportsEngine(min: String?, max: String?): Boolean {
        val lower = min?.let { versionBound(it, false) } ?: return false
        val upper = max?.let { versionBound(it, true) } ?: return false
        // This small catalog conservatively checks max even if AMO says strict
        // compatibility is off. Unknown range forms require a catalog update.
        return compareEngine(lower) >= 0 && compareEngine(upper) <= 0
    }
}
