package dev.browser

internal data class PictureInPictureAvailability(
    val supported: Boolean,
    val allowed: Boolean,
    val resumed: Boolean,
    val hasSurface: Boolean,
    val nativeBlocked: Boolean = false,
)

internal data class PictureInPictureTarget(val tabId: String, val sessionVersion: Long)
internal enum class PictureInPicturePhase { IDLE, PREPARING, ACTIVE }

/** Pure lifecycle policy; Android owns the corresponding display transfer. */
internal class PictureInPicturePolicy {
    var enabled = false; private set
    var tabId: String? = null; private set
    var blocked = false; private set
    var externalActivityPending = false; private set
    var phase = PictureInPicturePhase.IDLE; private set
    var target: PictureInPictureTarget? = null; private set
    private var generation = 0L

    fun configure(enabled: Boolean, tabId: String?, blocked: Boolean) {
        this.enabled = enabled
        this.tabId = tabId
        this.blocked = blocked
    }
    fun suspendForExternalActivity() { externalActivityPending = true }
    fun resume() { externalActivityPending = false }
    fun reason(available: PictureInPictureAvailability, explicit: Boolean = false): String? = when {
        !available.supported -> "unsupported"
        !available.allowed -> "permission-denied"
        externalActivityPending -> "external-activity"
        available.nativeBlocked -> "native-prompt"
        blocked && !explicit -> "chrome-blocked"
        tabId.isNullOrBlank() -> "no-tab"
        !available.hasSurface -> "surface-unavailable"
        !available.resumed -> "background"
        else -> null
    }
    fun canAutoEnter(available: PictureInPictureAvailability): Boolean =
        enabled && phase == PictureInPicturePhase.IDLE && reason(available) == null

    fun begin(target: PictureInPictureTarget, available: PictureInPictureAvailability, explicit: Boolean = false): Long? {
        if (phase != PictureInPicturePhase.IDLE || target.tabId != tabId || reason(available, explicit) != null) return null
        this.target = target
        phase = PictureInPicturePhase.PREPARING
        return ++generation
    }
    fun confirm(ticket: Long): Boolean {
        if (ticket != generation || phase != PictureInPicturePhase.PREPARING) return false
        phase = PictureInPicturePhase.ACTIVE
        return true
    }
    fun cancel(ticket: Long): Boolean {
        if (ticket != generation || phase != PictureInPicturePhase.PREPARING) return false
        finish()
        return true
    }
    fun finish(): PictureInPictureTarget? {
        val old = target
        ++generation
        phase = PictureInPicturePhase.IDLE
        target = null
        return old
    }
}

internal fun pictureInPictureAspectRatio(width: Int, height: Int): Pair<Int, Int>? {
    if (width <= 0 || height <= 0) return null
    val ratio = width.toDouble() / height
    return when {
        ratio > 2.39 -> 239 to 100
        ratio < 1.0 / 2.39 -> 100 to 239
        else -> width to height
    }
}

internal data class PictureInPictureRestoration(val returnView: Boolean, val releaseCapturedSession: Boolean)

internal data class PictureInPictureViewportFit(val scale: Double, val offsetX: Double, val offsetY: Double)

internal fun pictureInPictureViewportFit(
    viewportWidth: Int,
    viewportHeight: Int,
    availableWidth: Int,
    availableHeight: Int,
): PictureInPictureViewportFit? {
    if (viewportWidth <= 0 || viewportHeight <= 0 || availableWidth <= 0 || availableHeight <= 0) return null
    val scale = minOf(availableWidth.toDouble() / viewportWidth, availableHeight.toDouble() / viewportHeight)
    return PictureInPictureViewportFit(scale,
        (availableWidth - viewportWidth * scale) / 2,
        (availableHeight - viewportHeight * scale) / 2)
}

internal data class PictureInPictureWindowSize(val width: Int, val height: Int)

internal fun pictureInPictureWindowRestored(
    current: PictureInPictureWindowSize,
    before: PictureInPictureWindowSize?,
    pip: PictureInPictureWindowSize?,
    layoutPending: Boolean,
): Boolean = !layoutPending && current.width > 0 && current.height > 0 &&
    (current == before || (pip != null && current != pip))

internal data class PictureInPictureAudioFocusOwner(val target: PictureInPictureTarget, val session: Any, val generation: Long)

internal class PictureInPicturePlaybackIntent {
    private var pauseRequested = false
    private var pauseObserved = false
    fun requestPause(playing: Boolean) {
        pauseRequested = true
        pauseObserved = !playing
    }
    fun requestPlay() { pauseRequested = false; pauseObserved = false }
    fun observe(playing: Boolean) {
        if (!playing) pauseObserved = true
        else if (pauseObserved) requestPlay()
    }
    fun canAcquire(playing: Boolean, explicitPlay: Boolean = false): Boolean =
        explicitPlay || (playing && !pauseRequested)
}

internal class PictureInPictureAudioFocusPolicy {
    private var generation = 0L
    private var owner: PictureInPictureAudioFocusOwner? = null
    fun begin(target: PictureInPictureTarget, session: Any): PictureInPictureAudioFocusOwner =
        PictureInPictureAudioFocusOwner(target, session, ++generation).also { owner = it }
    fun owns(request: PictureInPictureAudioFocusOwner, target: PictureInPictureTarget?, session: Any?): Boolean =
        owner == request && request.target == target && request.session === session
    fun clear() { owner = null }
}

internal fun pictureInPictureRestoration(
    hostAttached: Boolean,
    hostView: Any,
    transferredView: Any,
    capturedSession: Any,
    currentSession: Any?,
    registeredSession: Any?,
): PictureInPictureRestoration = PictureInPictureRestoration(
    returnView = hostAttached && hostView === transferredView,
    releaseCapturedSession = currentSession === capturedSession && currentSession !== registeredSession,
)
