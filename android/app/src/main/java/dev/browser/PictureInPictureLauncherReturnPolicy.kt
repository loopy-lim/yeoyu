package dev.browser

internal data class PictureInPictureLauncherReturnRequest(val generation: Long, val entryTicket: Long)

internal class PictureInPictureLauncherReturnPolicy {
    private var generation = 0L
    private var request: PictureInPictureLauncherReturnRequest? = null
    private var claimed = false
    val pending: Boolean get() = request != null

    fun request(entryTicket: Long?, preparing: Boolean): PictureInPictureLauncherReturnRequest? {
        if (!preparing || entryTicket == null) return null
        return request ?: PictureInPictureLauncherReturnRequest(++generation, entryTicket).also {
            request = it
            claimed = false
        }
    }

    fun claimOnActive(): PictureInPictureLauncherReturnRequest? {
        if (claimed) return null
        return request?.also { claimed = true }
    }

    fun foregroundResumed(): Boolean {
        // A resume/normal-sized frame before the late ACTIVE callback is not an
        // acknowledgement. Only a return issued after that boundary can settle here.
        return claimed && cancel()
    }

    fun owns(request: PictureInPictureLauncherReturnRequest): Boolean = this.request == request

    fun cancel(request: PictureInPictureLauncherReturnRequest? = null): Boolean {
        if (this.request == null || (request != null && !owns(request))) return false
        this.request = null
        claimed = false
        return true
    }
}
