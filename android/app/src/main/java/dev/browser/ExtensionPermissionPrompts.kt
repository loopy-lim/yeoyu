package dev.browser

import android.app.Activity
import android.app.AlertDialog
import android.app.Application
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.ScrollView
import android.widget.TextView
import com.workspacebrowser.R
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.WebExtension

/** The host validates installation identity and operation ownership before calling.
 * Every foreground prompt has one owner and one explicit answer; overlap is denied. */
internal object ExtensionPermissionPrompts {
    private const val TECHNICAL_DATA = "technicalAndInteraction"
    private const val TIMEOUT_MS = 120_000L
    private val main = Handler(Looper.getMainLooper())
    private data class Pending(val token: Any, val cancel: () -> Unit)
    private var pending: Pending? = null

    fun install(
        extension: WebExtension,
        permissions: Array<String>,
        origins: Array<String>,
        data: Array<String>,
    ): GeckoResult<WebExtension.PermissionPromptResponse> = prompt(
        extension,
        "Install extension",
        permissions,
        origins,
        data,
        installing = true,
    ) { allow ->
        // GV155's third field controls optional technical/interaction collection.
        // This dialog offers no opt-in for it, so neither private nor technical
        // access can become granted merely by accepting required install access.
        WebExtension.PermissionPromptResponse(allow, false, false)
    }

    fun permissions(
        extension: WebExtension,
        title: String,
        permissions: Array<String>,
        origins: Array<String>,
        data: Array<String>,
    ): GeckoResult<AllowOrDeny> = prompt(
        extension, title, permissions, origins, data, installing = false,
    ) { allow -> if (allow) AllowOrDeny.ALLOW else AllowOrDeny.DENY }

    fun closeAll() = onMain { pending?.cancel?.invoke() }

