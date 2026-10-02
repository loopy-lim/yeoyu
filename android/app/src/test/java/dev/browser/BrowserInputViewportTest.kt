package dev.browser

import android.app.Activity
import android.app.Application
import android.graphics.Insets
import android.view.WindowInsets
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], manifest = Config.NONE, application = Application::class)
class BrowserInputViewportTest {
    @Test fun modernInsetsSubtractNavigationAndIgnoreLegacyVisibleFrameGuesses() {
        assertEquals(260f, inputViewportKeyboardInset(35, 300, 40, 800, 500, 1f), 0f)
        assertEquals(0f, inputViewportKeyboardInset(35, 0, 40, 800, 500, 1f), 0f)
        assertEquals(130f, inputViewportKeyboardInset(35, 300, 40, 800, 500, 2f), 0f)
    }

    @Test fun legacyFallbackUsesWindowCoordinatesWithoutConfusingSystemBarsForIme() {
        assertEquals(240f, inputViewportKeyboardInset(26, 40, 40, 1200, 920, 1f), 0f)
        assertEquals(0f, inputViewportKeyboardInset(29, 40, 40, 1200, 1160, 1f), 0f)
        assertEquals(0f, inputViewportKeyboardInset(26, 0, 40, 400, 360, 1f), 0f)
        assertEquals(140f, inputViewportKeyboardInset(29, 320, 40, 1200, 1200, 2f), 0f)
    }

    @Test fun actualRootInsetsAreForwardedAndRetainedWithoutResizingContent() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        val root = BrowserInputRoot(activity)
        activity.setContentView(root)
        root.layout(0, 0, 800, 640)
        val events = mutableListOf<InputViewportSnapshot>()
        BrowserInputViewport.attach(activity, root, { "main" }, events::add)
        try {
            val insets = WindowInsets.Builder()
                .setInsets(WindowInsets.Type.navigationBars(), Insets.of(0, 0, 0, 40))
                .setInsets(WindowInsets.Type.ime(), Insets.of(0, 0, 0, 300))
                .setVisible(WindowInsets.Type.ime(), true).build()
            val returned = root.dispatchApplyWindowInsets(insets)
            assertEquals("IME insets still reach Fabric and Gecko descendants", 300, returned.getInsets(WindowInsets.Type.ime()).bottom)
            assertEquals(640, root.height)
            assertEquals(260f / root.resources.displayMetrics.density, events.last().keyboardInset, 0.001f)
            assertEquals("main", events.last().scope)
            assertEquals("A sheet opened after IME appearance reads the owner's current inset",
                260f / root.resources.displayMetrics.density, BrowserInputViewport.snapshot("main").keyboardInset, 0.001f)
            val hidden = WindowInsets.Builder(insets).setInsets(WindowInsets.Type.ime(), Insets.NONE).setVisible(WindowInsets.Type.ime(), false).build()
            root.dispatchApplyWindowInsets(hidden)
            assertEquals(0f, events.last().keyboardInset, 0f)
        } finally { BrowserInputViewport.detach(activity); controller.pause().stop().destroy() }
    }

    @Test fun snapshotsAndRetargetEventsBelongToTheirExactActivityOwner() {
        val first = Robolectric.buildActivity(Activity::class.java).setup()
        val second = Robolectric.buildActivity(Activity::class.java).setup()
        val mainRoot = BrowserInputRoot(first.get())
        val windowRoot = BrowserInputRoot(second.get(), routePreIme = false)
        first.get().setContentView(mainRoot); second.get().setContentView(windowRoot)
        mainRoot.layout(0, 0, 800, 640); windowRoot.layout(0, 0, 400, 400)
        var scope = "tab-b"
        val events = mutableListOf<InputViewportSnapshot>()
        BrowserInputViewport.attach(first.get(), mainRoot, { "main" }, events::add)
        BrowserInputViewport.attach(second.get(), windowRoot, { scope }, events::add)
        try {
            assertEquals(640f / mainRoot.resources.displayMetrics.density, BrowserInputViewport.snapshot("main").visibleHeight, 0.001f)
            assertEquals(400f / windowRoot.resources.displayMetrics.density, BrowserInputViewport.snapshot("tab-b").visibleHeight, 0.001f)
            assertEquals(0f, BrowserInputViewport.snapshot("unowned").visibleHeight, 0f)
            scope = "tab-c"
            BrowserInputViewport.refresh(second.get())
            assertTrue(events.any { it.scope == "tab-b" && it.visibleHeight == 0f })
            assertEquals("tab-c", events.last().scope)
            windowRoot.layout(0, 0, 640, 300)
            BrowserInputViewport.refresh(second.get())
            assertEquals(300f / windowRoot.resources.displayMetrics.density, events.last().visibleHeight, 0.001f)
            BrowserInputViewport.detach(second.get())
            assertNull(windowRoot.viewportObserver)
            assertEquals(0f, BrowserInputViewport.snapshot("tab-c").visibleHeight, 0f)
            assertTrue(BrowserInputViewport.snapshot("main").visibleHeight > 0f)
        } finally {
            BrowserInputViewport.detach(first.get()); BrowserInputViewport.detach(second.get())
            first.pause().stop().destroy(); second.pause().stop().destroy()
        }
    }
}
