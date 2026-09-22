package dev.browser

import android.app.Activity
import android.app.Application
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers

/** Real Window/DecorView calls; OEM mouse/edge-gesture behavior still needs a device. */
@Suppress("DEPRECATION")
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE, application = Application::class)
class ImmersiveModeTest {
    private fun requestedBars(window: android.view.Window): Int =
        ReflectionHelpers.callInstanceMethod<Int>(window.insetsController, "getRequestedVisibleTypes") and
            WindowInsets.Type.systemBars()

    private fun withWindow(test: (android.view.Window) -> Unit) {
        val activity = Robolectric.buildActivity(Activity::class.java).setup()
        try {
            test(activity.get().window)
        } finally {
            activity.pause().stop().destroy()
        }
    }

    @Test fun browserFullscreenHidesOnlyTheStatusBarAndKeepsHomeAvailable() = withWindow { window ->
        ImmersiveMode.set(window, true)
        val flags = window.decorView.systemUiVisibility
        assertEquals(0, flags and View.SYSTEM_UI_FLAG_HIDE_NAVIGATION)
        assertEquals(0, flags and View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
        assertTrue(flags and View.SYSTEM_UI_FLAG_FULLSCREEN != 0)
        assertEquals(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE, window.insetsController!!.systemBarsBehavior)
        assertEquals(0, requestedBars(window) and WindowInsets.Type.statusBars())
        assertTrue(requestedBars(window) and WindowInsets.Type.navigationBars() != 0)
        assertTrue(requestedBars(window) and WindowInsets.Type.captionBar() != 0)
    }

    @Test fun disablingFullscreenClearsLegacyHidingWithoutErasingAppearance() = withWindow { window ->
        val appearance = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        window.decorView.systemUiVisibility = appearance or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_FULLSCREEN
        ImmersiveMode.set(window, false)
        assertEquals(0, window.decorView.systemUiVisibility and (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_FULLSCREEN))
        assertEquals(appearance, window.decorView.systemUiVisibility and appearance)
        assertEquals(WindowInsetsController.BEHAVIOR_DEFAULT, window.insetsController!!.systemBarsBehavior)
        assertEquals(WindowInsets.Type.systemBars(), requestedBars(window))
    }

    @Test fun focusRefreshRetainsAppearanceAndDoesNotToggleLegacyFlags() = withWindow { window ->
        val appearance = View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        window.decorView.systemUiVisibility = appearance
        ImmersiveMode.set(window, true)
        val first = window.decorView.systemUiVisibility
        repeat(20) {
            ImmersiveMode.set(window, true)
            assertTrue("Focus refresh must not re-hide Home", requestedBars(window) and WindowInsets.Type.navigationBars() != 0)
        }
        assertEquals(first, window.decorView.systemUiVisibility)
        assertEquals(appearance, window.decorView.systemUiVisibility and appearance)
    }

    @Test fun videoFullscreenAndReturnNeverHideHome() = withWindow { window ->
        for (fullscreen in listOf(false, true, false, true)) {
            // Same preference/content-fullscreen policy as MainActivity.
            ImmersiveMode.set(window, browserImmersiveEnabled(false, fullscreen))
            assertTrue(requestedBars(window) and WindowInsets.Type.navigationBars() != 0)
            assertEquals(if (fullscreen) 0 else WindowInsets.Type.statusBars(),
                requestedBars(window) and WindowInsets.Type.statusBars())
        }
    }

    @Test fun focusRefreshRepairsLegacyStateDriftWithoutChangingBarAppearance() = withWindow { window ->
        ImmersiveMode.set(window, true)
        // An appearance or window consumer replaces the legacy flags between focus callbacks.
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        ImmersiveMode.set(window, true)
        assertEquals(0, window.decorView.systemUiVisibility and View.SYSTEM_UI_FLAG_HIDE_NAVIGATION)
        assertEquals(0, window.decorView.systemUiVisibility and View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
        assertTrue(window.decorView.systemUiVisibility and View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR != 0)
        assertTrue(requestedBars(window) and WindowInsets.Type.navigationBars() != 0)
    }

    @Test fun missingWindowDuringLifecycleIsSafe() {
        ImmersiveMode.set(null, true)
        ImmersiveMode.set(null, false)
    }
}
