package dev.browser

import android.app.Activity
import android.app.AppOpsManager
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Rect
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.provider.Settings
import android.util.Rational
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.inputmethod.InputMethodManager
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.window.layout.WindowMetricsCalculator
import com.facebook.react.bridge.Arguments
import com.facebook.react.views.view.isEdgeToEdgeFeatureFlagOn
import org.json.JSONObject
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.MediaSession
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong

/** Activity-owned PiP. React and the GeckoSession stay alive while only GeckoView moves. */
class BrowserPictureInPicture(private val activity: Activity, private val launchReturn: (Intent) -> Unit) {
    internal val hasDisplayTransfer: Boolean get() = transfer != null || activity.isInPictureInPictureMode
    internal fun externalOwnershipChanged() {
        if (ExternalPictureInPicture.hasDisplayTransfer) {
            // The process-owned audio request moves with the session. Clearing
            // this Activity's bookkeeping must not generate a competing LOSS.
            audioSession = null
            audioPlaybackIntent = PictureInPicturePlaybackIntent()
        }
        refreshParams()
        emitState()
    }
    private companion object {
        val sequences = AtomicLong()
        const val ENTRY_TIMEOUT_MS = 1_500L
        const val RETURN_NONCE = "dev.browser.pip.LAUNCHER_RETURN_NONCE"
    }

    private data class Transfer(
        val ticket: Long,
        val target: PictureInPictureTarget,
        val owner: BrowserSurfaceView,
        val gecko: GeckoView,
        val session: GeckoSession,
        val documentGeneration: Long,
        val parent: ViewGroup,
        val index: Int,
        val layout: ViewGroup.LayoutParams,
        val rootVisibility: Int,
        val source: Rect,
        var pixels: VideoPixelRect,
        val region: VideoRegion,
        var invalidVideo: Boolean = false,
        val viewportWidth: Int,
        val viewportHeight: Int,
    )

    private data class MediaDocument(val target: PictureInPictureTarget, val generation: Long)
    private fun Transfer.mediaDocument() = MediaDocument(target, documentGeneration)

    private data class AudioSession(
        val target: PictureInPictureTarget,
        val session: GeckoSession,
        val media: MediaSession,
        val documentGeneration: Long,
    )

    private val main = Handler(Looper.getMainLooper())
    private val policy = PictureInPicturePolicy()
    private val launcherReturn = PictureInPictureLauncherReturnPolicy()
    private val dismissal = PictureInPictureDismissalPolicy()
    private var launcherReturnTimeout: Runnable? = null
    private var reactRoot: View? = null
    private var container: VideoPipViewport? = null
    private var rejectedEntryShield: View? = null
    private var rejectedRootVisibility = View.VISIBLE
    private var transfer: Transfer? = null
    private var rootSizeBeforeEntry: PictureInPictureWindowSize? = null
    private var lastPipRootSize: PictureInPictureWindowSize? = null
    private var pendingWindowRestoration = false
    private var restoredWindowWidth: Double? = null
    private var pendingStopTarget: MediaDocument? = null
    private var resumed = false
    private var destroyed = false
    private var lastReason: String? = null
    private var sequence = sequences.incrementAndGet()
    private var lastEvent: String? = null
    private var lastParams: String? = null
    private var timeout: Runnable? = null
    private val actionNonce = UUID.randomUUID().toString()
    private val actionName = "${activity.packageName}.PIP.$actionNonce"
    private var registeredReceiver = false
    private val supportsPictureInPicture by lazy {
        activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
    }
    private var pictureInPictureAllowed = false
    private val pendingActions = mutableMapOf<String, PendingIntent>()
    private val hasAudioFocusRequest: Boolean get() = audioSession?.let {
        ExternalPictureInPicture.audioLease?.hasRequestFor(it.session)
    } == true
    private var audioSession: AudioSession? = null
    private var audioPlaybackIntent = PictureInPicturePlaybackIntent()
    private var traceSequence = 0L

