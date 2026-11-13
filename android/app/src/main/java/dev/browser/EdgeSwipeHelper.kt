package dev.browser

import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.ViewConfiguration
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.PanZoomController
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Coordinates edge-swipe Back/Forward touch interception and indicator drawing on
 * [BrowserSurfaceView] without wrapping [StableGeckoView], preserving `gecko.parent === host`.
 */
internal class EdgeSwipeHelper(
    private val host: BrowserSurfaceView,
    private val onBeginDragging: () -> Unit,
    private val onTriggerNavigate: (EdgeSwipeDirection) -> Unit,
) {
    private enum class GesturePhase {
        IDLE,
        WAITING_DOWN,
        READY_FOR_FIRST_MOVE,
        WAITING_MOVE,
        DRAGGING,
        REJECTED,
    }

    private val density = host.resources.displayMetrics.density
    private val touchSlop = ViewConfiguration.get(host.context).scaledTouchSlop.toFloat()
    private val triggerDistancePx = 84f * density
    private val minFlingDistancePx = 40f * density
    private val minFlingVelocityPxPerSec = 520f * density
    private val pillTriggerOffsetPx = 42f * density
    private val maxPillOffsetPx = 56f * density
    private val pillRadius = 18f * density

    private var phase = GesturePhase.IDLE
    private var direction: EdgeSwipeDirection? = null
    private var gestureToken = 0L
    private var activePointerId = MotionEvent.INVALID_POINTER_ID
    private var downX = 0f
    private var downY = 0f
    private var dragAnchorX = 0f
    private var latestMoveX = 0f
    private var dragDistancePx = 0f

    private var wantDetailOnDown = false
    private var wantDetailOnMove = false
    private var velocityTracker: VelocityTracker? = null

    private var propDisabled = false
    private var canGoBack = false
    private var canGoForward = false

    private val locationOnScreen = IntArray(2)

    private val isDarkMode: Boolean
        get() = (host.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES

    private var surfaceColor: Int = if (isDarkMode) Color.parseColor("#27272E") else Color.WHITE
    private var accentColor: Int = Color.parseColor("#5B5CE6")

    private val shadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.argb(44, 0, 0, 0)
    }
    private val pillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = surfaceColor
    }
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = density
        color = Color.argb(30, 0, 0, 0)
    }
    private val arrowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        strokeWidth = 2.2f * density
        color = accentColor
    }
    private val arrowPath = Path()

    val isDragging: Boolean
        get() = phase == GesturePhase.DRAGGING

    fun setDisabled(disabled: Boolean) {
        if (propDisabled == disabled) return
        propDisabled = disabled
        if (disabled) cancelActiveSwipe()
    }

    fun setCanGoBack(enabled: Boolean) {
        if (canGoBack == enabled) return
        canGoBack = enabled
        if (!enabled && direction == EdgeSwipeDirection.BACK) cancelActiveSwipe()
    }

    fun setCanGoForward(enabled: Boolean) {
        if (canGoForward == enabled) return
        canGoForward = enabled
        if (!enabled && direction == EdgeSwipeDirection.FORWARD) cancelActiveSwipe()
    }

    fun setColors(accent: String?, surface: String?) {
        parseColorOrNull(accent)?.let {
            accentColor = it
            arrowPaint.color = it
            host.invalidate()
        }
        parseColorOrNull(surface)?.let {
            surfaceColor = it
            pillPaint.color = it
            host.invalidate()
        }
    }

    fun reset() {
        cancelActiveSwipe()
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
        val activeDirection = direction ?: return
        result.accept(
            { detail ->
                if (token != gestureToken) return@accept
                if (detail == null) {
                    rejectAndClear()
                    return@accept
                }
                val allowed = EdgeSwipePolicy.canEdgeNavigate(
                    direction = activeDirection,
                    handledResult = detail.handledResult(),
                    scrollableDirections = detail.scrollableDirections(),
                )
                if (!allowed || !EdgeSwipePolicy.canArm(environment(1))) {
                    rejectAndClear()
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
                            phase = GesturePhase.DRAGGING
                            dragAnchorX = latestMoveX
                            dragDistancePx = 0f
                            onBeginDragging()
                            host.parent?.requestDisallowInterceptTouchEvent(true)
                        }
                    }
                }
            },
            {
                if (token == gestureToken) {
                    rejectAndClear()
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
                dragDistancePx = 0f
                recycleVelocityTracker()
                activePointerId = event.getPointerId(0)
                downX = event.x
                downY = event.y
                latestMoveX = event.x

                val env = environment(event.pointerCount)
                val detected = EdgeSwipePolicy.detectEdgeDirection(downX, bounds(), env)
                direction = detected
                if (detected != null) {
                    phase = GesturePhase.WAITING_DOWN
                    wantDetailOnDown = true
                    velocityTracker = VelocityTracker.obtain().apply { addMovement(event) }
                } else {
                    phase = GesturePhase.REJECTED
                }
                return false
            }

            MotionEvent.ACTION_POINTER_DOWN -> {
                rejectAndClear()
                return false
            }

            MotionEvent.ACTION_MOVE -> {
                if (event.pointerCount > 1 || activePointerId == MotionEvent.INVALID_POINTER_ID) {
                    rejectAndClear()
                    return false
                }
                val index = event.findPointerIndex(activePointerId)
                if (index < 0) {
                    rejectAndClear()
                    return false
                }
                velocityTracker?.addMovement(event)
                val x = event.getX(index)
                val y = event.getY(index)
                latestMoveX = x
                val dx = x - downX
                val dy = y - downY
                val activeDirection = direction ?: return false

                return when (phase) {
                    GesturePhase.DRAGGING -> true
                    GesturePhase.WAITING_DOWN -> {
                        if (EdgeSwipePolicy.classifyMove(activeDirection, dx, dy, touchSlop) == EdgeMoveIntent.REJECT) {
                            rejectAndClear()
                        }
                        false
                    }
                    GesturePhase.READY_FOR_FIRST_MOVE -> {
                        when (EdgeSwipePolicy.classifyMove(activeDirection, dx, dy, touchSlop)) {
                            EdgeMoveIntent.REJECT -> {
                                rejectAndClear()
                                false
                            }
                            EdgeMoveIntent.ACCEPT -> {
                                if (!EdgeSwipePolicy.canArm(environment(event.pointerCount))) {
                                    rejectAndClear()
                                } else {
                                    phase = GesturePhase.WAITING_MOVE
                                    wantDetailOnMove = true
                                }
                                false
                            }
                            EdgeMoveIntent.UNDECIDED -> false
                        }
                    }
                    GesturePhase.WAITING_MOVE, GesturePhase.REJECTED, GesturePhase.IDLE -> false
                }
            }

            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                if (phase != GesturePhase.DRAGGING) {
                    clearTracking()
                }
                return phase == GesturePhase.DRAGGING
            }
        }
        return false
    }

    fun onTouchEvent(event: MotionEvent): Boolean {
        if (phase != GesturePhase.DRAGGING) return false
        val activeDirection = direction ?: return false

        when (event.actionMasked) {
            MotionEvent.ACTION_POINTER_DOWN -> {
                rejectAndClear()
                return false
            }

            MotionEvent.ACTION_MOVE -> {
                if (event.pointerCount > 1) {
                    rejectAndClear()
                    return false
                }
                val index = event.findPointerIndex(activePointerId)
                if (index < 0) {
                    cancelActiveSwipe()
                    return true
                }
                velocityTracker?.addMovement(event)
                val x = event.getX(index)
                latestMoveX = x
                val signedDx = x - dragAnchorX
                val rawDistance = when (activeDirection) {
                    EdgeSwipeDirection.BACK -> signedDx
                    EdgeSwipeDirection.FORWARD -> -signedDx
                }.coerceAtLeast(0f)
                dragDistancePx = rawDistance
                host.invalidate()
                return true
            }

            MotionEvent.ACTION_UP -> {
                velocityTracker?.addMovement(event)
                velocityTracker?.computeCurrentVelocity(1000)
                val vx = velocityTracker?.getXVelocity(activePointerId) ?: 0f
                val index = event.findPointerIndex(activePointerId)
                val finalX = if (index >= 0) event.getX(index) else latestMoveX
                val signedDx = finalX - dragAnchorX
                val shouldNavigate = EdgeSwipePolicy.canArm(environment(1)) &&
                    EdgeSwipePolicy.shouldCommitSwipe(
                        direction = activeDirection,
                        signedDx = signedDx,
                        signedVxPxPerSec = vx,
                        triggerDistancePx = triggerDistancePx,
                        minFlingDistancePx = minFlingDistancePx,
                        minFlingVelocityPxPerSec = minFlingVelocityPxPerSec,
                    )
                clearTracking()
                if (shouldNavigate) {
                    onTriggerNavigate(activeDirection)
                }
                return true
            }

            MotionEvent.ACTION_CANCEL -> {
                cancelActiveSwipe()
                return true
            }
        }
        return true
    }

    fun draw(canvas: Canvas) {
        if (phase != GesturePhase.DRAGGING || dragDistancePx <= 1f) return
        val activeDirection = direction ?: return

        val progress = (dragDistancePx / triggerDistancePx).coerceIn(0f, 1f)
        val ready = dragDistancePx >= triggerDistancePx
        val pillOffset = EdgeSwipePolicy.computeDampedOffset(
            dragDistancePx,
            pillTriggerOffsetPx,
            maxPillOffsetPx,
        )
        val centerX = when (activeDirection) {
            EdgeSwipeDirection.BACK -> -pillRadius + pillOffset
            EdgeSwipeDirection.FORWARD -> host.width + pillRadius - pillOffset
        }
        val verticalMargin = pillRadius + 24f * density
        val maxY = (host.height - verticalMargin).coerceAtLeast(verticalMargin)
        val centerY = downY.coerceIn(verticalMargin, maxY)

        val scale = (0.72f + 0.28f * progress).coerceIn(0.72f, 1f)
        val alphaInt = (min(1f, progress * 1.6f) * 255f).roundToInt()

        canvas.save()
        canvas.translate(centerX, centerY)
        canvas.scale(scale, scale)

        shadowPaint.alpha = ((alphaInt / 255f) * 44f).roundToInt()
        canvas.drawCircle(0f, 2f * density, pillRadius + 1.5f * density, shadowPaint)

        pillPaint.alpha = alphaInt
        canvas.drawCircle(0f, 0f, pillRadius, pillPaint)

        borderPaint.color = if (ready) accentColor else Color.argb(36, 0, 0, 0)
        borderPaint.strokeWidth = if (ready) 1.5f * density else density
        borderPaint.alpha = if (ready) alphaInt else ((alphaInt / 255f) * 36f).roundToInt()
        canvas.drawCircle(0f, 0f, pillRadius, borderPaint)

        val chevronHalfHeight = 5.5f * density
        val chevronWidth = 4.5f * density
        arrowPath.reset()
        when (activeDirection) {
            EdgeSwipeDirection.BACK -> {
                arrowPath.moveTo(chevronWidth * 0.4f, -chevronHalfHeight)
                arrowPath.lineTo(-chevronWidth * 0.6f, 0f)
                arrowPath.lineTo(chevronWidth * 0.4f, chevronHalfHeight)
            }
            EdgeSwipeDirection.FORWARD -> {
                arrowPath.moveTo(-chevronWidth * 0.4f, -chevronHalfHeight)
                arrowPath.lineTo(chevronWidth * 0.6f, 0f)
                arrowPath.lineTo(-chevronWidth * 0.4f, chevronHalfHeight)
            }
        }
        arrowPaint.alpha = alphaInt
        canvas.drawPath(arrowPath, arrowPaint)
        canvas.restore()
    }

    internal fun cancelActiveSwipe() {
        clearTracking()
    }

    private fun rejectAndClear() {
        val hadDrag = dragDistancePx != 0f
        gestureToken++
        wantDetailOnDown = false
        wantDetailOnMove = false
        activePointerId = MotionEvent.INVALID_POINTER_ID
        direction = null
        dragDistancePx = 0f
        recycleVelocityTracker()
        host.parent?.requestDisallowInterceptTouchEvent(false)
        phase = GesturePhase.REJECTED
        if (hadDrag) host.invalidate()
    }

    private fun clearTracking() {
        val hadDrag = dragDistancePx != 0f
        gestureToken++
        wantDetailOnDown = false
        wantDetailOnMove = false
        activePointerId = MotionEvent.INVALID_POINTER_ID
        direction = null
        dragDistancePx = 0f
        recycleVelocityTracker()
        host.parent?.requestDisallowInterceptTouchEvent(false)
        phase = GesturePhase.IDLE
        if (hadDrag) host.invalidate()
    }

    private fun recycleVelocityTracker() {
        velocityTracker?.recycle()
        velocityTracker = null
    }

    private fun bounds(): EdgeSwipeBounds {
        host.getLocationInWindow(locationOnScreen)
        val rootInsets = ViewCompat.getRootWindowInsets(host)
        val gestureInsets = rootInsets?.getInsets(WindowInsetsCompat.Type.systemGestures())
        val windowWidth = host.rootView?.width?.takeIf { it > 0 } ?: host.width
        return EdgeSwipeBounds(
            viewWidth = host.width,
            viewLocationX = locationOnScreen[0],
            windowWidth = windowWidth,
            systemGestureLeft = gestureInsets?.left ?: 0,
            systemGestureRight = gestureInsets?.right ?: 0,
            density = density,
        )
    }

    private fun environment(pointerCount: Int): EdgeSwipeEnvironment {
        val imeVisible = ViewCompat.getRootWindowInsets(host)
            ?.isVisible(WindowInsetsCompat.Type.ime()) == true
        val session = host.gecko.session
        return EdgeSwipeEnvironment(
            propDisabled = propDisabled,
            canGoBack = canGoBack,
            canGoForward = canGoForward,
            imeVisible = imeVisible,
            resizeCoverActive = host.isResizeCoverDisplayed,
            sessionOpen = session?.isOpen == true,
            pointerCount = pointerCount,
        )
    }

    private fun parseColorOrNull(raw: String?): Int? {
        if (raw.isNullOrBlank()) return null
        return try {
            Color.parseColor(raw.trim())
        } catch (_: IllegalArgumentException) {
            null
        }
    }
}
