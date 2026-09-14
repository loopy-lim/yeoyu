package dev.browser

internal enum class VideoPipRegionUpdate { APPLY, IGNORE, INVALID }

/** A new lease needs a live watch reply and OS confirmation before any page pixels are visible. */
internal class VideoPipPresentation(private val initial: VideoRegion) {
    private var sequence = initial.sequence
    private var inPip = false
    private var confirmedWatch = false
    private var geometry = initial
    private var frames = 0
    var valid: Boolean = true
        private set
    val ready: Boolean get() = valid && confirmedWatch && frames >= 2
    val visible: Boolean get() = ready && inPip
    val awaitingPinnedFrames: Boolean get() = valid && inPip && !ready
    val readinessReason: String get() = when {
        !valid -> "invalid"
        !inPip -> "unpinned"
        !confirmedWatch -> "watch"
        frames < 2 -> "texture-$frames"
        else -> "ready"
    }
    fun pinned(value: Boolean) { inPip = value }
    fun update(region: VideoRegion?, sameSession: Boolean): VideoPipRegionUpdate {
        if (!valid) return VideoPipRegionUpdate.IGNORE
        if (region == null || !sameSession || region.documentToken != initial.documentToken ||
            region.videoToken != initial.videoToken) {
            invalidate()
            return VideoPipRegionUpdate.INVALID
        }
        if (region.sequence <= sequence) return VideoPipRegionUpdate.IGNORE
        sequence = region.sequence
        if (!confirmedWatch || region.rect != geometry.rect || region.viewport != geometry.viewport) frames = 0
        geometry = region
        confirmedWatch = true
        return VideoPipRegionUpdate.APPLY
    }
    fun invalidate() { valid = false }
    fun textureUpdated() { if (valid && confirmedWatch && frames < 2) frames++ }
    fun textureInvalidated() { frames = 0 }
}
