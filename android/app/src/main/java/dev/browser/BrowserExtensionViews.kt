package dev.browser

import android.app.Activity
import android.app.Application
import android.app.Dialog
import android.content.res.Configuration
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSessionSettings
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.WebExtension
import org.mozilla.geckoview.WebResponse
import java.net.URI
import java.util.IdentityHashMap
import java.util.Locale
import kotlin.math.max
import kotlin.math.roundToInt

/** Auxiliary extension windows never enter browser tab, history or archive ownership. Main thread only. */
internal object BrowserExtensionViews {
    private const val MAX_PANELS = 2
    private const val OPEN_TIMEOUT_MS = 5_000L
    private const val OPEN_POLL_MS = 25L
    private val main = Handler(Looper.getMainLooper())
    private val panels = IdentityHashMap<GeckoSession, Panel>()
    private val retiring = IdentityHashMap<GeckoSession, String>()
    private val awaitingLateOpen = IdentityHashMap<GeckoSession, Runnable>()

    private class Panel(
        val activity: Activity,
        val extensionId: String,
        val origin: URI,
        val session: GeckoSession,
        val dialog: Dialog,
        val view: GeckoView,
        val loading: ProgressBar,
        val footer: LinearLayout,
        val title: TextView,
        val closeButton: Button,
        val onClosed: (GeckoSession) -> Unit,
        val popup: Boolean = false,
        val anchorX: Float = 0f,
        val anchorY: Float = 0f,
    ) {
        var opening: Runnable? = null
        var prompts: BrowserPromptDelegate? = null
        var lifecycle: Application.ActivityLifecycleCallbacks? = null
        var resize: View.OnLayoutChangeListener? = null
        var awaitingExternalOpen = false
        var documentGeneration = 0L
        var documentUrl: String? = null
    }

    private val denyPermissions = object : GeckoSession.PermissionDelegate {
        override fun onContentPermissionRequest(
            session: GeckoSession,
            perm: GeckoSession.PermissionDelegate.ContentPermission,
        ): GeckoResult<Int> = GeckoResult.fromValue(GeckoSession.PermissionDelegate.ContentPermission.VALUE_DENY)
        // Gecko's default Android/media callbacks explicitly reject their requests.
    }

