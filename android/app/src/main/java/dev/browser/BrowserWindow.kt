package dev.browser

import android.app.Activity
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
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
    // Fresh windows need an owner before their asynchronous tab creation finishes.
    private val owners = LinkedHashMap<String, BrowserWindowActivity>()

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
            // A finishing root can still hold a permission prompt until onDestroy.
            // Its imperative owner is invalid, but its tab must stay out of main.
            windows.entries.removeAll { it.key.isDestroyed }
            owners.entries.removeAll { it.value.isDestroyed || it.value.isFinishing }
            if (activity is BrowserWindowActivity) owners[activity.windowId] = activity
            if (tabId != null) windows[activity] = tabId
        }
        BrowserInputViewport.refresh(activity)
        if (tabId != null) emitTabs()
    }

    fun bind(activity: Activity, tabId: String) {
        synchronized(windows) { windows[activity] = tabId }
        BrowserInputViewport.refresh(activity)
        (activity as? BrowserWindowActivity)?.let { owner ->
            // Recreation launches a new JS root/owner with this same tab mission.
            owner.intent = Intent(owner.intent).putExtra(EXTRA_TAB, tabId)
            owner.applyTaskLabel(tabId)
        }
        emitTabs()
    }

    fun unregister(activity: Activity) {
        val removed = synchronized(windows) {
            if (activity is BrowserWindowActivity && owners[activity.windowId] === activity)
                owners.remove(activity.windowId)
            windows.remove(activity) != null
        }
        if (removed) emitTabs()
    }

    private fun owner(windowId: String): BrowserWindowActivity? = synchronized(windows) {
        owners.entries.removeAll { it.value.isDestroyed || it.value.isFinishing }
        owners[windowId]
    }

    fun missionFor(windowId: String): String? = owner(windowId)?.let(::missionOf)

    fun bindFor(windowId: String, tabId: String): Boolean {
        if (tabId.isBlank()) return false
        val target = owner(windowId) ?: return false
        val elsewhere = synchronized(windows) {
            windows.any { (activity, bound) -> activity !== target && bound == tabId &&
                !activity.isDestroyed && !activity.isFinishing }
        }
        if (elsewhere) return false
        bind(target, tabId)
        return true
    }

    fun closeFor(windowId: String): Boolean {
        val target = owner(windowId) ?: return false
        target.finish()
        // isFinishing invalidates the owner token immediately. Keep tab/prompt
        // ownership until onDestroy retires the JS root and cancels its requests.
        return true
    }

    fun tabOf(activity: Activity): String? =
        synchronized(windows) { windows[activity] }

    fun setPermissionPrompt(tabId: String, active: Boolean) {
        val owner = synchronized(windows) {
            windows.entries.firstOrNull { it.value == tabId }?.key
        } as? BrowserWindowActivity ?: return
        if (!owner.isFinishing && !owner.isDestroyed) owner.setPermissionPrompt(tabId, active)
    }

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
            GeckoSessionRegistry.emit?.let { emit ->
                val payload = com.facebook.react.bridge.Arguments.createMap().apply {
                    putString("tabIds", tabsJson())
                }
                emit("BrowserWindowTabsChanged", payload)
            }
        }
    }
}

class BrowserWindowActivity : ReactActivity() {
    /** A replacement Activity/root gets a new owner; stale old-root calls fail. */
    internal val windowId: String = java.util.UUID.randomUUID().toString()
    private var permissionPromptTab: String? = null

    internal fun setPermissionPrompt(tabId: String, active: Boolean) {
        if (active) permissionPromptTab = tabId
        else if (permissionPromptTab == tabId) permissionPromptTab = null
    }

    private fun hasPermissionPrompt() = permissionPromptTab != null &&
        permissionPromptTab == BrowserWindowCoordinator.tabOf(this)

    private fun dismissPermissionPrompt(): Boolean {
        if (!hasPermissionPrompt()) return false
        GeckoSessionRegistry.emit?.invoke("BrowserWindowPermissionDismiss", com.facebook.react.bridge.Arguments.createMap().apply {
            putString("tabId", permissionPromptTab)
        })
        return true
    }

    override fun getMainComponentName(): String = "YeoyuWindow"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        object : BrowserReactActivityDelegate(this, mainComponentName) {
            override fun getLaunchOptions(): Bundle =
                Bundle(intent.extras ?: Bundle.EMPTY).apply {
                    intent.getStringExtra(BrowserWindowCoordinator.EXTRA_TAB)?.let { putString("tabId", it) }
                    putString("windowId", this@BrowserWindowActivity.windowId)
                }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        dev.browser.BrowserAppearance.restore(this)
        super.onCreate(savedInstanceState)
        BrowserWindowCoordinator.register(this, intent?.getStringExtra(BrowserWindowCoordinator.EXTRA_TAB))
        // Observe IME geometry locally; this window keeps its own Back/Escape
        // handling and never sends pre-IME commands through the main router.
        val content = findViewById<android.view.ViewGroup>(android.R.id.content)
        val gateway = BrowserInputRoot(this, routePreIme = false)
        while (content.childCount > 0) {
            val child = content.getChildAt(0)
            val layout = child.layoutParams
            content.removeViewAt(0)
            gateway.addView(child, layout)
        }
        content.addView(gateway, android.view.ViewGroup.LayoutParams(
            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
            android.view.ViewGroup.LayoutParams.MATCH_PARENT
        ))
        BrowserInputViewport.attach(this, gateway, { BrowserWindowCoordinator.tabOf(this) })
        // Back is handled natively: engine history first, then close. The
        // global hardwareBackPress event would wake the main root's handlers.
        onBackPressedDispatcher.addCallback(
            this,
            object : androidx.activity.OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (dismissPermissionPrompt()) return
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
        BrowserInputViewport.refresh(this)
        BrowserWindowCoordinator.tabOf(this)?.let(::applyTaskLabel)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        BrowserWindowCoordinator.register(this, intent.getStringExtra(BrowserWindowCoordinator.EXTRA_TAB))
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        PermissionCoordinator.handle(requestCode, grantResults)
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        CredentialActivityCoordinator.handle(requestCode, resultCode, data)
        FilePromptCoordinator.handle(this, requestCode, resultCode, data)
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_ESCAPE && hasPermissionPrompt()) {
            if (event.action == KeyEvent.ACTION_UP) dismissPermissionPrompt()
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onUserLeaveHint() {
        dev.browser.BrowserMediaCoordinator.onUserLeaveHint(this)
        super.onUserLeaveHint()
    }

    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        BrowserInputViewport.refresh(this)
    }

    override fun onDestroy() {
        BrowserInputViewport.detach(this)
        BrowserDataModule.cancelForActivity(this)
        FilePromptCoordinator.cancelForActivity(this)
        PermissionCoordinator.cancelForActivity(this)
        BrowserWindowCoordinator.unregister(this)
        CredentialActivityCoordinator.cancelForActivity(this)
        super.onDestroy()
    }
}
