package dev.browser

import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import org.json.JSONArray
import org.json.JSONObject
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.WebExtension
import org.mozilla.geckoview.WebExtensionController
import java.net.URI
import java.util.IdentityHashMap
import java.util.concurrent.Executors

/** Gecko owns installation, signature verification, storage and extension permissions.
 * This host owns user consent, chrome actions and the bridge to Yeoyu's tab model.
 * No third-party extension receives Yeoyu's privileged video message delegates.
 */
internal object BrowserExtensionHost {
    private val main = Handler(Looper.getMainLooper())
    private val catalogIo = Executors.newSingleThreadExecutor()
    private var runtime: GeckoRuntime? = null
    private val installed = linkedMapOf<String, WebExtension>()
    private val sessions = IdentityHashMap<GeckoSession, String?>()
    private val defaults = mutableMapOf<String, WebExtension.Action>()
    private val actions = IdentityHashMap<GeckoSession, MutableMap<String, WebExtension.Action>>()
    private var activeId: String? = null
    private var busy = false
    private var installId: String? = null
    private var updateId: String? = null
    private var uiGeneration = 0L
    private var lastState = ""
    private data class PopupContext(val session: GeckoSession, val action: WebExtension.Action, val timeout: Runnable,
        val anchorX: Float, val anchorY: Float)
    private val popupContexts = mutableMapOf<String, PopupContext>()
    private var popupTraceCount = 0
    private var nextRequest = 0
    private val permissionEpoch = mutableMapOf<String, Long>()
    private data class TabRequest(val extensionId: String, val session: GeckoSession, val id: String, val action: String,
        val result: GeckoResult<AllowOrDeny>, val timeout: Runnable, var claimed: Boolean = false)
    private val tabRequests = mutableMapOf<Int, TabRequest>()
    private val controller get() = checkNotNull(runtime) { "Browser engine is not ready" }.webExtensionController

    fun initialize(rt: GeckoRuntime) {
        if (runtime === rt) return
        check(runtime == null) { "Extension runtime cannot be replaced while active" }
        runtime = rt
        controller.setPromptDelegate(object : WebExtensionController.PromptDelegate {
            override fun onInstallPromptRequest(extension: WebExtension, permissions: Array<String>, origins: Array<String>, data: Array<String>): GeckoResult<WebExtension.PermissionPromptResponse> =
                if (!extension.isBuiltIn && extension.id == installId) ExtensionPermissionPrompts.install(extension, permissions, origins, data)
                else GeckoResult.fromValue(WebExtension.PermissionPromptResponse(false, false, false))
            override fun onUpdatePrompt(extension: WebExtension, permissions: Array<String>, origins: Array<String>, data: Array<String>): GeckoResult<AllowOrDeny> =
                if (extension.id == updateId) ExtensionPermissionPrompts.permissions(extension, "Update permissions", permissions, origins, data)
                else GeckoResult.deny()
            override fun onOptionalPrompt(extension: WebExtension, permissions: Array<String>, origins: Array<String>, data: Array<String>): GeckoResult<AllowOrDeny> =
                if (usable(extension)) ExtensionPermissionPrompts.permissions(extension, "Additional permissions", permissions, origins, data)
                else GeckoResult.deny()
        })
        controller.setAddonManagerDelegate(object : WebExtensionController.AddonManagerDelegate {
            override fun onReady(extension: WebExtension) = observe { remember(extension) }
            override fun onInstalled(extension: WebExtension) = observe { remember(extension) }
            override fun onEnabled(extension: WebExtension) = observe { remember(extension) }
            override fun onDisabled(extension: WebExtension) = observe { cancelRequests(extension.id); BrowserExtensionViews.closeForExtension(extension.id); remember(extension) }
            override fun onUninstalled(extension: WebExtension) = observe { forget(extension.id); changed() }
            override fun onOptionalPermissionsChanged(extension: WebExtension) = observe { remember(extension) }
        })
        refresh { result -> result.exceptionOrNull()?.let { failure ->
            GeckoSessionRegistry.emit?.invoke("BrowserExtensionError", Arguments.createMap().apply {
                putString("error", failure.message ?: "Extensions could not be restored")
            })
        } }
    }

    private fun usable(extension: WebExtension): Boolean = !extension.isBuiltIn &&
        installed[extension.id]?.metaData?.enabled == true

