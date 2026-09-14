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
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Log
import android.util.Rational
import android.view.ViewGroup
import com.facebook.react.bridge.Arguments
import com.workspacebrowser.MainActivity
import org.json.JSONArray
import org.json.JSONObject
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView
import java.lang.ref.WeakReference
import java.util.UUID

/** One process-owned display lease; React hosts may disappear without releasing it. Main thread only. */
object ExternalPictureInPicture {
    private const val ENTRY_TIMEOUT_MS = 1_500L
    private const val CONFIRMATION_TIMEOUT_MS = 5_000L
    private const val RETURN_TIMEOUT_MS = 2_000L
    private val main = Handler(Looper.getMainLooper())
    private val policy = ExternalPictureInPicturePolicy()
    private val preparation = VideoPipPreparation()
    private data class Transfer(val lease: ExternalPipLease, val origin: BrowserSurfaceView,
        val gecko: GeckoView, val width: Int, val height: Int, val rect: Rect,
        val region: VideoRegion, val documentGeneration: Long, var pixels: VideoPixelRect, var viewport: VideoPipViewport? = null,
        var destination: BrowserSurfaceView? = null, var activity: ExternalPictureInPictureActivity? = null,
        val lifecycle: ExternalPipActivityState = ExternalPipActivityState(),
        val windowPresentation: ExternalPipWindowPresentation = ExternalPipWindowPresentation(lease.ticket))
    private var transfer: Transfer? = null
    private var returned: Transfer? = null
    private var entryTimeout: Runnable? = null
    private var returnTimeout: Runnable? = null
    private var browser = WeakReference<MainActivity>(null)
    private var app: Context? = null
    private var audio: ExternalPipAudio? = null
    private var enabled = false
    private var blocked = true
    private var visible = emptySet<String>()
    private var supported = false
    private var allowed = false
    private var mainStopped = true
    private var reason: String? = null
    private var sequence = 0L
    private var lastState: String? = null
    private var traceSequence = 0L
    private val nonce = UUID.randomUUID().toString()
    private var receiverRegistered = false
    private val actions = mutableMapOf<String, PendingIntent>()
    val hasLease: Boolean get() = policy.lease != null
    val hasDisplayTransfer: Boolean get() = hasLease || returned != null || policy.returning != null
    internal val audioLease: ExternalPipAudio? get() = audio

    /** Acceptance diagnostics only: lifecycle identities and decisions, never URLs or page content. */
    internal fun trace(event: String, activity: Activity? = null, ticket: Long? = null, detail: String? = null) {
        if ((activity?.packageName ?: app?.packageName) != "com.workspacebrowser.acceptance") return
        val current = transfer
        val host = activity ?: current?.activity
        val live = current?.lease?.source?.let(::entry)
        Log.i("YeoyuPipTrace", "n=${++traceSequence} uptime=${SystemClock.uptimeMillis()} event=$event" +
            " ticket=$ticket lease=${current?.lease?.ticket} tab=${current?.lease?.source?.tabId}" +
            " phase=${policy.phase} task=${host?.taskId} activity=${host?.let(System::identityHashCode)}" +
            " ownsActivity=${host != null && current?.activity === host} pip=${host?.isInPictureInPictureMode}" +
            " finishing=${host?.isFinishing} destroyed=${host?.isDestroyed} changing=${host?.isChangingConfigurations}" +
            " resumed=${current?.lifecycle?.resumed} stopped=${current?.lifecycle?.stopped}" +
            " mainStopped=$mainStopped mainTask=${browser.get()?.taskId}" +
            " capturedDoc=${current?.documentGeneration} currentDoc=${live?.documentGeneration}" +
            " playing=${live?.playing} returnToken=${policy.returning?.token} detail=$detail")
    }

    internal fun traceExitBoundary(activity: ExternalPictureInPictureActivity, ticket: Long,
        event: String, detail: String = "", begin: Boolean = false) {
        if (activity.packageName != "com.workspacebrowser.acceptance") return
        val current = transfer?.takeIf { it.lease.ticket == ticket && it.activity === activity } ?: return
        if (begin && policy.phase == ExternalPipPhase.ACTIVE && !activity.isInPictureInPictureMode)
            current.viewport?.beginExitProbe(activity, ticket, current.documentGeneration)
        current.viewport?.traceExitProbe(event, detail)
    }

