package dev.browser

internal data class ExternalPipSource(val tabId: String, val sessionVersion: Long, val session: Any, val view: Any)
internal data class ExternalPipLease(val ticket: Long, val source: ExternalPipSource)
internal data class ExternalPipReturn(val tabId: String, val token: Long)
internal enum class ExternalPipPhase { IDLE, PREPARING, ENTERING, ACTIVE }
internal enum class ExternalPipExit { NONE, RETURN, CLOSE }
/** Keep an expanding window in Android's draw sync while its viewport draws transparently. */
internal class ExternalPipWindowPresentation(private val ticket: Long) {
    private enum class Phase { HIDDEN, ACTIVE, EXIT_DRAWING }
    private var phase = Phase.HIDDEN
    private var finished = false
    val windowVisible: Boolean get() = phase != Phase.HIDDEN
    val viewportVisible: Boolean get() = !finished && phase != Phase.EXIT_DRAWING
    fun update(ticket: Long, confirmedActive: Boolean, inPip: Boolean, valid: Boolean) {
        if (this.ticket != ticket || finished) return
        when {
            confirmedActive && !inPip -> phase = Phase.EXIT_DRAWING
            confirmedActive && inPip && valid -> phase = Phase.ACTIVE
            phase != Phase.EXIT_DRAWING -> phase = Phase.HIDDEN
        }
    }
    fun finish() {
        if (phase != Phase.EXIT_DRAWING) phase = Phase.HIDDEN
        finished = true
    }
}
internal class ExternalPipActivityState {
    var resumed = false; private set
    var stopped = false; private set
    fun onStarted() { stopped = false }
    fun onResumed() { resumed = true; stopped = false }
    fun onPaused() { resumed = false }
    fun onStopped() { resumed = false; stopped = true }
    fun exit(active: Boolean, inPip: Boolean, finishing: Boolean): ExternalPipExit =
        externalPipExit(active, inPip, resumed, stopped, finishing)
}
// Keep Main underneath the ordinary Activity until Android moves that Activity into PiP.
internal fun externalPipLaunchFlagsAllowed(flags: Int): Boolean = flags and 0x18080000 == 0
internal fun externalPipExit(active: Boolean, inPip: Boolean, resumed: Boolean, stopped: Boolean,
    finishing: Boolean): ExternalPipExit = when {
        !active -> ExternalPipExit.NONE
        finishing -> ExternalPipExit.CLOSE
        !inPip && resumed -> ExternalPipExit.RETURN
        !inPip && stopped -> ExternalPipExit.CLOSE
        else -> ExternalPipExit.NONE
    }
internal fun samePipAudioSession(first: ExternalPipSource?, next: ExternalPipSource): Boolean =
    first?.tabId == next.tabId && first.sessionVersion == next.sessionVersion && first.session === next.session

internal fun externalPipSource(previous: String?, next: String?, before: Set<String>, after: Set<String>?,
    playing: Set<String>, focused: String?): String? {
    if (previous == null || (after == null && previous == next)) return null
    val remaining = after ?: if (next in before) before else setOfNotNull(next)
    val leaving = (before - remaining).intersect(playing)
    return focused?.takeIf { it in leaving } ?: previous.takeIf { it in leaving } ?: leaving.singleOrNull()
}

internal class ExternalPictureInPicturePolicy {
    private var generation = 0L
    var lease: ExternalPipLease? = null; private set
    var phase = ExternalPipPhase.IDLE; private set
    var returning: ExternalPipReturn? = null; private set
    private var entryRequested = false
    fun acceptEntry(ticket: Long): Boolean {
        if (lease?.ticket != ticket || phase != ExternalPipPhase.PREPARING || !entryRequested) return false
        phase = ExternalPipPhase.ENTERING
        return true
    }
    fun requestEntry(ticket: Long, resumed: Boolean): Boolean {
        if (lease?.ticket != ticket || phase != ExternalPipPhase.PREPARING || !resumed || entryRequested) return false
        entryRequested = true
        return true
    }
    fun canShowActivity(ticket: Long, inPictureInPictureMode: Boolean): Boolean =
        lease?.ticket == ticket && phase == ExternalPipPhase.ACTIVE && inPictureInPictureMode
    fun begin(source: ExternalPipSource, previous: String?, next: String?, visible: Set<String>,
        enabled: Boolean = true, available: Boolean = true, blocked: Boolean = false,
        homeBusy: Boolean = false, playing: Boolean = true): ExternalPipLease? {
        if (lease != null || returning != null || !enabled || !available || blocked || homeBusy || !playing ||
            previous != source.tabId || previous == next || (previous in visible && next in visible)) return null
        return ExternalPipLease(nextToken(), source).also {
            lease = it; phase = ExternalPipPhase.PREPARING; entryRequested = false
        }
    }
    fun owns(source: ExternalPipSource): Boolean = lease?.source?.let {
        it.tabId == source.tabId && it.sessionVersion == source.sessionVersion &&
            it.session === source.session && it.view === source.view
    } == true
    fun confirm(ticket: Long): Boolean {
        if (lease?.ticket != ticket || phase !in setOf(ExternalPipPhase.PREPARING, ExternalPipPhase.ENTERING) ||
            !entryRequested) return false
        phase = ExternalPipPhase.ACTIVE
        return true
    }
    fun finish(ticket: Long, requestReturn: Boolean = false): ExternalPipLease? {
        val old = lease?.takeIf { it.ticket == ticket } ?: return null
        lease = null
        phase = ExternalPipPhase.IDLE
        entryRequested = false
        if (requestReturn) returning = ExternalPipReturn(old.source.tabId, nextToken())
        return old
    }
    fun timeout(ticket: Long, expectedPhase: ExternalPipPhase = ExternalPipPhase.PREPARING): ExternalPipLease? =
        if (phase == expectedPhase && expectedPhase in setOf(ExternalPipPhase.PREPARING, ExternalPipPhase.ENTERING))
            finish(ticket, false) else null
    fun acknowledge(token: Long) { if (returning?.token == token) returning = null }
    private fun nextToken(): Long {
        check(generation < 9_007_199_254_740_991L) { "PiP token exhausted" }
        return ++generation
    }
}
