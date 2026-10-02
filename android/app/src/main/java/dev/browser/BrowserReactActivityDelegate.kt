package dev.browser

import android.app.Activity
import com.facebook.react.ReactActivity
import com.facebook.react.ReactHost
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.common.LifecycleState
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.modules.core.DefaultHardwareBackBtnHandler
import java.util.IdentityHashMap

/** Each surface keeps the normal RN delegate, but shares one host lifecycle owner.
 * Android desktop/multi-window can resume several Activities at the same time;
 * ReactHost has only one current Activity and identity-checks every pause. */
internal open class BrowserReactActivityDelegate(
    private val activity: ReactActivity,
    componentName: String,
) : DefaultReactActivityDelegate(activity, componentName) {
    private var activityHost: ReactHost? = null

    override fun getReactHost(): ReactHost? {
        activityHost?.let { return it }
        val shared = super.getReactHost() ?: return null
        return SharedReactHostLifecycle.attach(shared, activity).also { activityHost = it }
    }
}

private object SharedReactHostLifecycle {
    private val hosts = IdentityHashMap<ReactHost, HostLifecycle>()

    fun attach(host: ReactHost, activity: ReactActivity): ReactHost {
        UiThreadUtil.assertOnUiThread()
        val lifecycle = hosts.getOrPut(host) { HostLifecycle(host) { hosts.remove(host) } }
        return lifecycle.attach(activity)
    }
}

private class HostLifecycle(private val host: ReactHost, private val retired: () -> Unit) {
    private class Root(val activity: ReactActivity) {
        var lifecycle = LifecycleState.BEFORE_CREATE
        var focused = false
        var resumedOrder = 0L
        var focusOrder = 0L
        var backHandler: DefaultHardwareBackBtnHandler? = null
    }

    private val roots = LinkedHashMap<Activity, Root>()
    private var owner: Root? = null
    private var order = 0L
    private var hostFocused = false

    fun attach(activity: ReactActivity): ReactHost {
        val root = roots.getOrPut(activity) { Root(activity) }
        // createSurface and all non-lifecycle operations still reach the real
        // host. ReactDelegate unloads only this root's surface before destroy.
        return object : ReactHost by host {
            override val lifecycleState: LifecycleState get() = root.lifecycle

            override fun onHostResume(activity: Activity?, defaultBackButtonImpl: DefaultHardwareBackBtnHandler?) {
                check(activity == null || activity === root.activity)
                resume(root, defaultBackButtonImpl ?: root.activity)
            }

            override fun onHostResume(activity: Activity?) = onHostResume(activity, root.activity)
            override fun onHostPause(activity: Activity?) {
                check(activity == null || activity === root.activity)
                pause(root)
            }
            override fun onHostPause() = pause(root)
            override fun onHostDestroy(activity: Activity?) {
                check(activity == null || activity === root.activity)
                destroy(root)
            }
            override fun onHostDestroy() = destroy(root)
            override fun onWindowFocusChange(hasFocus: Boolean) = focus(root, hasFocus)
            override fun onHostLeaveHint(activity: Activity?) {
                UiThreadUtil.assertOnUiThread()
                if (owner === root && root.lifecycle == LifecycleState.RESUMED)
                    host.onHostLeaveHint(root.activity)
            }
        }
    }

    private fun resume(root: Root, backHandler: DefaultHardwareBackBtnHandler) {
        UiThreadUtil.assertOnUiThread()
        if (roots[root.activity] !== root) return
        root.lifecycle = LifecycleState.RESUMED
        root.backHandler = backHandler
        root.resumedOrder = ++order
        reconcile()
    }

    private fun pause(root: Root) {
        UiThreadUtil.assertOnUiThread()
        if (roots[root.activity] !== root) return
        root.lifecycle = LifecycleState.BEFORE_RESUME
        root.focused = false
        reconcile()
    }

    private fun focus(root: Root, hasFocus: Boolean) {
        UiThreadUtil.assertOnUiThread()
        if (roots[root.activity] !== root) return
        if (hasFocus && (root.lifecycle != LifecycleState.RESUMED ||
                root.activity.isFinishing || root.activity.isDestroyed)) return
        root.focused = hasFocus
        if (hasFocus) root.focusOrder = ++order
        reconcile()
    }

    private fun destroy(root: Root) {
        UiThreadUtil.assertOnUiThread()
        if (roots[root.activity] !== root) return
        roots.remove(root.activity)
        root.lifecycle = LifecycleState.BEFORE_CREATE
        root.focused = false
        if (roots.isEmpty()) {
            // The final root may differ from RN's last paused currentActivity.
            // The Activity overload would then skip global lifecycle cleanup.
            host.onHostDestroy()
            owner = null
            retired()
        } else {
            reconcile()
        }
    }

    private fun reconcile() {
        val resumed = roots.values.filter {
            it.lifecycle == LifecycleState.RESUMED &&
                !it.activity.isFinishing && !it.activity.isDestroyed
        }
        val next = resumed.filter { it.focused }.maxByOrNull { it.focusOrder }
            ?: resumed.maxByOrNull { it.resumedOrder }
        if (next != null) {
            if (owner !== next || host.lifecycleState != LifecycleState.RESUMED) {
                host.onHostResume(next.activity, next.backHandler)
                // RN 0.87's lifecycle manager skips context.onHostResume when
                // already RESUMED. Refresh its Activity on focus handoff without
                // broadcasting a false AppState background/media interruption.
                host.currentReactContext?.let { context ->
                    if (context.currentActivity !== next.activity) context.onHostResume(next.activity)
                }
                owner = next
            }
            forwardFocus(next.focused)
        } else {
            forwardFocus(false)
            if (host.lifecycleState == LifecycleState.RESUMED)
                owner?.let { host.onHostPause(it.activity) }
            // Other roots may remain created but paused. Keep the shared paused
            // lifecycle until a live root resumes; never destroy their context.
        }
    }

    private fun forwardFocus(focused: Boolean) {
        if (hostFocused == focused) return
        hostFocused = focused
        host.onWindowFocusChange(focused)
    }
}