    private fun remember(extension: WebExtension) {
        if (extension.isBuiltIn) return
        installed[extension.id] = extension
        extension.setActionDelegate(actionDelegate)
        extension.setTabDelegate(tabDelegate)
        sessions.keys.toList().forEach { bindExtension(it, extension) }
        BrowserExtensionIcons.load(extension.id, extension.metaData?.icon) { changed() }
        changed()
    }

    private fun forget(id: String) {
        cancelRequests(id)
        BrowserExtensionViews.closeForExtension(id)
        BrowserExtensionIcons.forget(id)
        installed.remove(id)?.let { extension ->
            sessions.keys.toList().forEach { session ->
                session.webExtensionController.setActionDelegate(extension, null)
                session.webExtensionController.setTabDelegate(extension, null)
            }
        }
        defaults.remove(id)
        actions.values.forEach { it.remove(id) }
    }

    fun bind(session: GeckoSession, tabId: String? = null) {
        sessions[session] = tabId
        installed.values.toList().forEach { bindExtension(session, it) }
        if (tabId != null) controller.setTabActive(session, tabId == activeId)
    }

    private fun bindExtension(session: GeckoSession, extension: WebExtension) {
        session.webExtensionController.setActionDelegate(extension, actionDelegate)
        session.webExtensionController.setTabDelegate(extension, sessionTabDelegate)
    }

    fun unbind(session: GeckoSession) {
        if (sessions.containsKey(session)) controller.setTabActive(session, false)
        sessions.remove(session)
        actions.remove(session)
        // A close requested by an extension is acknowledged by React after the
        // domain transaction has removed its tab; retain that request until then.
    }

    fun setActiveTab(id: String?) {
        activeId = id
        if (runtime == null) return
        sessions.forEach { (session, tabId) ->
            controller.setTabActive(session, tabId != null && tabId == id && GeckoSessionRegistry.entry(tabId)?.session === session)
        }
        changed()
    }

    private fun activeEntry() = activeId?.let { GeckoSessionRegistry.entry(it) }?.takeIf { it.session.isOpen }
    private fun canUse(extension: WebExtension, session: GeckoSession): Boolean = usable(extension) &&
        (!session.settings.usePrivateMode || installed[extension.id]?.metaData?.allowedInPrivateBrowsing == true)

    /** Anchor exports use the panel's real session, never the browser's currently selected tab. */
    fun allowsPanelExport(extensionId: String, session: GeckoSession): Boolean =
        sessions.containsKey(session) && session.isOpen && BrowserExtensionViews.owns(session, extensionId) &&
            installed[extensionId]?.let { canUse(it, session) } == true

    private val actionDelegate = object : WebExtension.ActionDelegate {
        override fun onBrowserAction(extension: WebExtension, session: GeckoSession?, action: WebExtension.Action) {
            if (extension.isBuiltIn) return
            if (session == null) defaults[extension.id] = action
            else if (sessions.containsKey(session)) actions.getOrPut(session) { mutableMapOf() }[extension.id] = action
            BrowserExtensionIcons.load(BrowserExtensionIcons.actionKey(extension.id), action.icon) { changed() }
            changed()
        }
        override fun onTogglePopup(extension: WebExtension, action: WebExtension.Action): GeckoResult<GeckoSession>? = popup(extension, action)
        override fun onOpenPopup(extension: WebExtension, action: WebExtension.Action): GeckoResult<GeckoSession>? = popup(extension, action)
    }

    private fun panel(extension: WebExtension, opened: Boolean, url: String? = null,
        popup: Boolean = false, anchorX: Float = 0f, anchorY: Float = 0f): GeckoSession? {
        if (!usable(extension)) return null
        val privateMode = activeEntry()?.privateSession == true
        if (privateMode && !extension.metaData.allowedInPrivateBrowsing) return null
        return BrowserExtensionViews.show(checkNotNull(runtime), extension, privateMode, opened, url,
            popup, anchorX, anchorY, bind = { bind(it) }, onClosed = { unbind(it) })
    }

