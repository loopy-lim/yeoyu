package dev.browser

import java.net.URI

/** Gecko principal attributes remain in the identity; only the displayed origin is normalized. */
internal fun webNotificationOrigin(source: String?, principal: String): String? {
    val origin = permissionOrigin(source) ?: return null
    val principalOrigin = principal.substringBefore('^')
    return origin.takeIf { principalOrigin == origin }
}

internal data class WebNotificationPresentation(
    val title: String,
    val text: String,
    val origin: String?,
    val allowActions: Boolean,
)

internal fun webNotificationPresentation(
    privateBrowsing: Boolean,
    foreground: Boolean,
    systemAllowed: Boolean,
    channelAllowed: Boolean,
    title: String?,
    text: String?,
    origin: String,
): WebNotificationPresentation? {
    if (!systemAllowed || !channelAllowed || (privateBrowsing && !foreground)) return null
    if (privateBrowsing) return WebNotificationPresentation("Yeoyu", "비공개 탭에서 새 알림을 보냈습니다", null, false)
    return WebNotificationPresentation(
        notificationText(title, 256).ifBlank { "Yeoyu" },
        notificationText(text, 4_096),
        origin,
        true,
    )
}

internal fun notificationText(value: String?, limit: Int): String =
    value.orEmpty().take(limit).filterNot { Character.isISOControl(it) || Character.getType(it) == Character.FORMAT.toInt() }

internal data class WebNotificationKey(val principal: String, val tag: String, val privateBrowsing: Boolean)

internal data class LiveWebNotification<T>(
    val key: WebNotificationKey,
    val origin: String,
    val token: String,
    val value: T,
    val actions: List<String>,
)

internal data class RetiredWebNotification<T>(val entry: LiveWebNotification<T>, val notifyEngine: Boolean)

/** Main-thread ledger. Opaque tokens are one-shot and never reused for replacement notifications. */
internal class WebNotificationLedger<T>(private val capacity: Int = 64) {
    init { require(capacity > 0) }
    private val entries = linkedMapOf<String, LiveWebNotification<T>>()

    fun add(key: WebNotificationKey, origin: String, token: String, value: T, actions: List<String>): List<RetiredWebNotification<T>> {
        require(token.isNotBlank() && token !in entries)
        val removed = mutableListOf<RetiredWebNotification<T>>()
        // Gecko finishes the previous observer before sending the replacement.
        // dismiss() uses tag+origin, so dismissing the old object would close the NEW listener.
        remove(key)?.let { removed.add(RetiredWebNotification(it, false)) }
        while (entries.size >= capacity) entries.remove(entries.keys.first())?.let { removed.add(RetiredWebNotification(it, true)) }
        entries[token] = LiveWebNotification(key, origin, token, value, actions.toList())
        return removed
    }

    /** -1 is the notification body; other values must identify an offered action. */
    fun consume(token: String, actionIndex: Int): LiveWebNotification<T>? {
        val entry = entries[token] ?: return null
        if (actionIndex != -1 && actionIndex !in entry.actions.indices) return null
        return entries.remove(token)
    }

    fun remove(key: WebNotificationKey): LiveWebNotification<T>? =
        entries.values.firstOrNull { it.key == key }?.let { entries.remove(it.token) }

    fun removeWhere(predicate: (LiveWebNotification<T>) -> Boolean): List<LiveWebNotification<T>> =
        entries.values.filter(predicate).also { selected -> selected.forEach { entries.remove(it.token) } }
}

/** GV's service-worker callback has no source principal. Admit only a fresh same-origin normal click. */
internal class WebNotificationActivation {
    private data class Grant(val origin: String, val createdAt: Long)
    private var grant: Grant? = null

    fun begin(origin: String, privateBrowsing: Boolean, now: Long) {
        grant = if (privateBrowsing) null else Grant(origin, now)
    }

    fun clear() { grant = null }

    fun consume(url: String, now: Long): String? {
        val active = grant ?: return null
        grant = null
        if (now < active.createdAt || now - active.createdAt >= 5_000 || url.length > 8_192) return null
        val parsed = runCatching { URI(url) }.getOrNull() ?: return null
        if (parsed.rawUserInfo != null || permissionOrigin(url) != active.origin) return null
        return active.origin
    }
}
