package dev.browser

internal fun browserImmersiveEnabled(preference: Boolean, contentFullscreen: Boolean): Boolean =
    preference || contentFullscreen

/** A content session owns fullscreen until Gecko acknowledges exit. Main thread only. */
internal class ContentFullscreenSession<S : Any>(
    private val session: S,
    private val isCurrent: () -> Boolean,
    private val isVisible: () -> Boolean,
    private val exitNative: () -> Unit,
    private val changed: (Boolean) -> Unit,
) {
    var fullscreen = false
        private set
    private var exiting = false
    private var retired = false

    fun onFullScreen(callbackSession: S, enabled: Boolean) {
        if (callbackSession !== session || retired || !isCurrent()) return
        if (!enabled) {
            exiting = false
            publish(false)
        } else if (!isVisible()) {
            publish(false)
            exitOnce(keepPendingOnFailure = true)
        } else if (!exiting) {
            publish(true)
        }
    }

    fun requestExit() {
        if (!retired && isCurrent() && fullscreen) exitOnce(keepPendingOnFailure = false)
    }

    /** An outgoing surface/document cannot retain fullscreen chrome. */
    fun leave() {
        if (retired || !isCurrent()) return
        val wasFullscreen = fullscreen
        publish(false)
        if (wasFullscreen) exitOnce(keepPendingOnFailure = true)
    }

    /** A closed/crashed engine must never receive an exit call or a late enter. */
    fun retire() {
        retired = true
        exiting = false
        publish(false)
    }

    private fun exitOnce(keepPendingOnFailure: Boolean) {
        if (exiting) return
        exiting = true
        try {
            exitNative()
        } catch (failure: Exception) {
            if (!keepPendingOnFailure) exiting = false
            throw failure
        }
    }

    private fun publish(value: Boolean) {
        if (fullscreen == value) return
        fullscreen = value
        changed(value)
    }
}
