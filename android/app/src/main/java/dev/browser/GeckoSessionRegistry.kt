package dev.browser

import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import org.json.JSONObject
import org.json.JSONArray
import org.mozilla.geckoview.*
import java.io.File
import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

private const val PERMISSION_REQUEST_TIMEOUT_MS = 60_000L

/** Process-local browser objects. Rust owns IDs/metadata, never these objects. Main thread only. */
object GeckoSessionRegistry {
    private var runtime: GeckoRuntime? = null
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor { job -> Thread(job, "yeoyu-session-storage").apply { isDaemon = true } }
    private var toolsConfig = BrowserToolsConfig()
    private val configurationGate = BrowserConfigurationGate()
    private var initialized = false
    private var initializing = false
    private val initializeReplies = mutableListOf<(Result<String>) -> Unit>()
    private var store: SessionStateStore? = null
    private var configFile: File? = null
    private var pausedStore: PausedSessionStore? = null
    private val persistedPausedIds = mutableSetOf<String>()
    private var activeIds: Set<String>? = null
    private var metadataCount = 0
    /** Tabs whose GeckoSession must run private mode; owned by reconcile. */
    private val privateIds = mutableSetOf<String>()
    private val writeGate = SessionWriteGate()
    private val isolation = SessionIsolationBarrier()
    private val recoveryBudget = SessionRecoveryBudget()
    private val savedStates = linkedMapOf<String, StoredSessionState>()
    private data class PendingStateWrite(val token: SessionWriteGate.Token, val value: StoredSessionState)
    private val pendingStateWrites = linkedMapOf<String, PendingStateWrite>()
    private var stateWriteScheduled = false
    private var stateWriteInFlight = false
    private var lastStorageError: String? = null
    private var lastStorageErrorAt = 0L
    private data class SuspendedTab(val url: String, val reason: String)
    private val suspended = mutableMapOf<String, SuspendedTab>()
    private val waitingSurfaces = mutableMapOf<String, BrowserSurfaceView>()
    private val pendingAdmissions = PendingSurfaceAdmissions<BrowserSurfaceView>()
    private val unclosedSessions = mutableSetOf<GeckoSession>()
    private var nextSessionVersion = 1L
    private var navigationSequence = 0L
    private var releaseOperation = 0L
    private data class ToolsInitialization(
        val config: BrowserToolsConfig, val store: SessionStateStore, val states: SessionStateRead,
        val file: File, val pausedStore: PausedSessionStore, val pausedIds: Set<String>,
    )

    /** Must complete before React mounts the first BrowserSurface. */
    fun initializeTools(app: Context, reply: (Result<String>) -> Unit) {
        if (initialized) { reply(Result.success(toolsConfig.toJson())); return }
        initializeReplies.add(reply)
        if (initializing) return
        initializing = true
        val root = File(app.applicationContext.noBackupFilesDir, "browser-tools")
        io.execute {
            val result = runCatching {
                val config = File(root, "settings.json")
                val loaded = if (config.exists()) {
                    if (config.length() > 128 * 1024) throw IOException("Browser settings exceed the storage limit")
                    BrowserToolsConfig.parse(config.readText(Charsets.UTF_8))
                } else BrowserToolsConfig()
                val sessionStore = SessionStateStore(File(root, "sessions"), SESSION_ENGINE_VERSION)
                val pauses = PausedSessionStore(File(root, "paused-tabs.json"))
                val paused = pauses.read()
                paused.forEach { sessionStore.remove(it) }
                val read = if (loaded.restoreSessions) sessionStore.readAll(System.currentTimeMillis())
                    else { sessionStore.clear(); SessionStateRead(emptyMap(), emptyList()) }
                ToolsInitialization(loaded, sessionStore, read, config, pauses, paused)
            }
            main.post {
                initializing = false
                result.onSuccess { loaded ->
                    toolsConfig = loaded.config
                    store = loaded.store
                    configFile = loaded.file
                    pausedStore = loaded.pausedStore
                    loaded.pausedIds.filter { activeIds?.contains(it) != false }.forEach { id ->
                        persistedPausedIds.add(id); isolation.pause(id)
                    }
                    loaded.states.states.filterKeys { activeIds?.contains(it) != false && it !in persistedPausedIds }.forEach { (id, state) -> savedStates[id] = state }
                    loaded.states.issues.firstOrNull()?.let(::storageError)
                    activeIds?.let { keep -> io.execute {
                        try { loaded.store.reconcile(keep); loaded.pausedStore.write(loaded.pausedIds.intersect(keep)) }
                        catch (_: Exception) { main.post { storageError("Saved tab cleanup could not be completed") } }
                    } }
                    initialized = true
                    writeGate.setEnabled(toolsConfig.restoreSessions)
                    try { runtime?.let(::applyRuntimeSettings) }
                    catch (_: Exception) { storageError("Browser settings could not be applied to the engine") }
                }.onFailure { storageError("Browser settings could not be read; saved data was kept") }
                val response = result.map { toolsConfig.toJson() }
                initializeReplies.toList().also { initializeReplies.clear() }.forEach { it(response) }
            }
        }
    }

    fun configureTools(app: Context, json: String, reply: (Result<Unit>) -> Unit) {
        if (!initialized) { reply(Result.failure(IllegalStateException("Browser settings are not ready"))); return }
        val updated = try { BrowserToolsConfig.parse(json) } catch (error: Exception) { reply(Result.failure(error)); return }
        if (isolation.clearing) { reply(Result.failure(IllegalStateException("Browser data is being cleared"))); return }
        // Immediately reject queued old writes when consent is withdrawn.
        if (!updated.restoreSessions) { writeGate.setEnabled(false); pendingStateWrites.clear() }
        val file = configFile ?: run { reply(Result.failure(IOException("Browser settings storage is unavailable"))); return }
        configurationGate.begin()
        try { io.execute {
            var configSaved = false
            val result = runCatching {
                // Persist opt-out first: a process death during cleanup must not restore old data.
                AtomicBrowserFile.write(file, updated.toJson().toByteArray(Charsets.UTF_8))
                configSaved = true
                if (!updated.restoreSessions) store?.clear()
            }
            main.post {
                val applied = runCatching {
                    if (!configSaved) return@runCatching
                    toolsConfig = updated
                    writeGate.setEnabled(updated.restoreSessions)
                    // Volatile states also restore manually released tabs in this process.
                    // Opt-out removes durable copies above, not this live-session buffer.
                    runtime?.let(::applyRuntimeSettings)
                    entries.forEach { (_, entry) ->
                        applySiteSettings(entry, entry.url)
                        if (updated.restoreSessions) entry.session.flushSessionState()
                    }
                }
                val completion = result.fold({ applied }, { Result.failure(it) })
                configurationGate.finish()
                completion.onFailure { storageError("Browser settings could not be fully saved or applied") }
                reply(completion)
            }
        } } catch (error: Exception) {
            configurationGate.finish()
            reply(Result.failure(error))
        }
    }

    fun setTabMetadataCount(count: Int) {
        metadataCount = count.coerceAtLeast(0)
    }

    fun diagnostics(): String = JSONObject().apply {
        put("engineVersion", SESSION_ENGINE_VERSION)
        put("automaticMemorySaving", toolsConfig.automaticMemorySaving)
        put("clearing", isolation.clearing)
        put("metadataTabs", metadataCount)
        put("attachedSurfaces", entries.values.count { it.owner != null })
        put("liveSessions", entries.size)
        put("privateSessions", entries.values.count { it.privateSession })
        put("unclosedSessions", unclosedSessions.size)
        put("suspendedSessions", suspended.size)
        val reasonCounts = mutableMapOf<String, Int>()
        entries.forEach { (id, entry) -> releaseObservation(id, entry).protectionReasons().forEach { reason -> reasonCounts[reason] = (reasonCounts[reason] ?: 0) + 1 } }
        put("protectionReasonCounts", JSONObject(reasonCounts))
        put("savedSessions", savedStates.size)
        put("lastStorageError", lastStorageError ?: JSONObject.NULL)
        put("entries", JSONArray().apply { entries.forEach { (id, entry) -> put(JSONObject().apply {
            put("tabId", id); put("private", entry.privateSession); put("playing", entry.playing)
            put("recording", entry.recording); put("attached", entry.owner != null)
            put("blockedCount", entry.blockedCount)
            put("trackingProtection", entry.session.settings.useTrackingProtection)
            put("resourceState", if (entry.owner != null) "attached" else "live-background")
            put("protectionReasons", JSONArray(releaseObservation(id, entry).protectionReasons()))
        }) } })
    }.toString()

