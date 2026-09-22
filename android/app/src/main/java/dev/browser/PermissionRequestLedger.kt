package dev.browser

internal data class PendingPermissionRequest<T>(
    val id: Int,
    val owner: Any,
    val documentGeneration: Long,
    val value: T,
)

internal data class ResolvedPermission<T>(val value: T, val allow: Boolean, val current: Boolean)

/** Pure bookkeeping for permission callbacks that outlive the delegate call. */
internal class PermissionRequestLedger<T> {
    private val requests = linkedMapOf<Int, PendingPermissionRequest<T>>()

    fun add(id: Int, owner: Any, documentGeneration: Long, value: T) {
        requests[id] = PendingPermissionRequest(id, owner, documentGeneration, value)
    }

    fun resolve(
        id: Int,
        allow: Boolean,
        isOwnerAlive: (Any) -> Boolean,
        currentDocument: (Any) -> Long?,
    ): ResolvedPermission<T>? {
        val request = requests.remove(id) ?: return null
        val current = isOwnerAlive(request.owner) &&
            currentDocument(request.owner) == request.documentGeneration
        return ResolvedPermission(request.value, allow && current, current)
    }

    fun cancel(id: Int): PendingPermissionRequest<T>? = requests.remove(id)

    fun hasForOwner(owner: Any): Boolean = requests.values.any { it.owner === owner }

    fun cancelMatching(owner: Any, matches: (T) -> Boolean): List<PendingPermissionRequest<T>> =
        requests.values.filter { it.owner === owner && matches(it.value) }.also { cancelled ->
            cancelled.forEach { requests.remove(it.id) }
        }

    fun cancelForOwner(owner: Any): List<PendingPermissionRequest<T>> =
        requests.values.filter { it.owner === owner }.also { cancelled ->
            cancelled.forEach { requests.remove(it.id) }
        }

    fun cancelAll(): List<PendingPermissionRequest<T>> =
        requests.values.toList().also { requests.clear() }
}