    private fun popup(extension: WebExtension, action: WebExtension.Action): GeckoResult<GeckoSession>? {
        val context = popupContexts[extension.id] ?: run { tracePopup("callback-without-request"); return null }
        if (context.action !== action) { tracePopup("callback-identity-mismatch"); return null }
        tracePopup("callback-matched")
        popupContexts.remove(extension.id)
        main.removeCallbacks(context.timeout)
        if (activeEntry()?.session !== context.session || !canUse(extension, context.session)) {
            tracePopup("callback-context-retired")
            report("The active tab changed; open extension controls again")
            return null
        }
        return try {
            panel(extension, true, popup = true, anchorX = context.anchorX, anchorY = context.anchorY)
                ?.let { tracePopup("panel-created"); GeckoResult.fromValue(it) }
                ?: run { tracePopup("panel-unavailable"); report("Extension controls could not open in this window"); null }
        } catch (error: Exception) {
            tracePopup("panel-failed")
            report(error.message ?: "Extension controls could not open")
            null
        }
    }

    /** Diagnostic phases only: never log an extension, tab, URL or page content. */
    private fun tracePopup(phase: String) {
        if (popupTraceCount >= 80 || GeckoSessionRegistry.activityProvider?.invoke()?.packageName != "com.workspacebrowser.acceptance") return
        popupTraceCount++
        android.util.Log.i("YeoyuExtensionPopup", "phase=$phase")
    }

    fun isExtensionPage(url: String?): Boolean = url != null && installed.values.any { ownPage(it, url) }

    private fun ownPage(extension: WebExtension, url: String): Boolean = runCatching {
        val base = URI(extension.metaData.baseUrl)
        val uri = URI(url)
        uri.scheme == "moz-extension" && uri.host == base.host && uri.rawUserInfo == null && uri.port == -1
    }.getOrDefault(false)

    private val tabDelegate = object : WebExtension.TabDelegate {
        override fun onNewTab(source: WebExtension, details: WebExtension.CreateTabDetails): GeckoResult<GeckoSession>? {
            if (!usable(source)) return null
            val url = details.url ?: return null
            if (details.active == false || details.cookieStoreId != null || details.discarded == true || details.openInReaderMode == true || details.pinned == true) return null
            if (ownPage(source, url)) return try { panel(source, false, url)?.let { GeckoResult.fromValue(it) } }
                catch (error: Exception) { report(error.message ?: "Extension page could not open"); null }
            val opener = activeEntry() ?: return null
            if (!canUse(source, opener.session) || canonicalBrowserOrigin(url) == null || details.index != null) return null
            // Gecko opens the returned UNOPENED session and navigates it. Reuse
            // the transactional popup adoption bridge; never load the URL twice.
            val epoch = permissionEpoch[source.id] ?: 0L
            val generation = uiGeneration
            return GeckoSessionRegistry.requestExtensionWindow(checkNotNull(activeId), opener.session, url) {
                uiGeneration == generation && (permissionEpoch[source.id] ?: 0L) == epoch && canUse(source, opener.session)
            }
        }
        override fun onOpenOptionsPage(source: WebExtension) {
            try { if (usable(source)) openOptions(source.id) }
            catch (error: Exception) { report(error.message ?: "Extension settings could not open") }
        }
    }

    private val sessionTabDelegate = object : WebExtension.SessionTabDelegate {
        override fun onCloseTab(source: WebExtension?, session: GeckoSession): GeckoResult<AllowOrDeny> {
            if (source == null || !canUse(source, session)) return GeckoResult.deny()
            if (BrowserExtensionViews.owns(session)) return if (BrowserExtensionViews.owns(session, source.id) &&
                BrowserExtensionViews.close(session) && !session.isOpen) GeckoResult.allow() else GeckoResult.deny()
            return requestTab(source, session, "close")
        }
        override fun onUpdateTab(extension: WebExtension, session: GeckoSession, details: WebExtension.UpdateTabDetails): GeckoResult<AllowOrDeny> {
            if (!canUse(extension, session) || details.autoDiscardable != null || details.muted != null || details.pinned != null || details.highlighted != null) return GeckoResult.deny()
            val url = details.url
            if (BrowserExtensionViews.owns(session)) {
                if (url != null && canonicalBrowserOrigin(url) == null && !BrowserExtensionViews.owns(session, extension.id)) return GeckoResult.deny()
                return if (url == null || canonicalBrowserOrigin(url) != null || ownPage(extension, url)) GeckoResult.allow() else GeckoResult.deny()
            }
            // Extension dashboards stay in owned panels. Browser tabs retain
            // web restore targets; Gecko itself can still redirect to a blocker interstitial.
            if (url != null && canonicalBrowserOrigin(url) == null) return GeckoResult.deny()
            val id = sessions[session] ?: return GeckoResult.deny()
            if (GeckoSessionRegistry.entry(id)?.session !== session) return GeckoResult.deny()
            return if (details.active == true) requestTab(extension, session, "activate") else GeckoResult.allow()
        }
    }