    /** Called only after the UI confirms page closure and possible sign-out. */
    fun clearBrowsingData(app: Context, host: String?, category: String, reply: (Result<Unit>) -> Unit) {
        val flags = when (category) {
            "cookies" -> StorageController.ClearFlags.COOKIES or StorageController.ClearFlags.AUTH_SESSIONS
            "storage" -> StorageController.ClearFlags.DOM_STORAGES
            "cache" -> StorageController.ClearFlags.ALL_CACHES
            "all-site-data" -> StorageController.ClearFlags.SITE_DATA or StorageController.ClearFlags.AUTH_SESSIONS
            else -> { reply(Result.failure(IllegalArgumentException("Unknown browser data category"))); return }
        }
        val normalizedHost = host?.let { raw ->
            // The host API spans schemes/ports; do not claim an origin-only deletion.
            val origin = canonicalBrowserOrigin("https://$raw")
            if (raw.isBlank() || origin == null || java.net.URI(origin).port != -1 || java.net.URI(origin).rawAuthority != raw.lowercase(java.util.Locale.ROOT)) {
                reply(Result.failure(IllegalArgumentException("A valid exact host is required"))); return
            }
            raw.lowercase(java.util.Locale.ROOT).removeSurrounding("[", "]")
        }
        if (!initialized || isolation.clearing) { reply(Result.failure(IllegalStateException("Browser data tools are not ready"))); return }
        val rt = try { getRuntime(app) } catch (error: Exception) { reply(Result.failure(error)); return }
        val pausedIdsAtStart = (activeIds ?: emptySet()) + entries.keys + savedStates.keys + suspended.keys + pendingAdmissions.ids()
        isolation.begin(pausedIdsAtStart)
        persistedPausedIds.addAll(pausedIdsAtStart)
        pendingAdmissions.pauseAll()
        releaseOperation++
        writeGate.beginClear()
        pendingStateWrites.clear()
        savedStates.clear()
        CredentialActivityCoordinator.cancelAll()
        suspended.replaceAll { _, tab -> tab.copy(reason = "data-cleared") }
        var allClosed = true
        unclosedSessions.toList().forEach { session ->
            try {
                if (session.isOpen) session.close()
                if (!session.isOpen) { FilePromptCoordinator.releaseSession(session); unclosedSessions.remove(session) }
                else allClosed = false
            } catch (_: Exception) { allClosed = false }
        }
        entries.keys.toList().forEach { id ->
            val entry = entries[id] ?: return@forEach
            val owner = entry.owner
            suspended[id] = SuspendedTab(entry.url, "data-cleared")
            if (!retireEntry(id, "data-cleared")) allClosed = false
            if (owner != null && owner.isAttachedToWindow) waitingSurfaces[id] = owner
            sessionBlocked(id, "data-cleared")
        }
        if (!allClosed) {
            persistPausedIds()
            isolation.end(); writeGate.endClear()
            reply(Result.failure(IOException("A page could not be closed; data was not cleared")))
            return
        }
        val pausedIds = persistedPausedIds.toSet()
        // Ordered after all older writes. A failed disk clear must not resume pages.
        io.execute {
            val disk = runCatching { pausedStore?.write(pausedIds); store?.clear() }
            main.post {
                disk.onFailure {
                    isolation.end(); writeGate.endClear()
                    storageError("Saved sessions could not be cleared; pages remain paused")
                    reply(Result.failure(it))
                }.onSuccess {
                    try {
                        val request = if (normalizedHost == null) rt.storageController.clearData(flags)
                            else rt.storageController.clearDataFromHost(normalizedHost, flags)
                        var replied = false
                        val timeout = Runnable {
                            if (!replied) {
                                replied = true
                                // Keep the global lock until the engine actually settles.
                                reply(Result.failure(IOException("Data clearing is still pending; pages remain paused")))
                            }
                        }
                        main.postDelayed(timeout, 15_000)
                        request.accept({
                            main.removeCallbacks(timeout)
                            isolation.end(); writeGate.endClear()
                            if (!replied) { replied = true; reply(Result.success(Unit)) }
                        }, { failure ->
                            main.removeCallbacks(timeout)
                            isolation.end(); writeGate.endClear()
                            if (!replied) { replied = true; reply(Result.failure(failure ?: IOException("Browser data clear failed"))) }
                        })
                    } catch (error: Exception) {
                        isolation.end(); writeGate.endClear()
                        reply(Result.failure(error))
                    }
                }
            }
        }
    }

    /** Manual and automatic release share the same conservative safety boundary. */
    fun releaseInactive(automatic: Boolean = false, reply: (Result<String>) -> Unit) {
        if (isolation.clearing) { reply(Result.failure(IllegalStateException("Browser data is being cleared"))); return }
        if (automatic && !toolsConfig.automaticMemorySaving) { reply(Result.failure(IllegalStateException("Automatic memory saving is disabled"))); return }
        val operation = ++releaseOperation
        val candidates = entries.keys.take(64)
        var released = 0
        var protected = 0
        var failed = 0
        val reasons = mutableMapOf<String, Int>()
        fun countReasons(values: List<String>) { values.forEach { reasons[it] = (reasons[it] ?: 0) + 1 } }
        fun next(index: Int) {
            if (operation != releaseOperation) { reply(Result.failure(IllegalStateException("Tab release was superseded"))); return }
            if (index >= candidates.size) {
                reply(Result.success(JSONObject().apply {
                    put("released", released); put("protected", protected); put("failed", failed); put("reasons", JSONObject(reasons))
                }.toString())); return
            }
            val id = candidates[index]
            val entry = entries[id]
            val before = entry?.let { releaseObservation(id, it) }
            if (entry == null || before?.canInspect() != true) { countReasons(before?.protectionReasons() ?: listOf("retired")); protected++; main.post { next(index + 1) }; return }
            var finished = false
            fun complete(forms: Boolean?, error: Boolean) {
                if (finished) return
                finished = true
                val current = entries[id]
                if (operation != releaseOperation) { main.post { next(index + 1) }; return }
                if (error) failed++
                else if (current === entry && !isolation.clearing && before.canReleaseAfter(releaseObservation(id, entry), forms)) {
                    suspended[id] = SuspendedTab(entry.url, "memory")
                    if (retireEntry(id, "memory")) released++ else failed++
                } else { protected++; countReasons(if (forms == true) listOf("form-input") else listOf("changed-or-unknown")) }
                main.post { next(index + 1) }
            }
            main.postDelayed({ complete(null, true) }, 2_000)
            try { entry.session.containsFormData().accept({ complete(it, false) }, { complete(null, true) }) }
            catch (_: Exception) { complete(null, true) }
        }
        next(0)
    }

    /** Only Android pressure may trigger the opt-in path. Unknown SPA state stays protected. */
    fun onMemoryPressure() { main.post {
        if (toolsConfig.automaticMemorySaving && !isolation.clearing) releaseInactive(automatic = true) { }
    } }

    fun retry(app: Context, id: String, reply: (Result<Unit>) -> Unit) {
        if (activeIds?.contains(id) == false) { reply(Result.failure(IllegalArgumentException("Tab is closed"))); return }
        val url = suspended[id]?.url ?: entries[id]?.url
        if (url == null) { reply(Result.failure(IllegalArgumentException("No paused page is available"))); return }
        if (!isolation.resume(id)) { reply(Result.failure(IllegalStateException("Browser data is being cleared"))); return }
        if (persistedPausedIds.remove(id)) persistPausedIds()
        entries[id]?.let { live ->
            reply(runCatching { recoveryBudget.retry(id); live.session.reload() })
            return
        }
        val owner = entries[id]?.owner ?: waitingSurfaces[id]
        val result = runCatching {
            recoveryBudget.retry(id)
            retireEntry(id, "user-retry")
            suspended.remove(id)
            createEntry(app.applicationContext, id, url, isPrivate = id in privateIds)
            if (owner != null && owner.isAttachedToWindow && owner.tabId == id) attach(owner, id, url)
        }
        result.onFailure { isolation.pause(id); suspended[id] = SuspendedTab(url, "retry-failed"); sessionBlocked(id, "retry-failed") }
        reply(result)
    }

    fun load(app: Context, id: String, url: String) {
        if (activeIds?.contains(id) == false) return
        if (!isolation.resume(id)) {
            suspended[id] = SuspendedTab(url, "data-cleared")
            if (persistedPausedIds.add(id)) persistPausedIds()
            sessionBlocked(id, "data-clear-in-progress"); return
        }
        if (persistedPausedIds.remove(id)) persistPausedIds()
        val owner = entries[id]?.owner ?: waitingSurfaces[id]
        try {
            recoveryBudget.retry(id)
            suspended.remove(id)
            savedStates.remove(id)
            pendingStateWrites.remove(id)
            val entry = entries[id]
            if (entry == null) {
                createEntry(app.applicationContext, id, url, isPrivate = id in privateIds)
                if (owner != null && owner.isAttachedToWindow && owner.tabId == id) attach(owner, id, url)
            } else { entry.initialNavigation.navigationRequested(url); applySiteSettings(entry, url); entry.session.loadUri(url) }
        } catch (_: Exception) { sessionBlocked(id, "load-failed") }
    }

    fun navigate(app: Context, id: String, action: String) {
        if (activeIds?.contains(id) == false) return
        if (isolation.clearing) { sessionBlocked(id, "data-clear-in-progress"); return }
        if (entries[id] == null) {
            retry(app, id) { it.onFailure { sessionBlocked(id, "retry-failed") } }
            return
        }
        try {
            val entry = entries[id] ?: return
            val session = entry.session
            if (action == "back" || action == "forward" || action == "reload") entry.initialNavigation.navigationRequested()
            if (action == "reload") recoveryBudget.retry(id)
            when (action) { "back" -> session.goBack(); "forward" -> session.goForward(); "reload" -> session.reload() }
        } catch (_: Exception) { sessionBlocked(id, "load-failed") }
    }

    private fun getRuntime(app: Context): GeckoRuntime = runtime ?: run {
        BrowserAppearance.initialize(app)
        GeckoRuntime.create(app.applicationContext)
    }.also {
        runtime = it
        it.activityDelegate = CredentialActivityCoordinator
        applyRuntimeSettings(it)
        BrowserWebNotifications.initialize(app, it)
        installNotificationWindowDelegate(it)
        BrowserExtensionHost.initialize(it)
        BrowserVideoRegions.initialize(it, diagnostics = (app.packageName == "com.workspacebrowser.acceptance" || app.packageName.startsWith("com.workspacebrowser.acceptance.")))
    }

    private fun applyRuntimeSettings(rt: GeckoRuntime) {
        BrowserAppearance.applyRuntimeSettings(rt.settings)
        rt.settings.setAutomaticFontSizeAdjustment(false).setFontSizeFactor(toolsConfig.textScale.toFloat())
        val protection = rt.settings.contentBlocking
        protection.setAntiTracking(if (toolsConfig.trackingProtection == "strict") ContentBlocking.AntiTracking.STRICT else ContentBlocking.AntiTracking.DEFAULT)
        protection.setEnhancedTrackingProtectionLevel(when (toolsConfig.trackingProtection) {
            "standard" -> ContentBlocking.EtpLevel.DEFAULT
            "strict" -> ContentBlocking.EtpLevel.STRICT
            else -> ContentBlocking.EtpLevel.NONE
        })
    }

    private fun applySiteSettings(entry: Entry, url: String) {
        val site = toolsConfig.siteFor(url)
        entry.session.settings.userAgentMode = if (site?.desktop != false) GeckoSessionSettings.USER_AGENT_MODE_DESKTOP else GeckoSessionSettings.USER_AGENT_MODE_MOBILE
        // Desktop selects the site's UA variant, not a forced 980 CSS-pixel
        // canvas. Keep responsive meta viewports in both modes so split/sidebar
        // resizing still changes CSS breakpoints. Saving unrelated site settings
        // must not change the default viewport behavior either.
        entry.session.settings.viewportMode = GeckoSessionSettings.VIEWPORT_MODE_MOBILE
        entry.session.settings.useTrackingProtection = site?.trackingProtection ?: (toolsConfig.trackingProtection != "engine-default")
    }

