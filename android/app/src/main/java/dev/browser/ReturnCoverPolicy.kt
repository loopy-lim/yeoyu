package dev.browser

/** Opaque native references are compared by identity, even if their classes implement equals. */
internal data class ReturnCoverTarget(val tab: String, val entry: Any, val session: Any, val document: Long) {
    fun matches(other: ReturnCoverTarget): Boolean = tab == other.tab && entry === other.entry &&
        session === other.session && document == other.document
}

/** Paint readiness only. ACK, display-lease adoption, Android geometry and pixels remain caller-owned. */
internal class ReturnCoverPolicy {
    companion object { const val MAX_DURATION_MS = 500L }
    class Ticket internal constructor(val sequence: Long, val returnToken: Long, val started: Long)
    /** A new object denotes an applied layout, even when the dimensions happen to match an old one. */
    class Layout internal constructor(val width: Int, val height: Int)
    data class Observation(val target: ReturnCoverTarget, val owner: Any, val layout: Layout)
    private class Destination(val target: ReturnCoverTarget) {
        var owner: Any? = null
        var layout: Layout? = null
        var painted = false
    }
    private class Pending(val ticket: Ticket, targets: List<ReturnCoverTarget>) {
        val destinations = targets.map(::Destination)
        var displayed = false
    }
    private var sequence = 0L
    private var pending: Pending? = null
    val current: Ticket? get() = pending?.ticket
    val displayed: Boolean get() = pending?.displayed == true

    fun begin(returnToken: Long, targets: List<ReturnCoverTarget>, now: Long): Ticket? {
        pending = null
        if (returnToken <= 0 || now < 0 || targets.size !in 1..2 || targets.any { it.tab.isBlank() } ||
            targets.indices.any { i -> (0 until i).any { j ->
                targets[i].tab == targets[j].tab || targets[i].entry === targets[j].entry ||
                    targets[i].session === targets[j].session
            } }) return null
        val ticket = Ticket(++sequence, returnToken, now)
        pending = Pending(ticket, targets) // Map now; later native ACK/adoption may discard the input list.
        return ticket
    }

    /** Call only inside the still-current native preparation's install action. Never accepts a second copy. */
    fun captured(ticket: Ticket, now: Long): Boolean {
        val p = live(ticket, now) ?: return false
        if (p.displayed) return false
        p.displayed = true
        return true
    }

    /** A prop bind before Android attachment is allowed, but does not itself make a pane ready. */
    fun attached(ticket: Ticket, target: ReturnCoverTarget, owner: Any, now: Long): Boolean {
        val d = destination(ticket, target, now) ?: return false
        if (d.owner != null && d.owner !== owner) return false
        d.owner = owner
        return true
    }

    /** Caller reports initial or changed actual layout, not every pre-draw. Zero size removes old evidence. */
    fun layoutApplied(ticket: Ticket, target: ReturnCoverTarget, owner: Any,
        width: Int, height: Int, now: Long): Layout? {
        val d = destination(ticket, target, now)?.takeIf { it.owner === owner } ?: return null
        d.painted = false
        d.layout = null
        if (width <= 0 || height <= 0) return null
        return Layout(width, height).also { d.layout = it }
    }

    /** Adapter must first validate rooted ownership and settled host/child/texture sizes. */
    fun frame(ticket: Ticket, target: ReturnCoverTarget, owner: Any, layout: Layout, now: Long): Boolean {
        val d = destination(ticket, target, now) ?: return false
        if (d.owner !== owner || d.layout !== layout) return false
        d.painted = true
        return true
    }

    /** Both fresh observations must still match on the draw that removes the shared bitmap. */
    fun reveal(ticket: Ticket, observations: List<Observation>, now: Long): Boolean {
        val p = live(ticket, now)?.takeIf { it.displayed } ?: return false
        if (observations.size != p.destinations.size || !p.destinations.all { d ->
            val o = observations.singleOrNull { it.target.tab == d.target.tab }
            o != null && d.painted && d.layout != null && d.target.matches(o.target) &&
                d.owner === o.owner && d.layout === o.layout
        }) return false
        return cancel(ticket)
    }

    fun cancel(ticket: Ticket): Boolean {
        if (pending?.ticket !== ticket) return false
        pending = null
        return true
    }

    /** Absolute budget includes copying. A stale deadline cannot clear a later return. */
    fun expire(ticket: Ticket, now: Long): Boolean {
        if (pending?.ticket !== ticket || !expired(ticket, now)) return false
        return cancel(ticket)
    }

    private fun expired(ticket: Ticket, now: Long): Boolean =
        now < ticket.started || now - ticket.started >= MAX_DURATION_MS

    private fun live(ticket: Ticket, now: Long): Pending? {
        val p = pending?.takeIf { it.ticket === ticket } ?: return null
        if (expired(ticket, now)) { cancel(ticket); return null }
        return p
    }

    private fun destination(ticket: Ticket, target: ReturnCoverTarget, now: Long): Destination? =
        live(ticket, now)?.takeIf { it.displayed }?.destinations?.firstOrNull { it.target.matches(target) }
}

/** Complete once; a cancelled native preparation may decline to run installation. */
internal class CoverPublication(publish: ((() -> Unit) -> Unit)) {
    private var publish: ((() -> Unit) -> Unit)? = publish
    fun complete(install: () -> Unit = {}): Boolean {
        val complete = publish ?: return false
        publish = null // Reentrant failure/cancel cannot install or complete twice.
        var installed = false
        complete { install(); installed = true }
        return installed
    }
}

/** The optional cover cannot claim to hide pixels outside its original source rectangle. */
internal fun returnCoverFramesFit(source: SpaceCoverRect, frames: List<SpaceCoverRect>): Boolean {
    if (frames.size !in 1..2 || frames.any { spaceCoverRootRect(it, source) == null }) return false
    if (frames.size == 1) return frames.single() == source
    val (a, b) = frames
    return a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top
}