    private fun requestTab(extension: WebExtension, session: GeckoSession, action: String): GeckoResult<AllowOrDeny> {
        val id = sessions[session] ?: return GeckoResult.deny()
        if (GeckoSessionRegistry.entry(id)?.session !== session) return GeckoResult.deny()
        val sink = GeckoSessionRegistry.emit ?: return GeckoResult.deny()
        val requestId = ++nextRequest
        val result = GeckoResult<AllowOrDeny>()
        val timeout = Runnable { resolveTabRequest(requestId, false) }
        tabRequests[requestId] = TabRequest(extension.id, session, id, action, result, timeout)
        main.postDelayed(timeout, 10_000)
        sink("BrowserExtensionTabRequest", Arguments.createMap().apply {
            putInt("requestId", requestId); putString("tabId", id); putString("action", action)
        })
        return result
    }

    fun resolveTabRequest(requestId: Int, success: Boolean) {
        val request = tabRequests.remove(requestId) ?: return
        main.removeCallbacks(request.timeout)
        val entry = GeckoSessionRegistry.entry(request.id)
        val applied = if (request.action == "close") entry == null && !request.session.isOpen
            else entry?.session === request.session && activeId == request.id
        val permitted = installed[request.extensionId]?.let { canUse(it, request.session) } == true
        request.result.complete(if (request.claimed && success && applied && permitted) AllowOrDeny.ALLOW else AllowOrDeny.DENY)
    }

    /** Called from inside the serialized domain mutation, immediately before
     * its command. A queued event is not permission to act after revocation. */
    fun claimTabRequest(requestId: Int): Boolean {
        val request = tabRequests[requestId] ?: return false
        if (request.claimed || GeckoSessionRegistry.entry(request.id)?.session !== request.session ||
            !request.session.isOpen || installed[request.extensionId]?.let { canUse(it, request.session) } != true) return false
        request.claimed = true
        return true
    }

    fun refresh(reply: (Result<String>) -> Unit) {
        try { controller.list().accept({ extensions ->
            try {
            val external = checkNotNull(extensions) { "Could not read installed extensions" }.filter { !it.isBuiltIn }
            installed.keys.toList().filter { id -> external.none { it.id == id } }.forEach { forget(it) }
            external.forEach { remember(it) }
            reply(Result.success(json()))
            } catch (error: Exception) { reply(Result.failure(error)) }
        }, { reply(Result.failure(it ?: IllegalStateException("Could not read installed extensions"))) }) } catch (error: Exception) { reply(Result.failure(error)) }
    }

    private fun action(extension: WebExtension): WebExtension.Action? {
        val fallback = defaults[extension.id]
        val current = activeEntry()?.session?.let { actions[it]?.get(extension.id) }
        return if (current != null && fallback != null) current.withDefault(fallback) else current ?: fallback
    }

    /** The per-tab action icon wins over the manifest icon, matching Chrome. */
    private fun tileIcon(extension: WebExtension): String =
        BrowserExtensionIcons.cached(BrowserExtensionIcons.actionKey(extension.id))
            .ifEmpty { BrowserExtensionIcons.cached(extension.id) }

    private fun colorHex(value: Int?): String =
        value?.let { String.format("#%08X", it) } ?: ""

    private fun json(): String = JSONObject().put("busy", busy).put("catalog", BrowserExtensionCatalog.entriesJson())
        .put("extensions", JSONArray(installed.values.map { extension ->
            val meta = extension.metaData
            val current = action(extension)
            JSONObject().put("id", extension.id).put("name", meta.name ?: extension.id).put("version", meta.version ?: "")
                .put("description", meta.description ?: "").put("enabled", meta.enabled)
                .put("privateAllowed", meta.allowedInPrivateBrowsing).put("disabledFlags", meta.disabledFlags)
                .put("hasOptions", !meta.optionsPageUrl.isNullOrBlank()).put("hasAction", action(extension) != null)
                .put("actionEnabled", action(extension)?.enabled != false)
                .put("badge", action(extension)?.badgeText ?: "")
                .put("badgeBackgroundColor", colorHex(current?.badgeBackgroundColor))
                .put("badgeTextColor", colorHex(current?.badgeTextColor))
                .put("icon", tileIcon(extension))
                .put("permissions", JSONArray(meta.requiredPermissions.toList()))
                .put("origins", JSONArray(meta.requiredOrigins.toList()))
                .put("dataPermissions", JSONArray(meta.requiredDataCollectionPermissions.toList()))
                .put("optionalPermissions", JSONArray(meta.grantedOptionalPermissions.toList()))
                .put("optionalOrigins", JSONArray(meta.grantedOptionalOrigins.toList()))
                .put("optionalDataPermissions", JSONArray(meta.grantedOptionalDataCollectionPermissions.toList()))
        })).toString()

