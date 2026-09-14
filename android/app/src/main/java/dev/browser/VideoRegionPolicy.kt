package dev.browser

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor

internal data class VideoCssRect(val x: Double, val y: Double, val width: Double, val height: Double)
internal data class VideoViewport(
    val width: Double, val height: Double, val visualWidth: Double, val visualHeight: Double,
    val offsetLeft: Double, val offsetTop: Double, val scale: Double,
)
internal data class VideoRegion(
    val documentToken: String, val videoToken: String, val sequence: Long,
    val viewport: VideoViewport, val rect: VideoCssRect, val playing: Boolean,
    val videoWidth: Int, val videoHeight: Int,
)
internal data class VideoPixelRect(val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val width: Int get() = right - left
    val height: Int get() = bottom - top
}

private const val VIDEO_COORDINATE_EPSILON = 1e-6
private const val VIDEO_SURFACE_SIZE_TOLERANCE = 2.0 + VIDEO_COORDINATE_EPSILON
private const val MAX_VIDEO_SEQUENCE = 9_007_199_254_740_991L

/** Convert a fully visible video rectangle using the current Gecko client-to-surface matrix.
 * The caller must reject matrix rotation, skew and perspective before passing its axes here.
 */
internal fun videoRegionToPixels(
    region: VideoRegion, sourceWidth: Int, sourceHeight: Int,
    scaleX: Double, scaleY: Double, offsetX: Double, offsetY: Double,
): VideoPixelRect? {
    val viewport = region.viewport
    val rect = region.rect
    if (region.documentToken.isBlank() || region.videoToken.isBlank() ||
        region.sequence !in 1L..MAX_VIDEO_SEQUENCE || region.videoWidth <= 0 || region.videoHeight <= 0 ||
        sourceWidth <= 0 || sourceHeight <= 0) return null
    if (!doubleArrayOf(viewport.width, viewport.height, viewport.visualWidth, viewport.visualHeight,
        viewport.offsetLeft, viewport.offsetTop, viewport.scale, rect.x, rect.y, rect.width, rect.height,
        scaleX, scaleY, offsetX, offsetY).all { it.isFinite() }) return null
    if (viewport.width <= 0 || viewport.height <= 0 || viewport.visualWidth <= 0 || viewport.visualHeight <= 0 ||
        rect.width <= 0 || rect.height <= 0 || scaleX <= 0 || scaleY <= 0) return null

    // Until pinch/pan coordinates are established end to end, accept only the
    // unzoomed visual viewport. It must map to the current surface; the layout
    // viewport may be larger after fullscreen exit without changing CSS client
    // coordinates. Only tolerate rounding when layout is smaller than visual.
    if (abs(viewport.scale - 1.0) > VIDEO_COORDINATE_EPSILON ||
        abs(viewport.offsetLeft) > VIDEO_COORDINATE_EPSILON || abs(viewport.offsetTop) > VIDEO_COORDINATE_EPSILON ||
        (viewport.visualWidth - viewport.width) * scaleX > VIDEO_SURFACE_SIZE_TOLERANCE ||
        (viewport.visualHeight - viewport.height) * scaleY > VIDEO_SURFACE_SIZE_TOLERANCE ||
        abs(viewport.visualWidth * scaleX - sourceWidth) > VIDEO_SURFACE_SIZE_TOLERANCE ||
        abs(viewport.visualHeight * scaleY - sourceHeight) > VIDEO_SURFACE_SIZE_TOLERANCE) return null
    if (rect.x < -VIDEO_COORDINATE_EPSILON || rect.y < -VIDEO_COORDINATE_EPSILON ||
        rect.x + rect.width > viewport.width + VIDEO_COORDINATE_EPSILON ||
        rect.y + rect.height > viewport.height + VIDEO_COORDINATE_EPSILON ||
        rect.x + rect.width > viewport.visualWidth + VIDEO_COORDINATE_EPSILON ||
        rect.y + rect.height > viewport.visualHeight + VIDEO_COORDINATE_EPSILON) return null

    val left = rect.x * scaleX + offsetX
    val top = rect.y * scaleY + offsetY
    val right = (rect.x + rect.width) * scaleX + offsetX
    val bottom = (rect.y + rect.height) * scaleY + offsetY
    if (!doubleArrayOf(left, top, right, bottom).all { it.isFinite() } ||
        left < -VIDEO_COORDINATE_EPSILON || top < -VIDEO_COORDINATE_EPSILON ||
        right > sourceWidth + VIDEO_COORDINATE_EPSILON || bottom > sourceHeight + VIDEO_COORDINATE_EPSILON) return null
    // Only tolerate floating point noise at the outside surface boundary. All
    // other fractional edges round inward so adjacent page pixels stay hidden.
    val result = VideoPixelRect(ceil(left.coerceAtLeast(0.0)).toInt(), ceil(top.coerceAtLeast(0.0)).toInt(),
        floor(right.coerceAtMost(sourceWidth.toDouble())).toInt(), floor(bottom.coerceAtMost(sourceHeight.toDouble())).toInt())
    return result.takeIf { it.width >= 16 && it.height >= 16 }
}
