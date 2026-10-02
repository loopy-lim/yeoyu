package dev.browser

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WindowFocusChangeListener
import com.facebook.react.common.LifecycleState
import com.facebook.react.interfaces.fabric.ReactSurface
import com.facebook.react.modules.core.PermissionListener
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsDefaults
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsForTests
import com.facebook.react.runtime.ReactHostImpl
import com.workspacebrowser.MainActivity
import java.lang.ref.WeakReference
import java.lang.reflect.Proxy
import java.util.concurrent.atomic.AtomicReference
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.util.ReflectionHelpers

/** Keep the installed RN lifecycle/identity assertion, without starting Hermes/Fabric JNI. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = SharedReactHostTestApplication::class,
    shadows = [NoBundleReactActivityDelegate::class])
class SharedReactHostLifecycleTest {
    private lateinit var host: ReactHostImpl
    private lateinit var context: ReactContext
    private val events = mutableListOf<String>()
    private val activities = mutableListOf<ReactActivity>()

    @Before fun installUnstartedReactHost() {
        ReactNativeFeatureFlagsForTests.setUp()
        ReactNativeFeatureFlags.override(object : ReactNativeFeatureFlagsDefaults() {
            override fun enableBridgelessArchitecture() = true
            override fun useFabricInterop() = false
        })
        // ReactHostImpl's normal constructor creates native ComponentFactory. Allocate
        // only its Java lifecycle state; all exercised lifecycle methods are real RN.
        val unsafeField = Class.forName("sun.misc.Unsafe").getDeclaredField("theUnsafe").apply { isAccessible = true }
        val unsafe = unsafeField.get(null)
        host = unsafe.javaClass.getMethod("allocateInstance", Class::class.java)
            .invoke(unsafe, ReactHostImpl::class.java) as ReactHostImpl
        ReflectionHelpers.setField(host, "activity", AtomicReference<Activity?>())
        ReflectionHelpers.setField(host, "lastUsedActivityRef", AtomicReference(WeakReference<Activity?>(null)))
        val trackerType = Class.forName("com.facebook.react.runtime.ReactHostStateTracker")
        val tracker = trackerType.getDeclaredConstructor(Int::class.javaPrimitiveType).apply { isAccessible = true }.newInstance(1)
        ReflectionHelpers.setField(host, "stateTracker", tracker)
        val managerType = Class.forName("com.facebook.react.runtime.ReactLifecycleStateManager")
        val manager = managerType.getDeclaredConstructor(trackerType).apply { isAccessible = true }.newInstance(tracker)
        ReflectionHelpers.setField(host, "reactLifecycleStateManager", manager)
        val contextType = Class.forName("com.facebook.react.runtime.BridgelessReactContext")
        context = contextType.getDeclaredConstructor(Context::class.java, ReactHostImpl::class.java)
            .apply { isAccessible = true }.newInstance(RuntimeEnvironment.getApplication(), host) as ReactContext
        val refType = Class.forName("com.facebook.react.runtime.BridgelessAtomicRef")
        val ref = refType.getDeclaredConstructor(Any::class.java).apply { isAccessible = true }.newInstance(context)
        ReflectionHelpers.setField(host, "bridgelessReactContextRef", ref)
        (RuntimeEnvironment.getApplication() as SharedReactHostTestApplication).sharedHost = host
        context.addLifecycleEventListener(object : LifecycleEventListener {
            override fun onHostResume() { events.add("resume") }
            override fun onHostPause() { events.add("pause") }
            override fun onHostDestroy() { events.add("destroy") }
        })
    }

    @After fun retireActivities() {
        for (activity in activities.asReversed()) activity.reactActivityDelegate.onDestroy()
        ReflectionHelpers.getField<android.os.Handler>(BrowserWindowCoordinator, "main").removeCallbacksAndMessages(null)
        ReflectionHelpers.getField<MutableMap<Activity, String>>(BrowserWindowCoordinator, "windows").clear()
        ReflectionHelpers.getField<MutableMap<String, BrowserWindowActivity>>(BrowserWindowCoordinator, "owners").clear()
        MainActivity.current = null
        ReactNativeFeatureFlagsForTests.setUp()
    }

    @Test fun lateWindowPauseAfterMainResumeDoesNotCrashOrBackgroundTheMainRoot() {
        val main = activity(MainActivity::class.java)
        val window = activity(BrowserWindowActivity::class.java)
        main.reactActivityDelegate.onResume()
        window.reactActivityDelegate.onResume()
        main.reactActivityDelegate.onResume()
        events.clear()

        // Android 16 multi-resume: Main resumes before the previous OS window pauses.
        ReflectionHelpers.callInstanceMethod<Void>(window, "onPause")

        assertEquals(LifecycleState.RESUMED, host.lifecycleState)
        assertSame(main, context.currentActivity)
        assertTrue("A different root's pause must not broadcast background", events.isEmpty())
        assertSame(main, currentHostActivity())
    }

    @Test fun promotingAnAlreadyResumedRootRefreshesTheNativeContextWithoutBackground() {
        val main = activity(MainActivity::class.java)
        val window = activity(BrowserWindowActivity::class.java)
        main.reactActivityDelegate.onResume()
        window.reactActivityDelegate.onResume()
        assertSame(window, context.currentActivity)
        events.clear()

        main.reactActivityDelegate.onWindowFocusChanged(true)

        assertSame(main, currentHostActivity())
        assertSame(main, context.currentActivity)
        assertEquals(LifecycleState.RESUMED, host.lifecycleState)
        assertFalse(events.contains("pause"))
    }

    @Test fun oldWindowBlurCannotClearTheNewFocusedOwnersFocusOrBackHandler() {
        val main = activity(MainActivity::class.java)
        val window = activity(BrowserWindowActivity::class.java)
        main.reactActivityDelegate.onResume()
        window.reactActivityDelegate.onResume()
        window.reactActivityDelegate.onWindowFocusChanged(true)
        main.reactActivityDelegate.onWindowFocusChanged(true)
        val focus = mutableListOf<Boolean>()
        context.addWindowFocusChangeListener(object : WindowFocusChangeListener {
            override fun onWindowFocusChange(hasFocus: Boolean) { focus.add(hasFocus) }
        })

        window.reactActivityDelegate.onWindowFocusChanged(false)

        assertSame(main, currentHostActivity())
        assertSame(main, ReflectionHelpers.getField<Any?>(host, "defaultHardwareBackBtnHandler"))
        assertTrue("A stale blur must not blur the newly focused React owner", focus.isEmpty())
    }

    @Test fun pausingCurrentWindowKeepsOtherResumedRootActiveThenLastPauseBackgroundsOnce() {
        val main = activity(MainActivity::class.java)
        val window = activity(BrowserWindowActivity::class.java)
        main.reactActivityDelegate.onResume()
        window.reactActivityDelegate.onResume()
        events.clear()

        window.reactActivityDelegate.onPause()

        assertEquals(LifecycleState.RESUMED, host.lifecycleState)
        assertSame(main, currentHostActivity())
        assertSame(main, context.currentActivity)
        assertFalse(events.contains("pause"))
        events.clear()
        main.reactActivityDelegate.onPause()
        assertEquals(LifecycleState.BEFORE_RESUME, host.lifecycleState)
        assertEquals(listOf("pause"), events)
        assertNull(ReflectionHelpers.getField<Any?>(host, "defaultHardwareBackBtnHandler"))
    }

    @Test fun closingOneRootStopsOnlyItsSurfaceAndKeepsTheOtherRootAlive() {
        val main = activity(MainActivity::class.java)
        val window = activity(BrowserWindowActivity::class.java)
        var mainStops = 0
        var windowStops = 0
        main.reactDelegate!!.setReactSurface(surface { mainStops++ })
        window.reactDelegate!!.setReactSurface(surface { windowStops++ })
        main.reactActivityDelegate.onResume()
        window.reactActivityDelegate.onResume()
        events.clear()

        ReflectionHelpers.callInstanceMethod<Void>(window, "onDestroy")
        activities.remove(window)

        assertEquals(1, windowStops)
        assertEquals(0, mainStops)
        assertEquals(LifecycleState.RESUMED, host.lifecycleState)
        assertSame(main, context.currentActivity)
        assertFalse(events.contains("pause"))
        assertFalse(events.contains("destroy"))
    }

    @Test fun focusFromAPausedRootCannotOutrankTheRealFocusedRootOnItsNextResume() {
        val main = activity(MainActivity::class.java)
        val window = activity(BrowserWindowActivity::class.java)
        main.reactActivityDelegate.onResume()
        main.reactActivityDelegate.onWindowFocusChanged(true)
        window.reactActivityDelegate.onResume()
        window.reactActivityDelegate.onPause()
        events.clear()

        window.reactActivityDelegate.onWindowFocusChanged(true)
        window.reactActivityDelegate.onResume()

        assertSame(main, currentHostActivity())
        assertSame(main, context.currentActivity)
        assertTrue(events.isEmpty())
    }

    @Test fun retiredRootCallbacksCannotEraseAReplacementWindowOwner() {
        val old = activity(BrowserWindowActivity::class.java)
        val replacement = activity(BrowserWindowActivity::class.java)
        old.reactActivityDelegate.onResume()
        replacement.reactActivityDelegate.onResume()
        replacement.reactActivityDelegate.onWindowFocusChanged(true)
        ReflectionHelpers.callInstanceMethod<Void>(old, "onDestroy")
        activities.remove(old)
        events.clear()

        old.reactActivityDelegate.onWindowFocusChanged(true)
        old.reactActivityDelegate.onPause()
        old.reactActivityDelegate.onDestroy()
        replacement.reactActivityDelegate.onResume()

        assertSame(replacement, currentHostActivity())
        assertSame(replacement, context.currentActivity)
        assertEquals(LifecycleState.RESUMED, host.lifecycleState)
        assertTrue(events.isEmpty())
    }

    @Test fun lastCreatedRootDestroyClearsTheHostEvenWhenItsPausedOwnerWasAlreadyDestroyed() {
        val main = activity(MainActivity::class.java)
        val window = activity(BrowserWindowActivity::class.java)
        main.reactActivityDelegate.onResume()
        main.reactActivityDelegate.onPause()
        events.clear()

        main.reactActivityDelegate.onDestroy()
        activities.remove(main)
        assertEquals(LifecycleState.BEFORE_RESUME, host.lifecycleState)
        assertTrue(events.isEmpty())
        window.reactActivityDelegate.onDestroy()
        activities.remove(window)

        assertEquals(LifecycleState.BEFORE_CREATE, host.lifecycleState)
        assertNull(currentHostActivity())
        assertNull(context.currentActivity)
        assertEquals(listOf("destroy"), events)
    }

    @Test fun aPausedWindowsPermissionListenerWaitsForItsOwnResumeWhileMainIsActive() {
        val main = activity(MainActivity::class.java)
        val window = activity(BrowserWindowActivity::class.java)
        main.reactActivityDelegate.onResume()
        window.reactActivityDelegate.onResume()
        window.reactActivityDelegate.onPause()
        var answers = 0
        val permissions = arrayOf(android.Manifest.permission.CAMERA)
        window.reactActivityDelegate.requestPermissions(permissions, 77, PermissionListener { _, _, _ -> answers++; true })

        window.onRequestPermissionsResult(77, permissions, intArrayOf(android.content.pm.PackageManager.PERMISSION_GRANTED))

        assertEquals("The main root's foreground state must not release another root's callback", 0, answers)
        window.reactActivityDelegate.onResume()
        assertEquals(1, answers)
    }

    private fun surface(stopped: () -> Unit): ReactSurface = Proxy.newProxyInstance(
        ReactSurface::class.java.classLoader, arrayOf(ReactSurface::class.java)
    ) { _, method, _ ->
        check(method.name == "stop") { "Unexpected surface call: ${method.name}" }
        stopped()
        null
    } as ReactSurface

    private fun currentHostActivity(): Activity? =
        ReflectionHelpers.getField<AtomicReference<Activity?>>(host, "activity").get()

    private fun <T : ReactActivity> activity(type: Class<T>): T {
        val controller = Robolectric.buildActivity(type)
        activities.add(controller.get())
        controller.create().start()
        return controller.get()
    }
}

class SharedReactHostTestApplication : Application(), ReactApplication {
    lateinit var sharedHost: ReactHost
    override val reactHost: ReactHost get() = sharedHost
}

/** Surface startup is the only replaced boundary; delegate lifecycle remains installed RN. */
@Implements(ReactActivityDelegate::class)
class NoBundleReactActivityDelegate {
    @Implementation protected fun loadApp(appKey: String?) {}
}
