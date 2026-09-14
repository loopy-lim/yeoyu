package dev.browser

/** A blocked tab stays blocked even after the rolling window expires. */
internal class SessionRecoveryBudget {
    private val failures = mutableMapOf<String, MutableList<Long>>()
    private val blocked = mutableSetOf<String>()

    fun allowAutomaticRecovery(id: String, now: Long): Boolean {
        if (id in blocked) return false
        val recent = failures.getOrPut(id) { mutableListOf() }
        recent.removeAll { now - it >= 60_000 || now < it }
        recent.add(now)
        if (recent.size > 2) {
            blocked.add(id)
            return false
        }
        return true
    }

    fun attempts(id: String): Int = failures[id]?.size ?: 0
    fun retry(id: String) { failures.remove(id); blocked.remove(id) }
    fun reconcile(ids: Set<String>) {
        failures.keys.retainAll(ids)
        blocked.retainAll(ids)
    }
}

/** Thread-safe authorization for delayed disk writes owned by one session. */
internal class SessionWriteGate {
    data class Token(val id: String, val owner: Any, val generation: Long, val document: Long)
    private data class Owner(val value: Any, val document: Long)
    private var generation = 0L
    private var enabled = false
    private var clearing = false
    private val owners = mutableMapOf<String, Owner>()
    private var nextDocument = 1L

    @Synchronized fun register(id: String, owner: Any) { owners[id] = Owner(owner, nextDocument++) }
    @Synchronized fun remove(id: String) { owners.remove(id) }
    @Synchronized fun setEnabled(value: Boolean) { generation++; enabled = value }
    @Synchronized fun beginClear() { generation++; clearing = true; owners.clear() }
    @Synchronized fun endClear() { clearing = false }
    @Synchronized fun capture(id: String, owner: Any): Token? =
        owners[id]?.takeIf { enabled && !clearing && it.value === owner }?.let { Token(id, owner, generation, it.document) }
    @Synchronized fun accepts(token: Token): Boolean =
        enabled && !clearing && token.generation == generation && owners[token.id]?.value === token.owner && owners[token.id]?.document == token.document
}

/** Engine deletion completes before any explicitly requested page can resume. */
internal class SessionIsolationBarrier {
    var clearing = false
        private set
    private val paused = mutableSetOf<String>()
    fun begin(ids: Set<String>) {
        check(!clearing) { "Browser data is already being cleared" }
        clearing = true
        paused.addAll(ids)
    }
    fun end() { clearing = false }
    fun allowAttach(id: String): Boolean {
        if (clearing) paused.add(id)
        return !clearing && id !in paused
    }
    fun resume(id: String): Boolean {
        if (clearing) { paused.add(id); return false }
        paused.remove(id)
        return true
    }
    fun pause(id: String) { paused.add(id) }
    fun reconcile(ids: Set<String>) { paused.retainAll(ids) }
}

/** A form query only authorizes the exact idle observation it was started for. */
internal data class SessionReleaseObservation(
    val sessionVersion: Long,
    val documentVersion: Long,
    val activityVersion: Long,
    val attached: Boolean = false,
    val playing: Boolean = false,
    val recording: Boolean = false,
    val loading: Boolean = false,
    val hasPrompt: Boolean = false,
    val hasPermission: Boolean = false,
    val hasFiles: Boolean = false,
    val hasPopup: Boolean = false,
    val hasState: Boolean = false,
    val keepAlive: Boolean = false,
    val privateSession: Boolean = false,
    val emptyDocument: Boolean = false,
    val restorableConsent: Boolean = false,
) {
    fun protectionReasons(): List<String> = buildList {
        if (attached) add("visible-or-pip")
        if (playing) add("media")
        if (recording) add("recording")
        if (loading) add("loading")
        if (hasPrompt) add("prompt")
        if (hasPermission) add("permission")
        if (hasFiles) add("input-or-upload")
        if (hasPopup) add("popup")
        if (!hasState) add("missing-restoration")
        if (keepAlive) add("keep-alive")
        if (privateSession) add("private-session")
        if (!emptyDocument && !restorableConsent) add("unknown-state")
    }
    fun canInspect() = protectionReasons().isEmpty()
    fun canReleaseAfter(current: SessionReleaseObservation, containsForms: Boolean?): Boolean =
        containsForms == false && canInspect() && current.canInspect() &&
            sessionVersion == current.sessionVersion && documentVersion == current.documentVersion &&
            activityVersion == current.activityVersion
}

/** Main-thread gate for changes that derive a new value from committed settings. */
internal class BrowserConfigurationGate {
    private var pending = 0
    fun begin() { pending++ }
    fun finish() { check(pending > 0); pending-- }
    fun <T> whenIdle(change: () -> T): T {
        check(pending == 0) { "Browser settings are still saving; try changing text size again when saving finishes" }
        return change()
    }
}
