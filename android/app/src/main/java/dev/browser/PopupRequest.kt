package dev.browser

/** One Gecko result and one adoption acknowledgement, completed at most once.
 * Main-thread caller owns timeout scheduling and verifies the session is open. */
internal class PopupRequest<T : Any>(
    private val completeResult: (T?) -> Unit,
    private val closeChild: (T) -> Unit,
) {
    var child: T? = null
        private set
    private var finished = false
    private var reply: ((String?) -> Unit)? = null

    fun adopt(session: T, acknowledge: (String?) -> Unit): Boolean {
        if (finished || child != null) return false
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
