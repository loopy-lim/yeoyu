package dev.browser

import android.app.Activity
import android.content.ActivityNotFoundException
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
        val admitted = !isSubframe &&
            ExternalLinkPolicy.navigationAdmitted(request.hasUserGesture, request.isRedirect)
        if (!admitted) {
            if (!isSubframe) failed(tabId, "This page tried to open another app without a user action.")
            return GeckoResult.fromValue(AllowOrDeny.DENY)
        }
        val activity = GeckoSessionRegistry.activityProvider?.invoke()
        if (activity == null || !activity.hasWindowFocus()) {
            failed(tabId, "Return to the browser and tap the link to open another app.")
            return GeckoResult.fromValue(AllowOrDeny.DENY)
        }
        var fallback: String? = null
        var target: ExternalAppTarget? = null
        // The intent's own escape hatch for a missing handler; guarded like any launch.
        fun loadWebFallback(web: String) {
            if (!guard.acquire(tabId, request.triggerUri.orEmpty(), "fallback:$web", SystemClock.elapsedRealtime())) {
                failed(tabId, "This page is repeatedly opening the same app. Tap the link again in a few seconds.")
                return
            }
            main.post { if (isCurrent()) session.load(GeckoSession.Loader().uri(web).flags(GeckoSession.LOAD_FLAGS_EXTERNAL)) }
        }
        try {
            val wrapped = scheme == "intent"
            val parsed = if (wrapped) Intent.parseUri(request.uri, Intent.URI_INTENT_SCHEME) else null
            fallback = if (wrapped) ExternalLinkPolicy.webUri(parsed?.getStringExtra("browser_fallback_url")) else null
            val data = if (wrapped) parsed?.dataString else request.uri
            target = data?.let { ExternalLinkPolicy.appTarget(it, admitted, false, parsed?.`package`, wrapped, app.packageName) }
            check(target != null) { "This external link type is not supported." }
            check(guard.acquire(tabId, request.triggerUri.orEmpty(), target.uri, SystemClock.elapsedRealtime())) {
                "This page is repeatedly opening the same app. Tap the link again in a few seconds."
            }
            val intent = Intent(if (scheme == "tel") Intent.ACTION_DIAL else Intent.ACTION_VIEW, Uri.parse(target.uri))
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            target.targetPackage?.let { intent.setPackage(it) }
            // Package visibility (Android 11+) hides foreign scheme handlers from
            // resolveActivity even when startActivity would reach them, so the
            // resolver is only trusted to speak about this app itself — and only
            // for packageless targets: a set launch package already excludes us.
            if (target.targetPackage == null) {
                check(Intent(intent).setPackage(app.packageName).resolveActivity(activity.packageManager) == null) {
                    "The external link would reopen this browser."
                }
            }
            activity.startActivity(intent)
            handedOff(tabId)
        } catch (missing: ActivityNotFoundException) {
            // Nothing on this device can handle the target. Fall back in the Chrome
            // order: the intent's web fallback, the package's store listing, a notice.
            val web = fallback
            val missingPackage = target?.targetPackage
            when {
                web != null -> loadWebFallback(web)
                missingPackage != null && launchStoreListing(activity, tabId, missingPackage, request.triggerUri.orEmpty()) -> Unit
                else -> failed(tabId, "No app on this device can open this link.")
            }
        } catch (failure: Exception) {
            val web = fallback
            if (web != null) loadWebFallback(web)
            else failed(tabId, failure.message ?: "No app can open this link.")
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

    /** The page left for another app; a temporary surface (Little Arc) can dismiss itself. */
    private fun handedOff(tabId: String) {
        GeckoSessionRegistry.emit?.invoke("BrowserExternalNavigationHandoff", Arguments.createMap().apply {
            putString("tabId", tabId)
        })
    }

    /** Store listing fallback for an installed-nowhere package; false when no store can open either. */
    private fun launchStoreListing(activity: Activity, tabId: String, targetPackage: String, document: String): Boolean {
        if (!guard.acquire(tabId, document, "market:$targetPackage", SystemClock.elapsedRealtime())) return false
        val listing = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$targetPackage"))
            .addCategory(Intent.CATEGORY_BROWSABLE)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            activity.startActivity(listing)
            handedOff(tabId)
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }
}
