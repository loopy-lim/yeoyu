package dev.browser

import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import android.os.SystemClock
import android.os.Trace
import android.view.Gravity
import android.view.View
import org.mozilla.geckoview.GeckoSession
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** A bounded snapshot hides Gecko's briefly unpainted area during native resize. */
internal class GeckoResizeCover(
    private val host: BrowserSurfaceView,
    private val gecko: StableGeckoView,
) {
    private val lifecycle = ResizeCoverLifecycle()
    private var drawable: BitmapDrawable? = null
    private var session: GeckoSession? = null
    private var tabId: String? = null
    private var deadline: Runnable? = null
    private var textureObserver: GeckoTextureObserver? = null
    private var layoutListener: View.OnLayoutChangeListener? = null
    private var generation = 0L
    val isDisplayed: Boolean get() = drawable != null

    fun resize(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
        if (oldWidth <= 0 || oldHeight <= 0 || width <= 0 || height <= 0 ||
            !host.isAttachedToWindow || !host.isShown || gecko.parent !== host ||
            gecko.session?.isOpen != true) {
            clear()
            return
        }
        if (session != null && !ownsSurface()) clear()
        drawable?.setBounds(0, 0, width, height)
        val startedAt = SystemClock.uptimeMillis()
        if (!lifecycle.resize(startedAt)) return

        val token = ++generation
        session = gecko.session
        tabId = host.tabId
        val listener = View.OnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
            if (generation == token &&
                (right - left != oldRight - oldLeft || bottom - top != oldBottom - oldTop)) {
                lifecycle.layoutApplied()
            }
        }
        layoutListener = listener
        gecko.addOnLayoutChangeListener(listener)
        val observer = object : GeckoTextureObserver {
            override fun onTextureUpdated() {
                if (generation != token) return
                if (!ownsSurface()) {
                    clear()
                } else if (lifecycle.frame(SystemClock.uptimeMillis(), host.isGeckoLayoutPending)) {
                    releaseCover(resetEpisode = false)
                }
            }
            override fun onTextureInvalidated() {
                if (generation == token) clear()
            }
        }
        textureObserver = observer
        gecko.textureObserver = observer
        // Called from the host's onSizeChanged, before its old-sized TextureView
        // is laid out again. getBitmap may synchronously call onTextureUpdated.
        val bitmap = capture()
        if (generation != token || !ownsSurface()) {
            bitmap?.recycle() // This bitmap has never been attached to a drawable.
            if (generation == token) clear()
            return
        }
        lifecycle.captured(bitmap != null)
        if (bitmap == null) {
            releaseCover(resetEpisode = false)
            return
        }
        if (lifecycle.expire(SystemClock.uptimeMillis())) {
            bitmap.recycle()
            releaseCover(resetEpisode = false)
            return
        }
        drawable = BitmapDrawable(host.resources, bitmap).apply {
            gravity = Gravity.FILL
            isFilterBitmap = true
            setBounds(0, 0, width, height)
            host.overlay.add(this)
        }
        val timeout = Runnable {
            if (generation == token && lifecycle.expire(SystemClock.uptimeMillis())) {
                releaseCover(resetEpisode = false)
            }
        }
        deadline = timeout
        host.postDelayed(timeout, max(0L, startedAt + ResizeCoverLifecycle.MAX_DURATION_MS - SystemClock.uptimeMillis()))
    }

    fun clear() = releaseCover(resetEpisode = true)

    private fun ownsSurface(): Boolean = host.isAttachedToWindow && host.isShown &&
        gecko.parent === host && host.tabId == tabId && gecko.session === session && session?.isOpen == true

    private fun capture(): Bitmap? {
        val texture = gecko.textureForCapture() ?: return null
        if (!texture.isAvailable || texture.width <= 0 || texture.height <= 0) return null
        // This transient cover is stretched only while the viewport changes.
        // Bound its synchronous GPU readback and allocation to ~6 MB per pane.
        val scale = min(1.0, sqrt(1_500_000.0 / (texture.width.toDouble() * texture.height)))
        var bitmap: Bitmap? = null
        try {
            Trace.beginSection("Yeoyu.ResizeCover.allocate")
            try {
                bitmap = Bitmap.createBitmap(max(1, (texture.width * scale).toInt()),
                    max(1, (texture.height * scale).toInt()), Bitmap.Config.ARGB_8888)
            } finally {
                Trace.endSection()
            }
            Trace.beginSection("Yeoyu.ResizeCover.getBitmap")
            try {
                texture.getBitmap(bitmap)
            } finally {
                Trace.endSection()
            }
            return bitmap
        } catch (_: IllegalStateException) {
            // The rendering context can disappear during surface recovery.
        } catch (_: OutOfMemoryError) {
            // The live surface remains usable when a temporary snapshot cannot fit.
        }
        bitmap?.recycle()
        return null
    }

    private fun releaseCover(resetEpisode: Boolean) {
        generation++
        deadline?.let(host::removeCallbacks)
        deadline = null
        if (gecko.textureObserver === textureObserver) gecko.textureObserver = null
        textureObserver = null
        layoutListener?.let(gecko::removeOnLayoutChangeListener)
        layoutListener = null
        drawable?.let(host.overlay::remove)
        // Drop all bitmap references after removing the drawable. Do not recycle
        // a displayed bitmap while RenderThread may still hold its display list.
        drawable = null
        session = null
        tabId = null
        if (resetEpisode) lifecycle.clear()
        // Retire this episode before layout can synchronously deliver another
        // Texture callback. A reentrant new cover must keep its own observer.
        host.flushPendingGeckoLayout()
    }
}
