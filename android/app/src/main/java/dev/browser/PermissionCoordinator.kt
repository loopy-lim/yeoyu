package dev.browser

import android.app.Activity
import android.Manifest
import android.content.pm.PackageManager
import com.facebook.react.bridge.Promise

/** Bridges Activity.requestPermissions results back to the JS promise that asked. */
object PermissionCoordinator {
    private var nextCode = 1
    private data class Request(val permissions: Array<String>, val promise: Promise)
    private val pending = mutableMapOf<Int, Request>()

    fun request(activity: Activity, permissions: Array<String>, promise: Promise) {
        val code = nextCode++
        pending[code] = Request(permissions.copyOf(), promise)
        try {
            activity.requestPermissions(permissions, code)
        } catch (_: Exception) {
            pending.remove(code)
            promise.resolve(false)
        }
    }

    fun handle(code: Int, grantResults: IntArray) {
        val request = pending.remove(code) ?: return
        request.promise.resolve(
            grantResults.isNotEmpty() && grantResults.size == request.permissions.size &&
                requestedAndroidPermissionsHeld(request.permissions) { permission ->
                    grantResults[request.permissions.indexOf(permission)] == PackageManager.PERMISSION_GRANTED
                }
        )
    }
}

/** Approximate location is a valid answer when both accuracy levels are offered.
 * Camera, microphone and every non-location capability remain independent. */
internal fun requestedAndroidPermissionsHeld(
    permissions: Array<out String>,
    held: (String) -> Boolean,
): Boolean {
    val fine = Manifest.permission.ACCESS_FINE_LOCATION
    val coarse = Manifest.permission.ACCESS_COARSE_LOCATION
    val locationPair = permissions.contains(fine) && permissions.contains(coarse)
    return permissions.all { permission ->
        if (locationPair && (permission == fine || permission == coarse)) held(fine) || held(coarse)
        else held(permission)
    }
}
