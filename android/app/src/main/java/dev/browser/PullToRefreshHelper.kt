package dev.browser

import android.content.Context
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.drawable.Drawable
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.ViewConfiguration
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.swiperefreshlayout.widget.CircularProgressDrawable
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.PanZoomController
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Coordinates touch interception and rendering for pull-to-refresh on [BrowserSurfaceView]
 * without wrapping [StableGeckoView] in an intermediate container, preserving direct
 * `gecko.parent === host` surface invariants.
 */
internal class PullToRefreshHelper(
    private val host: BrowserSurfaceView,
    private val onTriggerRefresh: () -> Unit,
) {
    private enum class GesturePhase {
        IDLE,
        WAITING_DOWN,
        READY_FOR_FIRST_MOVE,
        WAITING_MOVE,
        PULLING,
        REJECTED,
    }

    private val density = host.resources.displayMetrics.density
    private val touchSlop = ViewConfiguration.get(host.context).scaledTouchSlop.toFloat()
    private val triggerPx = 72f * density
    private val maxDragPx = 112f * density
    private val restingOffsetPx = 54f * density
    private val badgeSizePx = (40f * density).roundToInt()
    private val badgeRadius = badgeSizePx / 2f

    private val mainHandler = Handler(Looper.getMainLooper())
    private var safetyTimeout: Runnable? = null

    private var phase = GesturePhase.IDLE
    private var gestureToken = 0L
    private var activePointerId = MotionEvent.INVALID_POINTER_ID
    private var downX = 0f
    private var downY = 0f
    private var pullAnchorY = 0f
    private var latestMoveY = 0f
    private var pullDistancePx = 0f

    private var wantDetailOnDown = false
    private var wantDetailOnMove = false

    private var propDisabled = false
    private var currentScrollY = 0
    private var currentLoading = false
    private var currentUrl = "about:blank"
    private var isRefreshing = false
    private var refreshObservedStart = false

    private val isDarkMode: Boolean
        get() = (host.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES

    private var surfaceColor: Int = if (isDarkMode) Color.parseColor("#27272E") else Color.WHITE
    private var accentColor: Int = Color.parseColor("#5B5CE6")

    private val shadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.argb(38, 0, 0, 0)
    }
    private val badgePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = surfaceColor
    }
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = density
        color = Color.argb(26, 0, 0, 0)
    }

    private val progressDrawable = CircularProgressDrawable(host.context).apply {
        setStyle(CircularProgressDrawable.DEFAULT)
        setColorSchemeColors(accentColor)
        callback = host
    }

    fun ownsDrawable(who: Drawable): Boolean = who === progressDrawable

    fun setDisabled(disabled: Boolean) {
        if (propDisabled == disabled) return
        propDisabled = disabled
        if (disabled) {
            cancelActivePull()
        }
    }

    fun setColors(accent: String?, surface: String?) {
        parseColorOrNull(accent)?.let {
            accentColor = it
            progressDrawable.setColorSchemeColors(it)
            host.invalidate()
        }
        parseColorOrNull(surface)?.let {
            surfaceColor = it
            badgePaint.color = it
            host.invalidate()
        }
    }

    fun updateUrl(url: String) {
        currentUrl = url
    }

    fun updateScrollY(scrollY: Int) {
        currentScrollY = scrollY
        if (scrollY > 0 && phase != GesturePhase.IDLE && phase != GesturePhase.REJECTED) {
            cancelActivePull()
        }
    }

    fun updateLoading(loading: Boolean) {
        val prev = currentLoading
        currentLoading = loading
        if (isRefreshing) {
            if (loading) {
                refreshObservedStart = true
            } else if (prev || refreshObservedStart) {
                finishRefreshing()
            }
        }
    }

    fun reset() {
        cancelActivePull()
        finishRefreshing()
        currentScrollY = 0
        currentLoading = false
    }

    fun shouldRequestDetailResult(event: MotionEvent): Boolean {
        return when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                val want = wantDetailOnDown
                wantDetailOnDown = false
                want
            }
            MotionEvent.ACTION_MOVE -> {
                val want = wantDetailOnMove
                wantDetailOnMove = false
                want
            }
            else -> false
        }
    }

    fun onDetailResult(actionMasked: Int, result: GeckoResult<PanZoomController.InputResultDetail>) {
        val token = gestureToken
        result.accept(
            { detail ->
                if (token != gestureToken) return@accept
                if (detail == null) {
                    phase = GesturePhase.REJECTED
                    return@accept
                }
                val allowed = PullToRefreshPolicy.canOverscrollTop(
                    detail.handledResult(),
                    detail.scrollableDirections(),
                    detail.overscrollDirections(),
                )
                if (!allowed || !PullToRefreshPolicy.canBeginPull(environment())) {
                    phase = GesturePhase.REJECTED
                    return@accept
                }
                when (actionMasked) {
                    MotionEvent.ACTION_DOWN -> {
                        if (phase == GesturePhase.WAITING_DOWN) {
                            phase = GesturePhase.READY_FOR_FIRST_MOVE
                        }
                    }
                    MotionEvent.ACTION_MOVE -> {
                        if (phase == GesturePhase.WAITING_MOVE) {
                            phase = GesturePhase.PULLING
                            pullAnchorY = latestMoveY
                            pullDistancePx = 0f
                            host.parent?.requestDisallowInterceptTouchEvent(true)
                        }
                    }
                }
            },
            {
                if (token == gestureToken) {
                    phase = GesturePhase.REJECTED
                }
            },
        )
    }

    fun onInterceptTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                gestureToken++
                wantDetailOnDown = false
                wantDetailOnMove = false
                pullDistancePx = 0f
                activePointerId = event.getPointerId(0)
                downX = event.x
                downY = event.y
                latestMoveY = event.y
                if (PullToRefreshPolicy.canBeginPull(environment())) {
                    phase = GesturePhase.WAITING_DOWN
                    wantDetailOnDown = true
                } else {
                    phase = GesturePhase.REJECTED
                }
                return false
            }

            MotionEvent.ACTION_POINTER_DOWN -> {
                cancelActivePull()
                phase = GesturePhase.REJECTED
                return false
            }

            MotionEvent.ACTION_MOVE -> {
                if (event.pointerCount > 1 || activePointerId == MotionEvent.INVALID_POINTER_ID) {
                    cancelActivePull()
                    phase = GesturePhase.REJECTED
                    return false
                }
                val index = event.findPointerIndex(activePointerId)
                if (index < 0) {
                    cancelActivePull()
                    phase = GesturePhase.REJECTED
                    return false
                }
                val x = event.getX(index)
                val y = event.getY(index)
                latestMoveY = y
                val dx = x - downX
                val dy = y - downY

                return when (phase) {
                    GesturePhase.PULLING -> true
                    GesturePhase.WAITING_DOWN -> {
                        if (dy < -touchSlop || (abs(dx) > touchSlop && abs(dx) > abs(dy))) {
                            phase = GesturePhase.REJECTED
                        }
                        false
                    }
                    GesturePhase.READY_FOR_FIRST_MOVE -> {
                        if (dy < -touchSlop || (abs(dx) > touchSlop && abs(dx) > abs(dy))) {
                            phase = GesturePhase.REJECTED
                            false
                        } else if (dy > touchSlop && abs(dy) > abs(dx)) {
                            if (!PullToRefreshPolicy.canBeginPull(environment())) {
                                phase = GesturePhase.REJECTED
                            } else {
                                phase = GesturePhase.WAITING_MOVE
                                wantDetailOnMove = true
                            }
                            false
                        } else {
                            false
                        }
                    }
                    GesturePhase.WAITING_MOVE, GesturePhase.REJECTED, GesturePhase.IDLE -> false
                }
            }

            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                if (phase != GesturePhase.PULLING) {
                    phase = GesturePhase.IDLE
                    wantDetailOnDown = false
                    wantDetailOnMove = false
                    activePointerId = MotionEvent.INVALID_POINTER_ID
                    host.parent?.requestDisallowInterceptTouchEvent(false)
                }
                return phase == GesturePhase.PULLING
            }
        }
        return false
    }

    fun onTouchEvent(event: MotionEvent): Boolean {
        if (phase != GesturePhase.PULLING) return false

        when (event.actionMasked) {
            MotionEvent.ACTION_POINTER_DOWN -> {
                cancelActivePull()
                phase = GesturePhase.REJECTED
                return false
            }

            MotionEvent.ACTION_MOVE -> {
                if (event.pointerCount > 1) {
                    cancelActivePull()
                    phase = GesturePhase.REJECTED
                    return false
                }
                val index = event.findPointerIndex(activePointerId)
                if (index < 0) {
                    cancelActivePull()
                    return true
                }
                val y = event.getY(index)
                val rawDy = (y - pullAnchorY).coerceAtLeast(0f)
                pullDistancePx = PullToRefreshPolicy.computeDampedDrag(rawDy, triggerPx, maxDragPx)
                host.invalidate()
                return true
            }

            MotionEvent.ACTION_UP -> {
                val shouldTrigger = pullDistancePx >= triggerPx &&
                    PullToRefreshPolicy.canBeginPull(environment())
                phase = GesturePhase.IDLE
                activePointerId = MotionEvent.INVALID_POINTER_ID
                host.parent?.requestDisallowInterceptTouchEvent(false)
                if (shouldTrigger) {
                    startRefreshing()
                    onTriggerRefresh()
                } else {
                    pullDistancePx = 0f
                    host.invalidate()
                }
                return true
            }

            MotionEvent.ACTION_CANCEL -> {
                cancelActivePull()
                return true
            }
        }
        return true
    }

    fun draw(canvas: Canvas) {
        if (!isRefreshing && pullDistancePx <= 0.5f) return
        val progress = if (isRefreshing) 1f else (pullDistancePx / triggerPx).coerceIn(0f, 1f)
        val centerX = host.width / 2f
        val offsetY = if (isRefreshing) {
            restingOffsetPx
        } else {
            -badgeRadius + pullDistancePx * 0.85f
        }
        val scale = if (isRefreshing) 1f else (0.55f + 0.45f * progress).coerceIn(0.55f, 1f)
        val alphaInt = if (isRefreshing) 255 else (min(1f, progress * 1.4f) * 255f).roundToInt()

        canvas.save()
        canvas.translate(centerX, offsetY)
        canvas.scale(scale, scale)

        shadowPaint.alpha = ((alphaInt / 255f) * 38f).roundToInt()
        canvas.drawCircle(0f, 2f * density, badgeRadius + 1.5f * density, shadowPaint)

        badgePaint.alpha = alphaInt
        canvas.drawCircle(0f, 0f, badgeRadius, badgePaint)

        borderPaint.alpha = ((alphaInt / 255f) * 26f).roundToInt()
        canvas.drawCircle(0f, 0f, badgeRadius, borderPaint)

        val inset = (badgeRadius * 0.85f).roundToInt()
        progressDrawable.setBounds(-inset, -inset, inset, inset)
        progressDrawable.alpha = alphaInt
        if (!isRefreshing) {
            progressDrawable.arrowEnabled = true
            progressDrawable.arrowScale = min(1f, progress)
            progressDrawable.setStartEndTrim(0f, min(0.8f, progress * 0.8f))
            progressDrawable.progressRotation = progress * 0.45f
        } else {
            progressDrawable.arrowEnabled = false
        }
        progressDrawable.draw(canvas)
        canvas.restore()
    }

    private fun startRefreshing() {
        isRefreshing = true
        refreshObservedStart = false
        pullDistancePx = restingOffsetPx
        progressDrawable.arrowEnabled = false
        progressDrawable.start()
        scheduleSafetyTimeout()
        host.invalidate()
    }

    private fun finishRefreshing() {
        safetyTimeout?.let(mainHandler::removeCallbacks)
        safetyTimeout = null
        if (!isRefreshing && !progressDrawable.isRunning) return
        isRefreshing = false
        refreshObservedStart = false
        pullDistancePx = 0f
        progressDrawable.stop()
        host.invalidate()
    }

    private fun scheduleSafetyTimeout() {
        safetyTimeout?.let(mainHandler::removeCallbacks)
        val timeout = Runnable { finishRefreshing() }
        safetyTimeout = timeout
        mainHandler.postDelayed(timeout, REFRESH_SAFETY_TIMEOUT_MS)
    }

    internal fun cancelActivePull() {
        gestureToken++
        wantDetailOnDown = false
        wantDetailOnMove = false
        activePointerId = MotionEvent.INVALID_POINTER_ID
        host.parent?.requestDisallowInterceptTouchEvent(false)
        if (phase != GesturePhase.IDLE) {
            phase = GesturePhase.IDLE
        }
        if (pullDistancePx != 0f) {
            pullDistancePx = 0f
            host.invalidate()
        }
    }

    private fun environment(): PullToRefreshEnvironment {
        val imeVisible = ViewCompat.getRootWindowInsets(host)
            ?.isVisible(WindowInsetsCompat.Type.ime()) == true
        val session = host.gecko.session
        val resolvedUrl = GeckoSessionRegistry.entry(host.tabId)?.url
            ?.takeIf { it.isNotEmpty() }
            ?: currentUrl
        return PullToRefreshEnvironment(
            propDisabled = propDisabled,
            imeVisible = imeVisible,
            isOnline = isNetworkOnline(host.context),
            isLoading = currentLoading,
            isRefreshing = isRefreshing,
            resizeCoverActive = host.isResizeCoverDisplayed,
            sessionOpen = session?.isOpen == true,
            scrollY = currentScrollY,
            url = resolvedUrl,
        )
    }

    private fun isNetworkOnline(context: Context): Boolean {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return true
        val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun parseColorOrNull(raw: String?): Int? {
        if (raw.isNullOrBlank()) return null
        return try {
            Color.parseColor(raw.trim())
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    companion object {
        private const val REFRESH_SAFETY_TIMEOUT_MS = 12_000L
    }
}
