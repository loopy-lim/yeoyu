package dev.browser

import android.content.Context
import android.os.SystemClock
import android.util.Log
import android.graphics.SurfaceTexture
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoView

internal interface GeckoTextureObserver {
    fun onTextureUpdated()
    fun onTextureInvalidated()
}

/**
 * Gecko 155.0.20260903215306 recreates its Surface and resumes the compositor on
 * every TextureView update, which forces another frame. Keep real surface events
 * and explicit recovery, but stop that feedback loop. Recheck on Gecko upgrades.
 */
class StableGeckoView(context: Context) : GeckoView(context) {
    internal var textureObserver: GeckoTextureObserver? = null
    internal var pipTextureObserver: GeckoTextureObserver? = null

    private class ReturnTrace(val ticket: Long, val tab: String, val document: Long,
        val session: Int, val started: Long) {
        var adopted = false
        var updatedBeforeAdopt = false
        var updatedAfterAdopt = false
        var events = 0
    }
    private var returnTrace: ReturnTrace? = null

    internal fun beginReturnedSurfaceTrace(ticket: Long, tab: String, document: Long) {
        if (context.packageName != "com.workspacebrowser.acceptance") return
        val trace = ReturnTrace(ticket, tab, document, System.identityHashCode(session), SystemClock.uptimeMillis())
        returnTrace = trace
        traceReturnedSurface("requested")
        postDelayed({
            if (returnTrace === trace) {
                traceReturnedSurface("deadline", "firstAfterAdopt=${trace.updatedAfterAdopt}")
                returnTrace = null
            }
        }, 5_000L)
    }

    internal fun markReturnedSurfaceAdopted() {
        returnTrace?.adopted = true
        traceReturnedSurface("adopted")
    }

    internal fun traceReturnedSurface(event: String, detail: String = "") {
        val trace = returnTrace ?: return
        if (trace.events++ >= 24) return
        val texture = textureForCapture()
        val host = parent as? View
        var ancestor: View? = this
        var effectiveAlpha = 1f
        while (ancestor != null) {
            effectiveAlpha *= ancestor.alpha
            ancestor = ancestor.parent as? View
        }
        Log.i("YeoyuReturnSurface", "uptime=${SystemClock.uptimeMillis()} event=$event" +
            " ageMs=${SystemClock.uptimeMillis()-trace.started} ticket=${trace.ticket} tab=${trace.tab}" +
            " document=${trace.document} expectedSession=${trace.session} session=${System.identityHashCode(session)}" +
            " view=${System.identityHashCode(this)} parent=${System.identityHashCode(parent)} adopted=${trace.adopted}" +
            " attached=$isAttachedToWindow shown=$isShown alpha=$alpha effectiveAlpha=$effectiveAlpha" +
            " size=${width}x$height layout=$isLayoutRequested parentSize=${host?.width}x${host?.height}" +
            " texture=${System.identityHashCode(texture)} available=${texture?.isAvailable}" +
            " surface=${System.identityHashCode(texture?.surfaceTexture)} detail=$detail")
    }

    private fun traceReturnedTextureUpdated(surface: SurfaceTexture) {
        val trace = returnTrace ?: return
        if (trace.adopted) {
            if (trace.updatedAfterAdopt) return
            trace.updatedAfterAdopt = true
        } else {
            if (trace.updatedBeforeAdopt) return
            trace.updatedBeforeAdopt = true
        }
        traceReturnedSurface("first-updated", "callbackSurface=${System.identityHashCode(surface)}")
    }

    init {
        setViewBackend(BACKEND_TEXTURE_VIEW)
        installTextureGuard()
    }

    override fun onAttachedToWindow() {
        installTextureGuard()
        super.onAttachedToWindow()
        traceReturnedSurface("attached")
    }

    override fun onDetachedFromWindow() {
        traceReturnedSurface("detaching")
        SpaceTransitionCover.textureInvalidated(this)
        textureObserver?.onTextureInvalidated()
        pipTextureObserver?.onTextureInvalidated()
        super.onDetachedFromWindow()
    }

    override fun setSession(session: GeckoSession) {
        traceReturnedSurface("set-session", "next=${System.identityHashCode(session)}")
        SpaceTransitionCover.textureInvalidated(this)
        textureObserver?.onTextureInvalidated()
        pipTextureObserver?.onTextureInvalidated()
        super.setSession(session)
    }

    override fun releaseSession(): GeckoSession? {
        traceReturnedSurface("release-session")
        SpaceTransitionCover.textureInvalidated(this)
        textureObserver?.onTextureInvalidated()
        pipTextureObserver?.onTextureInvalidated()
        return super.releaseSession()
    }

    internal fun textureForCapture(): TextureView? = findTextureView(this)

    override fun requestNewSurface() {
        post {
            val texture = findTextureView(this)
            val guard = texture?.surfaceTextureListener as? StableTextureListener
            if (texture == null || guard == null) {
                super.requestNewSurface()
            } else {
                // Match pinned Gecko's recovery toggle, arming in the same UI
                // runnable so an intervening frame cannot consume the request.
                guard.lifecycle.requestRefresh()
                texture.visibility = View.INVISIBLE
                texture.visibility = View.VISIBLE
            }
        }
    }

    private fun installTextureGuard() {
        val texture = findTextureView(this) ?: return
        val original = texture.surfaceTextureListener ?: return
        if (original is StableTextureListener) return
        texture.surfaceTextureListener = StableTextureListener(original, this)
    }

    private fun findTextureView(view: View): TextureView? {
        if (view is TextureView) return view
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) {
                findTextureView(view.getChildAt(index))?.let { return it }
            }
        }
        return null
    }

    // Keep this adapter installed through detach/attach: Gecko must receive the
    // child's destruction callback and remains responsible for surface ownership.
    private class StableTextureListener(
        private val original: TextureView.SurfaceTextureListener,
        private val owner: StableGeckoView,
    ) : TextureView.SurfaceTextureListener {
        val lifecycle = TextureSurfaceLifecycle()

        override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
            owner.traceReturnedSurface("available", "callbackSurface=${System.identityHashCode(surface)} size=${width}x$height")
            lifecycle.available { original.onSurfaceTextureAvailable(surface, width, height) }
            owner.traceReturnedSurface("available-dispatched")
        }

        override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {
            lifecycle.sizeChanged { original.onSurfaceTextureSizeChanged(surface, width, height) }
        }

        override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
            SpaceTransitionCover.textureInvalidated(owner)
            owner.textureObserver?.onTextureInvalidated()
            owner.pipTextureObserver?.onTextureInvalidated()
            owner.traceReturnedSurface("destroyed", "callbackSurface=${System.identityHashCode(surface)}")
            return lifecycle.destroyed { original.onSurfaceTextureDestroyed(surface) }
        }

        override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {
            lifecycle.updated { original.onSurfaceTextureUpdated(surface) }
            if (owner.returnTrace != null) owner.traceReturnedTextureUpdated(surface)
            // Observe only while a resize cover exists. Do not resume Gecko for
            // ordinary frames or allocate a forwarding closure in this hot path.
            SpaceTransitionCover.textureUpdated(owner)
            owner.textureObserver?.onTextureUpdated()
            owner.pipTextureObserver?.onTextureUpdated()
        }
    }
}
