package dev.browser

internal data class SpaceSurfaceIdentity(val tab: String, val session: Any, val document: Long) {
    fun matches(other: SpaceSurfaceIdentity) = tab == other.tab && session === other.session && document == other.document
}
internal data class SpaceCoverRect(val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val width get() = right - left
    val height get() = bottom - top
}

/** A bitmap lease outlives its outgoing view, never its exact destination or deadline. */
internal class SpaceTransitionPolicy {
    companion object { const val MAX_DURATION_MS = 500L }
    data class Ticket(val sequence: Long, val source: SpaceSurfaceIdentity, val target: SpaceSurfaceIdentity, val started: Long)
    private var sequence = 0L
    var current: Ticket? = null
        private set
    var displayed = false
        private set
    private var incoming: Any? = null
    private var consumeGesture = false

    fun begin(source: SpaceSurfaceIdentity, target: SpaceSurfaceIdentity, now: Long): Ticket? {
        cancel()
        if (source.tab.isBlank() || target.tab.isBlank() || source.tab == target.tab || source.session === target.session) return null
        return Ticket(++sequence, source, target, now).also { current = it }
    }
    fun captured(ticket: Ticket, now: Long): Boolean {
        if (current !== ticket || expired(ticket, now)) return false
        displayed = true
        return true
    }
    fun attached(ticket: Ticket, identity: SpaceSurfaceIdentity, owner: Any): Boolean {
        if (current !== ticket || !displayed || !ticket.target.matches(identity)) return false
        if (incoming != null && incoming !== owner) return false
        incoming = owner
        return true
    }
    fun frame(ticket: Ticket, identity: SpaceSurfaceIdentity, owner: Any): Boolean {
        if (current !== ticket || !displayed || incoming !== owner || !ticket.target.matches(identity)) return false
        return cancel(ticket)
    }
    fun cancel(ticket: Ticket? = current): Boolean {
        if (ticket == null || current !== ticket) return false
        current = null
        displayed = false
        incoming = null
        return true
    }
    fun expired(ticket: Ticket, now: Long): Boolean =
        current === ticket && now - ticket.started >= MAX_DURATION_MS && cancel(ticket)

    fun touch(down: Boolean, end: Boolean, inside: Boolean): Boolean {
        if (down) consumeGesture = displayed && inside
        // Any input ends the visual cover. A covered DOWN still owns its tail.
        cancel()
        val result = consumeGesture
        if (end) consumeGesture = false
        return result
    }
}

/** Translate fully visible source bounds; clipping or an empty root is not safe to capture. */
internal fun spaceCoverRootRect(source: SpaceCoverRect, root: SpaceCoverRect): SpaceCoverRect? {
    if (root.right <= root.left || root.bottom <= root.top || source.right <= source.left || source.bottom <= source.top ||
        source.left < root.left || source.top < root.top || source.right > root.right || source.bottom > root.bottom) return null
    return SpaceCoverRect(source.left - root.left, source.top - root.top, source.right - root.left, source.bottom - root.top)
}

internal fun spaceCoverBitmapSize(width: Int, height: Int): Pair<Int, Int>? {
    if (width <= 0 || height <= 0) return null
    val scale = minOf(1.0, kotlin.math.sqrt(8_000_000.0 / (width.toDouble() * height)), 8_000_000.0 / maxOf(width, height))
    return maxOf(1, (width * scale).toInt()) to maxOf(1, (height * scale).toInt())
}

/** Fabric may bind props before mounting; an already attached foreign root is never eligible. */
internal fun spaceCoverCanObserveOwner(windowAttached: Boolean, belongsToRoot: Boolean): Boolean = !windowAttached || belongsToRoot

/** Opacity must be observable and settled before window pixels can become a root-level cover. */
internal fun spaceCoverStableAncestor(
    alpha: Float, transitionAlpha: Float?, hasAnimation: Boolean, layoutTransitionRunning: Boolean,
): Boolean = alpha == 1f && transitionAlpha == 1f && !hasAnimation && !layoutTransitionRunning
