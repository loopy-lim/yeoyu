package dev.browser

/** Owns the latest requested child layout independently of Android measurement. */
internal class ResizeLayoutCoalescer(private val applyLayout: (Int, Int) -> Unit) {
    companion object { const val SETTLE_MS = 48L }
    private data class Pending(val width: Int, val height: Int, val time: Long, val token: Long)
    private var pending: Pending? = null
    private var generation = 0L
    private var applying = 0
    val hasPending: Boolean get() = pending != null
    val isApplying: Boolean get() = applying != 0

    fun request(width: Int, height: Int, now: Long, covered: Boolean): Long? {
        if (!covered || width <= 0 || height <= 0) {
            discard()
            apply(width, height)
            return null
        }
        val token = ++generation
        pending = Pending(width, height, now, token)
        return token
    }

    fun settle(token: Long, now: Long) {
        val latest = pending ?: return
        if (latest.token == token && now - latest.time >= SETTLE_MS) flush()
    }

    fun flush() {
        val latest = pending ?: return
        flush(latest.width, latest.height)
    }

    fun flush(width: Int, height: Int) {
        if (pending == null) return
        // Layout can synchronously call back into the owner. Retire this work
        // before applying it so neither that callback nor an old task replays it.
        discard()
        apply(width, height)
    }

    fun discard() {
        generation++
        pending = null
    }

    private fun apply(width: Int, height: Int) {
        applying++
        try {
            applyLayout(width, height)
        } finally {
            applying--
        }
    }
}
