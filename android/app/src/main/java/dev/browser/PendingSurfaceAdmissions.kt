package dev.browser

/** Main-thread Surface requests waiting for their Rust tab IDs to reach native. */
internal class PendingSurfaceAdmissions<V : Any> {
    data class Request<V>(val view: V, val id: String, val url: String, val requiresResume: Boolean)
    private val pending = java.util.IdentityHashMap<V, Request<V>>()

    fun request(view: V, id: String, url: String, admittedIds: Set<String>?, clearing: Boolean, release: () -> Unit): Boolean {
        if (admittedIds?.contains(id) != false) {
            pending.remove(view)
            return true
        }
        val requiresResume = clearing || pending[view]?.let { it.id == id && it.requiresResume } == true
        // Releasing the old binding calls detach. Register only after it returns.
        release()
        pending[view] = Request(view, id, url, requiresResume)
        return false
    }

    fun takeAdmitted(ids: Set<String>, isCurrent: (V, String) -> Boolean): List<Request<V>> {
        val ready = mutableListOf<Request<V>>()
        val iterator = pending.values.iterator()
        while (iterator.hasNext()) {
            val request = iterator.next()
            if (!isCurrent(request.view, request.id)) iterator.remove()
            else if (request.id in ids) {
                iterator.remove()
                ready.add(request)
            }
            // An older queued snapshot can precede this view's own admission.
        }
        return ready
    }
    fun detach(view: V) { pending.remove(view) }
    fun removeTab(id: String) { pending.values.removeAll { it.id == id } }
    fun pauseAll() { pending.replaceAll { _, request -> request.copy(requiresResume = true) } }
    fun ids(): Set<String> = pending.values.map { it.id }.toSet()
}
