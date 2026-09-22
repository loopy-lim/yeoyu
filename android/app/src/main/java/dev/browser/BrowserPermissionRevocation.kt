package dev.browser

import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession.PermissionDelegate
import org.mozilla.geckoview.GeckoSession.PermissionDelegate.ContentPermission

/** Removes Gecko's remembered content decision as well as the app's rule.
 * Invoke on a thread with a Looper (the module uses the Android UI thread). */
object BrowserPermissionRevocation {
    fun reset(runtime: GeckoRuntime, origin: String?, kind: String?, reply: (Result<Unit>) -> Unit) {
        try {
            require(origin == null || permissionOrigin(origin) == origin) { "A full website origin is required" }
            require(kind == null || kind in appPermissionKinds) { "Unsupported site permission" }
            // Media grants live in the app ledger; persistent storage cannot be
            // revoked with the content-permission API. Never clear user data here.
            if (kind == "persistent-storage" || kind == "camera" || kind == "microphone") {
                reply(Result.success(Unit))
                return
            }
            val storage = runtime.storageController
            storage.allPermissions.accept({ permissions ->
                try {
                    requireNotNull(permissions) { "Could not read website permissions" }
                        .filter { matches(it, origin, kind) }.forEach {
                        storage.setPermission(it, ContentPermission.VALUE_PROMPT)
                    }
                    // setPermission is void in GV155. Read back after dispatch so
                    // the UI does not delete its rule after an unconfirmed reset.
                    storage.allPermissions.accept({ updated ->
                        if (updated == null) {
                            reply(Result.failure(IllegalStateException("Could not confirm website permission reset")))
                        } else {
                            val retained = updated.any {
                                matches(it, origin, kind) && it.value != ContentPermission.VALUE_PROMPT
                            }
                            if (retained) reply(Result.failure(IllegalStateException("The website permission could not be reset; try again")))
                            else reply(Result.success(Unit))
                        }
                    }, { error -> reply(Result.failure(error ?: IllegalStateException("Could not confirm website permission reset"))) })
                } catch (error: Exception) {
                    reply(Result.failure(error))
                }
            }, { error -> reply(Result.failure(error ?: IllegalStateException("Could not read website permissions"))) })
        } catch (error: Exception) {
            reply(Result.failure(error))
        }
    }

    private fun matches(permission: ContentPermission, origin: String?, kind: String?): Boolean =
        matchesPermissionReset(permission.uri, contentKind(permission.permission), permission.privateMode, origin, kind)

    private fun contentKind(permission: Int): String? = when (permission) {
        PermissionDelegate.PERMISSION_GEOLOCATION -> "geolocation"
        PermissionDelegate.PERMISSION_DESKTOP_NOTIFICATION -> "notifications"
        PermissionDelegate.PERMISSION_AUTOPLAY_AUDIBLE, PermissionDelegate.PERMISSION_AUTOPLAY_INAUDIBLE -> "autoplay"
        else -> null
    }

    private val appPermissionKinds = setOf("camera", "microphone", "geolocation", "notifications", "autoplay", "persistent-storage")
}

internal fun matchesPermissionReset(
    uri: String,
    permissionKind: String?,
    privateMode: Boolean,
    requestedOrigin: String?,
    requestedKind: String?,
): Boolean {
    if (privateMode || permissionKind !in setOf("geolocation", "notifications", "autoplay")) return false
    val origin = permissionOrigin(uri) ?: return false
    return (requestedOrigin == null || requestedOrigin == origin) &&
        (requestedKind == null || requestedKind == permissionKind)
}
