package dev.browser

import org.mozilla.geckoview.GeckoSession.PermissionDelegate as P

/** Autoplay is a browsing preference, not an interruption for each new site. */
internal fun defaultContentPermissionDecision(permission: Int, saved: Boolean?): Int? = when (permission) {
    P.PERMISSION_AUTOPLAY_INAUDIBLE, P.PERMISSION_AUTOPLAY_AUDIBLE -> {
        val allow = saved ?: (permission == P.PERMISSION_AUTOPLAY_INAUDIBLE)
        if (allow) P.ContentPermission.VALUE_ALLOW else P.ContentPermission.VALUE_DENY
    }
    else -> null
}

/** A dismissal quiets the current document; navigation gives it a fresh chance. */
internal class DocumentPermissionPrompts {
    private val dismissed = mutableSetOf<Pair<String, String>>()
    fun dismiss(origin: String, kinds: String) {
        kinds.split(",").forEach { dismissed.add(origin to it) }
    }
    fun shouldPrompt(origin: String, kinds: String): Boolean =
        kinds.split(",").none { (origin to it) in dismissed }
    fun clear() = dismissed.clear()
}
