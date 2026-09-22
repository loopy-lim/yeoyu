package dev.browser

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import com.facebook.react.bridge.Arguments
import com.workspacebrowser.R
import org.json.JSONArray

/** Launcher long-press shortcuts ("새 탭", "비공개 탭"). Pushed as dynamic
 *  shortcuts on every process start so package/acceptance suffixes always
 *  resolve. Taps land in MainActivity and queue as browser commands. */
internal object BrowserShortcuts {
    private const val EXTRA = "yeoyu.shortcut"
    private val main = Handler(Looper.getMainLooper())

    fun push(context: Context) {
        val app = context.applicationContext
        try {
            val newTab = ShortcutInfoCompat.Builder(app, "yeoyu.shortcut.new-tab")
                .setShortLabel(app.getString(R.string.shortcut_new_tab))
                .setIcon(IconCompat.createWithResource(app, R.drawable.ic_shortcut_new_tab))
                .setIntent(
                    Intent("dev.browser.SHORTCUT")
                        .setClassName(app, "com.workspacebrowser.MainActivity")
                        .putExtra(EXTRA, "new-tab")
                ).build()
            val privateTab = ShortcutInfoCompat.Builder(app, "yeoyu.shortcut.private-tab")
                .setShortLabel(app.getString(R.string.shortcut_private_tab))
                .setIcon(IconCompat.createWithResource(app, R.drawable.ic_shortcut_private_tab))
                .setIntent(
                    Intent("dev.browser.SHORTCUT")
                        .setClassName(app, "com.workspacebrowser.MainActivity")
                        .putExtra(EXTRA, "private-tab")
                ).build()
            ShortcutManagerCompat.setDynamicShortcuts(app, listOf(newTab, privateTab))
        } catch (_: Exception) {
            // A launcher that refuses shortcuts must never block startup.
        }
    }
}

/** Shortcut taps are single commands. They queue durably enough to survive
 *  the cold-start gap before React listeners mount, then re-emit as
 *  BrowserCommand through the existing command registry ("tab.new",
 *  "private.newTab"). */
internal object PendingShortcuts {
    private const val EXTRA = "yeoyu.shortcut"
    private val main = Handler(Looper.getMainLooper())
    private val pending = mutableListOf<String>()

    /** Called from Activity onCreate (fresh starts only) and onNewIntent. */
    @Synchronized
    fun receive(intent: Intent?) {
        if (intent?.action != "dev.browser.SHORTCUT") return
        val command = when (intent.getStringExtra(EXTRA)) {
            "new-tab" -> "tab.new"
            "private-tab" -> "private.newTab"
            else -> return
        }
        synchronized(pending) { pending.add(command) }
        main.post {
            GeckoSessionRegistry.emit?.invoke("BrowserCommand", Arguments.createMap().apply {
                putString("command", command)
            })
        }
    }

    /** JS drains once per React mount; warm taps deliver live via the event. */
    @Synchronized
    fun drainJson(): String {
        val out = JSONArray(pending.toList()).toString()
        pending.clear()
        return out
    }
}