    private fun storageError(message: String) {
        val now = android.os.SystemClock.elapsedRealtime()
        val notify = lastStorageError != message || now - lastStorageErrorAt >= 10_000
        lastStorageError = message
        if (notify) {
            lastStorageErrorAt = now
            emit?.invoke("BrowserSessionStorageError", Arguments.createMap().apply { putString("message", message) })
        }
    }

    private fun persistPausedIds() {
        val ids = persistedPausedIds.toSet()
        io.execute {
            try { pausedStore?.write(ids) }
            catch (_: Exception) { main.post { storageError("Paused tab state could not be saved") } }
        }
    }

    private fun sessionBlocked(id: String, reason: String) {
        emit?.invoke("BrowserSessionBlocked", Arguments.createMap().apply {
            putString("tabId", id); putString("reason", reason); putInt("attempts", recoveryBudget.attempts(id))
        })
    }

    private fun rememberState(id: String, entry: Entry, state: GeckoSession.SessionState) {
        // Private sessions never persist state: nothing reaches savedStates,
        // the disk store, or restore-on-restart for these tabs.
        if (entry.privateSession) return
        if (entries[id] !== entry || isolation.clearing) return
        if (state.size <= 0 || state.currentIndex !in 0 until state.size) return
        // Blocker interstitials contain installation-specific extension URLs.
        // Keep the last usable web state; otherwise restore from the web target.
        if ((0 until state.size).any { state[it].uri?.startsWith("moz-extension:", ignoreCase = true) == true }) return
        if (!entry.initialNavigation.acceptSessionState(entry.url, state[state.currentIndex].uri)) return
        val raw = state.toString() ?: return
        val value = StoredSessionState(id, entry.url, raw, System.currentTimeMillis())
        if (value.byteSize > MAX_SESSION_STATE_BYTES) {
            savedStates.remove(id); pendingStateWrites.remove(id)
            writeGate.register(id, entry)
            io.execute { try { store?.remove(id) } catch (_: Exception) { main.post { storageError("An oversized saved tab state could not be removed") } } }
            storageError("A tab is too large for session restoration"); return
        }
        savedStates.remove(id)
        savedStates[id] = value
        entry.stateDocumentGeneration = entry.documentGeneration
        var bytes = savedStates.values.sumOf { it.byteSize.toLong() }
        while (bytes > 20L * 1024 * 1024 && savedStates.isNotEmpty()) {
            val oldest = savedStates.entries.first()
            bytes -= oldest.value.byteSize
            pendingStateWrites.remove(oldest.key)
            savedStates.remove(oldest.key)
        }
        writeGate.capture(id, entry)?.let { pendingStateWrites[id] = PendingStateWrite(it, value) }
        scheduleStateWrites()
    }

    /** Single instance so removeCallbacks can cancel the pending pass. */
    private val stateWritePass = Runnable { writePendingStates() }

    private fun scheduleStateWrites() {
        if (stateWriteScheduled || stateWriteInFlight || pendingStateWrites.isEmpty()) return
        stateWriteScheduled = true
        main.postDelayed(stateWritePass, 750)
    }

    /** Must run on the main handler. */
    private fun writePendingStates() {
        stateWriteScheduled = false
        val writes = pendingStateWrites.values.toList()
        pendingStateWrites.clear()
        if (writes.isEmpty()) return
        stateWriteInFlight = true
        io.execute {
            var failed = false
            writes.forEach { pending ->
                if (writeGate.accepts(pending.token)) {
                    try { store?.write(pending.value, System.currentTimeMillis()) }
                    catch (_: Exception) { failed = true }
                }
            }
            main.post {
                stateWriteInFlight = false
                if (failed) storageError("A tab state could not be saved; the live page remains open")
                scheduleStateWrites()
            }
        }
    }

