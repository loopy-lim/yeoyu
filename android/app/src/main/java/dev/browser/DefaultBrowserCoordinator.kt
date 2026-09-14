package dev.browser

import android.app.Activity
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import java.lang.ref.WeakReference
import org.json.JSONObject

object DefaultBrowserCoordinator {
    private const val REQUEST_CODE = 0x2101
    private data class Pending(val activity: WeakReference<Activity>, val complete: (String) -> Unit)
    private var pending: Pending? = null

    fun status(context: Context): String {
        val roles = if (Build.VERSION.SDK_INT >= 29) context.getSystemService(RoleManager::class.java) else null
        val available = if (Build.VERSION.SDK_INT >= 29) roles?.isRoleAvailable(RoleManager.ROLE_BROWSER) == true else true
        val held = if (Build.VERSION.SDK_INT >= 29) roles?.isRoleHeld(RoleManager.ROLE_BROWSER) == true else false
        return JSONObject().put("available", available).put("held", held)
            .put("settingsOnly", Build.VERSION.SDK_INT < 29).toString()
    }

    /** Only invoked by the settings button, never during initialization. */
    fun request(activity: Activity, complete: (String) -> Unit) {
        check(pending == null) { "Default browser selection is already open" }
        val intent = if (Build.VERSION.SDK_INT >= 29) {
            val roles = activity.getSystemService(RoleManager::class.java)
            check(roles.isRoleAvailable(RoleManager.ROLE_BROWSER)) { "Default browser selection is unavailable" }
            if (roles.isRoleHeld(RoleManager.ROLE_BROWSER)) { complete(status(activity)); return }
            roles.createRequestRoleIntent(RoleManager.ROLE_BROWSER)
        } else Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
        pending = Pending(WeakReference(activity), complete)
        try { activity.startActivityForResult(intent, REQUEST_CODE) }
        catch (failure: Exception) { pending = null; throw failure }
    }

    fun handleActivityResult(requestCode: Int): Boolean {
        if (requestCode != REQUEST_CODE) return false
        val request = pending ?: return true
        pending = null
        request.activity.get()?.let { request.complete(status(it)) }
        return true
    }

    fun cancelForActivity(activity: Activity) {
        val request = pending?.takeIf { it.activity.get() === activity } ?: return
        pending = null
        request.complete(status(activity))
    }
}
