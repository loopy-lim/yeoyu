package dev.browser

import android.content.Context
import android.content.res.Configuration
import org.json.JSONObject
import java.util.Locale

/** Localize only browser-owned chrome; never change the OS or Gecko content locale. */
internal object BrowserAppStrings {
    @Volatile private var selected: String? = null

    fun setLanguage(language: String) {
        selected = language.takeIf { it == "ko" || it == "en" } ?: "system"
    }

    fun language(context: Context): String {
        val preference = selected ?: runCatching {
            val raw = context.getSharedPreferences("browser-ui", 0).getString("preferences", null)
            JSONObject(raw ?: "{}").optString("language", "system")
        }.getOrDefault("system")
        return when (preference) {
            "ko", "en" -> preference
            else -> if (Locale.getDefault().language == "ko") "ko" else "en"
        }
    }

    fun get(context: Context, id: Int, vararg args: Any): String {
        val configuration = Configuration(context.resources.configuration)
        configuration.setLocale(Locale.forLanguageTag(language(context)))
        return context.createConfigurationContext(configuration).getString(id, *args)
    }
}