    fun show(
        runtime: GeckoRuntime,
        extension: WebExtension,
        privateMode: Boolean,
        openInitially: Boolean = true,
        initialUrl: String? = null,
        popup: Boolean = false,
        anchorX: Float = 0f,
        anchorY: Float = 0f,
        bind: (GeckoSession) -> Unit,
        onClosed: (GeckoSession) -> Unit,
    ): GeckoSession? {
        if (Looper.myLooper() != Looper.getMainLooper() || panels.size + retiring.size >= MAX_PANELS) return null
        val activity = GeckoSessionRegistry.activityProvider?.invoke() ?: return null
        if (activity.isFinishing || activity.isDestroyed || (!activity.hasWindowFocus() &&
            panels.values.none { it.activity === activity && it.dialog.window?.decorView?.hasWindowFocus() == true })) return null
        val metadata = extension.metaData ?: return null
        if (!metadata.enabled || (privateMode && !metadata.allowedInPrivateBrowsing)) return null
        val origin = runCatching { URI(metadata.baseUrl) }.getOrNull() ?: return null
        if (origin.scheme != "moz-extension" || origin.host.isNullOrEmpty() || origin.rawUserInfo != null || origin.port != -1) return null
        if (initialUrl != null && !allows(origin, initialUrl)) return null

        val session = GeckoSession(GeckoSessionSettings.Builder().usePrivateMode(privateMode).build())
        val view = GeckoView(activity).apply { visibility = View.INVISIBLE }
        val loading = ProgressBar(activity).apply { contentDescription = "Loading extension" }
        val content = FrameLayout(activity).apply {
            addView(view, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            addView(loading, FrameLayout.LayoutParams(dp(activity, 48), dp(activity, 48), android.view.Gravity.CENTER))
        }
        val title = metadata.name?.take(120)?.takeIf { it.isNotBlank() } ?: "Extension"
        val heading = TextView(activity).apply {
            text = if (privateMode) "$title — Private" else title
            textSize = 18f
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        val closeButton = Button(activity).apply {
            text = "Close"
            contentDescription = "Close extension panel"
            minHeight = dp(activity, 48)
            minWidth = dp(activity, 72)
            // Ghost control: the stock widget background reads as system chrome.
            setBackgroundColor(android.graphics.Color.TRANSPARENT)
            setAllCaps(false)
            textSize = 15f
            setOnClickListener { close(session) }
        }
        val footer = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(activity, 56)
            setPadding(dp(activity, 16), dp(activity, 4), dp(activity, 8), dp(activity, 4))
            addView(heading, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(closeButton, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        val layout = object : LinearLayout(activity) {
            override fun onConfigurationChanged(configuration: Configuration) {
                super.onConfigurationChanged(configuration)
                panels[session]?.let(::refreshChrome)
            }
        }.apply {
            orientation = LinearLayout.VERTICAL
            // Local extension accessibles already contain their screen origin;
            // Gecko 155 adds it again. Keep the content at the window origin.
            addView(content, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(footer, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        // The application theme is a non-floating, no-action-bar window. A
        // floating AlertDialog would add an origin before content is laid out.
        val dialog = Dialog(activity, com.workspacebrowser.R.style.AppTheme).apply {
            requestWindowFeature(android.view.Window.FEATURE_NO_TITLE)
            setOwnerActivity(activity)
            setTitle(heading.text)
            setContentView(layout)
        }
        val panel = Panel(activity, extension.id, origin, session, dialog, view, loading, footer, heading, closeButton, onClosed,
            popup, anchorX, anchorY)
        panels[session] = panel
        try {
            // GeckoView 155 supplies this provider to Window.open only when it
            // already exists. Match browser tabs before either this owner or
            // WebExtensionController opens the session; late view attachment
            // must not be the first initialization of the accessibility tree.
            session.accessibility
            // The caller binds extension-specific delegates before any Gecko open.
            // This owner installs the navigation, content, progress and permission boundary.
            bind(session)
            if (panels[session] !== panel) return null
            configure(panel)
            dialog.setOnDismissListener { close(session) }
            if (popup) {
                // Chrome-style anchored action bubble: grow from its center, no
                // dim, touches outside close it without ever reaching the page.
                dialog.setCanceledOnTouchOutside(true)
                dialog.window?.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
                dialog.window?.setWindowAnimations(com.workspacebrowser.R.style.ExtensionPopup)
            }
            registerLifecycle(panel)
            dialog.show()
            dialog.window?.let { window ->
                window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
                ImmersiveMode.set(window, true)
            }
            // Keep the content's top/left origin fixed while the IME appears.
            // Bottom inset padding keeps Close and the last content row usable.
            ViewCompat.setOnApplyWindowInsetsListener(layout) { _, insets ->
                val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
                val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
                layout.setPadding(0, 0, 0, max(bars.bottom, ime.bottom))
                footer.setPadding(max(dp(activity, 16), bars.left), dp(activity, 4), max(dp(activity, 8), bars.right), dp(activity, 4))
                insets
            }
            ViewCompat.requestApplyInsets(layout)
            resize(panel)
            panel.resize = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> resize(panel) }
                .also { activity.window.decorView.addOnLayoutChangeListener(it) }
            if (openInitially) {
                session.open(runtime)
                attach(panel)
                if (initialUrl != null && panels[session] === panel) session.loadUri(initialUrl)
            } else {
                // WebExtensionController.newTab requires this session to remain
                // unopened until show returns. It opens and navigates it itself.
                panel.awaitingExternalOpen = true
                waitForOpen(panel)
            }
            return session.takeIf { panels[it] === panel }
        } catch (_: RuntimeException) {
            close(session)
            return null
        }
    }

    private fun configure(panel: Panel) {
        val session = panel.session
        session.permissionDelegate = denyPermissions
        panel.prompts = BrowserPromptDelegate(session, { panel.activity.takeIf { panels[session] === panel } },
            { panels[session] === panel && !panel.activity.isFinishing && !panel.activity.isDestroyed })
            .also { session.promptDelegate = it }
        session.navigationDelegate = object : GeckoSession.NavigationDelegate {
            override fun onLoadRequest(session: GeckoSession, request: GeckoSession.NavigationDelegate.LoadRequest): GeckoResult<AllowOrDeny> {
                val allowed = allowsNavigation(panel, session, request)
                return GeckoResult.fromValue(if (allowed) AllowOrDeny.ALLOW else AllowOrDeny.DENY)
            }
            override fun onSubframeLoadRequest(session: GeckoSession, request: GeckoSession.NavigationDelegate.LoadRequest): GeckoResult<AllowOrDeny> {
                val allowed = allowsNavigation(panel, session, request)
                return GeckoResult.fromValue(if (allowed) AllowOrDeny.ALLOW else AllowOrDeny.DENY)
            }
            // window.open is default-denied; the extension manager owns tabs.create.
        }
        session.contentDelegate = object : GeckoSession.ContentDelegate {
            override fun onCloseRequest(session: GeckoSession) { close(session) }
            override fun onCrash(session: GeckoSession) { close(session) }
            override fun onKill(session: GeckoSession) { close(session) }
            override fun onExternalResponse(session: GeckoSession, response: WebResponse) { export(panel, response) }
        }
        session.progressDelegate = object : GeckoSession.ProgressDelegate {
            override fun onPageStart(session: GeckoSession, url: String) {
                if (panels[session] !== panel) return
                panel.documentGeneration++
                panel.documentUrl = url
                PrivateDownloadConfirmation.cancel(session)
                attach(panel)
            }
        }
    }

    private fun allowsNavigation(panel: Panel, session: GeckoSession, request: GeckoSession.NavigationDelegate.LoadRequest): Boolean =
        panels[session] === panel && (allows(panel.origin, request.uri) ||
            (BrowserExtensionHost.allowsPanelExport(panel.extensionId, session) &&
                BrowserExtensionDownloads.allowedNavigation(panel.origin.toString(), request.triggerUri, request.uri, request.isRedirect)))

    private fun export(panel: Panel, response: WebResponse) {
        val session = panel.session
        val generation = panel.documentGeneration
        val current = {
            panels[session] === panel && panel.documentGeneration == generation &&
                !panel.activity.isFinishing && !panel.activity.isDestroyed && panel.dialog.isShowing &&
                BrowserExtensionDownloads.ownsDocument(panel.origin.toString(), panel.documentUrl) &&
                BrowserExtensionHost.allowsPanelExport(panel.extensionId, session)
        }
        val focused = { activity: Activity ->
            activity === panel.activity && panels[session] === panel && panel.dialog.isShowing &&
                panel.dialog.window?.decorView?.hasWindowFocus() == true
        }
        if (!current() || !focused(panel.activity) || !BrowserExtensionDownloads.allowedResponse(panel.origin.toString(), response.uri)) {
            runCatching { response.body?.close() }
            return
        }
        val app = panel.activity.applicationContext
        val save = { DownloadCoordinator.save(app, response) { event, payload -> GeckoSessionRegistry.emit?.invoke(event, payload) } }
        if (session.settings.usePrivateMode) PrivateDownloadConfirmation.request(session, response, current, save, focused)
        else save()
    }

    private fun attach(panel: Panel) {
        if (panels[panel.session] !== panel) return
        if (panel.activity.isFinishing || panel.activity.isDestroyed || !panel.dialog.isShowing) {
            close(panel.session)
            return
        }
        if (!panel.session.isOpen) return
        panel.awaitingExternalOpen = false
        panel.opening?.let(main::removeCallbacks)
        panel.opening = null
        try {
            if (panel.view.session !== panel.session) panel.view.setSession(panel.session)
            panel.view.visibility = View.VISIBLE
            panel.loading.visibility = View.GONE
            panel.session.setActive(true)
        } catch (_: RuntimeException) { close(panel.session) }
    }

    private fun waitForOpen(panel: Panel) {
        val deadline = SystemClock.uptimeMillis() + OPEN_TIMEOUT_MS
        val task = object : Runnable {
            override fun run() {
                if (panels[panel.session] !== panel || panel.opening !== this) return
                if (panel.session.isOpen) attach(panel)
                else if (SystemClock.uptimeMillis() >= deadline) close(panel.session)
                else main.postDelayed(this, OPEN_POLL_MS)
            }
        }
        panel.opening = task
        main.post(task)
    }

    private fun registerLifecycle(panel: Panel) {
        panel.lifecycle = object : Application.ActivityLifecycleCallbacks {
            override fun onActivityDestroyed(activity: Activity) { if (activity === panel.activity) close(panel.session) }
            override fun onActivityCreated(activity: Activity, state: Bundle?) {}
            override fun onActivityStarted(activity: Activity) {}
            override fun onActivityResumed(activity: Activity) {}
            override fun onActivityPaused(activity: Activity) {}
            override fun onActivityStopped(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) {}
        }.also { panel.activity.application.registerActivityLifecycleCallbacks(it) }
    }

    private fun resize(panel: Panel) {
        if (panels[panel.session] !== panel) return
        panel.dialog.window?.apply {
            if (panel.popup) {
                // Anchor near the pressed control; the bubble never crosses the
                // screen edges and keeps a minimum height for usable content.
                val metrics = panel.activity.resources.displayMetrics
                val gap = dp(panel.activity, 6)
                val margin = dp(panel.activity, 12)
                val width = minOf(dp(panel.activity, 360), metrics.widthPixels - margin * 2)
                val below = metrics.heightPixels - panel.anchorY.toInt() - gap - margin
                val height = maxOf(minOf(dp(panel.activity, 460), below), dp(panel.activity, 240))
                val x = (panel.anchorX - dp(panel.activity, 40)).toInt()
                    .coerceIn(margin, maxOf(margin, metrics.widthPixels - width - margin))
                val attributes = attributes.apply {
                    gravity = Gravity.TOP or Gravity.START
                    this.width = width
                    this.height = height
                    this.x = x
                    y = panel.anchorY.toInt() + gap
                }
                setAttributes(attributes)
            } else {
                setGravity(Gravity.TOP or Gravity.START)
                setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT)
                decorView.setPadding(0, 0, 0, 0)
            }
        }
        refreshChrome(panel)
    }

    private fun refreshChrome(panel: Panel) {
        val colors = panel.activity.obtainStyledAttributes(intArrayOf(android.R.attr.colorBackground, android.R.attr.textColorPrimary))
        try {
            val background = colors.getColor(0, android.graphics.Color.BLACK)
            val foreground = colors.getColorStateList(1) ?: android.content.res.ColorStateList.valueOf(android.graphics.Color.WHITE)
            if (panel.popup) {
                // The floating bubble carries its own rounded outline; the theme's
                // window background would paint the dialog full-bleed square.
                val outline = GradientDrawable().apply {
                    setColor(background)
                    cornerRadius = dp(panel.activity, 12).toFloat()
                    setStroke(1, 0x29000000.toInt() or (foreground.defaultColor and 0x00FFFFFF))
                }
                panel.dialog.window?.setBackgroundDrawable(outline)
            } else {
                panel.dialog.window?.setBackgroundDrawable(ColorDrawable(background))
            }
            panel.footer.setBackgroundColor(android.graphics.Color.TRANSPARENT)
            panel.title.setTextColor(foreground)
            panel.closeButton.setTextColor(foreground)
            panel.closeButton.setBackgroundColor(android.graphics.Color.TRANSPARENT)
        } finally { colors.recycle() }
    }

    private fun dp(activity: Activity, value: Int) = (value * activity.resources.displayMetrics.density).roundToInt()

    private fun allows(origin: URI, value: String): Boolean {
        val uri = runCatching { URI(value) }.getOrNull() ?: return false
        return when (uri.scheme?.lowercase(Locale.ROOT)) {
            "about" -> uri.rawSchemeSpecificPart == "blank"
            "http", "https" -> !uri.host.isNullOrEmpty() && uri.rawUserInfo == null
            "moz-extension" -> uri.rawAuthority.equals(origin.rawAuthority, ignoreCase = true) &&
                uri.host.equals(origin.host, ignoreCase = true) && uri.rawUserInfo == null && uri.port == -1
            else -> false
        }
    }

    fun owns(session: GeckoSession): Boolean = panels.containsKey(session)

    fun owns(session: GeckoSession, extensionId: String): Boolean =
        panels[session]?.extensionId == extensionId

    fun hasForegroundPanel(activity: Activity, extensionId: String): Boolean =
        !activity.isFinishing && !activity.isDestroyed && panels.values.any {
            it.activity === activity && it.extensionId == extensionId && it.session.isOpen && it.dialog.isShowing &&
                it.dialog.window?.decorView?.hasWindowFocus() == true
        }

    fun closeForExtension(id: String) {
        val sessions = panels.values.filter { it.extensionId == id }.map { it.session } +
            retiring.entries.filter { it.value == id }.map { it.key }
        sessions.forEach(::close)
    }

    fun closeAll() { (panels.keys.toList() + retiring.keys.toList()).forEach(::close) }

    fun close(session: GeckoSession): Boolean {
        PrivateDownloadConfirmation.cancel(session)
        val panel = panels.remove(session)
        if (panel == null) {
            if (!retiring.containsKey(session)) return false
            if (session.isOpen || !awaitingLateOpen.containsKey(session)) closeLateSession(session)
            return true
        }
        retiring[session] = panel.extensionId
        panel.opening?.let(main::removeCallbacks)
        panel.lifecycle?.let { panel.activity.application.unregisterActivityLifecycleCallbacks(it) }
        panel.resize?.let { panel.activity.window.decorView.removeOnLayoutChangeListener(it) }
        panel.dialog.setOnDismissListener(null)
        runCatching { panel.prompts?.cancelPending() }
        runCatching { panel.view.releaseSession() }
        runCatching { panel.dialog.dismiss() }
        // Retired delegates retain neither Activity nor panel callbacks. If
        // Gecko opens a returned tabs.create session after dismissal, deny its
        // navigation and close it even after the bounded polling window ends.
        session.promptDelegate = null
        session.permissionDelegate = denyPermissions
        session.navigationDelegate = retiredNavigation
        session.contentDelegate = retiredContent
        session.progressDelegate = retiredProgress
        if (session.isOpen) retireSession(session)
        else if (panel.awaitingExternalOpen) watchLateOpen(session)
        else retireSession(session)
        runCatching { panel.onClosed(session) }
        return true
    }

    private fun retireSession(session: GeckoSession) {
        runCatching { if (session.isOpen) session.close() }
        // Accepted file copies are released only after Gecko can no longer read them.
        if (!session.isOpen) {
            runCatching { FilePromptCoordinator.releaseSession(session) }
            retiring.remove(session)
        }
        // A failed native close retains only the session/extension ID, occupies
        // the bounded budget, and is retried by closeAll/closeForExtension.
    }

    private fun closeLateSession(session: GeckoSession) {
        awaitingLateOpen.remove(session)?.let(main::removeCallbacks)
        retireSession(session)
    }

    private val retiredNavigation = object : GeckoSession.NavigationDelegate {
        override fun onLoadRequest(session: GeckoSession, request: GeckoSession.NavigationDelegate.LoadRequest): GeckoResult<AllowOrDeny> {
            main.post { closeLateSession(session) }
            return GeckoResult.fromValue(AllowOrDeny.DENY)
        }
        override fun onSubframeLoadRequest(session: GeckoSession, request: GeckoSession.NavigationDelegate.LoadRequest): GeckoResult<AllowOrDeny> =
            onLoadRequest(session, request)
    }
    private val retiredContent = object : GeckoSession.ContentDelegate {
        override fun onCloseRequest(session: GeckoSession) { closeLateSession(session) }
        override fun onCrash(session: GeckoSession) { closeLateSession(session) }
        override fun onKill(session: GeckoSession) { closeLateSession(session) }
        override fun onExternalResponse(session: GeckoSession, response: WebResponse) {
            runCatching { response.body?.close() }
            closeLateSession(session)
        }
    }
    private val retiredProgress = object : GeckoSession.ProgressDelegate {
        override fun onPageStart(session: GeckoSession, url: String) { closeLateSession(session) }
    }

    private fun watchLateOpen(session: GeckoSession) {
        val deadline = SystemClock.uptimeMillis() + OPEN_TIMEOUT_MS
        val task = object : Runnable {
            override fun run() {
                if (awaitingLateOpen[session] !== this) return
                if (session.isOpen || SystemClock.uptimeMillis() >= deadline) closeLateSession(session)
                else main.postDelayed(this, OPEN_POLL_MS)
            }
        }
        awaitingLateOpen[session] = task
        main.post(task)
    }
}