    private fun start() { check(!busy) { "Another extension operation is still running" }; busy = true; changed() }
    private fun finish(reply: (Result<String>) -> Unit, error: Throwable? = null) {
        busy = false; installId = null; updateId = null; changed()
        if (error != null) reply(Result.failure(error)) else refresh(reply)
    }

    fun install(slug: String, reply: (Result<String>) -> Unit) {
        try { start() } catch (error: Exception) { reply(Result.failure(error)); return }
        val generation = uiGeneration
        catalogIo.execute {
            val candidate = runCatching { BrowserExtensionCatalog.resolve(slug) }
            main.post {
                candidate.fold({ item ->
                    try {
                        check(generation == uiGeneration) { "The browser window changed; start installation again" }
                        check(!installed.containsKey(item.id)) { "This extension is already installed" }
                        installId = item.id
                        controller.install(item.downloadUrl).accept({ extension ->
                            try {
                                if (extension == null || extension.id != item.id) finish(reply, IllegalStateException("Unexpected installed extension"))
                                else { remember(extension); finish(reply) }
                            } catch (error: Exception) { finish(reply, error) }
                        }, { finish(reply, it ?: IllegalStateException("Extension operation failed")) })
                    } catch (error: Exception) { finish(reply, error) }
                }, { finish(reply, it ?: IllegalStateException("Extension operation failed")) })
            }
        }
    }

    /** Display-only AMO search; serialized on the catalog worker next to install resolution. */
    fun search(query: String, reply: (Result<String>) -> Unit) {
        catalogIo.execute {
            val result = runCatching { BrowserExtensionCatalog.search(query) }
            main.post { result.fold({ reply(Result.success(it)) }, { reply(Result.failure(it)) }) }
        }
    }

    /** Revoke one previously granted optional permission, origin or data-collection
     * consent. Granting stays with the extension's own request prompts. */
    fun revokeOptional(id: String, kind: String, value: String, reply: (Result<String>) -> Unit) {
        try { start() } catch (error: Exception) { reply(Result.failure(error)); return }
        try {
            val extension = checkNotNull(installed[id]) { "Extension is no longer installed; refresh the list" }
            val granted = when (kind) {
                "permission" -> extension.metaData.grantedOptionalPermissions
                "origin" -> extension.metaData.grantedOptionalOrigins
                "data" -> extension.metaData.grantedOptionalDataCollectionPermissions
                else -> throw IllegalArgumentException("Unsupported permission kind")
            }
            check(granted.toList().contains(value)) { "That permission is not currently granted to this extension" }
            val permissions = if (kind == "permission") arrayOf(value) else arrayOf<String>()
            val origins = if (kind == "origin") arrayOf(value) else arrayOf<String>()
            val data = if (kind == "data") arrayOf(value) else arrayOf<String>()
            controller.removeOptionalPermissions(id, permissions, origins, data).accept({ changedExtension ->
                try { changedExtension?.let { remember(it) }; finish(reply) }
                catch (error: Exception) { finish(reply, error) }
            }, { finish(reply, it ?: IllegalStateException("Extension operation failed")) })
        } catch (error: Exception) { finish(reply, error) }
    }

