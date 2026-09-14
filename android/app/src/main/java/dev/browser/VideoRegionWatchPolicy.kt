package dev.browser

/** Transport observation precedes PiP; heartbeat expiry only protects a confirmed display. */
internal class VideoRegionWatchPolicy(val startedAt: Long, private val timeoutMillis: Long = 1_000L) {
    private var alive = true
    private var pinned = false
    var acknowledged = false; private set
    var deadlineAt: Long? = null; private set
    var timerGeneration = 0L; private set

    fun setPinned(value: Boolean, now: Long) {
        if (!alive || pinned == value) return
        pinned = value
        reschedule(now)
    }

    fun accepted(now: Long) {
        if (!alive) return
        acknowledged = true
        reschedule(now)
    }

    private fun reschedule(now: Long) {
        timerGeneration++
        deadlineAt = if (alive && pinned && acknowledged) now + timeoutMillis else null
    }

    fun canExpire(generation: Long, now: Long): Boolean = alive && generation == timerGeneration &&
        deadlineAt?.let { now >= it } == true

    fun cancel() {
        if (!alive) return
        alive = false
        timerGeneration++
        deadlineAt = null
    }
}
