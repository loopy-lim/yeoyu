package dev.browser

internal enum class PictureInPictureDismissalAction { NONE, BACKGROUND, RESTORE }

/** Invalid media may close PiP, but cannot override a newer foreground request. */
internal class PictureInPictureDismissalPolicy {
    private var generation = 0L
    private var entering = false
    private var foreground = false
    private var attempted = false
    private var pending: Long? = null

    fun beginEntry(foregroundRequested: Boolean = false) {
        // Pause, transitioning and mode(true) can describe the same entry.
        if (entering) {
            if (foregroundRequested) requestForeground()
            return
        }
        entering = true
        foreground = foregroundRequested
        attempted = false
        pending = null
    }
    fun requestForeground() {
        foreground = true
        pending = null
    }
    fun cancel() {
        entering = false
        pending = null
    }
    fun request(): Long? {
        if (!entering || foreground || attempted) return null
        attempted = true
        return (++generation).also { pending = it }
    }
    fun claim(request: Long, inPip: Boolean): PictureInPictureDismissalAction {
        if (pending != request) return PictureInPictureDismissalAction.NONE
        pending = null
        return if (inPip) PictureInPictureDismissalAction.BACKGROUND else PictureInPictureDismissalAction.RESTORE
    }
}