    /** Acceptance-only decisions; no page contents or media URLs. Never called from pre-draw. */
    private fun trace(event: String, detail: String? = null) {
        if (activity.packageName != "com.workspacebrowser.acceptance") return
        val current = transfer
        val entry = (current?.target?.tabId ?: policy.tabId)?.let(GeckoSessionRegistry::entry)
        val gecko = current?.gecko ?: entry?.owner?.gecko
        android.util.Log.i("YeoyuHomePip", "n=${++traceSequence} uptime=${android.os.SystemClock.uptimeMillis()} event=$event" +
            " ticket=${current?.ticket} phase=${policy.phase} tab=${current?.target?.tabId ?: policy.tabId}" +
            " task=${activity.taskId} pip=${activity.isInPictureInPictureMode} resumed=$resumed" +
            " invalid=${current?.invalidVideo} shield=${rejectedEntryShield != null} reason=$lastReason" +
            " session=${entry?.session?.let(System::identityHashCode)} capturedDoc=${current?.documentGeneration}" +
            " currentDoc=${entry?.documentGeneration} playing=${entry?.playing}" +
            " viewport=${gecko?.width}x${gecko?.height} stage=${container?.width}x${container?.height}" +
            " root=${reactRoot?.width}x${reactRoot?.height} rootVisible=${reactRoot?.visibility}" +
            " launcherPending=${launcherReturn.pending} detail=$detail")
    }

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != actionName || intent.getStringExtra("nonce") != actionNonce) return
            val current = transfer?.takeUnless { it.invalidVideo } ?: return
            if (intent.getLongExtra("ticket", -1L) != current.ticket) return
            val media = ownedEntry()?.media?.takeIf { it.isActive } ?: return
            when (intent.getStringExtra("control")) {
                "play" -> if (requestAudioFocus(explicitPlay = true)) media.play()
                "pause" -> { pauseAudio(); abandonAudioFocus(retainSession = true) }
            }
            refreshParams()
        }
    }
    private val registryListener: (String) -> Unit = { id ->
        if (!destroyed && (id == policy.tabId || id == transfer?.target?.tabId || id == audioSession?.target?.tabId)) {
            if (audioSession != null && audioEntry() == null) abandonAudioFocus()
            audioEntry()?.let { audioPlaybackIntent.observe(it.playing) }
            if (transfer != null && ownedEntry() == null) {
                lastReason = "target-unavailable"
                transfer?.let(::invalidateVideo)
            } else {
                if (!hasAudioFocusRequest && (ownedEntry()?.playing == true || (resumed && audioEntry()?.playing == true)))
                    requestAudioFocus()
                refreshParams()
            }
            emitState()
        }
    }
    private val drawListener = ViewTreeObserver.OnPreDrawListener {
        if (!destroyed) {
            if (activity.isInPictureInPictureMode && transfer != null) {
                reactRoot?.let { lastPipRootSize = PictureInPictureWindowSize(it.width, it.height) }
            } else recordRestoredWindowWidth()
            refreshParams()
        }
        true
    }

    fun attach(root: View) {
        reactRoot = root
        refreshPermission()
        root.viewTreeObserver.addOnPreDrawListener(drawListener)
        GeckoSessionRegistry.pictureInPictureStateChanged = registryListener
        val filter = IntentFilter(actionName)
        if (Build.VERSION.SDK_INT >= 33) activity.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        else activity.registerReceiver(receiver, filter)
        registeredReceiver = true
    }

    fun configure(enabled: Boolean, tabId: String?, blocked: Boolean) {
        if (destroyed) return
        policy.configure(enabled, tabId?.takeIf { it.isNotBlank() }, blocked)
        lastReason = null
        refreshParams()
        emitState()
    }

    fun status(): String {
        refreshPermission()
        emitState()
        return stateJson().put("sequence", sequence).toString()
    }

    fun enter(): String {
        if (destroyed) return status()
        refreshPermission()
        if (activity.isInPictureInPictureMode || transfer != null) return status()
        clearLauncherReturn()
        dismissal.cancel()
        dismissal.beginEntry()
        if (prepare(explicit = true)) {
            try {
                if (!activity.enterPictureInPictureMode(params(autoEnter = false))) {
                    lastReason = "entry-rejected"
                    restore()
                }
            } catch (_: RuntimeException) {
                lastReason = "entry-rejected"
                restore()
            }
        } else dismissal.cancel()
        emitState()
        return status()
    }

    /** API 31+ lets the system enter; older Android requires the explicit call here. */
    fun onUserLeaveHint() {
        trace("leave-start")
        clearLauncherReturn()
        refreshPermission()
        refreshParams()
        val available = availability()
        if (!policy.canAutoEnter(available)) {
            trace("leave-rejected", "reason=${policy.reason(available)} enabled=${policy.enabled} available=$available")
            return
        }
        dismissal.cancel()
        dismissal.beginEntry()
        if (!prepare(explicit = false)) return
        if (Build.VERSION.SDK_INT < 31) {
            try {
                if (!activity.enterPictureInPictureMode(params(autoEnter = false))) {
                    lastReason = "entry-rejected"
                    restore()
                }
            } catch (_: RuntimeException) {
                lastReason = "entry-rejected"
                restore()
            }
        }
        emitState()
    }

    /** Android 15 reports this before the entry animation hides the browser chrome. */
    fun onTransitioningToPictureInPicture() {
        trace("transitioning")
        dismissal.beginEntry(foregroundRequested = launcherReturn.pending)
        if (transfer == null && policy.enabled && !policy.externalActivityPending &&
            !prepare(explicit = false, systemEntering = true)) hideUnexpectedEntry()
    }

    fun onNewIntent(intent: Intent) {
        trace("new-intent", "internal=${intent.getStringExtra(RETURN_NONCE) == actionNonce}" +
            " main=${intent.action == Intent.ACTION_MAIN} launcher=${intent.hasCategory(Intent.CATEGORY_LAUNCHER)} flags=${intent.flags}")
        if (destroyed || intent.getStringExtra(RETURN_NONCE) == actionNonce) return
        // A launcher tap or deep link is newer user intent than queued invalid-media cleanup.
        if (activity.isInPictureInPictureMode || transfer != null || rejectedEntryShield != null)
            dismissal.beginEntry()
        dismissal.requestForeground()
        if (intent.action != Intent.ACTION_MAIN || !intent.hasCategory(Intent.CATEGORY_LAUNCHER)) {
            // An intervening external link is a newer user action. Its existing
            // delivery path in MainActivity still runs after this notification.
            clearLauncherReturn()
            refreshParams()
            return
        }
        val request = launcherReturn.request(transfer?.ticket,
            preparing = policy.phase == PictureInPicturePhase.PREPARING) ?: return
        if (launcherReturnTimeout == null) {
            launcherReturnTimeout = Runnable {
                if (launcherReturn.owns(request)) {
                    clearLauncherReturn()
                    refreshParams()
                    emitState()
                }
            }.also { main.postDelayed(it, ENTRY_TIMEOUT_MS) }
        }
        refreshParams()
        emitState()
    }

    fun onModeChanged(active: Boolean) {
        if (destroyed) return
        trace("mode", "active=$active")
        if (active) {
            dismissal.beginEntry(foregroundRequested = launcherReturn.pending)
            if (transfer == null && !prepare(explicit = false, systemEntering = true)) {
                // Auto-entry may have been armed just before the cached video disappeared.
                // Keep the browser alive behind the user's current task if no video remains.
                hideUnexpectedEntry()
                if (launcherReturn.pending) returnToLauncherAfterEntry()
                else dismissUnexpectedEntry()
                refreshParams()
                emitState()
                return
            }
            cancelTimeout()
            transfer?.let { policy.confirm(it.ticket) }
            container?.setPinned(true)
            if (transfer?.invalidVideo == true) dismissInvalidVideo()
            else if (ownedEntry()?.playing == true) requestAudioFocus()
        } else {
            clearLauncherReturn()
            if (!resumed && policy.phase == PictureInPicturePhase.ACTIVE)
                pendingStopTarget = transfer?.takeUnless { it.invalidVideo }?.mediaDocument()
            restore()
        }
        refreshParams()
        emitState()
        if (active) returnToLauncherAfterEntry()
    }

    fun onResume() {
        if (destroyed) return
        trace("resume")
        if (!activity.isInPictureInPictureMode) dismissal.requestForeground()
        resumed = true
        policy.resume()
        refreshPermission()
        pendingStopTarget = null
        if (!activity.isInPictureInPictureMode && launcherReturn.foregroundResumed()) clearLauncherReturn()
        if (!activity.isInPictureInPictureMode && transfer != null) restore()
        if (!activity.isInPictureInPictureMode) restoreUnexpectedEntry()
        if (!hasAudioFocusRequest && audioPlaybackIntent.canAcquire(audioEntry()?.playing == true)) requestAudioFocus()
        refreshParams()
        emitState()
    }

    fun onPause() {
        trace("pause")
        // Auto-entry on newer Android may omit onUserLeaveHint entirely.
        if (activity.isInPictureInPictureMode)
            dismissal.beginEntry(foregroundRequested = launcherReturn.pending)
        resumed = false
    }

    fun onStop() {
        trace("stop")
        resumed = false
        val target = pendingStopTarget ?: transfer?.takeUnless { it.invalidVideo }?.mediaDocument()
            ?.takeIf { policy.phase == PictureInPicturePhase.ACTIVE }
        target?.let(::pauseTarget)
        pauseAudio()
        pendingStopTarget = null
        abandonAudioFocus(retainSession = true)
        if (!activity.isInPictureInPictureMode) restore()
        emitState()
    }

    /** Call before native external launch; configure() cannot accidentally re-arm it. */
    fun suspendForExternalActivity() {
        clearLauncherReturn()
        policy.suspendForExternalActivity()
        if (policy.phase == PictureInPicturePhase.PREPARING && !activity.isInPictureInPictureMode) restore()
        refreshParams()
        emitState()
    }

    fun externalActivityLaunchFailed() {
        if (resumed) policy.resume()
        refreshParams()
        emitState()
    }

    fun onExternalActivityResult() {
        // Some cancelled dialogs deliver a result without pausing this Activity.
        if (resumed && activity.hasWindowFocus()) externalActivityLaunchFailed()
    }

    fun openSettings() {
        val packageUri = Uri.parse("package:${activity.packageName}")
        // The specialized Settings constant is hidden in the public Android SDK.
        val pip = Intent("android.settings.PICTURE_IN_PICTURE_SETTINGS", packageUri)
        val intent = if (pip.resolveActivity(activity.packageManager) != null) pip
            else Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri)
        activity.startActivity(intent)
    }

    fun destroy() {
        if (destroyed) return
        destroyed = true
        clearLauncherReturn()
        if (!activity.isChangingConfigurations) {
            (transfer?.takeUnless { it.invalidVideo }?.mediaDocument() ?: pendingStopTarget)?.let(::pauseTarget)
            pauseAudio()
        }
        restore()
        val observer = reactRoot?.viewTreeObserver
        if (observer?.isAlive == true) observer.removeOnPreDrawListener(drawListener)
        if (GeckoSessionRegistry.pictureInPictureStateChanged === registryListener)
            GeckoSessionRegistry.pictureInPictureStateChanged = null
        if (registeredReceiver) { activity.unregisterReceiver(receiver); registeredReceiver = false }
        pendingActions.values.forEach { it.cancel() }
        pendingActions.clear()
        abandonAudioFocus()
        reactRoot = null
    }

    private fun availableOwner(): BrowserSurfaceView? {
        val entry = policy.tabId?.let(GeckoSessionRegistry::entry) ?: return null
        val owner = entry.owner ?: return null
        return owner.takeIf {
            it.isAttachedToWindow && it.isShown && it.tabId == policy.tabId && entry.session.isOpen &&
                it.gecko.session === entry.session && it.gecko.width > 0 && it.gecko.height > 0
        }
    }

    private fun supported(): Boolean = supportsPictureInPicture

    @Suppress("DEPRECATION")
    private fun refreshPermission() {
        pictureInPictureAllowed = supported() && try {
            activity.getSystemService(AppOpsManager::class.java).checkOpNoThrow(
                AppOpsManager.OPSTR_PICTURE_IN_PICTURE, Process.myUid(), activity.packageName
            ) == AppOpsManager.MODE_ALLOWED
        } catch (_: RuntimeException) { false }
    }

    private fun allowed(): Boolean = pictureInPictureAllowed

    private fun availability(systemEntering: Boolean = false): PictureInPictureAvailability =
        PictureInPictureAvailability(supported(), allowed(), resumed || systemEntering,
            availableVideo() != null, ExternalPictureInPicture.hasDisplayTransfer || policy.tabId?.let(GeckoSessionRegistry::isPictureInPictureBlocked) == true)

    private fun stateJson(): JSONObject {
        val available = availability()
        val active = !destroyed && activity.isInPictureInPictureMode
        val transitioning = !destroyed && policy.phase == PictureInPicturePhase.PREPARING
        val reason = lastReason ?: if (active || transitioning) null else policy.reason(available)
        return JSONObject().put("supported", available.supported).put("allowed", available.allowed)
            .put("active", active).put("transitioning", transitioning)
            .put("autoEnterEnabled", autoEnterEnabled())
            .put("tabId", transfer?.target?.tabId ?: policy.tabId ?: JSONObject.NULL)
            .apply { restoredWindowWidth?.let { put("restoredWindowWidth", it) } }
            .apply { if (reason != null) put("reason", reason) }
    }

    private fun emitState() {
        val json = stateJson()
        val comparable = json.toString()
        if (lastEvent == comparable) return
        lastEvent = comparable
        sequence = sequences.incrementAndGet()
        val payload = Arguments.createMap().apply {
            putBoolean("supported", json.getBoolean("supported"))
            putBoolean("allowed", json.getBoolean("allowed"))
            putBoolean("active", json.getBoolean("active"))
            putBoolean("transitioning", json.getBoolean("transitioning"))
            putBoolean("autoEnterEnabled", json.getBoolean("autoEnterEnabled"))
            putString("tabId", if (json.isNull("tabId")) null else json.getString("tabId"))
            if (json.has("reason")) putString("reason", json.getString("reason"))
            if (json.has("restoredWindowWidth")) putDouble("restoredWindowWidth", json.getDouble("restoredWindowWidth"))
            putDouble("sequence", sequence.toDouble())
        }
        GeckoSessionRegistry.emit?.invoke("BrowserPictureInPicture", payload)
    }

    private data class AvailableVideo(val owner: BrowserSurfaceView, val region: VideoRegion, val pixels: VideoPixelRect)

    private fun availableVideo(): AvailableVideo? {
        val owner = availableOwner() ?: return null
        val session = owner.gecko.session ?: return null
        val region = BrowserVideoRegions.latest(session)?.takeIf { it.playing } ?: return null
        val pixels = VideoPipViewport.pixelsFor(session, region, owner.gecko.width, owner.gecko.height) ?: return null
        return AvailableVideo(owner, region, pixels)
    }

    private fun prepare(explicit: Boolean, systemEntering: Boolean = false): Boolean {
        trace("prepare-start", "explicit=$explicit systemEntering=$systemEntering")
        if (ExternalPictureInPicture.hasDisplayTransfer) {
            trace("prepare-rejected", "reason=external-display-transfer")
            return false
        }
        if (transfer != null) { trace("prepare-retained"); return true }
        availableOwner()?.flushPendingGeckoLayout()
        val available = availability(systemEntering)
        val video = availableVideo()
        val owner = video?.owner
        val root = reactRoot
        val parent = owner?.gecko?.parent as? ViewGroup
        val entry = policy.tabId?.let(GeckoSessionRegistry::entry)
        if (video == null || owner == null || root == null || parent !== owner || entry == null) {
            lastReason = policy.reason(available, explicit) ?: "video-unavailable"
            trace("prepare-rejected", "video=${video != null} owner=${owner != null} root=${root != null}" +
                " parentMatches=${parent === owner} entry=${entry != null} available=$available")
            emitState()
            return false
        }
        val target = PictureInPictureTarget(owner.tabId, entry.sessionVersion)
        val ticket = policy.begin(target, available, explicit)
        if (ticket == null) {
            lastReason = policy.reason(available, explicit)
            trace("prepare-rejected", "reason=policy-begin available=$available")
            emitState()
            return false
        }
        val captured = Transfer(ticket, target, owner, owner.gecko, entry.session, entry.documentGeneration, parent,
            parent.indexOfChild(owner.gecko), owner.gecko.layoutParams, root.visibility,
            VideoPipViewport.sourceRect(owner.gecko, video.pixels), video.pixels, video.region,
            viewportWidth = owner.gecko.width, viewportHeight = owner.gecko.height)
        transfer = captured
        rootSizeBeforeEntry = PictureInPictureWindowSize(root.width, root.height)
        lastPipRootSize = null
        pendingWindowRestoration = false
        restoredWindowWidth = null
        lastReason = null
        emitState()
        try {
            val content = activity.findViewById<ViewGroup>(android.R.id.content)
            val stage = VideoPipViewport(activity, captured.gecko, captured.session,
                captured.viewportWidth, captured.viewportHeight, captured.region, captured.pixels)
            container = stage
            content.addView(stage, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            stage.attach()
            activity.getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(root.windowToken, 0)
            root.visibility = View.INVISIBLE
            stage.startWatching(onInvalid = {
                if (transfer === captured) invalidateVideo(captured)
            }, onPixelsChanged = { pixels ->
                if (transfer === captured) {
                    captured.source.offset(pixels.left - captured.pixels.left, pixels.top - captured.pixels.top)
                    captured.source.right = captured.source.left + pixels.width
                    captured.source.bottom = captured.source.top + pixels.height
                    captured.pixels = pixels
                    refreshParams()
                }
            })
            if (entry.playing && !captured.invalidVideo) requestAudioFocus()
            scheduleTimeout(ticket)
            trace("prepare-ready", "pixels=${captured.pixels} regionSequence=${captured.region.sequence}")
            return true
        } catch (_: RuntimeException) {
            lastReason = "surface-transfer-failed"
            trace("prepare-rejected", "reason=surface-transfer-failed")
            restore()
            emitState()
            return false
        }
    }

    private fun invalidateVideo(current: Transfer) {
        if (transfer !== current || current.invalidVideo) return
        trace("video-invalid")
        current.invalidVideo = true
        container?.hideInvalid()
        lastReason = "video-region-unavailable"
        pendingStopTarget = null
        // A same-session navigation may already own different media. Release focus without pause.
        abandonAudioFocus()
        refreshParams()
        emitState()
        dismissInvalidVideo()
    }

    private fun dismissInvalidVideo() {
        val current = transfer?.takeIf { it.invalidVideo } ?: return
        if (!activity.isInPictureInPictureMode) { trace("invalid-dismiss-deferred"); return }
        requestBackgroundDismissal("invalid", owns = { transfer === current }, restoreView = ::restore)
    }

    private fun hideUnexpectedEntry() {
        if (rejectedEntryShield != null) return
        trace("unexpected-entry")
        val root = reactRoot ?: return
        val content = activity.findViewById<ViewGroup>(android.R.id.content)
        val shield = View(activity).apply { setBackgroundColor(android.graphics.Color.BLACK) }
        rejectedRootVisibility = root.visibility
        rejectedEntryShield = shield
        rootSizeBeforeEntry = PictureInPictureWindowSize(root.width, root.height)
        restoredWindowWidth = null
        content.addView(shield, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.visibility = View.INVISIBLE
        lastReason = "video-unavailable"
        main.postDelayed({
            if (rejectedEntryShield === shield) {
                if (activity.isInPictureInPictureMode) dismissUnexpectedEntry() else restoreUnexpectedEntry()
            }
        }, ENTRY_TIMEOUT_MS)
    }

    private fun dismissUnexpectedEntry() {
        val shield = rejectedEntryShield ?: return
        requestBackgroundDismissal("unexpected", owns = { rejectedEntryShield === shield }, restoreView = ::restoreUnexpectedEntry)
    }

    private fun requestBackgroundDismissal(kind: String, owns: () -> Boolean, restoreView: () -> Unit) {
        val request = dismissal.request() ?: run { trace("$kind-dismiss-skipped"); return }
        main.post {
            if (destroyed || !owns()) return@post
            when (dismissal.claim(request, activity.isInPictureInPictureMode)) {
                PictureInPictureDismissalAction.NONE -> { trace("$kind-dismiss-cancelled"); return@post }
                PictureInPictureDismissalAction.RESTORE -> { restoreView(); return@post }
                PictureInPictureDismissalAction.BACKGROUND -> Unit
            }
            try {
                // Android removes the pinned root and retains this Activity behind Home.
                // Do not launch Main: video ending must not take over the user's current app.
                val accepted = activity.moveTaskToBack(true)
                trace("$kind-dismiss-background", "accepted=$accepted")
                if (!accepted) { lastReason = "video-dismiss-rejected"; emitState() }
            } catch (_: RuntimeException) {
                // Keep the invalid crop covered; a later explicit return can still restore it.
                lastReason = "video-dismiss-failed"
                trace("$kind-dismiss-failed")
                emitState()
            }
        }
    }

    private fun restoreUnexpectedEntry() {
        if (!destroyed && activity.isInPictureInPictureMode) return
        val shield = rejectedEntryShield ?: return
        dismissal.cancel()
        rejectedEntryShield = null
        reactRoot?.visibility = rejectedRootVisibility
        (shield.parent as? ViewGroup)?.removeView(shield)
        pendingWindowRestoration = !destroyed
        lastParams = null
    }

    private fun restore() {
        trace("restore")
        dismissal.cancel()
        cancelTimeout()
        restoreUnexpectedEntry()
        val old = transfer ?: return
        transfer = null
        container?.dispose()
        policy.finish()
        // Audio focus belongs to the session, not its temporary display parent. Keep a
        // valid request through expansion so a pending system GAIN still reaches Gecko.
        if (destroyed || audioEntry() == null) abandonAudioFocus()
        pendingActions.values.forEach { it.cancel() }
        pendingActions.clear()
        val entry = GeckoSessionRegistry.entry(old.owner.tabId)
        val registeredSession = entry?.takeIf { it.owner === old.owner && it.session.isOpen }?.session
        val restoration = pictureInPictureRestoration(old.owner.isAttachedToWindow,
            old.owner.gecko, old.gecko, old.session, old.gecko.session, registeredSession)
        // Restore the host's child even after recovery replaced its session. Otherwise a
        // still-mounted BrowserSurfaceView would remain empty and admission could not recover it.
        // A newer session on this View belongs to recovery/admission, not this transfer.
        if (restoration.releaseCapturedSession) old.gecko.releaseSession()
        (old.gecko.parent as? ViewGroup)?.removeView(old.gecko)
        if (restoration.returnView)
            old.parent.addView(old.gecko, old.index.coerceIn(0, old.parent.childCount), old.layout)
        reactRoot?.visibility = old.rootVisibility
        container?.let { (it.parent as? ViewGroup)?.removeView(it) }
        container = null
        lastParams = null
        pendingWindowRestoration = !destroyed
    }

    private fun recordRestoredWindowWidth() {
        if (!pendingWindowRestoration || transfer != null || activity.isInPictureInPictureMode) return
        val root = reactRoot ?: return
        val decor = activity.window.decorView
        if (!root.isAttachedToWindow || root.visibility != View.VISIBLE || !pictureInPictureWindowRestored(
                PictureInPictureWindowSize(root.width, root.height), rootSizeBeforeEntry, lastPipRootSize,
                root.isLayoutRequested || decor.isLayoutRequested)) return
        // Match RN DeviceInfoModule.getWindowDisplayMetrics so JS Dimensions can acknowledge
        // this native layout without guessing from a timer or the former full-screen width.
        val metrics = activity.resources.displayMetrics
        val bounds = WindowMetricsCalculator.getOrCreate().computeCurrentWindowMetrics(activity).bounds
        val width = if (isEdgeToEdgeFeatureFlagOn) bounds.width() else {
            ViewCompat.getRootWindowInsets(decor)?.let {
                val insets = it.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
                bounds.width() - insets.left - insets.right
            } ?: metrics.widthPixels
        }
        if (width <= 0 || metrics.density <= 0) return
        restoredWindowWidth = width.toDouble() / metrics.density
        pendingWindowRestoration = false
        emitState()
    }

    private fun ownedEntry(): GeckoSessionRegistry.Entry? {
        val current = transfer ?: return null
        return GeckoSessionRegistry.entry(current.target.tabId)?.takeIf {
            it.sessionVersion == current.target.sessionVersion && it.session === current.session &&
                it.owner === current.owner && it.session.isOpen && current.gecko.session === it.session &&
                it.documentGeneration == current.documentGeneration
        }
    }

    private fun pauseTarget(document: MediaDocument) {
        GeckoSessionRegistry.entry(document.target.tabId)?.takeIf {
            it.sessionVersion == document.target.sessionVersion && it.documentGeneration == document.generation
        }?.media?.pause()
    }

    private fun audioEntry(): GeckoSessionRegistry.Entry? {
        val current = audioSession ?: return null
        return GeckoSessionRegistry.entry(current.target.tabId)?.takeIf {
            it.sessionVersion == current.target.sessionVersion && it.session === current.session && it.session.isOpen &&
                it.documentGeneration == current.documentGeneration
        }
    }

    private fun autoEnterEnabled(): Boolean {
        if (destroyed || rejectedEntryShield != null || ExternalPictureInPicture.hasDisplayTransfer || launcherReturn.pending || !policy.enabled || policy.blocked || policy.externalActivityPending || !supported() || !allowed()) return false
        if (policy.tabId?.let(GeckoSessionRegistry::isPictureInPictureBlocked) == true) return false
        return if (transfer != null) transfer?.invalidVideo == false && ownedEntry() != null
        else policy.canAutoEnter(availability())
    }

    private fun params(autoEnter: Boolean): PictureInPictureParams {
        val builder = PictureInPictureParams.Builder()
        val current = transfer
        val video = if (current == null) availableVideo() else null
        val pixels = current?.pixels ?: video?.pixels
        val ratio = pixels?.let { pictureInPictureAspectRatio(it.width, it.height) }
        if (ratio != null) builder.setAspectRatio(Rational(ratio.first, ratio.second))
        val source = current?.source ?: video?.let { VideoPipViewport.sourceRect(it.owner.gecko, it.pixels) } ?: Rect()
        if (!source.isEmpty) builder.setSourceRectHint(source)
        builder.setActions(mediaActions())
        if (Build.VERSION.SDK_INT >= 31) builder.setAutoEnterEnabled(autoEnter).setSeamlessResizeEnabled(false)
        return builder.build()
    }

    private fun refreshParams() {
        if (destroyed || !supported()) return
        val video = if (transfer == null) availableVideo() else null
        val rect = transfer?.source ?: video?.let { VideoPipViewport.sourceRect(it.owner.gecko, it.pixels) } ?: Rect()
        val entry = ownedEntry()
        val auto = autoEnterEnabled()
        val signature = "$auto|${policy.tabId}|${transfer?.ticket}|$rect|${transfer?.pixels ?: video?.pixels}|${entry?.playing}|${entry?.media?.isActive}"
        if (lastParams == signature) return
        try {
            activity.setPictureInPictureParams(params(auto))
            lastParams = signature
            emitState()
        } catch (_: RuntimeException) { lastReason = "params-rejected" }
    }

    private fun mediaActions(): List<RemoteAction> {
        val current = transfer?.takeUnless { it.invalidVideo } ?: return emptyList()
        val entry = ownedEntry() ?: return emptyList()
        if (entry.media?.isActive != true) return emptyList()
        val control = if (entry.playing) "pause" else "play"
        val label = if (entry.playing) "Pause" else "Play"
        val icon = if (entry.playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        val intent = Intent(actionName).setPackage(activity.packageName)
            .putExtra("nonce", actionNonce).putExtra("ticket", current.ticket).putExtra("control", control)
        // A previous PiP action must keep its old ticket, not adopt a new session's extras.
        val requestCode = (current.ticket * 2 + if (control == "play") 1 else 0).toInt()
        val pending = PendingIntent.getBroadcast(activity, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        pendingActions[control] = pending
        return listOf(RemoteAction(Icon.createWithResource(activity, icon), label, label, pending))
    }

    private fun pauseAudio() {
        val entry = audioEntry() ?: return
        audioPlaybackIntent.requestPause(entry.playing)
        ExternalPictureInPicture.audioLease?.pauseFor(entry.session)
        entry.media?.pause()
    }

    private fun requestAudioFocus(explicitPlay: Boolean = false): Boolean {
        val transferred = transfer
        if (transferred?.invalidVideo == true) return false
        if (transferred != null) {
            val entry = ownedEntry() ?: return false
            val media = entry.media ?: return false
            if (audioSession?.session !== entry.session || audioSession?.documentGeneration != entry.documentGeneration) {
                abandonAudioFocus()
                audioSession = AudioSession(transferred.target, entry.session, media, entry.documentGeneration)
                audioPlaybackIntent = PictureInPicturePlaybackIntent()
            }
        }
        val owner = audioSession ?: return false
        if (audioEntry() == null) { abandonAudioFocus(); return false }
        if (explicitPlay) audioPlaybackIntent.requestPlay()
        val shared = ExternalPictureInPicture.audioLease ?: return false
        shared.bind(ExternalPipSource(owner.target.tabId, owner.target.sessionVersion,
            owner.session, transferred?.gecko ?: owner.session), owner.media)
        return shared.acquire(explicitPlay)
    }

    private fun abandonAudioFocus(retainSession: Boolean = false) {
        audioSession?.let { ExternalPictureInPicture.audioLease?.abandonFor(it.session, retainSession) }
        if (!retainSession) audioSession = null
    }

    private fun scheduleTimeout(ticket: Long) {
        cancelTimeout()
        timeout = Runnable {
            if (transfer?.ticket == ticket && !activity.isInPictureInPictureMode && policy.cancel(ticket)) {
                lastReason = "entry-cancelled"
                trace("entry-timeout")
                restore()
                refreshParams()
                emitState()
            }
        }.also { main.postDelayed(it, ENTRY_TIMEOUT_MS) }
    }

    private fun returnToLauncherAfterEntry() {
        val request = launcherReturn.claimOnActive() ?: return
        // Android's mode(true) callback is the entry-animation completion boundary.
        // Let its current lifecycle transaction finish before requesting expansion.
        main.post {
            if (destroyed || !launcherReturn.owns(request)) return@post
            if (!activity.isInPictureInPictureMode) {
                clearLauncherReturn()
                refreshParams()
                emitState()
                return@post
            }
            try {
                trace("launcher-return-launch")
                val intent = Intent.makeMainActivity(activity.componentName)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
                    .putExtra(RETURN_NONCE, actionNonce)
                launchReturn(intent)
            } catch (_: RuntimeException) {
                if (launcherReturn.owns(request)) {
                    lastReason = "launcher-return-failed"
                    clearLauncherReturn()
                    refreshParams()
                    emitState()
                }
            }
        }
    }

    private fun clearLauncherReturn() {
        launcherReturn.cancel()
        launcherReturnTimeout?.let(main::removeCallbacks)
        launcherReturnTimeout = null
    }

    private fun cancelTimeout() {
        timeout?.let(main::removeCallbacks)
        timeout = null
    }
}
