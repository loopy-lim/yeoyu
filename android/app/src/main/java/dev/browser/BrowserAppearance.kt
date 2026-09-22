package dev.browser

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.view.WindowCompat
import org.json.JSONObject
import org.mozilla.geckoview.GeckoRuntimeSettings

/** Mode changes update presentation only. The existing UI preference writer owns persistence. */
object BrowserAppearance {
    private var mode: String? = null
    private var appearance = "lavender"
    private var chrome: Int? = null
    private var chromeMode: String? = null
    private var runtimeSettings: GeckoRuntimeSettings? = null

    fun initialize(context: Context) {
        if (mode != null) return
        val saved = runCatching {
            context.getSharedPreferences("browser-ui", Context.MODE_PRIVATE)
                .getString("preferences", null)?.let(::JSONObject)
        }.getOrNull()
        mode = normalizeMode(saved?.optString("colorMode"))
        appearance = if (saved?.optString("appearance") == "warm") "warm" else "lavender"
    }

    /** Call before super.onCreate: DayNight resources apply before dialogs or React inflate. */
    fun restore(activity: AppCompatActivity) {
        initialize(activity)
        activity.delegate.localNightMode = delegateMode()
    }

    /** GeckoView 155 keeps this preference live and notifies existing documents on change. */
    fun applyRuntimeSettings(settings: GeckoRuntimeSettings) {
        runtimeSettings = settings
        settings.setPreferredColorScheme(geckoMode())
    }

    /** Runs on the UI thread. uiMode is handled by MainActivity, preserving its live surface. */
    fun apply(activity: AppCompatActivity?, selectedMode: String, resolvedMode: String, chromeColor: String) {
        require(selectedMode in setOf("system", "light", "dark")) { "Unsupported color mode" }
        require(resolvedMode in setOf("light", "dark")) { "Unsupported resolved color mode" }
        require(selectedMode == "system" || selectedMode == resolvedMode) { "Inconsistent color mode" }
        require(Regex("^#[0-9a-fA-F]{6}$").matches(chromeColor)) { "Invalid chrome color" }
        val parsed = Color.parseColor(chromeColor)
        mode = selectedMode
        chrome = parsed
        chromeMode = resolvedMode
        runtimeSettings?.setPreferredColorScheme(geckoMode())
        activity?.let {
            // Only this browser Activity changes resources. This does not recreate it:
            // MainActivity's manifest handles uiMode configuration changes itself.
            if (it.delegate.localNightMode != delegateMode()) it.delegate.localNightMode = delegateMode()
            refreshSystemBars(it)
        }
    }

    /** Also call after configuration changes and immersive updates, which can reset bar flags. */
    @Suppress("DEPRECATION")
    fun refreshSystemBars(activity: AppCompatActivity) {
        initialize(activity)
        val resolved = when (mode) {
            "dark" -> "dark"
            "light" -> "light"
            else -> if (activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES) "dark" else "light"
        }
        val dark = resolved == "dark"
        // A system update can reach native before JS retints. Never reuse the previous
        // brightness's background while waiting for the next resolved theme payload.
        val background = chrome.takeIf { chromeMode == resolved } ?: Color.parseColor(
            if (dark) if (appearance == "warm") "#261d1e" else "#211c26"
            else if (appearance == "warm") "#dfcfd1" else "#d9cedf"
        )
        val window = activity.window
        window.setBackgroundDrawable(ColorDrawable(background))
        window.statusBarColor = background
        window.navigationBarColor = background
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }

    internal fun normalizeMode(value: String?): String = when (value) {
        "light", "dark" -> value
        else -> "system"
    }

    private fun delegateMode(): Int = when (mode) {
        "light" -> AppCompatDelegate.MODE_NIGHT_NO
        "dark" -> AppCompatDelegate.MODE_NIGHT_YES
        else -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
    }

    private fun geckoMode(): Int = when (mode) {
        "light" -> GeckoRuntimeSettings.COLOR_SCHEME_LIGHT
        "dark" -> GeckoRuntimeSettings.COLOR_SCHEME_DARK
        else -> GeckoRuntimeSettings.COLOR_SCHEME_SYSTEM
    }
}
