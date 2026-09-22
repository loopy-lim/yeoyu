package dev.browser

import android.content.Context
import android.os.Build
import android.view.View
import android.view.Window
import android.view.WindowInsets
import android.view.WindowInsetsController
import org.json.JSONObject

/** Single insets implementation shared by BrowserModule and MainActivity. */
@Suppress("DEPRECATION")
object ImmersiveMode {
    private const val PREFS = "browser-ui"
    private val immersiveFlags = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
        View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
        View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
    private val ownedFlags = immersiveFlags or View.SYSTEM_UI_FLAG_IMMERSIVE or
        View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION

    fun isEnabled(context: Context): Boolean {
        val json = context.getSharedPreferences(PREFS, 0).getString("preferences", null) ?: return true
        return runCatching { JSONObject(json).optBoolean("fullscreen", true) }.getOrDefault(true)
    }

    fun set(window: Window?, enabled: Boolean) {
        if (window == null) return
        val decor = window.decorView
        // Fullscreen controls only the status bar. Keep Home visible instead of
        // fighting a tablet's mouse-triggered navigation-bar reveal/hide cycle.
        // Clear legacy navigation hiding too, without erasing appearance flags.
        val flags = (decor.systemUiVisibility and ownedFlags.inv()) or
            if (enabled) immersiveFlags else 0
        if (decor.systemUiVisibility != flags) decor.systemUiVisibility = flags

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Only the immersive direction may touch decor fits. Forcing true
            // under API 35+ edge-to-edge can leave the window surface undrawn.
            if (enabled) window.setDecorFitsSystemWindows(false)
            val controller = window.insetsController ?: return
            val behavior = if (enabled) WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                else WindowInsetsController.BEHAVIOR_DEFAULT
            if (controller.systemBarsBehavior != behavior) controller.systemBarsBehavior = behavior
            controller.show(WindowInsets.Type.navigationBars() or WindowInsets.Type.captionBar())
            if (enabled) controller.hide(WindowInsets.Type.statusBars())
            else controller.show(WindowInsets.Type.statusBars())
        }
    }
}