    fun modify(id: String, operation: String, value: Boolean, reply: (Result<String>) -> Unit) {
        try { start() } catch (error: Exception) { reply(Result.failure(error)); return }
        try {
            val extension = checkNotNull(installed[id]) { "Extension is no longer installed; refresh the list" }
            when (operation) {
                "remove" -> controller.uninstall(extension).accept({
                    try { forget(id); finish(reply) } catch (error: Exception) { finish(reply, error) }
                }, { finish(reply, it ?: IllegalStateException("Extension operation failed")) })
                "enabled" -> {
                    val result = if (value) controller.enable(extension, WebExtensionController.EnableSource.USER)
                        else controller.disable(extension, WebExtensionController.EnableSource.USER)
                    result.accept({ changedExtension ->
                        try {
                            if (!value) { cancelRequests(id); BrowserExtensionViews.closeForExtension(id) }
                            changedExtension?.let { remember(it) }; finish(reply)
                        } catch (error: Exception) { finish(reply, error) }
                    }, { finish(reply, it ?: IllegalStateException("Extension operation failed")) })
                }
                "private" -> controller.setAllowedInPrivateBrowsing(extension, value).accept({ changedExtension ->
                    try {
                        cancelRequests(id); BrowserExtensionViews.closeForExtension(id)
                        changedExtension?.let { remember(it) }; finish(reply)
                    } catch (error: Exception) { finish(reply, error) }
                }, { finish(reply, it ?: IllegalStateException("Extension operation failed")) })
                "update" -> {
                    updateId = id
                    controller.update(extension).accept({ updated ->
                        try { updated?.let { remember(it) }; finish(reply) } catch (error: Exception) { finish(reply, error) }
                    }, { finish(reply, it ?: IllegalStateException("Extension operation failed")) })
                }
                else -> finish(reply, IllegalArgumentException("Unsupported extension operation"))
            }
        } catch (error: Exception) { finish(reply, error) }
    }

    fun openAction(id: String, anchorX: Float = 0f, anchorY: Float = 0f) {
        val extension = checkNotNull(installed[id]) { "Extension is not installed" }
        val current = checkNotNull(activeEntry()) { "Open a website before using extension controls" }
        check(canUse(extension, current.session)) { "Extension is disabled or unavailable in this private tab" }
        val available = checkNotNull(action(extension)) { "Extension controls are still starting; refresh and try again" }
        // withDefault creates a distinct Action even if there are no tab overrides;
        // a late callback from an earlier click cannot claim this click's context.
        val action = available.withDefault(available)
        check(action.enabled != false) { "This extension action is unavailable on the current page" }
        popupContexts.remove(id)?.let { main.removeCallbacks(it.timeout) }
        val timeout = Runnable {
            // A callback from an earlier click must not retire a newer request.
            if (popupContexts[id]?.action === action) {
                popupContexts.remove(id)
                tracePopup("callback-timeout")
                report("Extension controls did not open. Try again or open extension settings.")
            }
        }
        popupContexts[id] = PopupContext(current.session, action, timeout, anchorX, anchorY)
        main.postDelayed(timeout, 5_000)
        tracePopup("click-requested")
        try { action.click() } catch (error: Exception) {
            tracePopup("click-failed")
            popupContexts.remove(id); main.removeCallbacks(timeout); throw error
        }
    }

    fun openOptions(id: String) {
        val extension = checkNotNull(installed[id]) { "Extension is not installed" }
        val url = extension.metaData.optionsPageUrl
        check(!url.isNullOrBlank() && ownPage(extension, url)) { "This extension has no available settings page" }
        check(panel(extension, true, url) != null) { "Extension settings could not open in this window" }
    }

    fun closeUi() {
        uiGeneration++
        installId = null
        updateId = null
        BrowserExtensionViews.closeAll()
        ExtensionPermissionPrompts.closeAll()
        tabRequests.keys.toList().forEach { resolveTabRequest(it, false) }
        popupContexts.values.forEach { main.removeCallbacks(it.timeout) }
        popupContexts.clear()
    }

    private fun cancelRequests(id: String) {
        permissionEpoch[id] = (permissionEpoch[id] ?: 0L) + 1
        popupContexts.remove(id)?.let { main.removeCallbacks(it.timeout) }
        tabRequests.filterValues { it.extensionId == id }.keys.toList().forEach { resolveTabRequest(it, false) }
    }

    private fun report(message: String) { GeckoSessionRegistry.emit?.invoke("BrowserExtensionError", Arguments.createMap().apply { putString("error", message) }) }
    private fun observe(operation: () -> Unit) {
        try { operation() } catch (error: Exception) { report(error.message ?: "Extension state could not be refreshed") }
    }
    /** List refreshes themselves emit through here; a serialized-state diff guard
     * keeps one refresh from re-triggering listeners that call list() again. */
    private fun changed() {
        val state = try { json() } catch (error: Exception) { lastState }
        if (state == lastState) return
        lastState = state
        GeckoSessionRegistry.emit?.invoke("BrowserExtensionsChanged", Arguments.createMap())
    }
}
