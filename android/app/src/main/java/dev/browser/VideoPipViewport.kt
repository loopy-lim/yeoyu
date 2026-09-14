package dev.browser

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.FrameLayout
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView

/** Clip and transform the existing surface. Its measured viewport never becomes the PiP size. */
internal class VideoPipViewport(
    context: Context,
    private val gecko: GeckoView,
    private val session: GeckoSession,
    private val sourceWidth: Int,
    private val sourceHeight: Int,
    private val initial: VideoRegion,
    initialPixels: VideoPixelRect,
) : FrameLayout(context) {
    private val originalX = gecko.translationX
    private val originalY = gecko.translationY
    private val originalAccessibility = gecko.importantForAccessibility
    private val crop = FrameLayout(context).apply {
        clipChildren = true
        clipToPadding = true
        pivotX = 0f
        pivotY = 0f
    }
    private val mask = View(context).apply { setBackgroundColor(Color.BLACK) }
    private val presentation = VideoPipPresentation(initial)
    private var disposed = false
    private var attached = false
    private var watchSubscription: VideoRegionWatchSubscription? = null
    private var pinned = false
    private var frameDeadline: Runnable? = null
    private var onInvalid: (() -> Unit)? = null
    private class ExitProbe(val activity: Activity, val ticket: Long, val document: Long,
        val deadline: Long, val observer: ViewTreeObserver) {
        val handler = Handler(Looper.getMainLooper())
        var events = 0
        var preDraws = 0
        var draws = 0
        var preDraw: ViewTreeObserver.OnPreDrawListener? = null
        var draw: ViewTreeObserver.OnDrawListener? = null
        var expiry: Runnable? = null
        val commits = mutableListOf<Runnable>()
        val deliveries = mutableListOf<Runnable>()
    }
    private var exitProbe: ExitProbe? = null
    private var exitProbeStarted = false

    /** Observation only: one exit, at most24 events/750ms, never a rendering gate. */
    internal fun beginExitProbe(activity: Activity, ticket: Long, document: Long) {
        if (context.packageName != "com.workspacebrowser.acceptance" || disposed || exitProbeStarted) return
        exitProbeStarted = true
        val probe = ExitProbe(activity, ticket, document, SystemClock.uptimeMillis() + 750L,
            activity.window.decorView.viewTreeObserver)
        exitProbe = probe
        probe.preDraw = ViewTreeObserver.OnPreDrawListener {
            if (probeCurrent(probe) && probe.preDraws < 2) {
                val preDraw = ++probe.preDraws
                val state = exitProbeState(probe)
                recordExitProbe(probe, "pre-draw", "preDraw=$preDraw", state)
                registerExitCommit(probe, preDraw, state)
            }
            true
        }
        probe.draw = ViewTreeObserver.OnDrawListener {
            if (probeCurrent(probe) && probe.draws < 2)
                recordExitProbe(probe, "draw", "draw=${++probe.draws}")
        }
        if (probe.observer.isAlive) {
            probe.observer.addOnPreDrawListener(probe.preDraw)
            probe.observer.addOnDrawListener(probe.draw)
        }
        probe.expiry = Runnable { if (exitProbe === probe) stopExitProbe() }
            .also { probe.handler.postDelayed(it, 750L) }
    }

    private fun registerExitCommit(probe: ExitProbe, preDraw: Int, state: String) {
        if (Build.VERSION.SDK_INT < 29 || !isHardwareAccelerated || !probe.observer.isAlive) return
        // Register before draw: ViewRootImpl captures callbacks before dispatchOnDraw.
        // Submission is not presentation; this snapshot belongs to registration, not display.
        val delivery = object : Runnable {
            @Volatile var committedAt = 0L
            override fun run() {
                recordExitProbe(probe, "frame-commit",
                    "registeredPreDraw=$preDraw committedAt=$committedAt stateAtRegistration=true presentation=false", state)
            }
        }
        val commit = Runnable {
            delivery.committedAt = SystemClock.uptimeMillis()
            probe.handler.post(delivery)
        }
        probe.deliveries.add(delivery)
        probe.commits.add(commit)
        probe.observer.registerFrameCommitCallback(commit)
    }

    internal fun traceExitProbe(event: String, detail: String = "") {
        exitProbe?.let { recordExitProbe(it, event, detail) }
    }

    private fun probeCurrent(probe: ExitProbe): Boolean = exitProbe === probe && !disposed &&
        SystemClock.uptimeMillis() < probe.deadline && probe.events < 24

    private fun recordExitProbe(probe: ExitProbe, event: String, detail: String, state: String? = null) {
        if (!probeCurrent(probe)) return
        Log.i("YeoyuPipTrace", "uptime=${SystemClock.uptimeMillis()} event=exit-probe-$event" +
            " n=${++probe.events} ticket=${probe.ticket} session=${System.identityHashCode(session)}" +
            " document=${probe.document} ${state ?: exitProbeState(probe)} detail=$detail")
    }

    private fun exitProbeState(probe: ExitProbe): String = try {
        val activity = probe.activity
        val decor = activity.window.decorView
        val config = resources.configuration
        val bounds = if (Build.VERSION.SDK_INT >= 30) activity.windowManager.currentWindowMetrics.bounds else null
        "pip=${activity.isInPictureInPictureMode} alpha=${activity.window.attributes.alpha}" +
            " config=${config.screenWidthDp}x${config.screenHeightDp} bounds=$bounds" +
            " decor=${decor.width}x${decor.height} host=${width}x$height mask=${mask.visibility}" +
            " visible=${presentation.visible} ready=${presentation.ready} readiness=${presentation.readinessReason}" +
            " crop=${crop.width}x${crop.height} clip=${crop.clipBounds} pixels=$pixels" +
            " scale=${crop.scaleX},${crop.scaleY} translate=${crop.translationX},${crop.translationY}" +
            " gecko=${gecko.width}x${gecko.height} source=${sourceWidth}x$sourceHeight" +
            " sameSession=${gecko.session === session}" +
            " layout=$isLayoutRequested,${crop.isLayoutRequested},${gecko.isLayoutRequested}"
    } catch (_: RuntimeException) { "state=unavailable" }

    private fun stopExitProbe() {
        val probe = exitProbe ?: return
        exitProbe = null
        probe.expiry?.let(probe.handler::removeCallbacks)
        probe.deliveries.forEach(probe.handler::removeCallbacks)
        if (probe.observer.isAlive) {
            probe.preDraw?.let(probe.observer::removeOnPreDrawListener)
            probe.draw?.let(probe.observer::removeOnDrawListener)
            if (Build.VERSION.SDK_INT >= 29) probe.commits.forEach { probe.observer.unregisterFrameCommitCallback(it) }
        }
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        traceExitProbe("size", "old=${oldw}x$oldh new=${w}x$h")
        super.onSizeChanged(w, h, oldw, oldh)
    }

    override fun onDetachedFromWindow() {
        stopExitProbe()
        super.onDetachedFromWindow()
    }
    private fun trace(event: String, detail: String = "") {
        if (context.packageName != "com.workspacebrowser.acceptance") return
        Log.i("YeoyuPipTrace", "uptime=${SystemClock.uptimeMillis()} event=viewport-$event" +
            " session=${System.identityHashCode(session)} ready=${presentation.ready}" +
            " awaitingPinnedFrames=${presentation.awaitingPinnedFrames} readiness=${presentation.readinessReason}" +
            " valid=$valid source=${sourceWidth}x$sourceHeight gecko=${gecko.width}x${gecko.height}" +
            " crop=${crop.width}x${crop.height} host=${width}x$height detail=$detail")
    }
    val valid: Boolean get() = presentation.valid
    var pixels: VideoPixelRect = initialPixels
        private set
    private val textureObserver = object : GeckoTextureObserver {
        override fun onTextureUpdated() {
            if (disposed || !valid || gecko.session !== session || !isAttachedToWindow ||
                gecko.width != sourceWidth || gecko.height != sourceHeight ||
                crop.width != pixels.width || crop.height != pixels.height ||
                isLayoutRequested || crop.isLayoutRequested || gecko.isLayoutRequested) return
            presentation.textureUpdated()
            updateVisibility()
        }
        override fun onTextureInvalidated() {
            if (disposed) return
            presentation.textureInvalidated()
            updateVisibility()
        }
    }

    init {
        setBackgroundColor(Color.BLACK)
        clipChildren = true
        addView(crop, LayoutParams(initialPixels.width, initialPixels.height))
        // Keep TextureView visible so Android can latch frames underneath the opaque mask.
        addView(mask, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> fit() }
    }

    /** The coordinator records this stage before any View mutation, so failure can always unwind it. */
    fun attach() {
        check(!disposed && !attached)
        attached = true
        (gecko.parent as? ViewGroup)?.removeView(gecko)
        gecko.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        // MATCH_PARENT here would resize Gecko to the ROI and alter the page layout.
        crop.addView(gecko, LayoutParams(sourceWidth, sourceHeight))
        applyPixels(pixels)
        val stable = gecko as? StableGeckoView ?: error("Video PiP requires the texture backend")
        check(stable.pipTextureObserver == null)
        stable.pipTextureObserver = textureObserver
    }

    fun startWatching(onInvalid: () -> Unit, onPixelsChanged: (VideoPixelRect) -> Unit) {
        if (disposed || watchSubscription != null) return
        this.onInvalid = onInvalid
        updateVisibility()
        val subscription = BrowserVideoRegions.watch(session, initial) { region ->
            if (disposed || !valid) return@watch
            when (presentation.update(region, gecko.session === session && session.isOpen)) {
                VideoPipRegionUpdate.IGNORE -> return@watch
                VideoPipRegionUpdate.INVALID -> {
                    trace("invalid-watch", "region=${region != null} sameSession=${gecko.session === session}" +
                        " sameDocument=${region?.documentToken == initial.documentToken}" +
                        " sameVideo=${region?.videoToken == initial.videoToken}")
                    hideInvalid()
                    onInvalid()
                    return@watch
                }
                VideoPipRegionUpdate.APPLY -> Unit
            }
            // A newer crop must not reveal the previous document texture at its new coordinates.
            updateVisibility()
            val next = region?.let { pixelsFor(session, it, sourceWidth, sourceHeight) }
            if (next == null) {
                trace("invalid-pixels")
                hideInvalid()
                onInvalid()
                return@watch
            }
            if (next != pixels) {
                applyPixels(next)
                onPixelsChanged(next)
            }
            updateVisibility()
        }
        // A subscription can immediately invalidate and dispose this stage.
        if (disposed || !valid) subscription.cancel() else {
            watchSubscription = subscription
            subscription.setPinned(pinned)
        }
    }

    fun setPinned(value: Boolean) {
        pinned = value
        presentation.pinned(value)
        watchSubscription?.setPinned(value)
        trace("pinned", "active=$value")
        updateVisibility()
    }

    private fun updateVisibility() {
        traceExitProbe("mask-before")
        mask.visibility = if (presentation.visible && !disposed) View.INVISIBLE else View.VISIBLE
        traceExitProbe("mask-after")
        if (!presentation.awaitingPinnedFrames || disposed) {
            frameDeadline?.let(::removeCallbacks)
            frameDeadline = null
        } else if (onInvalid != null && frameDeadline == null) {
            // The coordinator bounds entry; frame latching gets its budget after OS confirmation.
            trace("frame-deadline-armed")
            frameDeadline = Runnable {
                frameDeadline = null
                if (!disposed && presentation.awaitingPinnedFrames) {
                    trace("frame-deadline", "layout=$isLayoutRequested cropLayout=${crop.isLayoutRequested}" +
                        " geckoLayout=${gecko.isLayoutRequested}")
                    hideInvalid()
                    onInvalid?.invoke()
                }
            }.also { postDelayed(it, 1_000L) }
        }
    }

    fun hideInvalid() {
        presentation.invalidate()
        updateVisibility()
        val subscription = watchSubscription
        watchSubscription = null
        subscription?.cancel()
    }

    private fun applyPixels(next: VideoPixelRect) {
        if (next != pixels) {
            presentation.textureInvalidated()
            updateVisibility()
        }
        pixels = next
        crop.clipBounds = Rect(0, 0, next.width, next.height)
        crop.layoutParams = LayoutParams(next.width, next.height)
        gecko.translationX = -next.left.toFloat()
        gecko.translationY = -next.top.toFloat()
        fit()
    }

    private fun fit() {
        if (disposed) return
        traceExitProbe("fit-before")
        pictureInPictureViewportFit(pixels.width, pixels.height, width, height)?.let {
            crop.scaleX = it.scale.toFloat()
            crop.scaleY = it.scale.toFloat()
            crop.translationX = it.offsetX.toFloat()
            crop.translationY = it.offsetY.toFloat()
        }
        traceExitProbe("fit-after")
    }

    fun dispose() {
        if (disposed) return
        traceExitProbe("dispose")
        stopExitProbe()
        disposed = true
        hideInvalid()
        onInvalid = null
        (gecko as? StableGeckoView)?.let { if (it.pipTextureObserver === textureObserver) it.pipTextureObserver = null }
        if (attached && (gecko.parent === crop || gecko.parent == null)) {
            if (gecko.parent === crop) crop.removeView(gecko)
            gecko.translationX = originalX
            gecko.translationY = originalY
            gecko.importantForAccessibility = originalAccessibility
        }
    }

    companion object {
        fun pixelsFor(session: GeckoSession, region: VideoRegion, width: Int, height: Int): VideoPixelRect? {
            if (!session.isOpen) return null
            return try {
                val matrix = Matrix()
                session.getClientToSurfaceMatrix(matrix)
                val values = FloatArray(9)
                matrix.getValues(values)
                if (values.any { !it.isFinite() } || values[Matrix.MSKEW_X] != 0f ||
                    values[Matrix.MSKEW_Y] != 0f || values[Matrix.MPERSP_0] != 0f ||
                    values[Matrix.MPERSP_1] != 0f || values[Matrix.MPERSP_2] != 1f) null
                else videoRegionToPixels(region, width, height, values[Matrix.MSCALE_X].toDouble(),
                    values[Matrix.MSCALE_Y].toDouble(), values[Matrix.MTRANS_X].toDouble(), values[Matrix.MTRANS_Y].toDouble())
                    .also { if (it == null) BrowserVideoRegions.tracePixelRejection(session, region, width, height, values) }
            } catch (_: RuntimeException) { null }
        }

        fun sourceRect(gecko: GeckoView, pixels: VideoPixelRect): Rect {
            val position = IntArray(2)
            gecko.getLocationOnScreen(position)
            return Rect(position[0] + pixels.left, position[1] + pixels.top,
                position[0] + pixels.right, position[1] + pixels.bottom)
        }
    }
}