    private fun entry(source: ExternalPipSource): GeckoSessionRegistry.Entry? =
        GeckoSessionRegistry.entry(source.tabId)?.takeIf {
            it.session === source.session && it.sessionVersion == source.sessionVersion && it.session.isOpen
        }
    private fun documentEntry(current: Transfer): GeckoSessionRegistry.Entry? =
        entry(current.lease.source)?.takeIf { it.documentGeneration == current.documentGeneration }

    internal fun holdsSession(session: GeckoSession): Boolean =
        (transfer?.let { policy.owns(it.lease.source) && it.gecko.session === session &&
            it.lease.source.session === session && entry(it.lease.source) != null } == true) ||
            (returned?.lease?.source?.let { it.session === session && entry(it) != null } == true)

    fun attachBrowser(activity: MainActivity) {
        browser = WeakReference(activity)
        app = activity.applicationContext
        if (audio == null) audio = ExternalPipAudio(activity.applicationContext, main)
        refreshPermission()
        emitState()
    }
    fun browserResumed(activity: MainActivity) {
        trace("main-resumed", activity)
        mainStopped = false; attachBrowser(activity)
    }
    fun browserStopped(activity: MainActivity) {
        trace("main-stopped", activity)
        if (browser.get() !== activity) return
        mainStopped = true
        preparation.cancel()
        pauseReturnedAudioIfStopped()
    }
    private fun pauseReturnedAudioIfStopped() {
        if (mainStopped && !hasDisplayTransfer && browser.get()?.browserPip?.hasDisplayTransfer != true) audio?.pause()
    }
    fun browserDestroyed(activity: MainActivity) {
        trace("main-destroyed", activity)
        if (browser.get() !== activity) return
        preparation.cancel()
        browser.clear()
        if (!activity.isChangingConfigurations && activity.isFinishing) shutdown()
    }
    fun configure(enabled: Boolean, visibleIdsJson: String, blocked: Boolean) {
        this.enabled = enabled
        this.blocked = blocked
        visible = try {
            val list = JSONArray(visibleIdsJson)
            (0 until list.length()).mapNotNull { (list.opt(it) as? String)?.takeIf(String::isNotBlank) }.toSet()
        } catch (_: Exception) { this.blocked = true; emptySet() }
        if (!this.enabled || this.blocked) preparation.cancel()
        emitState()
    }
    @Suppress("DEPRECATION")
    private fun refreshPermission() {
        val context = app ?: return
        supported = Build.VERSION.SDK_INT >= 33 && context.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
        allowed = supported && try {
            context.getSystemService(AppOpsManager::class.java).checkOpNoThrow(
                AppOpsManager.OPSTR_PICTURE_IN_PICTURE, Process.myUid(), context.packageName) == AppOpsManager.MODE_ALLOWED
        } catch (_: RuntimeException) { false }
    }
    fun status(): String { refreshPermission(); emitState(); return state().put("sequence", sequence).toString() }
    fun acknowledge(token: Double) {
        trace("ack", detail = "token=$token")
        if (!token.isFinite() || token <= 0 || token > 9_007_199_254_740_991.0 || token != token.toLong().toDouble()) return
        policy.acknowledge(token.toLong())
        browser.get()?.browserPip?.externalOwnershipChanged()
        pauseReturnedAudioIfStopped()
        emitState()
    }