    private fun <T> prompt(
        extension: WebExtension,
        title: String,
        permissions: Array<String>,
        origins: Array<String>,
        data: Array<String>,
        installing: Boolean,
        response: (Boolean) -> T,
    ): GeckoResult<T> {
        val result = GeckoResult<T>()
        // Snapshot the reviewed request; caller-owned arrays cannot change the
        // grant after the prompt has been scheduled on the UI thread.
        val permissionNames = permissions.copyOf()
        val originNames = origins.copyOf()
        val dataNames = data.copyOf()
        onMain {
            val activity = GeckoSessionRegistry.activityProvider?.invoke()
            if (pending != null || activity == null || activity.isFinishing ||
                activity.isDestroyed || (!activity.hasWindowFocus() &&
                    !BrowserExtensionViews.hasForegroundPanel(activity, extension.id))) {
                result.complete(response(false))
                return@onMain
            }
            val token = Any()
            var finished = false
            var dialog: AlertDialog? = null
            var timeout: Runnable? = null
            var lifecycle: Application.ActivityLifecycleCallbacks? = null
            fun finish(allow: Boolean) {
                if (finished) return
                finished = true
                val stillForeground = allow && runCatching {
                    !activity.isFinishing && !activity.isDestroyed &&
                        GeckoSessionRegistry.activityProvider?.invoke() === activity &&
                        dialog?.window?.decorView?.hasWindowFocus() == true
                }.getOrDefault(false)
                if (pending?.token === token) pending = null
                timeout?.let(main::removeCallbacks)
                lifecycle?.let { runCatching { activity.application.unregisterActivityLifecycleCallbacks(it) } }
                dialog?.setOnDismissListener(null)
                runCatching { dialog?.dismiss() }
                result.complete(response(allow && stillForeground))
            }
            pending = Pending(token) { finish(false) }
            try {
                lifecycle = object : Application.ActivityLifecycleCallbacks {
                    override fun onActivityPaused(owner: Activity) { if (owner === activity) finish(false) }
                    override fun onActivityStopped(owner: Activity) { if (owner === activity) finish(false) }
                    override fun onActivityDestroyed(owner: Activity) { if (owner === activity) finish(false) }
                    override fun onActivityCreated(owner: Activity, state: Bundle?) = Unit
                    override fun onActivityStarted(owner: Activity) = Unit
                    override fun onActivityResumed(owner: Activity) = Unit
                    override fun onActivitySaveInstanceState(owner: Activity, state: Bundle) = Unit
                }.also { activity.application.registerActivityLifecycleCallbacks(it) }
                val name = extension.metaData.name?.takeIf { it.isNotBlank() } ?: extension.id
                val content = TextView(activity).apply {
                    text = describe(activity, extension, permissionNames, originNames, dataNames, installing)
                    textSize = 16f
                    setTextIsSelectable(true)
                    setLineSpacing(0f, 1.12f)
                    val padding = (20 * resources.displayMetrics.density).toInt()
                    setPadding(padding, padding, padding, padding)
                }
                val scroll = ScrollView(activity).apply { addView(content) }
                val created = AlertDialog.Builder(activity)
                    .setTitle("${BrowserAppStrings.get(activity, when (title) {
                        "Install extension" -> R.string.browser_install_extension
                        "Update permissions" -> R.string.browser_update_permissions
                        else -> R.string.browser_additional_permissions
                    })}: ${visible(name)}")
                    .setView(scroll)
                    .setNegativeButton(BrowserAppStrings.get(activity, R.string.browser_cancel)) { _, _ -> finish(false) }
                    .setPositiveButton(BrowserAppStrings.get(activity, if (installing) R.string.browser_allow_install else R.string.browser_allow)) { _, _ -> finish(true) }
                    .setOnCancelListener { finish(false) }
                    .create()
                dialog = created
                created.setOnDismissListener { finish(false) }
                created.setCanceledOnTouchOutside(true)
                created.show()
                if (finished) return@onMain
                // Keep the action buttons visible; the full request remains
                // scrollable at large font sizes and in short app windows.
                scroll.layoutParams = scroll.layoutParams.apply {
                    height = (activity.resources.displayMetrics.heightPixels * 0.5f).toInt()
                }
                timeout = Runnable { finish(false) }.also { main.postDelayed(it, TIMEOUT_MS) }
            } catch (_: Exception) {
                finish(false)
            }
        }
        return result
    }

    private fun describe(
        activity: Activity,
        extension: WebExtension,
        permissions: Array<String>,
        origins: Array<String>,
        data: Array<String>,
        installing: Boolean,
    ): String = buildString {
        fun str(id: Int) = BrowserAppStrings.get(activity, id)
        append(visible(extension.metaData.name ?: extension.id))
        append("\n${BrowserAppStrings.get(activity, R.string.browser_extension_id, visible(extension.id))}\n\n")
        append(str(if (installing) R.string.browser_extension_install_intro else R.string.browser_extension_more_intro))
        append(" ${str(R.string.browser_extension_consent)}\n\n")
        append("${str(R.string.browser_permissions_heading)}\n")
        if (permissions.isEmpty()) append("${str(R.string.browser_no_permissions)}\n")
        permissions.forEach { append("• ${visible(it)}\n") }
        append("\n${str(R.string.browser_websites_heading)}\n")
        if (origins.isEmpty()) append("${str(R.string.browser_no_websites)}\n")
        origins.forEach { append("• ${if (it == "<all_urls>") str(R.string.browser_all_urls) else visible(it)}\n") }
        append("\n${str(if (installing) R.string.browser_required_data_heading else R.string.browser_requested_data_heading)}\n")
        append("${str(R.string.browser_data_explanation)}\n")
        val requestedData = if (installing) data.filterNot { it == TECHNICAL_DATA } else data.toList()
        if (requestedData.isEmpty()) append("${str(R.string.browser_no_data)}\n")
        requestedData.forEach { append("• ${dataDescription(activity, it)}\n") }
        if (installing) {
            append("\n${str(R.string.browser_install_not_enabled)}\n")
            if (TECHNICAL_DATA in data || TECHNICAL_DATA in extension.metaData.optionalDataCollectionPermissions.orEmpty()) {
                append("${str(R.string.browser_technical_off)}\n")
            }
        }
        append("\n${str(R.string.browser_extension_after)}")
    }

    private fun dataDescription(activity: Activity, value: String): String {
        val id = when (value) {
            "none" -> R.string.browser_data_none
            "authenticationInfo" -> R.string.browser_data_auth
            "bookmarksInfo" -> R.string.browser_data_bookmarks
            "browsingActivity" -> R.string.browser_data_browsing
            "financialAndPaymentInfo" -> R.string.browser_data_financial
            "healthInfo" -> R.string.browser_data_health
            "locationInfo" -> R.string.browser_data_location
            "personalCommunications" -> R.string.browser_data_messages
            "personallyIdentifyingInfo" -> R.string.browser_data_identity
            "searchTerms" -> R.string.browser_data_search
            TECHNICAL_DATA -> R.string.browser_data_technical
            "websiteActivity" -> R.string.browser_data_website_actions
            "websiteContent" -> R.string.browser_data_website_content
            else -> R.string.browser_data_other
        }
        return "${BrowserAppStrings.get(activity, id)} (${visible(value)})"
    }

    /** Keep metadata and raw identifiers as plain text, including visible escapes
     * for invisible control characters that could disguise the requested scope. */
    private fun visible(value: String): String = value.map { character ->
        if (Character.isISOControl(character) || Character.getType(character) == Character.FORMAT.toInt())
            "\\u%04x".format(character.code)
        else character.toString()
    }.joinToString("")

    private fun onMain(action: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) action() else main.post { action() }
    }
}