    /** Host activity stopped: capture every live tab's current engine state and
     * drain queued writes now. JS flushes the tab snapshot for this same
     * transition; without this pass a task removal inside the 750 ms
     * coalescing window still loses the newest page states. Best effort —
     * a write racing process death only covers what has reached the queue. */
    fun flushSessionsForBackground() {
        if (!initialized || !toolsConfig.restoreSessions || isolation.clearing) return
        main.post {
            if (isolation.clearing) return@post
            entries.values.forEach { entry ->
                if (!entry.privateSession) runCatching { entry.session.flushSessionState() }
            }
            // flushSessionState reports back through onSessionStateChange on
            // this looper; one trailing pass catches those states, then the
            // queue hits disk without waiting out the idle debounce.
            main.post {
                if (isolation.clearing) return@post
                if (stateWriteScheduled) { main.removeCallbacks(stateWritePass); stateWriteScheduled = false }
                if (pendingStateWrites.isNotEmpty() && !stateWriteInFlight) writePendingStates()
            }
        }
    }
    private data class PendingWindow(
        val openerId: String, val opener: GeckoSession, val uri: String,
        val request: PopupRequest<GeckoSession>, val timeout: Runnable,
        val notificationWindow: Boolean = false,
        val isAuthorized: () -> Boolean = { true })
    private val pendingWindows = mutableMapOf<Int, PendingWindow>()
    private val nextWindowId = AtomicInteger(1)
    /** Per-site permission decision pushed from JS: origin+kind → allow/block. */
    data class SitePermissionRule(val origin: String, val kind: String, val allow: Boolean)
    private var permissionRules: Map<String, Boolean> = emptyMap()
    /** Requests awaiting the user's dialog answer, completed later from JS. */
    private class PendingPermission(
        val origin: String, val kind: String,
        val session: GeckoSession,
        val timeout: Runnable,
        val content: GeckoResult<Int>? = null,
        val media: GeckoSession.PermissionDelegate.MediaCallback? = null,
        val video: GeckoSession.PermissionDelegate.MediaSource? = null,
        val audio: GeckoSession.PermissionDelegate.MediaSource? = null)
    private val pendingPermissions = PermissionRequestLedger<PendingPermission>()
    private val nextPermissionId = AtomicInteger(1)
    data class Entry(val session: GeckoSession, var url: String, var title: String = "",
        var loading: Boolean = false, var progress: Int = 0, var back: Boolean = false, var forward: Boolean = false,
        var playing: Boolean = false, var media: MediaSession? = null, var owner: BrowserSurfaceView? = null,
        var documentGeneration: Long = 0, val sessionVersion: Long = 0,
        var activityVersion: Long = 0, var stateDocumentGeneration: Long = -1,
        var recording: Boolean = false, var blockedCount: Int = 0, var security: JSONObject? = null,
        var fullscreen: Boolean = false, var mediaTitle: String? = null,
        var fullscreenVideoSize: Pair<Int, Int>? = null) {
        internal var lastContentfulPaintDocument: Long = -1
        internal val permissionPrompts = DocumentPermissionPrompts()
        /** Fixed for the session lifetime at creation; private sessions never
         *  persist state and run without the shared profile's storage. */
        internal var privateSession: Boolean = false
        internal lateinit var contentFullscreen: ContentFullscreenSession<GeckoSession>
        internal lateinit var initialNavigation: InitialNavigationAdmission
        internal val initialNavigationLocationAccepted: Boolean get() = initialNavigation.locationAccepted
    }
    private val entries = mutableMapOf<String, Entry>()
    var emit: ((String, WritableMap) -> Unit)? = null
    var pictureInPictureStateChanged: ((String) -> Unit)? = null
    /** Resolve the current Activity lazily; never retain a dead Activity window. */
    var activityProvider: (() -> android.app.Activity?)? = null
    fun dismissPrompts() {
        entries.values.forEach { (it.session.promptDelegate as? BrowserPromptDelegate)?.cancelPending() }
    }
    private var boosts: Map<String, String> = emptyMap()
    fun entry(id: String): Entry? = entries[id]
    internal fun isMediaPlaying(id: String, session: GeckoSession?): Boolean {
        val entry = entries[id] ?: return false
        return entry.session === session && session?.isOpen == true && entry.playing
    }
    internal fun extensionRuntime(app: Context): GeckoRuntime {
        check(initialized) { "Browser settings are not ready" }
        return getRuntime(app)
    }
    internal fun spaceTransitionPair(from: String, to: String): Pair<Entry, Entry>? {
        val source = entries[from] ?: return null
        val target = entries[to] ?: return null
        val owner = source.owner ?: return null
        if (from == to || source.session === target.session || target.owner != null ||
            !source.session.isOpen || !target.session.isOpen || source.playing ||
            source.fullscreen || target.fullscreen || owner.gecko.parent !== owner ||
            ExternalPictureInPicture.holdsSession(source.session) || ExternalPictureInPicture.holdsSession(target.session) ||
            isPictureInPictureBlocked(from) || isPictureInPictureBlocked(to)) return null
        val visibleOwners = entries.values.count { e -> e.owner?.let {
            it.isAttachedToWindow && it.isShown && it.gecko.parent === it
        } == true }
        return if (visibleOwners == 1) source to target else null
    }
    /** Admission stays owned here: a visual preparation must never resume a paused or future tab. */
    internal fun coldSpaceSource(from: String, to: String): Entry? {
        if (from == to || activeIds?.contains(from) != true || activeIds?.contains(to) != true ||
            isolation.clearing || from in suspended || to in suspended ||
            !isolation.allowAttach(from) || !isolation.allowAttach(to)) return null
        val source = entries[from] ?: return null
        val owner = source.owner ?: return null
        if (!source.session.isOpen || source.playing || source.fullscreen || owner.gecko.parent !== owner ||
            ExternalPictureInPicture.holdsSession(source.session) || isPictureInPictureBlocked(from) ||
            isPictureInPictureBlocked(to)) return null
        val visibleOwners = entries.values.count { e -> e.owner?.let {
            it.isAttachedToWindow && it.isShown && it.gecko.parent === it
        } == true }
        return source.takeIf { visibleOwners == 1 }
    }
    internal fun prepareColdSpaceTarget(context: Context, id: String, url: String): Entry? {
        if (activeIds?.contains(id) != true || isolation.clearing || id in suspended ||
            !isolation.allowAttach(id) || canonicalBrowserOrigin(url) == null) return null
        val existing = entries[id]
        if (existing != null && (existing.url != url || existing.owner != null || !existing.session.isOpen ||
            ExternalPictureInPicture.holdsSession(existing.session) || isPictureInPictureBlocked(id))) return null
        return ensure(context, id, url)
    }
    /** Return-only eligibility; the ordinary Space capture rules above remain unchanged. */
    internal fun returnTransitionTargets(from: String, after: Set<String>, returning: Entry): Pair<Entry, List<Entry>>? {
        val source = entries[from] ?: return null
        val owner = source.owner ?: return null
        val targets = after.map { entries[it] ?: return null }
        if (after.size !in 1..2 || targets.none { it === returning } || targets.any { it.session === source.session && it !== source } ||
            targets.map { it.session }.distinct().size != targets.size || source === returning || source.playing ||
            !source.session.isOpen || source.fullscreen || owner.gecko.parent !== owner ||
            ExternalPictureInPicture.holdsSession(source.session) || isPictureInPictureBlocked(from) ||
            after.any { isPictureInPictureBlocked(it) } || targets.any {
                !it.session.isOpen || it.fullscreen || (it.owner != null && it !== source) ||
                    (it !== returning && ExternalPictureInPicture.holdsSession(it.session))
            }) return null
        val visibleOwners = entries.values.count { e -> e.owner?.let {
            it.isAttachedToWindow && it.isShown && it.gecko.parent === it
        } == true }
        return if (visibleOwners == 1) source to targets else null
    }
    fun hasContentFullscreen(): Boolean = entries.values.any { it.fullscreen && !ExternalPictureInPicture.holdsSession(it.session) }
    fun exitContentFullscreen(id: String) {
        val entry = entries[id] ?: return
        if (ExternalPictureInPicture.holdsSession(entry.session)) return
        fullscreenOperation { entry.contentFullscreen.requestExit() }
    }
    internal fun externalDisplayChanged(id: String) {
        entries[id]?.let { entry ->
            updateActive(entry)
            if (!ExternalPictureInPicture.holdsSession(entry.session) && entry.owner?.isShown != true)
                fullscreenOperation { entry.contentFullscreen.leave() }
            emit?.invoke("BrowserNavigation", payload(id, entry))
        }
        refreshContentFullscreen()
    }
    private fun pictureInPictureChanged(id: String) {
        pictureInPictureStateChanged?.invoke(id)
        ExternalPictureInPicture.registryChanged(id)
    }
    private fun fullscreenOperation(operation: () -> Unit) {
        try { operation() }
        catch (failure: Exception) { android.util.Log.w("BrowserFullscreen", "Content fullscreen exit failed", failure) }
    }
    private fun refreshContentFullscreen() {
        (activityProvider?.invoke() as? com.workspacebrowser.MainActivity)?.refreshBrowserFullscreen()
    }
    fun isPictureInPictureBlocked(id: String): Boolean = entries[id]?.let {
        (it.session.promptDelegate as? BrowserPromptDelegate)?.hasPending() == true ||
            pendingPermissions.hasForOwner(it.session)
    } ?: false
    /** Replace per-site permission rules (origin+kind → allow). */
    fun setSitePermissionRules(list: List<SitePermissionRule>) {
        permissionRules = list.associate { "${it.origin}|${it.kind}" to it.allow }
    }
    /** Completes a pending permission request from the JS dialog. */
    fun resolvePermission(requestId: Int, allow: Boolean, rememberDenial: Boolean) {
        val resolution = pendingPermissions.resolve(
            requestId,
            allow,
            isOwnerAlive = { owner -> entries.values.any { it.session === owner } },
            currentDocument = { owner ->
                entries.values.firstOrNull { it.session === owner }?.documentGeneration
            },
        ) ?: return
        val pending = resolution.value
        main.removeCallbacks(pending.timeout)
        val grant = resolution.allow
        if (!grant && resolution.current) {
            val entry = entries.values.firstOrNull { it.session === pending.session }
            entry?.permissionPrompts?.dismiss(pending.origin, pending.kind)
            // Requests already queued by the same page must not reopen a
            // dismissed prompt. Other pages and capabilities remain separate.
            pendingPermissions.cancelMatching(pending.session) {
                entry?.permissionPrompts?.shouldPrompt(it.origin, it.kind) == false
            }.forEach { cancelPermission(it, "dismissed-for-document") }
        }
        // Gecko 155 remembers content responses. PROMPT denies this request
        // without converting a dismissal or failed save into a durable block.
        pending.content?.complete(when {
            grant -> GeckoSession.PermissionDelegate.ContentPermission.VALUE_ALLOW
            rememberDenial && resolution.current -> GeckoSession.PermissionDelegate.ContentPermission.VALUE_DENY
            else -> GeckoSession.PermissionDelegate.ContentPermission.VALUE_PROMPT
        })
        pending.media?.let { if (grant) it.grant(pending.video, pending.audio) else it.reject() }
    }
    private fun cancelPermission(requestId: Int, reason: String) {
        pendingPermissions.cancel(requestId)?.let { cancelPermission(it, reason) }
    }
    private fun cancelPermission(request: PendingPermissionRequest<PendingPermission>, reason: String) {
        val pending = request.value
        main.removeCallbacks(pending.timeout)
        pending.content?.complete(GeckoSession.PermissionDelegate.ContentPermission.VALUE_PROMPT)
        pending.media?.reject()
        emit?.invoke("BrowserPermissionCancelled", Arguments.createMap().apply {
            putInt("requestId", request.id); putString("reason", reason)
        })
    }
    private fun cancelPermissions(session: GeckoSession, reason: String) {
        pendingPermissions.cancelForOwner(session).forEach { cancelPermission(it, reason) }
    }
    /** Reject permission and window callbacks owned by the retiring React bridge. */
    fun cancelPendingRequests() {
        pendingPermissions.cancelAll().forEach { cancelPermission(it, "bridge-invalidated") }
        pendingWindows.keys.toList().forEach { cancelNewSession(it, "Browser window closed") }
    }
    internal fun requestExtensionWindow(openerId: String, opener: GeckoSession, uri: String, isAuthorized: () -> Boolean): GeckoResult<GeckoSession>? {
        if (canonicalBrowserOrigin(uri) == null) return null
        return requestWindow(openerId, opener, uri, fromExtension = true, isAuthorized = isAuthorized)
    }
    private fun installNotificationWindowDelegate(rt: GeckoRuntime) {
        rt.serviceWorkerDelegate = object : GeckoRuntime.ServiceWorkerDelegate {
            override fun onOpenWindow(url: String): GeckoResult<GeckoSession> {
                val origin = BrowserWebNotifications.consumeWindowActivation(url)
                    ?: return GeckoResult.fromException(IllegalStateException("A current website notification click is required"))
                val host = activityProvider?.invoke()
                if (host == null || host.isFinishing || host.isDestroyed || isolation.clearing ||
                    entries.values.any { it.privateSession && permissionOrigin(it.url) == origin })
                    return GeckoResult.fromException(IllegalStateException("The notification window is not available"))
                val opener = entries.entries.firstOrNull { (id, entry) ->
                    !entry.privateSession && entry.session.isOpen && activeIds?.contains(id) == true &&
                        id !in suspended && permissionOrigin(entry.url) == origin
                } ?: return GeckoResult.fromException(IllegalStateException("The notification website is no longer open"))
                val session = opener.value.session
                val generation = opener.value.documentGeneration
                return requestWindow(opener.key, session, url, fromExtension = false, notificationWindow = true,
                    isAuthorized = {
                        val current = entries[opener.key]
                        current != null && current.session === session && !current.privateSession && current.documentGeneration == generation &&
                            permissionOrigin(current.url) == origin &&
                            entries.values.none { it.privateSession && permissionOrigin(it.url) == origin }
                    }) ?: GeckoResult.fromException(IllegalStateException("The notification window could not be opened"))
            }
        }
    }
    private fun requestWindow(id: String, session: GeckoSession, uri: String, fromExtension: Boolean, notificationWindow: Boolean = false, isAuthorized: () -> Boolean = { true }): GeckoResult<GeckoSession>? {
        if (entries[id]?.session !== session || !session.isOpen || isolation.clearing || emit == null || !isAuthorized()) return null
        val result = GeckoResult<GeckoSession>()
        val requestId = nextWindowId.getAndIncrement()
        val request = PopupRequest<GeckoSession>({ result.complete(it) }, { child ->
            entries.entries.firstOrNull { it.value.session === child }?.key?.let { disposeEntry(it) }
            // Cancellation can race GeckoResult's queued open mapper.
            // Its main-loop dispatch precedes this cleanup dispatch.
            main.post { if (child.isOpen) child.close() }
        }, { it.isOpen })
        val timeout = Runnable { cancelNewSession(requestId, "Popup request timed out") }
        pendingWindows[requestId] = PendingWindow(id, session, uri, request, timeout, notificationWindow, isAuthorized)
        main.postDelayed(timeout, 10_000)
        emit?.invoke("BrowserNewWindow", Arguments.createMap().apply {
            putInt("requestId", requestId); putString("openerTabId", id); putString("uri", uri)
            putBoolean("extension", fromExtension)
        })
        return result
    }
    private fun cancelWindowsFrom(session: GeckoSession) {
        pendingWindows.filterValues { it.opener === session }.keys.toList()
            .forEach { cancelNewSession(it, "Popup opener closed") }
    }
    fun cancelNewSession(requestId: Int, reason: String = "Popup creation cancelled") {
        val pending = pendingWindows.remove(requestId) ?: return
        main.removeCallbacks(pending.timeout)
        pending.request.cancel(reason)
        emit?.invoke("BrowserNewWindowFailed", Arguments.createMap().apply {
            putInt("requestId", requestId); putString("error", reason)
        })
    }
    /** New popups and service-worker windows require an UNOPENED session.
     * Gecko opens it and attaches native window information before navigating.
     * GeckoRuntime 155 also accepts existing open sessions, but a just-opened
     * session can lack its native browsing context and must not use that path.
     * The browsing mode arrives with the adoption call because publish (and
     * therefore reconcile) only happens after the popup resolves. */
    fun resolveNewSession(app: Context, requestId: Int, tabId: String, isPrivate: Boolean, reply: (String?) -> Unit) {
        if (isolation.clearing || !isolation.allowAttach(tabId)) { reply("Browser data is being cleared"); return }
        val pending = pendingWindows[requestId]
        if (pending == null) { reply("Popup request expired"); return }
        if (!pending.isAuthorized()) {
            cancelNewSession(requestId, "Window authorization changed")
            reply("Window authorization changed"); return
        }
        if (pending.notificationWindow && isPrivate) {
            cancelNewSession(requestId, "Notification windows require a normal tab")
            reply("Notification windows require a normal tab"); return
        }
        if (entries[pending.openerId]?.session !== pending.opener || !pending.opener.isOpen) {
            cancelNewSession(requestId, "Popup opener closed")
            reply("Popup opener closed"); return
        }
        if (entries.containsKey(tabId) || pending.request.child != null) {
            reply("Popup session is already allocated"); return
        }
        try {
            val entry = createEntry(app.applicationContext, tabId, pending.uri, openInitially = false, isPrivate = isPrivate)
            if (pending.notificationWindow) {
                entry.initialNavigation = InitialNavigationAdmission(pending.uri, true) { entries[tabId] === entry }
            }
            // Prepare accessibility without opening: GeckoRuntime must observe
            // isOpen=false so GeckoViewServiceWorker waits for native setup.
            entry.session.accessibility
            pending.request.adopt(entry.session, reply)
            // GeckoResult dispatches its mapper asynchronously. A bounded
            // pending timeout remains armed until Gecko confirms isOpen.
            fun acknowledgeWhenOpen() {
                if (pendingWindows[requestId] !== pending) return
                if (!pending.isAuthorized()) {
                    cancelNewSession(requestId, "Window authorization changed"); return
                }
                if (entries[tabId] !== entry) {
                    cancelNewSession(requestId, "Popup session was closed"); return
                }
                if (entry.session.isOpen) {
                    pendingWindows.remove(requestId)
                    main.removeCallbacks(pending.timeout)
                    pending.request.opened()
                } else main.postDelayed({ acknowledgeWhenOpen() }, 16)
            }
            main.post { acknowledgeWhenOpen() }
        } catch (error: Exception) {
            val adopted = pending.request.child != null
            cancelNewSession(requestId, "Popup adoption failed: ${error.message}")
            if (!adopted) {
                disposeEntry(tabId)
                reply("Popup adoption failed: ${error.message}")
            }
        }
    }
    fun ensure(context: Context, id: String, initialUrl: String): Entry {
        check(isolation.allowAttach(id)) { "This tab needs an explicit retry" }
        entries[id]?.let { return it }
        return createEntry(context.applicationContext, id, initialUrl, isPrivate = id in privateIds)
    }
    /** Builds the GeckoSession + delegates for a tab; also the recovery
     *  path when a crashed/killed content process leaves a session dead. */
    private fun createEntry(app: Context, id: String, initialUrl: String, openInitially: Boolean = true, isPrivate: Boolean = false): Entry {
        check(isolation.allowAttach(id)) { "This tab is paused" }
        val rt = getRuntime(app)
        // Request desktop content while respecting responsive meta viewports
        // and the current pane's density-adjusted size. Pages without viewport
        // metadata retain Gecko's legacy wide-page fallback. Private
        // mode keeps cookies/storage out of the shared profile for the whole
        // session lifetime; the flag can never change afterwards.
        val session = GeckoSession(GeckoSessionSettings.Builder()
            .userAgentMode(GeckoSessionSettings.USER_AGENT_MODE_DESKTOP)
            .viewportMode(GeckoSessionSettings.VIEWPORT_MODE_MOBILE)
            .usePrivateMode(isPrivate).build())
        val e = Entry(session, initialUrl, sessionVersion = nextSessionVersion++)
        var requestedWebUrl = initialUrl
        e.privateSession = isPrivate
        entries[id] = e
        writeGate.register(id, e)
        // Saved tabs reopen with the same ID; callbacks from the retired
        // session must never change the replacement session's UI state.
        fun current() = entries[id] === e
        e.initialNavigation = InitialNavigationAdmission(initialUrl, openInitially, ::current)
        var bootstrapEvents = 0
        fun traceBootstrap(event: String, reported: String? = null) {
            if (e.privateSession || !app.packageName.startsWith("com.workspacebrowser.acceptance") || bootstrapEvents++ >= 40) return
            val kind = when (reported) { null -> "none"; "about:blank" -> "blank"; else -> "nonblank" }
            android.util.Log.i("YeoyuBootstrap", "event=$event tab=$id session=${e.sessionVersion}" +
                " document=${e.documentGeneration} reported=$kind knownBlank=${e.url == "about:blank"}" +
                " current=${current()} owner=${e.owner != null} openInitially=$openInitially")
        }
        traceBootstrap("created", initialUrl)
        BrowserExtensionHost.bind(session, id)
        BrowserVideoRegions.bind(session, ::current, { e.documentGeneration })
        e.contentFullscreen = ContentFullscreenSession(session, ::current, {
            ExternalPictureInPicture.holdsSession(session) ||
                e.owner?.let { it.isAttachedToWindow && it.isShown && it.width > 0 && it.height > 0 } == true
        }, { session.exitFullScreen() }, { enabled ->
            e.fullscreen = enabled
            refreshContentFullscreen()
            if (current()) {
                changed(id)
                ExternalPictureInPicture.registryChanged(id)
            }
            // Retirement removes the registry entry before releasing its view;
            // deliver the final false independently of that outgoing React view.
            else emit?.invoke("BrowserNavigation", payload(id, e))
        })
        applySiteSettings(e, initialUrl)
        // A crashed/killed content process makes the old session unusable:
        // recreate it in place and re-attach the surface, reloading the
        // tab's last URL instead of leaving a dead pane.
        fun recover(reason: String) {
            if (entries[id] !== e) return
            val owner = e.owner
            val url = e.url.ifBlank { "about:blank" }
            val allowed = recoveryBudget.allowAutomaticRecovery(id, android.os.SystemClock.elapsedRealtime())
            retireEntry(id, "session-terminated")
            if (isolation.clearing || !allowed) {
                isolation.pause(id)
                suspended[id] = SuspendedTab(url, reason)
                if (owner != null && owner.isAttachedToWindow) waitingSurfaces[id] = owner
                sessionBlocked(id, reason)
                return
            }
            try {
                createEntry(app, id, url, isPrivate = e.privateSession)
                owner?.let { attach(it, id, url) }
                emit?.invoke("BrowserSessionRecovered",Arguments.createMap().apply {putString("tabId",id)})
            } catch (_: Exception) {
                retireEntry(id, "recovery-failed")
                isolation.pause(id)
                suspended[id] = SuspendedTab(url, "recovery-failed")
                if (owner != null && owner.isAttachedToWindow) waitingSurfaces[id] = owner
                sessionBlocked(id, "recovery-failed")
            }
        }
        session.navigationDelegate = object : GeckoSession.NavigationDelegate {
            override fun onLoadRequest(s: GeckoSession, request: GeckoSession.NavigationDelegate.LoadRequest): GeckoResult<AllowOrDeny>? {
                if (!current() || isolation.clearing) return GeckoResult.deny()
                if (request.target != GeckoSession.NavigationDelegate.TARGET_WINDOW_NEW && request.uri == "about:blank")
                    e.initialNavigation.navigationRequested(request.uri)
                if (request.target != GeckoSession.NavigationDelegate.TARGET_WINDOW_NEW && canonicalBrowserOrigin(request.uri) != null) {
                    requestedWebUrl = request.uri
                    applySiteSettings(e, request.uri)
                }
                val generation = e.documentGeneration
                return ExternalNavigationCoordinator.onLoadRequest(app, id, s, request, { current() && e.documentGeneration == generation })
            }
            override fun onSubframeLoadRequest(s: GeckoSession, request: GeckoSession.NavigationDelegate.LoadRequest): GeckoResult<AllowOrDeny>? {
                if (!current() || isolation.clearing) return GeckoResult.deny()
                val generation = e.documentGeneration
                return ExternalNavigationCoordinator.onLoadRequest(app, id, s, request, { current() && e.documentGeneration == generation }, isSubframe = true)
            }
            override fun onLocationChange(s: GeckoSession, url: String?, perms: MutableList<GeckoSession.PermissionDelegate.ContentPermission>, hasUserGesture: Boolean) {
                if (!current()) return
                traceBootstrap("location", url)
                val wasReady = e.initialNavigationLocationAccepted
                if (!e.initialNavigation.acceptLocation(url, hasUserGesture)) { traceBootstrap("suppressed-location", url); return }
                val extensionPage = BrowserExtensionHost.isExtensionPage(url)
                e.url = if (extensionPage) requestedWebUrl else navigationTargetUrl(url, e.url)
                if (!extensionPage && canonicalBrowserOrigin(e.url) != null) requestedWebUrl = e.url
                e.activityVersion++
                if (extensionPage || e.security?.optString("origin") != canonicalBrowserOrigin(e.url)) e.security = null
                if (!wasReady && e.initialNavigationLocationAccepted) SpaceTransitionCover.initialNavigationReady(id, e)
                changed(id)
            }
            override fun onCanGoBack(s: GeckoSession, value: Boolean) { if (!current() || !e.initialNavigation.acceptHistoryChange()) return; e.back=value; changed(id) }
            override fun onCanGoForward(s: GeckoSession, value: Boolean) { if (!current() || !e.initialNavigation.acceptHistoryChange()) return; e.forward=value; changed(id) }
            override fun onLoadError(s: GeckoSession, url: String?, error: WebRequestError): GeckoResult<String>? {
                if (!current()) return null
                // Surface every load failure to JS; the banner keys on the
                // failing tab instead of blaming whatever tab is focused.
                emit?.invoke("BrowserLoadError",Arguments.createMap().apply {
                    putString("tabId",id);putInt("code",error.code)
                    putBoolean("security",error.category == WebRequestError.ERROR_CATEGORY_SECURITY)
                })
                return null
            }
            override fun onNewSession(s: GeckoSession, uri: String): GeckoResult<GeckoSession>? {
                if (!current() || isolation.clearing) return GeckoResult.fromValue(null)
                return requestWindow(id, session, uri, fromExtension = false)
            }
        }
        session.historyDelegate = object : GeckoSession.HistoryDelegate {
            // GV155 skips NavigationDelegate.onCanGoBack/Forward on history
            // traversals (observed: forward after back never reports
            // canGoBack=true), so derive both flags from the history list,
            // which fires on pushes and traversals alike.
            override fun onHistoryStateChange(s: GeckoSession, list: GeckoSession.HistoryDelegate.HistoryList) {
                if (!current()) return
                e.back = list.currentIndex > 0
                e.forward = list.currentIndex < list.size - 1
                changed(id)
            }
        }
        session.contentDelegate = object : GeckoSession.ContentDelegate {
            override fun onFocusRequest(s: GeckoSession) {
                if (!current() || isolation.clearing || activeIds?.contains(id) != true || id in suspended) return
                emit?.invoke("BrowserFocusWindow", Arguments.createMap().apply { putString("tabId", id) })
            }
            override fun onFirstComposite(s: GeckoSession) { if (current()) traceBootstrap("first-composite") }
            override fun onFirstContentfulPaint(s: GeckoSession) {
                if (!current()) return
                traceBootstrap("first-contentful-paint")
                if (e.initialNavigationLocationAccepted) e.lastContentfulPaintDocument = e.documentGeneration
            }
            override fun onPaintStatusReset(s: GeckoSession) {
                if (current()) e.lastContentfulPaintDocument = -1
            }
            override fun onFullScreen(s: GeckoSession, fullScreen: Boolean) {
                fullscreenOperation { e.contentFullscreen.onFullScreen(s, fullScreen) }
            }
            override fun onCloseRequest(s: GeckoSession) {
                if (!current()) return
                fullscreenOperation { e.contentFullscreen.leave() }
                cancelWindowsFrom(s)
                cancelPermissions(s, "page-closed")
                emit?.invoke("BrowserCloseWindow", Arguments.createMap().apply { putString("tabId", id) })
            }
            override fun onCrash(s: GeckoSession) = recover("crash")
            override fun onKill(s: GeckoSession) = recover("process-killed")
            override fun onContextMenu(s: GeckoSession, screenX: Int, screenY: Int, element: GeckoSession.ContentDelegate.ContextElement) {
                val generation = e.documentGeneration
                if (current()) ExternalNavigationCoordinator.onContextMenu(id, s, screenX, screenY, element, { current() && e.documentGeneration == generation })
            }
            override fun onTitleChange(s: GeckoSession, title: String?) { if (!current()) return; traceBootstrap("title"); e.title=title.orEmpty();changed(id) }
            override fun onExternalResponse(s: GeckoSession, response: WebResponse) {
                if (!current()) {
                    try { response.body?.close() } catch (_: Exception) {}
                    return
                }
                val generation = e.documentGeneration
                val save = { DownloadCoordinator.save(app, response) { event, payload -> emit?.invoke(event, payload) } }
                if (e.privateSession) PrivateDownloadConfirmation.request(s, response,
                    { current() && e.documentGeneration == generation }, save)
                else save()
            }
        }
        session.permissionDelegate = object : GeckoSession.PermissionDelegate {
            // Per-origin decisions: a stored rule decides outright; anything
            // else goes to the JS dialog (BrowserPermissionRequest) and
            // completes later via resolvePermission. A stored allow whose
            // Android runtime permission was revoked falls back to asking.
            override fun onContentPermissionRequest(s: GeckoSession, perm: GeckoSession.PermissionDelegate.ContentPermission): GeckoResult<Int>? {
                if (!current()) return GeckoResult.fromValue(GeckoSession.PermissionDelegate.ContentPermission.VALUE_PROMPT)
                val kind = contentPermissionKind(perm.permission)
                val origin = permissionOrigin(perm.uri)
                if (kind == null || origin == null) {
                    emit?.invoke("BrowserPermission",Arguments.createMap().apply {putString("tabId",id);putString("type",permLabel(perm.permission))})
                    return GeckoResult.fromValue(GeckoSession.PermissionDelegate.ContentPermission.VALUE_DENY)
                }
                val decision = if (e.privateSession) null else decide(origin, kind)
                defaultContentPermissionDecision(perm.permission, decision)?.let { return GeckoResult.fromValue(it) }
                if (decision == false) return GeckoResult.fromValue(GeckoSession.PermissionDelegate.ContentPermission.VALUE_DENY)
                if (decision == true && osHeld(app, kind))
                    return GeckoResult.fromValue(GeckoSession.PermissionDelegate.ContentPermission.VALUE_ALLOW)
                if (!e.permissionPrompts.shouldPrompt(origin, kind))
                    return GeckoResult.fromValue(GeckoSession.PermissionDelegate.ContentPermission.VALUE_PROMPT)
                val eventSink = emit ?: return GeckoResult.fromValue(
                    GeckoSession.PermissionDelegate.ContentPermission.VALUE_PROMPT
                )
                val result = GeckoResult<Int>()
                val requestId = nextPermissionId.getAndIncrement()
                val timeout = Runnable { cancelPermission(requestId, "timeout") }
                pendingPermissions.add(
                    requestId,
                    s,
                    e.documentGeneration,
                    PendingPermission(origin, kind, session = s, timeout = timeout, content = result),
                )
                main.postDelayed(timeout, PERMISSION_REQUEST_TIMEOUT_MS)
                eventSink("BrowserPermissionRequest", permissionPayload(requestId, id, kind, origin, e.privateSession))
                return result
            }
            override fun onAndroidPermissionsRequest(s: GeckoSession, permissions: Array<out String>?, callback: GeckoSession.PermissionDelegate.Callback) {
                if (!current()) { callback.reject(); return }
                // Gecko asks for the device-level permission only after the
                // content level was allowed. Grant when everything requested
                // is already held; otherwise deny — the OS prompt flows
                // through the JS dialog path (requestAndroidPermission), not
                // a second native dialog here.
                val held = requestedAndroidPermissionsHeld(permissions.orEmpty()) {
                    androidx.core.content.ContextCompat.checkSelfPermission(app, it) == android.content.pm.PackageManager.PERMISSION_GRANTED
                }
                if (held) callback.grant() else callback.reject()
            }
            override fun onMediaPermissionRequest(s: GeckoSession, uri: String, video: Array<GeckoSession.PermissionDelegate.MediaSource>?, audio: Array<GeckoSession.PermissionDelegate.MediaSource>?, callback: GeckoSession.PermissionDelegate.MediaCallback) {
                if (!current()) { callback.reject(); return }
                val origin = permissionOrigin(uri)
                val wants = mutableListOf<String>()
                if (video != null) wants.add("camera")
                if (audio != null) wants.add("microphone")
                // GV155's grant() takes one MediaSource per channel; grant only
                // when every requested channel is allowed — never partially.
                if (origin != null && wants.isNotEmpty() && wants.all { !e.privateSession && decide(origin, it) == true && osHeld(app, it) }) {
                    callback.grant(video?.firstOrNull(), audio?.firstOrNull())
                    return
                }
                if (origin == null || wants.isEmpty() || wants.any { !e.privateSession && decide(origin, it) == false }) {
                    callback.reject()
                    return
                }
                val eventSink = emit ?: run { callback.reject(); return }
                val ask = wants.filter { e.privateSession || decide(origin, it) != false }.joinToString(",")
                if (!e.permissionPrompts.shouldPrompt(origin, ask)) { callback.reject(); return }
                val requestId = nextPermissionId.getAndIncrement()
                val timeout = Runnable { cancelPermission(requestId, "timeout") }
                pendingPermissions.add(
                    requestId,
                    s,
                    e.documentGeneration,
                    PendingPermission(origin, ask, session = s, timeout = timeout, media = callback, video = video?.firstOrNull(), audio = audio?.firstOrNull()),
                )
                main.postDelayed(timeout, PERMISSION_REQUEST_TIMEOUT_MS)
                eventSink("BrowserPermissionRequest", permissionPayload(requestId, id, ask, origin, e.privateSession))
            }
        }
        session.promptDelegate = BrowserPromptDelegate(session, { activityProvider?.invoke() }, ::current)
        session.progressDelegate = object : GeckoSession.ProgressDelegate {
            override fun onPageStart(s: GeckoSession, url: String) {
                if (!current()) return
                traceBootstrap("page-start", url)
                if (!e.initialNavigation.acceptPageStart(url)) { traceBootstrap("suppressed-page-start", url); return }
                fullscreenOperation { e.contentFullscreen.leave() }
                PrivateDownloadConfirmation.cancel(s)
                e.documentGeneration += 1
                e.permissionPrompts.clear()
                e.lastContentfulPaintDocument = -1
                SpaceTransitionCover.coldDocumentChanged(id, e)
                SpaceTransitionCover.returnDocumentChanged(id)
                BrowserVideoRegions.navigationStarted(s)
                e.activityVersion += 1
                writeGate.register(id, e)
                pendingStateWrites.remove(id)
                e.stateDocumentGeneration = -1
                e.security = null
                e.blockedCount = 0
                cancelPermissions(s, "navigation")
                (s.promptDelegate as? BrowserPromptDelegate)?.cancelPending()
                e.loading = true; e.progress = 8; changed(id); reportProgress(id, e)
                securityChanged(id, e)
            }
            override fun onProgressChange(s: GeckoSession, progress: Int) {
                if (!current()) return
                e.progress = progress; reportProgress(id, e)
            }
            override fun onPageStop(s: GeckoSession, success: Boolean) {
                if (!current()) return
                traceBootstrap(if (success) "page-stop-success" else "page-stop-failed")
                if (!e.initialNavigation.acceptPageStop(success)) { traceBootstrap("suppressed-page-stop"); return }
                e.loading = false; e.progress = 100; reportProgress(id, e)
                injectBoost(id, e)
                s.flushSessionState()
            }
            override fun onSessionStateChange(s: GeckoSession, state: GeckoSession.SessionState) {
                if (!current()) return
                try { rememberState(id, e, state) }
                catch (_: Exception) { storageError("A tab state could not be captured; the live page remains open") }
            }
            override fun onSecurityChange(s: GeckoSession, information: GeckoSession.ProgressDelegate.SecurityInformation) {
                if (!current()) return
                e.security = JSONObject().apply {
                    put("origin", information.origin ?: canonicalBrowserOrigin(e.url).orEmpty())
                    put("host", information.host)
                    put("secure", information.isSecure)
                    put("exception", information.isException)
                    put("mixedActive", information.mixedModeActive == GeckoSession.ProgressDelegate.SecurityInformation.CONTENT_LOADED)
                    put("mixedPassive", information.mixedModePassive == GeckoSession.ProgressDelegate.SecurityInformation.CONTENT_LOADED)
                    put("mixedActiveStatus", information.mixedModeActive)
                    put("mixedPassiveStatus", information.mixedModePassive)
                    put("issuer", information.certificate?.issuerX500Principal?.name ?: "")
                    put("expiresAt", information.certificate?.notAfter?.time ?: 0L)
                }
                securityChanged(id, e)
            }
        }
        session.contentBlockingDelegate = object : ContentBlocking.Delegate {
            override fun onContentBlocked(s: GeckoSession, event: ContentBlocking.BlockEvent) {
                if (!current()) return
                e.blockedCount = (e.blockedCount + 1).coerceAtMost(100_000)
                emit?.invoke("BrowserContentBlocking", Arguments.createMap().apply {
                    putString("tabId", id); putInt("blockedCount", e.blockedCount)
                    putBoolean("trackingProtection", e.session.settings.useTrackingProtection)
                })
            }
        }
        session.mediaDelegate = object : GeckoSession.MediaDelegate {
            override fun onRecordingStatusChanged(s: GeckoSession, devices: Array<out GeckoSession.MediaDelegate.RecordingDevice>) {
                if (!current()) return
                e.recording = devices.any { it.status == GeckoSession.MediaDelegate.RecordingDevice.Status.RECORDING }
                e.activityVersion++
                updateActive(e)
            }
        }
        session.mediaSessionDelegate = object : MediaSession.Delegate {
            override fun onActivated(s: GeckoSession, media: MediaSession) {
                if (!current()) return
                e.media=media
                pictureInPictureChanged(id)
            }
            override fun onMetadata(s: GeckoSession, media: MediaSession, metadata: MediaSession.Metadata) {
                if (!current()) return
                e.mediaTitle = metadata.title
                pictureInPictureChanged(id)
            }
            override fun onFullscreen(s: GeckoSession, media: MediaSession, fullscreen: Boolean, metadata: MediaSession.ElementMetadata?) {
                if (!current()) return
                e.fullscreenVideoSize = metadata?.takeIf {
                    fullscreen && it.videoTrackCount > 0 && it.width in 1..Int.MAX_VALUE.toLong() && it.height in 1..Int.MAX_VALUE.toLong()
                }?.let { it.width.toInt() to it.height.toInt() }
                pictureInPictureChanged(id)
            }
            override fun onPlay(s: GeckoSession, media: MediaSession) { if (!current()) return; e.media=media; mediaChanged(id,true) }
            override fun onPause(s: GeckoSession, media: MediaSession) { if (current()) mediaChanged(id,false) }
            override fun onStop(s: GeckoSession, media: MediaSession) { if (current()) mediaChanged(id,false) }
            override fun onDeactivated(s: GeckoSession, media: MediaSession) { if (current()) { e.media=null; mediaChanged(id,false) } }
        }
        if (openInitially) {
            try {
                // A cold document may load before a GeckoView binds; open its window with the accessibility provider ready.
                session.accessibility
                traceBootstrap("open-before")
                session.open(rt)
                traceBootstrap("open-after")
                val saved = savedStates[id]?.takeIf { it.url == initialUrl }
                val restored = saved?.let { snapshot -> runCatching {
                    GeckoSession.SessionState.fromString(snapshot.state)?.takeIf { it.size > 0 && it.currentIndex in 0 until it.size }
                }.getOrNull() }
                if (restored != null) {
                    traceBootstrap("restore", initialUrl)
                    session.restoreState(restored)
                } else {
                    if (saved != null) {
                        savedStates.remove(id)
                        io.execute { try { store?.remove(id) } catch (_: Exception) { main.post { storageError("An invalid tab state could not be removed") } } }
                        storageError("A saved tab was invalid; its URL was opened instead")
                    }
                    traceBootstrap("load", initialUrl)
                    session.loadUri(initialUrl)
                }
                suspended.remove(id)
                updateActive(e)
            } catch (error: Exception) {
                retireEntry(id, "open-failed")
                throw error
            }
        }
        return e
    }
    fun attach(view: BrowserSurfaceView, id: String, url: String) {
        if (!pendingAdmissions.request(view, id, url, activeIds, isolation.clearing) { view.release() }) {
            if (isolation.clearing) {
                isolation.pause(id)
                if (persistedPausedIds.add(id)) persistPausedIds()
            }
            return
        }
        if (!isolation.allowAttach(id)) {
            view.release()
            suspended.putIfAbsent(id, SuspendedTab(url, "data-cleared"))
            if (suspended[id]?.reason == "data-cleared" && persistedPausedIds.add(id)) persistPausedIds()
            waitingSurfaces[id] = view
            sessionBlocked(id, suspended[id]?.reason ?: "data-cleared")
            return
        }
        val e = try { ensure(view.context,id,url) } catch (_: Exception) {
            isolation.pause(id)
            suspended[id] = SuspendedTab(url, "open-failed")
            waitingSurfaces[id] = view
            sessionBlocked(id, "open-failed")
            return
        }
        if (ExternalPictureInPicture.interceptAttach(view, id, e)) { view.release(); return }
        if (e.owner === view) return
        val returned = ExternalPictureInPicture.returnedView(id, e)
        e.owner?.release()
        if (returned !== view.gecko) view.release()
        if (returned != null) {
            e.owner = view
            (returned as? StableGeckoView)?.traceReturnedSurface("adopt-before", "destination=${System.identityHashCode(view)} owner=${System.identityHashCode(e.owner)} currentDocument=${e.documentGeneration}")
            view.adoptTransferredGeckoView(returned)
            (returned as? StableGeckoView)?.markReturnedSurfaceAdopted()
            ExternalPictureInPicture.completeReturnedView(returned)
        }
        else view.gecko.setSession(e.session)
        e.owner=view
        SpaceTransitionCover.attached(id, e, view)
        e.activityVersion++
        updateActive(e)
        view.post { if(e.owner === view) view.navigation(payload(id,e)) }
        securityChanged(id, e)
        refreshContentFullscreen()
    }
    fun detach(view: BrowserSurfaceView) {
        pendingAdmissions.detach(view)
        waitingSurfaces.entries.removeAll { it.value === view }
        entries.values.firstOrNull { it.owner === view }?.let {
            it.owner=null
            fullscreenOperation { it.contentFullscreen.leave() }
            it.activityVersion++
            updateActive(it)
        }
        view.gecko.releaseSession()
    }
    private fun retireEntry(id: String, reason: String): Boolean {
        val e = entries.remove(id) ?: return true
        if (e.privateSession) BrowserWebNotifications.dismissPrivate()
        SpaceTransitionCover.coldEntryRetired(id, e)
        SpaceTransitionCover.returnDocumentChanged(id)
        ExternalPictureInPicture.registryChanged(id)
        fullscreenOperation { e.contentFullscreen.retire() }
        BrowserExtensionHost.unbind(e.session)
        BrowserVideoRegions.retire(e.session)
        PrivateDownloadConfirmation.cancel(e.session)
        writeGate.remove(id)
        pendingStateWrites.remove(id)
        try { cancelWindowsFrom(e.session) } catch (_: Exception) {}
        try { cancelPermissions(e.session, reason) } catch (_: Exception) {}
        try { (e.session.promptDelegate as? BrowserPromptDelegate)?.cancelPending() } catch (_: Exception) {}
        val owner = e.owner
        e.owner = null
        try { owner?.release() } catch (_: Exception) {}
        e.security = null
        securityChanged(id, e)
        try {
            if (e.session.isOpen) e.session.close()
            if (e.session.isOpen) throw IOException("Session is still open")
            FilePromptCoordinator.releaseSession(e.session)
            return true
        } catch (_: Exception) {
            unclosedSessions.add(e.session)
            storageError("A browser session could not be fully closed")
            return false
        } finally {
            pictureInPictureChanged(id)
        }
    }
    private fun disposeEntry(id: String) {
        pendingAdmissions.removeTab(id)
        retireEntry(id, "tab-closed")
        // Closing the tab from the main browser must not leave an orphaned
        // window rendering a disposed session.
        BrowserWindowCoordinator.closeForTab(id)
        writeGate.remove(id)
        pendingStateWrites.remove(id)
        savedStates.remove(id)
        suspended.remove(id)
        waitingSurfaces.remove(id)
        io.execute { try { store?.remove(id) } catch (_: Exception) { main.post { storageError("A closed tab state could not be removed") } } }
    }
    fun reconcile(ids: Set<String>, newPrivateIds: Set<String> = privateIds) {
        if (activeIds == ids && privateIds == newPrivateIds) return
        activeIds = ids.toSet()
        privateIds.clear(); privateIds.addAll(newPrivateIds)
        (entries.keys + savedStates.keys + suspended.keys + waitingSurfaces.keys).filter { it !in ids }.forEach { disposeEntry(it) }
        recoveryBudget.reconcile(ids)
        // Fabric may already have mounted a tab from a newer JS snapshot.
        // Keep its deletion barrier until that tab's native admission arrives.
        val pauseOwners = ids + pendingAdmissions.ids()
        isolation.reconcile(pauseOwners)
        if (persistedPausedIds.retainAll(pauseOwners)) persistPausedIds()
        io.execute { try { store?.reconcile(ids) } catch (_: Exception) { main.post { storageError("Saved tab cleanup could not be completed") } } }
        pendingAdmissions.takeAdmitted(ids) { view, id -> view.isAttachedToWindow && view.tabId == id }.forEach { request ->
            if (request.requiresResume) {
                isolation.pause(request.id)
                if (persistedPausedIds.add(request.id)) persistPausedIds()
            }
            attach(request.view, request.id, request.url)
        }
    }
    fun pause(id:String) { entries[id]?.media?.pause() }
    fun allMedia() { entries.forEach { (id,e)->mediaChanged(id,e.playing) } }
    /** Native history step for OS windows; true when the page went back. */
    fun windowGoBack(id: String): Boolean {
        val e = entries[id] ?: return false
        if (!e.back || !e.session.isOpen) return false
        return try { e.session.goBack(); true } catch (_: Exception) { false }
    }
    /** The entry a system media notification may surface. Private tabs never leave the app. */
    fun backgroundMedia(): Pair<String, Entry>? = entries.entries.firstOrNull { (id, e) ->
        id !in suspended && e.playing && e.media?.isActive == true && !e.privateSession
    }?.toPair()
    fun mediaSetPlayback(id: String, play: Boolean) {
        val e = entries[id] ?: return
        if (play) e.media?.play() else e.media?.pause()
    }
    private fun releaseObservation(id: String, entry: Entry, restorableConsent: Boolean = false) = SessionReleaseObservation(
        sessionVersion = entry.sessionVersion,
        documentVersion = entry.documentGeneration,
        activityVersion = entry.activityVersion,
        attached = entry.owner != null || ExternalPictureInPicture.holdsSession(entry.session),
        playing = entry.playing || entry.media != null,
        recording = entry.recording,
        loading = entry.loading,
        hasPrompt = PrivateDownloadConfirmation.hasPending(entry.session) || (entry.session.promptDelegate as? BrowserPromptDelegate)?.hasPending() != false,
        hasPermission = pendingPermissions.hasForOwner(entry.session),
        hasFiles = FilePromptCoordinator.hasSessionFilesOrPending(entry.session),
        hasPopup = pendingWindows.values.any { it.opener === entry.session || it.request.child === entry.session },
        keepAlive = toolsConfig.siteFor(entry.url)?.keepAlive == true,
        privateSession = entry.privateSession,
        // URL alone cannot prove a blank page has no injected or opener-owned state.
        emptyDocument = false,
        restorableConsent = restorableConsent,
        hasState = savedStates[id]?.url == entry.url && entry.stateDocumentGeneration == entry.documentGeneration,
    )

