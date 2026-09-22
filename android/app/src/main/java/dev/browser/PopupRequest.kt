package dev.browser

/** One Gecko result and one adoption acknowledgement, completed at most once.
 * Gecko must receive an unopened child so it can attach native window info.
 * Main-thread caller owns timeout scheduling and verifies the later open. */
internal class PopupRequest<T : Any>(
    private val completeResult: (T?) -> Unit,
    private val closeChild: (T) -> Unit,
    private val isOpen: (T) -> Boolean,
) {
    var child: T? = null
        private set
    private var finished = false
    private var reply: ((String?) -> Unit)? = null

    fun adopt(session: T, acknowledge: (String?) -> Unit): Boolean {
        if (finished || child != null) return false
        check(!isOpen(session)) { "New windows require an unopened session" }
        child = session
        reply = acknowledge
        completeResult(session)
        return true
    }

    fun opened() {
        if (finished) return
        check(child != null) { "Popup has no adopted session" }
        finished = true
        reply?.invoke(null)
    }

    fun cancel(reason: String) {
        if (finished) return
        finished = true
        try {
            val session = child
            if (session == null) completeResult(null) else closeChild(session)
        } finally {
            reply?.invoke(reason)
        }
    }
}
