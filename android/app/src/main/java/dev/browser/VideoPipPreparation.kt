package dev.browser

/** Exactly one pending bridge continuation; late measurements cannot reserve a display. */
internal class VideoPipPreparation {
    private data class Pending(val ticket: Long, val done: () -> Unit)
    private var sequence = 0L
    private var pending: Pending? = null

    fun begin(done: () -> Unit): Long {
        val old = pending
        val next = Pending(++sequence, done)
        pending = next
        old?.done?.invoke()
        return next.ticket
    }

    fun complete(ticket: Long, action: () -> Unit = {}) {
        val current = pending?.takeIf { it.ticket == ticket } ?: return
        pending = null
        try { action() } finally { current.done() }
    }

    fun cancel() {
        val old = pending
        pending = null
        old?.done?.invoke()
    }
}
