package dev.browser

import java.io.File
import java.net.URI

/** A valid journal is necessary but never sufficient authority for deleting stored content. */
internal object DownloadPendingCleanup {
    fun temporaryFile(value: String, folder: File?): File? = runCatching {
        if (folder == null) return null
        val uri = URI(value)
        if (uri.scheme != "file" || !uri.authority.isNullOrEmpty() || uri.query != null || uri.fragment != null) return null
        val file = File(uri)
        file.takeIf { it.canonicalFile.parentFile == folder.canonicalFile &&
            it.name.startsWith(".yeoyu-download-") && it.name.endsWith(".part") }
    }.getOrNull()

    fun mediaStoreItem(value: String): Boolean = runCatching {
        val uri = URI(value)
        uri.scheme == "content" && uri.rawAuthority == "media" && uri.rawQuery == null && uri.rawFragment == null &&
            Regex("/external(?:_primary)?/downloads/[1-9][0-9]*").matches(uri.rawPath.orEmpty())
    }.getOrDefault(false)

    fun ownedPending(pending: Int, owner: String?, packageName: String): Boolean = pending == 1 && owner == packageName
}
