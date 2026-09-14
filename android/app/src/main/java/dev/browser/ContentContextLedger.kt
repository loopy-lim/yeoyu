package dev.browser

import java.util.UUID

/** One visible menu, one action, bound to the document that produced it. */
internal class ContentContextLedger {
    private data class Request(val id: String, val link: String?, val image: String?,
        val expiresAt: Long, val current: () -> Boolean)
    private var pending: Request? = null

    @Synchronized fun offer(link: String?, image: String?, now: Long, current: () -> Boolean): String {
        val id = UUID.randomUUID().toString()
        pending = Request(id, link, image, now + 60_000, current)
        return id
    }

    @Synchronized fun consume(id: String, target: String, now: Long): String {
        val request = pending?.takeIf { it.id == id } ?: error("This page menu has expired")
        pending = null
        check(now < request.expiresAt && request.current()) { "The page changed. Open its menu again." }
        return when (target) {
            "link" -> request.link
            "image" -> request.image
            else -> null
        } ?: error("This menu does not contain that web address")
    }

    @Synchronized fun cancel(id: String) { if (pending?.id == id) pending = null }
    @Synchronized fun clear() { pending = null }
}