    /** Resolve after a fresh measurement reserves the source, before React publishes its selection. */
    fun prepare(previous: String?, next: String?, nextVisibleJson: String?, done: () -> Unit) {
        val ticket = preparation.begin(done)
        SpaceTransitionCover.tabTransition()
        trace("prepare-start", browser.get(), detail = "preparation=$ticket previous=$previous next=$next visible=$visible")
        val explicitAfter = try {
            nextVisibleJson?.let { value ->
                val list = JSONArray(value)
                (0 until list.length()).map { list.getString(it) }.filter(String::isNotBlank).toSet()
            }
        } catch (_: Exception) {
            reason = "invalid-visible-tabs"; emitState(); preparation.complete(ticket); return
        }
        val before = visible
        val after = explicitAfter ?: if (next in before) before else setOfNotNull(next)
        val old = transfer
        if (old != null && (old.lease.source.tabId == next || old.lease.source.tabId in after)) {
            preparation.complete(ticket) {
                finish(old.lease.ticket, pause = false, requestReturn = false, retainForAttach = true)
            }
            return
        }
        val returning = policy.returning
        val parked = returned
        if (!hasLease && returning != null && parked != null && previous != null && next == returning.tabId &&
            previous != next && before == setOf(previous) && explicitAfter != null && explicitAfter.size in 1..2 && next in after &&
            parked.lease.source.tabId == next && documentEntry(parked) != null &&
            parked.gecko.session === parked.lease.source.session && browser.get()?.browserPip?.hasDisplayTransfer == false) {
            try {
                SpaceTransitionCover.prepareReturn(browser.get(), previous, after, documentEntry(parked)!!, parked.gecko, returning.token,
                    mayInstall = { policy.returning === returning && returned === parked && documentEntry(parked) != null &&
                        parked.gecko.session === parked.lease.source.session },
                    publish = { install -> preparation.complete(ticket, install) })
            } catch (_: RuntimeException) { preparation.complete(ticket) }
            catch (_: OutOfMemoryError) { preparation.complete(ticket) }
            return
        }
        if (hasLease || policy.returning != null || previous == null || (explicitAfter == null && previous == next)) {
            trace("prepare-skipped", browser.get(), detail = "preparation=$ticket lease=$hasLease returning=${policy.returning != null} previousMissing=${previous == null} same=${previous == next}")
            preparation.complete(ticket); return
        }
        refreshPermission()
        val activity = browser.get()
        val playing = before.filter { GeckoSessionRegistry.entry(it)?.playing == true }.toSet()
        val focused = before.firstOrNull { GeckoSessionRegistry.entry(it)?.owner?.gecko?.hasFocus() == true }
        val sourceId = externalPipSource(previous, next, before, explicitAfter, playing, focused)
        val candidate = sourceId?.let(GeckoSessionRegistry::entry)
        val owner = candidate?.owner
        if (activity == null || candidate == null || owner == null ||
            !canPrepare(activity, sourceId, candidate, owner)) {
            trace("prepare-rejected", activity, detail = "source=${sourceId != null}" +
                " playing=${candidate?.playing} mediaActive=${candidate?.media?.isActive} owner=${owner != null}" +
                " enabled=$enabled blocked=$blocked supported=$supported allowed=$allowed" +
                " focused=${activity?.hasWindowFocus()} homeBusy=${activity?.browserPip?.hasDisplayTransfer}" +
                " displayBusy=$hasDisplayTransfer")
            reason = when { !supported -> "unsupported"; !allowed -> "permission-denied"; else -> "unavailable" }
            emitState(); preparation.complete(ticket); return
        }
        owner.flushPendingGeckoLayout()
        val gecko = owner.gecko
        val source = ExternalPipSource(sourceId, candidate.sessionVersion, candidate.session, gecko)
        val documentGeneration = candidate.documentGeneration
        try {
            BrowserVideoRegions.request(candidate.session) { region ->
                preparation.complete(ticket) {
                    // Recheck ownership after measurement, including its single bounded reconnect.
                    val currentFocus = before.firstOrNull {
                        GeckoSessionRegistry.entry(it)?.owner?.gecko?.hasFocus() == true
                    }
                    if (browser.get() !== activity || visible != before || entry(source) !== candidate ||
                        currentFocus != focused || candidate.documentGeneration != documentGeneration || candidate.owner !== owner || owner.gecko !== gecko ||
                        !canPrepare(activity, sourceId, candidate, owner)) {
                        trace("prepare-stale", activity, detail = "preparation=$ticket source=$sourceId focus=${currentFocus == focused} visible=${visible == before} document=${candidate.documentGeneration == documentGeneration} owner=${candidate.owner === owner}")
                        return@complete
                    }
                    owner.flushPendingGeckoLayout()
                    val pixels = region?.takeIf { it.playing }?.let {
                        VideoPipViewport.pixelsFor(candidate.session, it, gecko.width, gecko.height)
                    }
                    if (region == null || pixels == null) {
                        trace("prepare-video-unavailable", activity, detail = "preparation=$ticket source=$sourceId region=${region != null} playing=${region?.playing} pixels=${pixels != null}")
                        reason = "video-unavailable"; emitState(); return@complete
                    }
                    val lease = policy.begin(source, sourceId, next, after,
                        homeBusy = activity.browserPip.hasDisplayTransfer) ?: return@complete
                    discardReturned()
                    val current = Transfer(lease, owner, gecko, gecko.width, gecko.height,
                        VideoPipViewport.sourceRect(gecko, pixels), region, documentGeneration, pixels)
                    transfer = current
                    trace("reserved", activity, lease.ticket)
                    reason = null
                    try {
                        candidate.owner = null
                        check(owner.takeTransferredGeckoView() === gecko)
                        GeckoSessionRegistry.externalDisplayChanged(sourceId)
                        activity.browserPip.externalOwnershipChanged()
                        registerReceiver()
                        emitState()
                        scheduleEntryTimeout(current, ExternalPipPhase.PREPARING, ENTRY_TIMEOUT_MS)
                        val intent = Intent(activity, ExternalPictureInPictureActivity::class.java)
                            .putExtra("ticket", lease.ticket)
                        activity.launchExternalPictureInPicture(intent)
                    } catch (_: RuntimeException) {
                        trace("launch-failed", activity, lease.ticket)
                        reason = "entry-failed"
                        finish(lease.ticket, pause = false, requestReturn = false, retainForAttach = true)
                    }
                }
            }
        } catch (_: RuntimeException) {
            reason = "video-unavailable"; emitState(); preparation.complete(ticket)
        }
    }

