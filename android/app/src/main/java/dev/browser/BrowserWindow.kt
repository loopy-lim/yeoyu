package dev.browser

import android.app.Activity
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.modules.core.DeviceEventManagerModule
import androidx.core.content.pm.ShortcutManagerCompat
import com.workspacebrowser.R
import org.json.JSONArray

/** OS-level windows: a second, chrome-light host for exactly one tab.
 *  The main Activity stays the single Arc browser; each window is its own
 *  task (documentLaunchMode), so free-form/desktop modes can show several
 *  side by side. Tabs stay process-global — a windowed tab still lives in
 *  the sidebar and returns when its window closes. */
internal object BrowserWindowCoordinator {
    const val EXTRA_TAB = "yeoyu.window.tab"
    private const val COMPONENT = "YeoyuWindow"
    private val main = Handler(Looper.getMainLooper())
    private val windows = LinkedHashMap<Activity, String>()

    fun launch(host: Context, tabId: String?): Boolean {
        // A tab already living in a window is brought forward, not duplicated.
        if (tabId != null) {
            val existing = synchronized(windows) {
                windows.entries.firstOrNull { it.value == tabId }?.key
            }
            if (existing != null && !existing.isFinishing) {
                return try {
                    val manager = host.getSystemService(android.app.ActivityManager::class.java)
                    manager?.moveTaskToFront(existing.taskId, 0)
                    true
                } catch (_: Exception) { false }
            }
        }
        val intent = Intent(host, BrowserWindowActivity::class.java)
            .addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NEW_DOCUMENT or
                    Intent.FLAG_ACTIVITY_MULTIPLE_TASK
            )
        if (tabId != null) intent.putExtra(EXTRA_TAB, tabId)
        return try { host.startActivity(intent); true } catch (_: Exception) { false }
    }

    fun register(activity: Activity, tabId: String?) {
        synchronized(windows) {
            windows.entries.removeAll { it.key.isDestroyed || it.key.isFinishing }
            if (tabId != null) windows[activity] = tabId
        }
        if (tabId != null) emitTabs()
    }

    fun bind(activity: Activity, tabId: String) {
        synchronized(windows) { windows[activity] = tabId }
        (activity as? BrowserWindowActivity)?.applyTaskLabel(tabId)
        emitTabs()
    }

    fun unregister(activity: Activity) {
        val removed = synchronized(windows) { windows.remove(activity) != null }
        if (removed) emitTabs()
    }

    fun tabOf(activity: Activity): String? =
        synchronized(windows) { windows[activity] }

    fun closeForTab(tabId: String): Boolean {
        val target = synchronized(windows) {
            windows.entries.firstOrNull { it.value == tabId }?.key
        } ?: return false
        target.finish()
        return true
    }

    fun close(activity: Activity) { activity.finish() }

    fun tabsJson(): String = synchronized(windows) {
        JSONArray(windows.values.filterNotNull().distinct()).toString()
    }

    /** Mission of the calling window: existing tab id or "" for a fresh tab. */
    fun missionOf(activity: Activity): String? =
        if (activity is BrowserWindowActivity)
            (tabOf(activity) ?: activity.intent?.getStringExtra(EXTRA_TAB) ?: "")
        else null

    private fun emitTabs() {
        main.post {
            val payload = com.facebook.react.bridge.Arguments.createMap().apply {
                putString("tabIds", tabsJson())
            }
            GeckoSessionRegistry.emit?.invoke("BrowserWindowTabsChanged", payload)
        }
    }
}

class BrowserWindowActivity : ReactActivity() {
    override fun getMainComponentName(): String = "YeoyuWindow"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
            override fun getLaunchOptions(): Bundle =
                intent.extras ?: Bundle.EMPTY
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        dev.browser.BrowserAppearance.restore(this)
        super.onCreate(savedInstanceState)
        BrowserWindowCoordinator.register(this, intent?.getStringExtra(BrowserWindowCoordinator.EXTRA_TAB))
        // Back is handled natively: engine history first, then close. The
        // global hardwareBackPress event would wake the main root's handlers.
        onBackPressedDispatcher.addCallback(
            this,
            object : androidx.activity.OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    val id = BrowserWindowCoordinator.tabOf(this@BrowserWindowActivity)
                    if (id != null && GeckoSessionRegistry.windowGoBack(id)) return
                    finish()
                }
            }
        )
    }

    /** Recents/free-form show several windows of this app at once; label each
     *  task with its tab so they are distinguishable. */
    fun applyTaskLabel(tabId: String) {
        val entry = GeckoSessionRegistry.entry(tabId)
        val label = entry?.title?.takeIf { it.isNotBlank() }
            ?: entry?.url?.takeIf { it.isNotBlank() }
            ?: getString(R.string.app_name)
        val description = if (Build.VERSION.SDK_INT >= 33) {
            android.app.ActivityManager.TaskDescription.Builder().setLabel(label).build()
        } else {
            @Suppress("DEPRECATION")
            android.app.ActivityManager.TaskDescription(label)
        }
        setTaskDescription(description)
    }

    override fun onResume() {
        super.onResume()
        BrowserWindowCoordinator.tabOf(this)?.let(::applyTaskLabel)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        BrowserWindowCoordinator.register(this, intent.getStringExtra(BrowserWindowCoordinator.EXTRA_TAB))
    }

    override fun onUserLeaveHint() {
        dev.browser.BrowserMediaCoordinator.onUserLeaveHint(this)
        super.onUserLeaveHint()
    }

    override fun onDestroy() {
        BrowserWindowCoordinator.unregister(this)
        super.onDestroy()
    }
}
