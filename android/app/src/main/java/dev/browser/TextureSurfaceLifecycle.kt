package dev.browser

internal class TextureSurfaceLifecycle {
    @PublishedApi internal var refreshRequested = false

    fun requestRefresh() { refreshRequested = true }

    inline fun available(publish: () -> Unit) {
        refreshRequested = false
        publish()
    }

    inline fun sizeChanged(publish: () -> Unit) = publish()

    inline fun destroyed(destroy: () -> Boolean): Boolean {
        refreshRequested = false
        return destroy()
    }

    // Inline the hot callback so suppressed frames allocate no forwarding lambda.
    inline fun updated(publish: () -> Unit) {
        if (!refreshRequested) return
        // Publishing can synchronously request another recovery. Consume first.
        refreshRequested = false
        publish()
    }
}