    private fun scheduleEntryTimeout(current: Transfer, expectedPhase: ExternalPipPhase, delayMillis: Long) {
        entryTimeout?.let(main::removeCallbacks)
        entryTimeout = Runnable {
            if (transfer === current && policy.phase == expectedPhase) {
                reason = if (expectedPhase == ExternalPipPhase.ENTERING) "entry-confirmation-timeout" else "entry-timeout"
                finish(current.lease.ticket, pause = false, requestReturn = false,
                    retainForAttach = true, onlyPhase = expectedPhase)
            }
        }.also { main.postDelayed(it, delayMillis) }
    }

    private fun canPrepare(activity: MainActivity, id: String, candidate: GeckoSessionRegistry.Entry,
        owner: BrowserSurfaceView): Boolean = enabled && !blocked && supported && allowed &&
        !hasDisplayTransfer && !activity.browserPip.hasDisplayTransfer && !activity.isFinishing &&
        activity.hasWindowFocus() && owner.isShown && owner.isAttachedToWindow &&
        owner.gecko.parent === owner && owner.gecko.session === candidate.session &&
        candidate.session.isOpen && candidate.playing && candidate.media?.isActive == true &&
        !GeckoSessionRegistry.isPictureInPictureBlocked(id)

    internal fun interceptAttach(view: BrowserSurfaceView, id: String, current: GeckoSessionRegistry.Entry): Boolean {
        val held = transfer ?: return false
        if (held.lease.source.tabId != id || entry(held.lease.source) !== current) return false
        held.destination = view
        return true
    }
    internal fun returnedView(id: String, current: GeckoSessionRegistry.Entry): GeckoView? {
        val old = returned ?: return null
        if (old.lease.source.tabId != id || entry(old.lease.source) !== current) return null
        return old.gecko
    }
    internal fun completeReturnedView(view: GeckoView) {
        if (returned?.gecko !== view) return
        returned = null
        returnTimeout?.let(main::removeCallbacks); returnTimeout = null
        browser.get()?.browserPip?.externalOwnershipChanged()
        pauseReturnedAudioIfStopped()
    }
    internal fun registryChanged(id: String) {
        val current = transfer
        if (current?.lease?.source?.tabId == id) {
            if (documentEntry(current) == null) {
                reason = "source-retired"
                audio?.abandonFor(current.lease.source.session, retainSession = false)
                finish(current.lease.ticket, pause = false, requestReturn = false, retainForAttach = true)
            } else current.activity?.let {
                try { if (Build.VERSION.SDK_INT >= 33) it.setPictureInPictureParams(params(current)) }
                catch (_: RuntimeException) { reason = "params-rejected" }
            }
        }
        if (returned?.lease?.source?.tabId == id && returned?.lease?.source?.let(::entry) == null) discardReturned()
        audio?.changed(id)
        emitState()
    }
    internal fun attachActivity(activity: ExternalPictureInPictureActivity, ticket: Long): Boolean {
        trace("attach", activity, ticket)
        val current = transfer?.takeIf { it.lease.ticket == ticket && policy.owns(it.lease.source) &&
            it.gecko.session === it.lease.source.session && entry(it.lease.source) != null } ?: return false
        if (documentEntry(current) == null) {
            audio?.abandonFor(current.lease.source.session, retainSession = false)
            finish(ticket, pause = false, requestReturn = false, retainForAttach = true)
            return false
        }
        if (current.activity != null && current.activity !== activity) return false
        current.activity = activity
        return try {
            attachViewport(activity, current)
            true
        } catch (_: RuntimeException) {
            reason = "surface-attach-failed"
            finish(ticket, pause = false, requestReturn = false)
            false
        }
    }
    private fun attachViewport(activity: ExternalPictureInPictureActivity, current: Transfer) {
        val stage = VideoPipViewport(activity, current.gecko, current.lease.source.session as GeckoSession,
            current.width, current.height, current.region, current.pixels)
        current.viewport = stage
        activity.setContentView(stage)
        stage.attach()
        stage.startWatching(onInvalid = {
            if (transfer === current) {
                hideWindow(current)
                reason = "video-region-unavailable"
                // Navigation may already have replaced the document's media. Do not pause it.
                audio?.abandonFor(current.lease.source.session, retainSession = false)
                finish(current.lease.ticket, pause = false, requestReturn = false, retainForAttach = true)
            }
        }, onPixelsChanged = { pixels ->
            if (transfer === current) {
                current.rect.offset(pixels.left - current.pixels.left, pixels.top - current.pixels.top)
                current.rect.right = current.rect.left + pixels.width
                current.rect.bottom = current.rect.top + pixels.height
                current.pixels = pixels
                try { activity.setPictureInPictureParams(params(current)) }
                catch (_: RuntimeException) { reason = "params-rejected" }
            }
        })
        if (transfer !== current) return
        ImmersiveMode.set(activity.window, true)
    }
    private fun applyWindowPresentation(current: Transfer) {
        // Window alpha0 opts out of Android's BLAST draw sync. For a confirmed exit,
        // keep it at1 and submit a transparent destination buffer from this View instead.
        current.viewport?.alpha = if (current.windowPresentation.viewportVisible) 1f else 0f
        current.activity?.setPipWindowVisible(current.windowPresentation.windowVisible)
    }
    private fun hideWindow(current: Transfer) {
        if (policy.phase == ExternalPipPhase.ACTIVE && current.activity?.isInPictureInPictureMode == false)
            current.windowPresentation.update(current.lease.ticket, confirmedActive = true, inPip = false, valid = false)
        current.windowPresentation.finish()
        applyWindowPresentation(current)
    }
    internal fun modeChanged(activity: ExternalPictureInPictureActivity, ticket: Long, active: Boolean) {
        trace("mode", activity, ticket, "active=$active")
        val current = transfer?.takeIf { it.lease.ticket == ticket && it.activity === activity } ?: return
        if (!active && !activity.isInPictureInPictureMode && policy.phase == ExternalPipPhase.ACTIVE) {
            current.windowPresentation.update(ticket, confirmedActive = true, inPip = false, valid = false)
            applyWindowPresentation(current)
        }
        if (documentEntry(current) == null) {
            audio?.abandonFor(current.lease.source.session, retainSession = false)
            finish(ticket, pause = false, requestReturn = false, retainForAttach = true)
            return
        }
        if (active && activity.isInPictureInPictureMode && policy.confirm(ticket)) {
            entryTimeout?.let(main::removeCallbacks); entryTimeout = null
            documentEntry(current)?.media?.let { audio?.bind(current.lease.source, it); audio?.acquire() }
        }
        // enterPictureInPictureMode updates the Activity's local flag before this callback.
        // Only the actual mode callback confirms entry and permits the window to be shown.
        current.viewport?.setPinned(active && activity.isInPictureInPictureMode)
        current.windowPresentation.update(ticket, policy.phase == ExternalPipPhase.ACTIVE,
            active && activity.isInPictureInPictureMode, current.viewport?.valid == true)
        applyWindowPresentation(current)
        if (!active) {
            val exit = current.lifecycle.exit(policy.phase == ExternalPipPhase.ACTIVE, false, activity.isFinishing)
            trace("mode-exit-decision", activity, ticket, "exit=$exit")
            when (exit) {
                ExternalPipExit.RETURN -> expand(activity, ticket)
                ExternalPipExit.CLOSE -> finish(ticket, pause = true, requestReturn = false)
                ExternalPipExit.NONE -> Unit
            }
        }
        emitState()
    }
    internal fun activityStarted(activity: ExternalPictureInPictureActivity, ticket: Long) {
        if (transfer?.activity === activity && transfer?.lease?.ticket == ticket) transfer?.lifecycle?.onStarted()
        trace("started", activity, ticket)
    }
    internal fun activityResumed(activity: ExternalPictureInPictureActivity, ticket: Long) {
        trace("resumed", activity, ticket)
        val current = transfer?.takeIf { it.activity === activity && it.lease.ticket == ticket } ?: return
        current.lifecycle.onResumed()
        if (policy.phase == ExternalPipPhase.ACTIVE) {
            if (!activity.isInPictureInPictureMode) expand(activity, ticket)
            return
        }
        if (documentEntry(current) == null || current.viewport?.valid != true || activity.isFinishing ||
            !enabled || blocked) {
            reason = "entry-unavailable"
            finish(ticket, pause = false, requestReturn = false, retainForAttach = true, onlyPhase = policy.phase)
            return
        }
        if (!policy.requestEntry(ticket, current.lifecycle.resumed)) return
        trace("entry-request", activity, ticket)
        val accepted = try {
            activity.enterPictureInPictureMode(params(current))
        } catch (error: RuntimeException) {
            trace("entry-exception", activity, ticket, error.javaClass.simpleName)
            false
        }
        trace("entry-result", activity, ticket, "accepted=$accepted")
        if (accepted && transfer === current && policy.acceptEntry(ticket)) {
            scheduleEntryTimeout(current, ExternalPipPhase.ENTERING, CONFIRMATION_TIMEOUT_MS)
            emitState()
        }
        // A synchronous mode callback can already have confirmed or returned this lease.
        // Rejection must never cancel that confirmed lease or any replacement transfer.
        if (!accepted && transfer === current && policy.phase == ExternalPipPhase.PREPARING) {
            reason = "entry-rejected"
            finish(ticket, pause = false, requestReturn = false, retainForAttach = true, onlyPhase = ExternalPipPhase.PREPARING)
        }
    }
    internal fun activityPaused(activity: ExternalPictureInPictureActivity, ticket: Long) {
        trace("paused", activity, ticket)
        if (transfer?.activity === activity && transfer?.lease?.ticket == ticket) transfer?.lifecycle?.onPaused()
    }
    internal fun expand(activity: ExternalPictureInPictureActivity, ticket: Long) {
        trace("expand", activity, ticket)
        if (transfer?.activity !== activity || transfer?.lease?.ticket != ticket) return
        finish(ticket, pause = false, requestReturn = true, retainForAttach = true, finishActivity = false)
        try {
            activity.startActivity(Intent(activity, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
        } catch (_: RuntimeException) {
            reason = "return-launch-failed"
            emitState()
        } finally { activity.finish() }
    }
    internal fun activityStopped(activity: ExternalPictureInPictureActivity, ticket: Long) {
        trace("stopped", activity, ticket)
        if (transfer?.activity !== activity || transfer?.lease?.ticket != ticket) return
        val current = transfer ?: return
        current.lifecycle.onStopped()
        if (policy.phase == ExternalPipPhase.PREPARING || policy.phase == ExternalPipPhase.ENTERING) {
            // The enter call updates this flag before the mode callback. A hidden window
            // may stop in between; leave an admitted request to that callback or the deadline.
            if (!activity.isInPictureInPictureMode) {
                reason = "entry-stopped"
                finish(ticket, pause = false, requestReturn = false, retainForAttach = true, onlyPhase = policy.phase)
            }
            return
        }
        if (documentEntry(current) == null) {
            audio?.abandonFor(current.lease.source.session, retainSession = false)
            finish(ticket, pause = false, requestReturn = false, retainForAttach = true)
            return
        }
        val exit = current.lifecycle.exit(policy.phase == ExternalPipPhase.ACTIVE,
            activity.isInPictureInPictureMode, activity.isFinishing)
        trace("stop-decision", activity, ticket, "exit=$exit")
        if (exit == ExternalPipExit.CLOSE)
            finish(ticket, pause = true, requestReturn = false)
        else audio?.pauseFor(current.lease.source.session)
    }
    internal fun activityDestroyed(activity: ExternalPictureInPictureActivity, ticket: Long) {
        trace("destroyed", activity, ticket)
        if (transfer?.activity === activity && transfer?.lease?.ticket == ticket)
            finish(ticket, pause = policy.phase == ExternalPipPhase.ACTIVE, requestReturn = false,
                retainForAttach = policy.phase != ExternalPipPhase.ACTIVE, finishActivity = false)
    }

    private fun finish(ticket: Long, pause: Boolean, requestReturn: Boolean, retainForAttach: Boolean = false,
        finishActivity: Boolean = true, onlyPhase: ExternalPipPhase? = null) {
        trace("finish-request", ticket = ticket,
            detail = "pause=$pause return=$requestReturn retain=$retainForAttach finishActivity=$finishActivity onlyPhase=$onlyPhase")
        val current = transfer?.takeIf { it.lease.ticket == ticket } ?: return
        val exiting = policy.phase == ExternalPipPhase.ACTIVE && current.activity?.isInPictureInPictureMode == false
        if ((if (onlyPhase != null) policy.timeout(ticket, onlyPhase) else policy.finish(ticket, requestReturn)) == null) return
        trace("finish-accepted", ticket = ticket, detail = "pause=$pause return=$requestReturn")
        if (exiting) current.windowPresentation.update(ticket, confirmedActive = true, inPip = false, valid = false)
        transfer = null
        entryTimeout?.let(main::removeCallbacks); entryTimeout = null
        if (documentEntry(current) == null) audio?.abandonFor(current.lease.source.session, retainSession = false)
        else if (pause) {
            audio?.pauseFor(current.lease.source.session)
            documentEntry(current)?.media?.pause()
        }
        cleanupReceiver()
        hideWindow(current)
        (current.gecko as? StableGeckoView)?.beginReturnedSurfaceTrace(ticket, current.lease.source.tabId, current.documentGeneration)
        current.viewport?.dispose()
        current.viewport = null
        (current.gecko.parent as? ViewGroup)?.removeView(current.gecko)
        val live = entry(current.lease.source)
        if (live != null) {
            returned = current
            val destination = listOfNotNull(current.destination, current.origin).firstOrNull {
                it.isAttachedToWindow && it.tabId == current.lease.source.tabId
            }
            if (destination != null) GeckoSessionRegistry.attach(destination, current.lease.source.tabId, live.url)
            if (returned === current) {
                if (retainForAttach) {
                    returnTimeout = Runnable { if (returned === current) discardReturned() }
                        .also { main.postDelayed(it, RETURN_TIMEOUT_MS) }
                } else discardReturned()
            }
        } else if (current.gecko.session === current.lease.source.session) current.gecko.releaseSession()
        if (finishActivity) current.activity?.finish()
        browser.get()?.browserPip?.externalOwnershipChanged()
        GeckoSessionRegistry.externalDisplayChanged(current.lease.source.tabId)
        emitState()
    }
    private fun discardReturned() {
        val old = returned ?: return
        returned = null
        returnTimeout?.let(main::removeCallbacks); returnTimeout = null
        if (old.gecko.session === old.lease.source.session) old.gecko.releaseSession()
        GeckoSessionRegistry.externalDisplayChanged(old.lease.source.tabId)
        browser.get()?.browserPip?.externalOwnershipChanged()
        pauseReturnedAudioIfStopped()
    }
    private fun params(current: Transfer): PictureInPictureParams {
        val entry = entry(current.lease.source)
        val ratio = pictureInPictureAspectRatio(current.pixels.width, current.pixels.height)!!
        // A source hint makes Android overlay the Main task snapshot during launch-into-PiP.
        // Omit it so the system transition cannot expose the former page around our live crop.
        return PictureInPictureParams.Builder().setAspectRatio(Rational(ratio.first, ratio.second))
            .setActions(remoteActions(current))
            .setAutoEnterEnabled(false).setSeamlessResizeEnabled(false)
            .setTitle(entry?.mediaTitle ?: entry?.title ?: "Yeoyu").build()
    }
    private fun actionName() = "${app?.packageName}.EXTERNAL_PIP.$nonce"
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val current = transfer ?: return
            if (intent?.action != actionName() || intent.getStringExtra("nonce") != nonce ||
                intent.getLongExtra("ticket", -1) != current.lease.ticket || documentEntry(current) == null) return
            trace("remote-action", ticket = current.lease.ticket, detail = intent.getStringExtra("control"))
            when (intent.getStringExtra("control")) { "play" -> audio?.play(); "pause" -> audio?.pause() }
        }
    }
    private fun registerReceiver() {
        if (receiverRegistered) return
        app?.registerReceiver(receiver, IntentFilter(actionName()), Context.RECEIVER_NOT_EXPORTED)
        receiverRegistered = true
    }
    private fun cleanupReceiver() {
        actions.values.forEach { it.cancel() }; actions.clear()
        if (receiverRegistered) app?.unregisterReceiver(receiver)
        receiverRegistered = false
    }
    private fun remoteActions(current: Transfer): List<RemoteAction> {
        val context = app ?: return emptyList()
        val entry = documentEntry(current) ?: return emptyList()
        val name = if (entry.playing) "pause" else "play"
        val label = if (entry.playing) "Pause" else "Play"
        val icon = if (entry.playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        val pending = actions.getOrPut(name) {
            PendingIntent.getBroadcast(context, (current.lease.ticket * 2 + if (name == "play") 1 else 0).toInt(),
                Intent(actionName()).setPackage(context.packageName).putExtra("nonce", nonce)
                    .putExtra("ticket", current.lease.ticket).putExtra("control", name),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        return listOf(RemoteAction(Icon.createWithResource(context, icon), label, label, pending))
    }
    private fun state() = JSONObject().apply {
        put("supported", supported); put("allowed", allowed)
        put("active", policy.phase == ExternalPipPhase.ACTIVE)
        put("transitioning", policy.phase == ExternalPipPhase.PREPARING || policy.phase == ExternalPipPhase.ENTERING)
        put("tabId", policy.lease?.source?.tabId ?: JSONObject.NULL)
        reason?.let { put("reason", it) }
        policy.returning?.let { put("returnTabId", it.tabId); put("returnToken", it.token) }
    }
    private fun emitState() {
        val state = state()
        val signature = state.toString()
        if (lastState == signature) return
        lastState = signature
        check(sequence < 9_007_199_254_740_991L)
        sequence++
        GeckoSessionRegistry.emit?.invoke("BrowserExternalPictureInPicture", Arguments.createMap().apply {
            putBoolean("supported", supported); putBoolean("allowed", allowed)
            putBoolean("active", policy.phase == ExternalPipPhase.ACTIVE)
            putBoolean("transitioning", policy.phase == ExternalPipPhase.PREPARING || policy.phase == ExternalPipPhase.ENTERING)
            putString("tabId", policy.lease?.source?.tabId); putDouble("sequence", sequence.toDouble())
            reason?.let { putString("reason", it) }
            policy.returning?.let { putString("returnTabId", it.tabId); putDouble("returnToken", it.token.toDouble()) }
        })
    }
    fun shutdown() {
        preparation.cancel()
        transfer?.let { finish(it.lease.ticket, pause = true, requestReturn = false) }
        discardReturned()
        policy.returning?.let { policy.acknowledge(it.token) }
        audio?.clear()
        enabled = false; blocked = true
        emitState()
    }
}
