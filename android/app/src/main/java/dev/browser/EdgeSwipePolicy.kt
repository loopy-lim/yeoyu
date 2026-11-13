package dev.browser

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

internal enum class EdgeSwipeDirection {
    BACK,
    FORWARD,
}

internal enum class EdgeMoveIntent {
    UNDECIDED,
    ACCEPT,
    REJECT,
}

internal data class EdgeSwipeEnvironment(
    val propDisabled: Boolean,
    val canGoBack: Boolean,
    val canGoForward: Boolean,
    val imeVisible: Boolean,
    val resizeCoverActive: Boolean,
    val sessionOpen: Boolean,
    val pointerCount: Int,
)

internal data class EdgeSwipeBounds(
    val viewWidth: Int,
    val viewLocationX: Int,
    val windowWidth: Int,
    val systemGestureLeft: Int,
    val systemGestureRight: Int,
    val density: Float,
)

/**
 * Pure decision policy for edge-swipe history navigation (`BACK` / `FORWARD`).
 *
 * Key invariants:
 * - Android predictive-back coexistence: never excludes `systemGestureInsets`; instead
 *   computes overlap between [BrowserSurfaceView] and the system gesture bezel so the
 *   browser edge band extends immediately inward (`overlap + 28dp`).
 * - Web horizontal scroll & carousel coexistence: verifies Gecko's
 *   `PanZoomController.InputResultDetail` before intercepting, backing off whenever content
 *   handles the touch (`HANDLED_CONTENT` / `IGNORED`) or can scroll in that direction
 *   (`SCROLLABLE_FLAG_LEFT` / `SCROLLABLE_FLAG_RIGHT`).
 */
internal object EdgeSwipePolicy {
    // Values mirror org.mozilla.geckoview.PanZoomController constants.
    const val INPUT_RESULT_UNHANDLED = 0
    const val INPUT_RESULT_HANDLED = 1
    const val INPUT_RESULT_HANDLED_CONTENT = 2
    const val INPUT_RESULT_IGNORED = 3

    const val SCROLLABLE_FLAG_RIGHT = 1 shl 1
    const val SCROLLABLE_FLAG_LEFT = 1 shl 3

    private const val INNER_BAND_DP = 28f
    private const val STANDALONE_BAND_DP = 32f
    private const val MAX_VIEW_FRACTION = 0.25f

    fun canArm(env: EdgeSwipeEnvironment): Boolean {
        if (env.propDisabled || env.imeVisible || env.resizeCoverActive || !env.sessionOpen) {
            return false
        }
        if (env.pointerCount > 1) return false
        return env.canGoBack || env.canGoForward
    }

    fun detectEdgeDirection(
        startX: Float,
        bounds: EdgeSwipeBounds,
        env: EdgeSwipeEnvironment,
    ): EdgeSwipeDirection? {
        if (!canArm(env)) return null
        if (bounds.viewWidth <= 0 || bounds.density <= 0f) return null

        val overlapLeft = max(0, bounds.systemGestureLeft - bounds.viewLocationX)
        val rawReachLeft = if (overlapLeft > 0) {
            overlapLeft + INNER_BAND_DP * bounds.density
        } else {
            STANDALONE_BAND_DP * bounds.density
        }
        val leftReach = min(
            bounds.viewWidth * MAX_VIEW_FRACTION,
            max(STANDALONE_BAND_DP * bounds.density, rawReachLeft),
        )

        val viewRight = bounds.viewLocationX + bounds.viewWidth
        val systemRightStart = if (bounds.windowWidth > 0) {
            max(0, bounds.windowWidth - bounds.systemGestureRight)
        } else {
            viewRight
        }
        val overlapRight = max(0, viewRight - systemRightStart)
        val rawReachRight = if (overlapRight > 0) {
            overlapRight + INNER_BAND_DP * bounds.density
        } else {
            STANDALONE_BAND_DP * bounds.density
        }
        val rightReach = min(
            bounds.viewWidth * MAX_VIEW_FRACTION,
            max(STANDALONE_BAND_DP * bounds.density, rawReachRight),
        )

        if (env.canGoBack && startX >= 0f && startX <= leftReach) {
            return EdgeSwipeDirection.BACK
        }
        if (env.canGoForward && startX >= (bounds.viewWidth - rightReach) && startX <= bounds.viewWidth.toFloat()) {
            return EdgeSwipeDirection.FORWARD
        }
        return null
    }

    fun classifyMove(
        direction: EdgeSwipeDirection,
        dx: Float,
        dy: Float,
        touchSlop: Float,
    ): EdgeMoveIntent {
        val slop = max(touchSlop, 1f)
        val directionalDx = when (direction) {
            EdgeSwipeDirection.BACK -> dx
            EdgeSwipeDirection.FORWARD -> -dx
        }
        if (directionalDx < -slop) return EdgeMoveIntent.REJECT
        if (abs(dy) > slop && abs(dy) > abs(dx) * 0.85f) return EdgeMoveIntent.REJECT
        if (directionalDx > slop && directionalDx > abs(dy) * 1.4f) return EdgeMoveIntent.ACCEPT
        return EdgeMoveIntent.UNDECIDED
    }

    fun canEdgeNavigate(
        direction: EdgeSwipeDirection,
        handledResult: Int,
        scrollableDirections: Int,
    ): Boolean {
        if (handledResult == INPUT_RESULT_HANDLED_CONTENT || handledResult == INPUT_RESULT_IGNORED) {
            return false
        }
        val blockedFlag = when (direction) {
            EdgeSwipeDirection.BACK -> SCROLLABLE_FLAG_LEFT
            EdgeSwipeDirection.FORWARD -> SCROLLABLE_FLAG_RIGHT
        }
        return (scrollableDirections and blockedFlag) == 0
    }

    fun shouldCommitSwipe(
        direction: EdgeSwipeDirection,
        signedDx: Float,
        signedVxPxPerSec: Float,
        triggerDistancePx: Float,
        minFlingDistancePx: Float,
        minFlingVelocityPxPerSec: Float,
    ): Boolean {
        val distance = when (direction) {
            EdgeSwipeDirection.BACK -> signedDx
            EdgeSwipeDirection.FORWARD -> -signedDx
        }
        val velocity = when (direction) {
            EdgeSwipeDirection.BACK -> signedVxPxPerSec
            EdgeSwipeDirection.FORWARD -> -signedVxPxPerSec
        }
        if (distance >= triggerDistancePx) return true
        return distance >= minFlingDistancePx && velocity >= minFlingVelocityPxPerSec
    }

    fun computeDampedOffset(rawDistancePx: Float, triggerPx: Float, maxOffsetPx: Float): Float {
        if (rawDistancePx <= 0f || triggerPx <= 0f || maxOffsetPx <= 0f) return 0f
        val linear = rawDistancePx * 0.45f
        val base = min(linear, min(triggerPx, maxOffsetPx))
        val overshoot = (linear - triggerPx).coerceAtLeast(0f)
        val room = (maxOffsetPx - triggerPx).coerceAtLeast(0f)
        val extra = if (overshoot > 0f && room > 0f) {
            val ratio = (overshoot / (triggerPx * 2f)).coerceIn(0f, 1f)
            room * (1f - (1f - ratio) * (1f - ratio))
        } else {
            0f
        }
        return (base + extra).coerceIn(0f, maxOffsetPx)
    }
}
