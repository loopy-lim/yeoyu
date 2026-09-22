package dev.browser

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession

/** Reconstructs allowed intents from URI data. Web-supplied components, extras and grants are discarded. */
object ExternalNavigationCoordinator {
    private val main = Handler(Looper.getMainLooper())
    private val guard = ExternalLaunchGuard()
    private val contexts = ContentContextLedger()
    private var contextExpiry: Runnable? = null
    private val engineSchemes = setOf("http", "https", "about", "data", "blob", "javascript", "file", "content", "resource", "chrome", "moz-extension")

    fun onLoadRequest(app: Context, tabId: String, session: GeckoSession,
        request: GeckoSession.NavigationDelegate.LoadRequest, isCurrent: () -> Boolean,
        isSubframe: Boolean = false): GeckoResult<AllowOrDeny>? {
        val scheme = Uri.parse(request.uri).scheme?.lowercase()
        if (scheme in engineSchemes) return null
        if (!isCurrent()) return GeckoResult.fromValue(AllowOrDeny.DENY)
        if (request.uri.length > 16_384 || request.uri.any { it.isISOControl() }) {
            failed(tabId, "This external link is malformed or too long.")
            return GeckoResult.fromValue(AllowOrDeny.DENY)
        }
        if (!request.hasUserGesture || isSubframe) {
            if (!isSubframe) failed(tabId, "This page tried to open another app without a user action.")
            return GeckoResult.fromValue(AllowOrDeny.DENY)
        }
        val activity = GeckoSessionRegistry.activityProvider?.invoke()
        if (activity == null || !activity.hasWindowFocus()) {
            failed(tabId, "Return to the browser and tap the link to open another app.")
            return GeckoResult.fromValue(AllowOrDeny.DENY)
        }
        var fallback: String? = null
        try {
            val wrapped = scheme == "intent"
            val parsed = if (wrapped) Intent.parseUri(request.uri, Intent.URI_INTENT_SCHEME) else null
            fallback = if (wrapped) ExternalLinkPolicy.webUri(parsed?.getStringExtra("browser_fallback_url")) else null
            val data = if (wrapped) parsed?.dataString else request.uri
            val target = data?.let { ExternalLinkPolicy.appTarget(it, true, false, parsed?.`package`, wrapped, app.packageName) }
            check(target != null) { "This external link type is not supported." }
            check(guard.acquire(tabId, request.triggerUri.orEmpty(), target.uri, SystemClock.elapsedRealtime())) {
                "This page is repeatedly opening the same app. Tap the link again in a few seconds."
            }
            val intent = Intent(if (scheme == "tel") Intent.ACTION_DIAL else Intent.ACTION_VIEW, Uri.parse(target.uri))
                .addCategory(Intent.CATEGORY_BROWSABLE)
            target.targetPackage?.let { intent.setPackage(it) }
            val resolved = intent.resolveActivity(activity.packageManager)
            check(resolved?.packageName != app.packageName) { "The external link would reopen this browser." }
            activity.startActivity(intent)
        } catch (failure: Exception) {
            val web = fallback
            if (web != null && guard.acquire(tabId, request.triggerUri.orEmpty(), "fallback:$web", SystemClock.elapsedRealtime())) {
                main.post { if (isCurrent()) session.load(GeckoSession.Loader().uri(web).flags(GeckoSession.LOAD_FLAGS_EXTERNAL)) }
            } else failed(tabId, failure.message ?: "No app can open this link.")
        }
        return GeckoResult.fromValue(AllowOrDeny.DENY)
    }

    fun onContextMenu(tabId: String, session: GeckoSession, screenX: Int, screenY: Int,
        element: GeckoSession.ContentDelegate.ContextElement, isCurrent: () -> Boolean) {
        if (!isCurrent()) return
        val link = ExternalLinkPolicy.webUri(element.linkUri)
        val image = if (element.type == GeckoSession.ContentDelegate.ContextElement.TYPE_IMAGE)
            ExternalLinkPolicy.webUri(element.srcUri) else null
        if (link == null && image == null) return
        contextExpiry?.let(main::removeCallbacks)
        val requestId = contexts.offer(link, image, SystemClock.elapsedRealtime(), isCurrent)
        val expire = Runnable { contexts.cancel(requestId) }
        contextExpiry = expire
        main.postDelayed(expire, 60_000)
        GeckoSessionRegistry.emit?.invoke("BrowserContentContextMenu", Arguments.createMap().apply {
            putString("requestId", requestId)
            putString("tabId", tabId)
            link?.let { putString("linkUri", it) }
            image?.let { putString("imageUri", it) }
            putString("title", (element.title ?: element.altText ?: element.linkText).orEmpty().take(256))
        })
    }

    /** Called on UI thread so document ownership cannot change between validation and consumption. */
    fun consumeContext(id: String, target: String): String = contexts.consume(id, target, SystemClock.elapsedRealtime())

    fun clearContextRequests() {
        contextExpiry?.let(main::removeCallbacks)
        contextExpiry = null
        contexts.clear()
    }

    fun share(activity: Activity, url: String) {
        val safe = ExternalLinkPolicy.webUri(url) ?: throw IllegalArgumentException("Only web links can be shared")
        val intent = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, safe)
        activity.startActivity(Intent.createChooser(intent, "Share link"))
    }

    private fun failed(tabId: String, error: String) {
        GeckoSessionRegistry.emit?.invoke("BrowserExternalNavigationFailed", Arguments.createMap().apply {
            putString("tabId", tabId); putString("error", error)
        })
    }
}
