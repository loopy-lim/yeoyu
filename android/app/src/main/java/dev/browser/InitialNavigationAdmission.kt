package dev.browser

/** Gecko 155 Progress.onEnable emits one synthetic blank start/location/success cycle. */
internal class InitialNavigationAdmission(
    initialUrl: String,
    openInitially: Boolean,
    private val current: () -> Boolean,
) {
    private enum class Phase { FIRST_START, BLANK_STARTED, BLANK_LOCATION, COMPLETE }
    private val protectsInitialTarget = openInitially && initialUrl != "about:blank"
    private var phase = if (protectsInitialTarget) Phase.FIRST_START else Phase.COMPLETE
    private var acceptedLocation = false

    /** Only a real admitted location opens cold-target readiness, never a synthetic start or paint. */
    val locationAccepted: Boolean get() = current() && acceptedLocation

    fun acceptPageStart(url: String): Boolean {
        if (!current()) return false
        if (phase == Phase.FIRST_START && url == "about:blank") {
            phase = Phase.BLANK_STARTED
            return false
        }
        phase = Phase.COMPLETE
        return true
    }

    fun acceptLocation(url: String?, hasUserGesture: Boolean): Boolean {
        if (!current()) return false
        if (phase == Phase.BLANK_STARTED && url == "about:blank" && !hasUserGesture) {
            phase = Phase.BLANK_LOCATION
            return false
        }
        // Unexpected ordering and every later navigation retain their existing semantics.
        phase = Phase.COMPLETE
        if (!url.isNullOrEmpty()) acceptedLocation = true
        return true
    }

    fun acceptPageStop(success: Boolean): Boolean {
        if (!current()) return false
        val synthetic = phase == Phase.BLANK_LOCATION && success
        phase = Phase.COMPLETE
        return !synthetic
    }

    /** Native LocationChange dispatches back/forward immediately after the location callback. */
    fun acceptHistoryChange(): Boolean = current() && phase != Phase.BLANK_STARTED && phase != Phase.BLANK_LOCATION

    fun acceptSessionState(knownUrl: String, stateUrl: String?): Boolean {
        if (!current()) return false
        if (!protectsInitialTarget) return true
        if (!acceptedLocation || stateUrl.isNullOrEmpty()) return false
        // A delayed bootstrap snapshot must not replace real history under a nonblank envelope.
        // A genuine later blank location updates knownUrl first and admits blank history normally.
        return stateUrl != "about:blank" || knownUrl == "about:blank"
    }

    /** Explicit blank/history outranks bootstrap matching; replacing the real target does not. */
    fun navigationRequested(url: String? = null) {
        if (current() && (url == null || url == "about:blank")) phase = Phase.COMPLETE
    }
}