    private fun updateActive(entry: Entry) {
        if (entry.session.isOpen) {
            // Inactivity keeps DOM/JS state in place; do not set suspendMediaWhenInactive.
            try { entry.session.setActive(entry.owner != null || ExternalPictureInPicture.holdsSession(entry.session) || entry.playing || entry.recording) }
            catch (_: Exception) { storageError("A background tab could not be made inactive") }
        }
    }

    private fun securityChanged(id: String, entry: Entry) {
        val security = entry.security
        emit?.invoke("BrowserSecurity", Arguments.createMap().apply {
            putString("tabId", id)
            putString("origin", security?.optString("origin") ?: canonicalBrowserOrigin(entry.url).orEmpty())
            putString("host", security?.optString("host") ?: Uri.parse(entry.url).host.orEmpty())
            putBoolean("known", security != null)
            putBoolean("secure", security?.optBoolean("secure") == true)
            putBoolean("exception", security?.optBoolean("exception") == true)
            putBoolean("mixedActive", security?.optBoolean("mixedActive") == true)
            putBoolean("mixedPassive", security?.optBoolean("mixedPassive") == true)
            putString("issuer", security?.optString("issuer").orEmpty())
            putDouble("expiresAt", security?.optLong("expiresAt")?.toDouble() ?: 0.0)
        })
    }
    /** Freeze the page's last frame as the surface background for ~800ms.
     *  GV155's TextureView drops its composited frame for 1-2 frames when
     *  view focus moves to a chrome input; the snapshot masks that blink. */
    fun captureForTransition(id: String) {
        val entry = entries[id] ?: return
        val owner = entry.owner ?: return
        owner.gecko.capturePixels().accept { result ->
            val bitmap = result ?: return@accept
            if (entries[id] !== entry || entry.owner !== owner) return@accept
            owner.post {
                if (entries[id] !== entry || entry.owner !== owner) return@post
                val drawable =
                    android.graphics.drawable.BitmapDrawable(owner.resources, bitmap)
                owner.background = drawable
                owner.postDelayed(
                    { if (owner.background === drawable) owner.background = null },
                    800
                )
            }
        }
    }
    /** Replace the boost map (bare host → css) and restyle live sessions. */
    fun setBoosts(map:Map<String,String>) {
        boosts=map
        entries.keys.toList().forEach { id -> entries[id]?.let { injectBoost(id,it) } }
    }
    private fun boostHost(url:String):String =
        Uri.parse(url).host?.lowercase()?.removePrefix("www.").orEmpty()
    private fun injectBoost(id:String,e:Entry) {
        // Always run the removal so disabling a boost clears the live page;
        // re-append only when CSS exists. JSONObject.quote yields a safe JS
        // string literal.
        val append=boosts[boostHost(e.url)]?.let { css -> "s=d.createElement('style');s.id='yeoyu-boost';s.textContent=" + JSONObject.quote(css) + ";d.head.appendChild(s)" } ?: ""
        val code="(function(){try{var d=document;if(!d.head)return;var s=d.getElementById('yeoyu-boost');if(s&&s.parentNode)s.parentNode.removeChild(s);$append}catch(err){}})()"
        e.session.loadUri("javascript:" + Uri.encode(code))
    }
    fun find(id:String,text:String,backward:Boolean) {
        val e=entries[id] ?: return
        val flags=if(backward) GeckoSession.FINDER_FIND_BACKWARDS else GeckoSession.FINDER_FIND_FORWARD
        // GV155 has no FinderDelegate; results arrive via the returned GeckoResult.
        e.session.finder.find(text,flags).accept { r ->
            if(r!=null) emit?.invoke("BrowserFindResult",Arguments.createMap().apply {putString("tabId",id);putInt("current",r.current);putInt("total",r.total)})
        }
    }
    fun findClear(id:String) { entries[id]?.session?.finder?.clear() }
    fun zoom(id:String,direction:String) {
        if (entries[id] == null || !initialized) return
        if (direction !in setOf("in", "out", "reset")) return
        val app = activityProvider?.invoke()?.applicationContext ?: return
        val updated = try { configurationGate.whenIdle {
            val scale = when (direction) {
                "in" -> (toolsConfig.textScale + 0.1).coerceAtMost(2.0)
                "out" -> (toolsConfig.textScale - 0.1).coerceAtLeast(0.5)
                else -> 1.0
            }
            toolsConfig.copy(textScale = scale)
        } } catch (error: IllegalStateException) {
            storageError(error.message ?: "Browser settings are still saving")
            return
        }
        configureTools(app, updated.toJson()) { result ->
            result.onSuccess { emit?.invoke("BrowserTextScale", Arguments.createMap().apply { putDouble("textScale", updated.textScale) }) }
        }
    }
    /** true = stored allow, false = stored block, null = ask the user. */
    private fun decide(origin: String, kind: String): Boolean? = permissionRules["$origin|$kind"]

