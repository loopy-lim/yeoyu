package dev.browser

import android.app.Application
import android.content.Intent
import android.os.Bundle
import android.os.Looper
import android.view.KeyEvent
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.Promise
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers
import java.lang.reflect.Proxy

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class BrowserWindowOwnershipTest {
    private val activities = mutableListOf<org.robolectric.android.controller.ActivityController<BrowserWindowActivity>>()

    @After fun cleanup() {
        drainTabNotices()
        for (controller in activities) controller.destroy()
        activities.clear()
        drainTabNotices()
    }

    @Test fun actualLaunchOptionsMapIntentTabAndCarryAPerActivityImmutableOwner() {
        val existing = window("existing-tab")
        val firstFresh = window()
        val secondFresh = window()
        val options = launchOptions(existing)
        assertEquals("existing-tab", options.getString("tabId"))
        val id = options.getString("windowId")
        assertFalse(id.isNullOrBlank())
        assertEquals(id, launchOptions(existing).getString("windowId"))
        assertNotEquals(id, launchOptions(firstFresh).getString("windowId"))
        assertNotEquals(launchOptions(firstFresh).getString("windowId"), launchOptions(secondFresh).getString("windowId"))
        assertNull(launchOptions(firstFresh).getString("tabId"))
    }

    @Test fun exactOwnerBridgeInterleavingCannotBorrowAnotherFreshOrBoundWindow() {
        val first = window()
        val second = window()
        val existing = window("existing-tab")
        val firstId = requireNotNull(launchOptions(first).getString("windowId"))
        val secondId = requireNotNull(launchOptions(second).getString("windowId"))
        val existingId = requireNotNull(launchOptions(existing).getString("windowId"))
        val context = BridgeReactContext(RuntimeEnvironment.getApplication())
        context.onHostResume(existing)
        val module = BrowserModule(context)
        assertEquals("", call(module, "windowMissionFor", firstId).value)
        assertEquals("", call(module, "windowMissionFor", secondId).value)
        assertEquals("existing-tab", call(module, "windowMissionFor", existingId).value)
        assertNull(call(module, "bindWindowTabFor", firstId, "first-tab").error)
        context.onHostResume(first)
        assertNull(call(module, "bindWindowTabFor", secondId, "second-tab").error)
        assertEquals("first-tab", BrowserWindowCoordinator.tabOf(first))
        assertEquals("second-tab", BrowserWindowCoordinator.tabOf(second))
        assertEquals("existing-tab", BrowserWindowCoordinator.tabOf(existing))
        assertNotNull(call(module, "bindWindowTabFor", secondId, "first-tab").error)
        assertEquals("second-tab", BrowserWindowCoordinator.tabOf(second))
        assertEquals("first-tab", BrowserWindowCoordinator.tabOf(first))
        assertEquals("second-tab", call(module, "windowMissionFor", secondId).value)
        assertNull(call(module, "closeWindowFor", secondId).error)
        assertTrue(second.isFinishing)
        assertEquals("A closing root keeps tab/prompt ownership until its onDestroy cleanup",
            "second-tab", BrowserWindowCoordinator.tabOf(second))
        window("another-tab")
        assertEquals("Registering another root cannot retire a still-closing root's prompt ownership",
            "second-tab", BrowserWindowCoordinator.tabOf(second))
        assertFalse(first.isFinishing)
        assertFalse(existing.isFinishing)
        assertNotNull(call(module, "bindWindowTabFor", secondId, "wrong-tab").error)
        assertNotNull(call(module, "windowMissionFor", secondId).error)
        assertNotNull(call(module, "closeWindowFor", "unknown-owner").error)
        assertEquals("first-tab", BrowserWindowCoordinator.tabOf(first))
        assertEquals("existing-tab", BrowserWindowCoordinator.tabOf(existing))
    }

    @Test fun recreationRetainsBoundMissionButRejectsTheRetiredRootOwner() {
        val original = window()
        val originalId = requireNotNull(launchOptions(original).getString("windowId"))
        val context = BridgeReactContext(RuntimeEnvironment.getApplication())
        context.onHostResume(original)
        val module = BrowserModule(context)
        assertNull(call(module, "bindWindowTabFor", originalId, "minted-tab").error)
        val inherited = Intent(original.intent).putExtra("windowId", originalId)
        val oldController = activities.single { it.get() === original }
        oldController.destroy()
        activities.remove(oldController)
        val replacement = window(inheritedIntent = inherited)
        val options = launchOptions(replacement)
        val replacementId = requireNotNull(options.getString("windowId"))
        assertNotEquals("A stale launch extra cannot reuse the retired root token", originalId, replacementId)
        assertEquals("minted-tab", options.getString("tabId"))
        assertEquals("minted-tab", call(module, "windowMissionFor", replacementId).value)
        assertNotNull(call(module, "bindWindowTabFor", originalId, "wrong-tab").error)
        assertNotNull(call(module, "closeWindowFor", originalId).error)
        assertFalse(replacement.isFinishing)
        assertEquals("minted-tab", BrowserWindowCoordinator.tabOf(replacement))
    }

    private data class Answer(var value: Any? = null, var error: Any? = null)
    private fun call(module: BrowserModule, name: String, vararg values: String): Answer {
        val answer = Answer()
        val promise = Proxy.newProxyInstance(Promise::class.java.classLoader, arrayOf(Promise::class.java)) { _, method, args ->
            if (method.name == "resolve") answer.value = args?.firstOrNull()
            if (method.name == "reject") answer.error = args?.firstOrNull()
            null
        } as Promise
        val method = module.javaClass.declaredMethods.firstOrNull { it.name == name }
        assertNotNull("The native bridge must expose exact-owner $name", method)
        method!!.invoke(module, *values, promise)
        drainTabNotices()
        shadowOf(Looper.getMainLooper()).idle()
        return answer
    }

    private fun launchOptions(activity: BrowserWindowActivity): Bundle {
        val delegate = ReflectionHelpers.callInstanceMethod<ReactActivityDelegate>(activity, "createReactActivityDelegate")
        return ReflectionHelpers.callInstanceMethod(delegate, "getLaunchOptions")
    }

    private fun window(tabId: String? = null, inheritedIntent: Intent? = null): BrowserWindowActivity {
        val intent = inheritedIntent ?: Intent(RuntimeEnvironment.getApplication(), BrowserWindowActivity::class.java)
        if (tabId != null) intent.putExtra(BrowserWindowCoordinator.EXTRA_TAB, tabId)
        val controller = Robolectric.buildActivity(BrowserWindowActivity::class.java, intent)
        val activity = controller.get()
        ReflectionHelpers.setField(activity, "mDelegate", object : ReactActivityDelegate(activity, "YeoyuWindow") {
            override fun onCreate(savedInstanceState: Bundle?) {}
            override fun onKeyDown(keyCode: Int, event: KeyEvent) = false
            override fun onKeyUp(keyCode: Int, event: KeyEvent) = false
            override fun onDestroy() {}
        })
        activities.add(controller)
        controller.create().start()
        drainTabNotices()
        return activity
    }
    private fun drainTabNotices() {
        ReflectionHelpers.getField<android.os.Handler>(BrowserWindowCoordinator, "main").removeCallbacksAndMessages(null)
    }
}
