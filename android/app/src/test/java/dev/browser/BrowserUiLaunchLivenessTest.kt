package dev.browser

import android.app.Activity
import android.app.Application
import android.os.Looper
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.Promise
import java.lang.reflect.Proxy
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class BrowserUiLaunchLivenessTest {
    @Test fun finishingAndDestroyedCurrentOwnersCannotLaunchAnotherWindow() = rejectedOwners("openInNewWindow")
    @Test fun finishingAndDestroyedCurrentOwnersCannotShare() = rejectedOwners("shareUrl")
    @Test fun finishingAndDestroyedCurrentOwnersCannotRequestTheBrowserRole() = rejectedOwners("requestDefaultBrowser")
    @Test fun finishingAndDestroyedCurrentOwnersCannotOpenPermissionSettings() = rejectedOwners("openAndroidPermissionSettings")

    private fun rejectedOwners(port: String) {
        for (destroyed in listOf(false, true)) {
            val controller = Robolectric.buildActivity(Activity::class.java).create().start()
            val owner = controller.get()
            val context = BridgeReactContext(RuntimeEnvironment.getApplication())
            context.onHostResume(owner)
            val module = BrowserModule(context)
            if (destroyed) controller.destroy() else owner.finish()
            val answer = Answer()
            try {
                launch(module, port, answer.promise)
                idle()
                assertEquals("$port must reject a ${if (destroyed) "destroyed" else "finishing"} owner", 1, answer.rejections)
                assertEquals(0, answer.resolutions)
                assertNull("$port cannot dispatch an intent from a retired owner", shadowOf(owner).nextStartedActivity)
                assertNull(shadowOf(owner).nextStartedActivityForResult)
            } finally { DefaultBrowserCoordinator.cancelForActivity(owner) }
        }
    }

    @Test fun liveOwnersRetainShareSettingsRoleAndNewWindowLaunches() {
        for (port in listOf("openInNewWindow", "shareUrl", "requestDefaultBrowser", "openAndroidPermissionSettings")) {
            val owner = Robolectric.buildActivity(Activity::class.java).create().start().get()
            val context = BridgeReactContext(RuntimeEnvironment.getApplication())
            context.onHostResume(owner)
            val module = BrowserModule(context)
            val answer = Answer()
            try {
                launch(module, port, answer.promise)
                idle()
                assertEquals("$port keeps its existing live-owner contract", 0, answer.rejections)
                val intent = if (port == "requestDefaultBrowser")
                    shadowOf(owner).nextStartedActivityForResult?.intent else shadowOf(owner).nextStartedActivity
                assertNotNull("$port must still dispatch the intended UI", intent)
                if (port != "requestDefaultBrowser") assertEquals(1, answer.resolutions)
            } finally { DefaultBrowserCoordinator.cancelForActivity(owner) }
        }
    }

    private fun launch(module: BrowserModule, port: String, promise: Promise) = when (port) {
        "openInNewWindow" -> module.openInNewWindow(null, promise)
        "shareUrl" -> module.shareUrl("https://example.test", promise)
        "requestDefaultBrowser" -> module.requestDefaultBrowser(promise)
        "openAndroidPermissionSettings" -> module.openAndroidPermissionSettings(promise)
        else -> error(port)
    }
    private fun idle() = shadowOf(Looper.getMainLooper()).idle()
    private class Answer {
        var resolutions = 0
        var rejections = 0
        val promise = Proxy.newProxyInstance(Promise::class.java.classLoader, arrayOf(Promise::class.java)) { _, method, _ ->
            if (method.name == "resolve") resolutions++
            if (method.name == "reject") rejections++
            null
        } as Promise
    }
}
