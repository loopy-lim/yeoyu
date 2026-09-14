package dev.browser

/** Activity results have no session identity; allocate before dispatch and never overwrite a callback. */
internal class ActivityRequestLedger<O: Any, V: Any> {
    private data class Entry<O, V>(val owner: O, val value: V)
    private val entries = linkedMapOf<Int, Entry<O, V>>()
    private var nextCode = 0x3000
    fun add(owner: O, value: V): Int {
        // Never reuse a code in this process: a very late OS result cannot match a new request.
        check(nextCode < 0x5000) { "Activity request capacity reached; restart the browser" }
        return nextCode++.also { entries[it] = Entry(owner, value) }
    }
    fun take(code: Int): V? = entries.remove(code)?.value
    fun cancelFor(owner: O): List<V> {
        val codes = entries.filterValues { it.owner === owner }.keys.toList()
        return codes.mapNotNull { take(it) }
    }
    fun cancelAll(): List<V> = entries.keys.toList().mapNotNull { take(it) }
}