    /** A stored allow with the Android runtime permission revoked behaves as if undecided. */
    private fun osHeld(app: Context, kind: String): Boolean {
        fun held(p: String) = androidx.core.content.ContextCompat.checkSelfPermission(app, p) == android.content.pm.PackageManager.PERMISSION_GRANTED
        return when (kind) {
            "camera" -> held(android.Manifest.permission.CAMERA)
            "microphone" -> held(android.Manifest.permission.RECORD_AUDIO)
            "geolocation" -> held(android.Manifest.permission.ACCESS_FINE_LOCATION) || held(android.Manifest.permission.ACCESS_COARSE_LOCATION)
            "notifications" -> Build.VERSION.SDK_INT < 33 || held(android.Manifest.permission.POST_NOTIFICATIONS)
            else -> true
        }
    }
    private fun permissionPayload(requestId: Int, tabId: String, kind: String, origin: String, ephemeral: Boolean) =
        Arguments.createMap().apply { putInt("requestId", requestId); putString("tabId", tabId); putString("kind", kind); putString("origin", origin); putBoolean("ephemeral", ephemeral) }
    private fun contentPermissionKind(permission:Int)=when(permission) {
        GeckoSession.PermissionDelegate.PERMISSION_GEOLOCATION->"geolocation"
        GeckoSession.PermissionDelegate.PERMISSION_DESKTOP_NOTIFICATION->"notifications"
        GeckoSession.PermissionDelegate.PERMISSION_PERSISTENT_STORAGE->"persistent-storage"
        GeckoSession.PermissionDelegate.PERMISSION_AUTOPLAY_INAUDIBLE,GeckoSession.PermissionDelegate.PERMISSION_AUTOPLAY_AUDIBLE->"autoplay"
        else->null
    }
    private fun permLabel(permission:Int)=when(permission) {
        GeckoSession.PermissionDelegate.PERMISSION_GEOLOCATION->"geolocation"
        GeckoSession.PermissionDelegate.PERMISSION_DESKTOP_NOTIFICATION->"notifications"
        GeckoSession.PermissionDelegate.PERMISSION_PERSISTENT_STORAGE->"persistent-storage"
        GeckoSession.PermissionDelegate.PERMISSION_XR->"xr"
        GeckoSession.PermissionDelegate.PERMISSION_AUTOPLAY_INAUDIBLE,GeckoSession.PermissionDelegate.PERMISSION_AUTOPLAY_AUDIBLE->"autoplay"
        GeckoSession.PermissionDelegate.PERMISSION_MEDIA_KEY_SYSTEM_ACCESS->"media-key-system-access"
        GeckoSession.PermissionDelegate.PERMISSION_TRACKING->"tracking"
        GeckoSession.PermissionDelegate.PERMISSION_STORAGE_ACCESS->"storage-access"
        GeckoSession.PermissionDelegate.PERMISSION_LOCAL_DEVICE_ACCESS->"local-device"
        GeckoSession.PermissionDelegate.PERMISSION_LOCAL_NETWORK_ACCESS->"local-network"
        else->"other"
    }
    private fun mediaChanged(id:String,playing:Boolean) {
        val e=entries[id] ?: return
        e.playing=playing
        e.owner?.mediaPlaybackChanged(e.session, playing)
        e.activityVersion++
        updateActive(e)
        emit?.invoke("BrowserMedia",Arguments.createMap().apply {putString("tabId",id);putBoolean("playing",playing)})
        pictureInPictureChanged(id)
        BrowserMediaCoordinator.onMediaChanged()
    }
    private fun reportProgress(id:String,e:Entry) {
        emit?.invoke("BrowserProgress",Arguments.createMap().apply {putString("tabId",id);putBoolean("loading",e.loading);putInt("progress",e.progress)})
    }
    private fun changed(id:String) {
        val e=entries[id] ?: return
        e.owner?.navigation(payload(id,e))
        // Detached sessions still navigate; React must keep the Rust snapshot current.
        if(e.owner == null) emit?.invoke("BrowserNavigation",payload(id,e))
    }
    private fun payload(id:String,e:Entry)=Arguments.createMap().apply {
        // Fabric surface events and DeviceEventEmitter may reach JS in a
        // different order. This clock spans both paths and session replacement.
        putDouble("navigationSequence", (++navigationSequence).toDouble())
        putString("tabId",id);putString("url",e.url);putString("title",e.title)
        putBoolean("loading",e.loading);putBoolean("canGoBack",e.back);putBoolean("canGoForward",e.forward)
        putBoolean("fullscreen",e.fullscreen && !ExternalPictureInPicture.holdsSession(e.session))
    }
}
