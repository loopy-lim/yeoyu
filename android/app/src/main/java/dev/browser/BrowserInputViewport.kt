package dev.browser

import android.app.Activity
import android.graphics.Rect
import android.os.Build
import android.view.View
import android.view.ViewTreeObserver
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import com.facebook.react.bridge.Arguments
import org.json.JSONObject
import kotlin.math.max

/** Coordinates and IME values are in physical pixels; JS sheet geometry is dp. */
internal fun inputViewportKeyboardInset(
    apiLevel: Int, imeBottom: Int, systemBottom: Int,
    windowBottom: Int, visibleBottom: Int, density: Float,
): Float {
    val scale = density.takeIf { it > 0f } ?: 1f
    val insets = max(0, imeBottom - systemBottom)
    // Old platforms approximate Type.ime(). A visible-frame gap is a fallback,
    // measured against this window, never the shared display's total height.
    val fallback = max(0, windowBottom - visibleBottom - systemBottom)
        .takeIf { apiLevel < 30 && it > 100f * scale } ?: 0
    return max(insets, fallback) / scale
}

internal data class InputViewportSnapshot(
    val scope: String, val keyboardInset: Float, val visibleHeight: Float,
    val width: Float = 0f, val height: Float = 0f,
) {
    fun json(): String = JSONObject().put("scope", scope).put("keyboardInset", keyboardInset)
        .put("visibleHeight", visibleHeight).toString()
}

/** Observes each Activity's own gateway without consuming insets or relaying layout. */
internal object BrowserInputViewport {
    private val trackers = LinkedHashMap<Activity, Tracker>()

    fun attach(
        activity: Activity, root: BrowserInputRoot, scope: () -> String?,
        publish: (InputViewportSnapshot) -> Unit = ::emit,
    ) {
        detach(activity)
        trackers[activity] = Tracker(root, scope, publish).also { it.start() }
    }

    fun refresh(activity: Activity) { trackers[activity]?.refresh() }

    fun detach(activity: Activity) { trackers.remove(activity)?.stop() }

    /** Both bridge reads and events confirm a scope, even with several resumed windows. */
    fun snapshot(scope: String): InputViewportSnapshot {
        val tracker = trackers.entries.lastOrNull { (activity, tracker) ->
            !activity.isDestroyed && !activity.isFinishing && tracker.owner() == scope
        }?.value ?: return InputViewportSnapshot(scope, 0f, 0f)
        tracker.snapshot()
        return tracker.latest?.takeIf { it.scope == scope } ?: InputViewportSnapshot(scope, 0f, 0f)
    }

    private fun emit(snapshot: InputViewportSnapshot) {
        GeckoSessionRegistry.emit?.invoke("BrowserInputViewportChanged", Arguments.createMap().apply {
            putString("scope", snapshot.scope)
            putDouble("keyboardInset", snapshot.keyboardInset.toDouble())
            putDouble("visibleHeight", snapshot.visibleHeight.toDouble())
        })
    }

    private class Tracker(
        private val root: BrowserInputRoot,
        val owner: () -> String?,
        private val publish: (InputViewportSnapshot) -> Unit,
    ) : ViewTreeObserver.OnGlobalLayoutListener, View.OnAttachStateChangeListener {
        var latest: InputViewportSnapshot? = null
            private set
        private var live = false
        private var lastInsets: WindowInsetsCompat? = null
        private val frame = Rect()
        private val location = IntArray(2)
        private val animation = object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
            override fun onProgress(insets: WindowInsetsCompat, runningAnimations: MutableList<WindowInsetsAnimationCompat>): WindowInsetsCompat {
                refresh(insets)
                return insets
            }
            override fun onEnd(animation: WindowInsetsAnimationCompat) { refresh() }
        }

        fun start() {
            live = true
            root.viewportObserver = { refresh(WindowInsetsCompat.toWindowInsetsCompat(it, root)) }
            root.viewTreeObserver.addOnGlobalLayoutListener(this)
            root.addOnAttachStateChangeListener(this)
            ViewCompat.setWindowInsetsAnimationCallback(root, animation)
            ViewCompat.requestApplyInsets(root)
            refresh()
        }

        fun stop() {
            live = false
            root.viewportObserver = null
            if (root.viewTreeObserver.isAlive) root.viewTreeObserver.removeOnGlobalLayoutListener(this)
            root.removeOnAttachStateChangeListener(this)
            ViewCompat.setWindowInsetsAnimationCallback(root, null)
            latest?.let { publish(InputViewportSnapshot(it.scope, 0f, 0f)) }
            latest = null
        }

        override fun onGlobalLayout() { refresh() }
        override fun onViewAttachedToWindow(view: View) {
            ViewCompat.requestApplyInsets(root)
            root.post { refresh() }
        }
        override fun onViewDetachedFromWindow(view: View) {}

        fun snapshot() {
            // During animation rootWindowInsets may already describe the end
            // state. A newly opened sheet must receive our last delivered IME
            // frame, while width/height can still be refreshed synchronously.
            refresh(lastInsets)
        }

        fun refresh(received: WindowInsetsCompat? = null) {
            if (!live) return
            val scope = owner()
            if (latest?.scope != scope) {
                latest?.let { publish(InputViewportSnapshot(it.scope, 0f, 0f)) }
                latest = null
            }
            if (scope == null) return
            val insets = received ?: ViewCompat.getRootWindowInsets(root) ?: lastInsets
            if (insets != null) lastInsets = insets
            root.getWindowVisibleDisplayFrame(frame)
            root.getLocationOnScreen(location)
            val density = root.resources.displayMetrics.density
            val keyboard = inputViewportKeyboardInset(Build.VERSION.SDK_INT,
                insets?.getInsets(WindowInsetsCompat.Type.ime())?.bottom ?: 0,
                insets?.getInsets(WindowInsetsCompat.Type.systemBars())?.bottom ?: 0,
                location[1] + root.height, frame.bottom, density)
            val height = root.height / density
            val next = InputViewportSnapshot(scope, keyboard, max(0f, height - keyboard), root.width / density, height)
            if (next != latest) { latest = next; publish(next) }
        }
    }
}
