package dev.browser

internal class ResizeCoverLifecycle {
    companion object {
        const val MAX_DURATION_MS = 500L
        private const val SETTLE_MS = 120L
    }

    var active = false
        private set
    private var attempted = false
    private var capturing = false
    private var startedAt = 0L
    private var lastResizeAt = 0L
    private var firstTextureAt: Long? = null

    // A reversal belongs to the same episode. Even a failed/expired cover must
    // not cause another GPU readback on each remaining animation frame.
    fun resize(now: Long): Boolean {
        if (!active && now - lastResizeAt >= SETTLE_MS) attempted = false
        lastResizeAt = now
        firstTextureAt = null
        if (attempted) return false
        attempted = true
        active = true
        capturing = true
        startedAt = now
        return true
    }

    fun captured(success: Boolean) {
        capturing = false
        active = active && success
    }

    fun layoutApplied() {
        // Host bounds can settle before the coalesced Gecko child is laid out.
        // A texture from before that layout is not evidence for its new viewport.
        firstTextureAt = null
    }

    fun frame(now: Long, layoutPending: Boolean = false): Boolean {
        // TextureView.getBitmap can synchronously deliver an updated callback.
        if (!active || capturing || layoutPending) return false
        val firstTexture = firstTextureAt
        if (firstTexture == null) {
            firstTextureAt = now
            return false
        }
        if (now - firstTexture < SETTLE_MS && now - startedAt < MAX_DURATION_MS) return false
        active = false
        return true
    }

    fun expire(now: Long): Boolean {
        if (!active || now - startedAt < MAX_DURATION_MS) return false
        active = false
        return true
    }

    fun clear() {
        active = false
        attempted = false
        capturing = false
        firstTextureAt = null
    }
}
