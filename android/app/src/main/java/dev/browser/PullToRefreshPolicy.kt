package dev.browser

import kotlin.math.min

internal data class PullToRefreshEnvironment(
    val propDisabled: Boolean,
    val imeVisible: Boolean,
    val isOnline: Boolean,
    val isLoading: Boolean,
    val isRefreshing: Boolean,
    val resizeCoverActive: Boolean,
    val sessionOpen: Boolean,
    val scrollY: Int,
    val url: String,
)

/**
 * Pure decision policy for browser pull-to-refresh.
 * Mirrors Mozilla Android-Components InputResultDetail semantics so native
 * pull-to-refresh cooperates cleanly with web app custom pull-to-refresh,
 * nested scrollable containers, text input/IME, and offline states.
 */
internal object PullToRefreshPolicy {
    // Values mirror org.mozilla.geckoview.PanZoomController constants.
    const val INPUT_RESULT_UNHANDLED = 0
    const val INPUT_RESULT_HANDLED = 1
    const val INPUT_RESULT_HANDLED_CONTENT = 2
    const val INPUT_RESULT_IGNORED = 3

    const val SCROLLABLE_FLAG_TOP = 1 shl 0
    const val OVERSCROLL_FLAG_NONE = 0
    const val OVERSCROLL_FLAG_HORIZONTAL = 1 shl 0
    const val OVERSCROLL_FLAG_VERTICAL = 1 shl 1

    fun isRemoteUrl(url: String): Boolean {
        val trimmed = url.trim()
        return trimmed.startsWith("http://", ignoreCase = true) ||
            trimmed.startsWith("https://", ignoreCase = true)
    }

    fun isRefreshableUrl(url: String): Boolean {
        val trimmed = url.trim()
        if (trimmed.isEmpty()) return false
        if (trimmed.equals("about:blank", ignoreCase = true)) return false
        if (trimmed.startsWith("yeoyu://", ignoreCase = true)) return false
        return isRemoteUrl(trimmed) ||
            trimmed.startsWith("file://", ignoreCase = true) ||
            trimmed.startsWith("data:", ignoreCase = true) ||
            trimmed.startsWith("content:", ignoreCase = true)
    }

    fun canBeginPull(env: PullToRefreshEnvironment): Boolean {
        if (env.propDisabled || env.imeVisible || env.isLoading || env.isRefreshing) return false
        if (env.resizeCoverActive || !env.sessionOpen) return false
        if (env.scrollY > 0) return false
        if (!isRefreshableUrl(env.url)) return false
        if (!env.isOnline && isRemoteUrl(env.url)) return false
        return true
    }

    fun canOverscrollTop(
        handledResult: Int,
        scrollableDirections: Int,
        overscrollDirections: Int,
    ): Boolean {
        if (handledResult == INPUT_RESULT_HANDLED_CONTENT || handledResult == INPUT_RESULT_IGNORED) {
            return false
        }
        if ((scrollableDirections and SCROLLABLE_FLAG_TOP) != 0) {
            return false
        }
        return when (handledResult) {
            INPUT_RESULT_HANDLED -> (overscrollDirections and OVERSCROLL_FLAG_VERTICAL) != 0
            INPUT_RESULT_UNHANDLED ->
                overscrollDirections == OVERSCROLL_FLAG_NONE ||
                    (overscrollDirections and OVERSCROLL_FLAG_VERTICAL) != 0
            else -> false
        }
    }

    /**
     * SwipeRefresh-style damped pull curve: linear early response followed by
     * increasing resistance up to [maxDragPx].
     */
    fun computeDampedDrag(rawDy: Float, triggerPx: Float, maxDragPx: Float): Float {
        if (rawDy <= 0f || triggerPx <= 0f || maxDragPx <= 0f) return 0f
        val damped = rawDy * 0.5f
        val base = min(damped, min(triggerPx, maxDragPx))
        val overshoot = (damped - triggerPx).coerceAtLeast(0f)
        val extraRoom = (maxDragPx - triggerPx).coerceAtLeast(0f)
        val tension = if (overshoot > 0f && extraRoom > 0f) {
            val ratio = (overshoot / (triggerPx * 2f)).coerceIn(0f, 1f)
            extraRoom * (1f - (1f - ratio) * (1f - ratio))
        } else {
            0f
        }
        return (base + tension).coerceIn(0f, maxDragPx)
    }
}
