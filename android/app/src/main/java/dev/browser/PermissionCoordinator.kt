package dev.browser

import android.app.Activity
import android.content.pm.PackageManager
import com.facebook.react.bridge.Promise

/** Bridges Activity.requestPermissions results back to the JS promise that asked. */
object PermissionCoordinator {
    private var nextCode = 1
    private val pending = mutableMapOf<Int, Promise>()

    fun request(activity: Activity, permissions: Array<String>, promise: Promise) {
        val code = nextCode++
        pending[code] = promise
        try {
            activity.requestPermissions(permissions, code)
        } catch (_: Exception) {
            pending.remove(code)
            promise.resolve(false)
        }
    }

    fun handle(code: Int, grantResults: IntArray) {
        val promise = pending.remove(code) ?: return
        promise.resolve(
            grantResults.isNotEmpty() &&
                grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        )
    }
}
