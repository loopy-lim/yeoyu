package dev.browser

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Looper
import android.view.KeyEvent
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.Promise
import com.workspacebrowser.MainActivity
import java.io.ByteArrayInputStream
import java.lang.reflect.Proxy
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, shadows = [PortablePickerWithoutPipTelemetry::class])
class BrowserDataActivityOwnershipTest {
    private val modules = mutableListOf<BrowserDataModule>()
    private val roots = mutableListOf<ReactActivity>()

    @After fun cleanup() {
        modules.forEach { it.invalidate() }
        roots.forEach { ReflectionHelpers.callInstanceMethod<Void>(it, "onDestroy") }
        roots.clear()
        ReflectionHelpers.getField<android.os.Handler>(BrowserWindowCoordinator, "main").removeCallbacksAndMessages(null)
        ReflectionHelpers.getField<MutableMap<Activity, String>>(BrowserWindowCoordinator, "windows").clear()
        ReflectionHelpers.getField<MutableMap<String, BrowserWindowActivity>>(BrowserWindowCoordinator, "owners").clear()
        MainActivity.current = null
    }

    @Test fun aFinishingOrDestroyedOwnerCannotOpenThePortablePicker() {
        for (destroyed in listOf(false, true)) {
            val controller = Robolectric.buildActivity(Activity::class.java).create().start()
            val owner = controller.get()
            val context = context(owner)
            val module = module(context)
            if (destroyed) controller.destroy() else owner.finish()
            val answer = Answer()

            module.chooseImport(answer.promise)
            idle()

            assertEquals(1, answer.rejections)
            assertEquals("PORTABLE_FILE", answer.error)
            assertNull(shadowOf(owner).nextStartedActivityForResult)
        }
    }

    @Test fun closingTheMainRootCancelsItsOwnPicker() = closingOwner(MainActivity::class.java)

    @Test fun closingAWindowRootCancelsItsOwnPicker() = closingOwner(BrowserWindowActivity::class.java)

    @Test fun anotherRootsDestroyAndStaleResultCannotCompleteTheOwnersPicker() {
        val owner = root(BrowserWindowActivity::class.java)
        val other = root(MainActivity::class.java)
        val context = context(owner)
        val module = module(context)
        val answer = Answer()
        module.chooseImport(answer.promise)
        idle()
        val request = requireNotNull(shadowOf(owner).nextStartedActivityForResult)

        destroy(other)
        context.onActivityResult(other, request.requestCode, Activity.RESULT_CANCELED, null)
        idle()
        assertEquals("Neither another root's teardown nor its result owns this picker", 0, answer.terminals)

        context.onActivityResult(owner, request.requestCode, Activity.RESULT_CANCELED, null)
        idle()
        assertEquals(1, answer.resolutions)
        assertNull(answer.value)
    }

    @Test fun aLateMatchingResultFromARetiredOwnerCannotAdmitNewFileIo() {
        for (destroyed in listOf(false, true)) {
            val controller = Robolectric.buildActivity(Activity::class.java).create().start()
            val owner = controller.get()
            val survivor = Robolectric.buildActivity(Activity::class.java).create().start().get()
            val context = context(owner)
            val module = module(context)
            val answer = Answer()
            val reads = AtomicInteger()
            val uri = Uri.parse("content://portable.test/late-${if (destroyed) "destroyed" else "finishing"}")
            val stream = object : ByteArrayInputStream("late data".toByteArray()) {
                override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
                    reads.incrementAndGet()
                    return super.read(bytes, offset, length)
                }
            }
            shadowOf(context.contentResolver).registerInputStream(uri, stream)
            module.chooseImport(answer.promise)
            idle()
            val request = requireNotNull(shadowOf(owner).nextStartedActivityForResult)
            context.onHostResume(survivor)
            // Isolate result admission before/without browser onDestroy cleanup.
            if (destroyed) controller.destroy() else owner.finish()

            context.onActivityResult(owner, request.requestCode, Activity.RESULT_OK, Intent().setData(uri))
            ReflectionHelpers.getField<java.util.concurrent.ExecutorService>(module, "io").submit {}.get(5, TimeUnit.SECONDS)
            idle()

            assertEquals("A retired owner's waiting picker must reject its late matching result", 1, answer.rejections)
            assertEquals(0, answer.resolutions)
            assertEquals("The late result cannot open/read the selected file", 0, reads.get())
            context.onActivityResult(owner, request.requestCode, Activity.RESULT_OK, Intent().setData(uri))
            idle()
            assertEquals(1, answer.terminals)
        }
    }

    @Test fun closingTheOwnerAfterSelectionKeepsAdmittedFileIoAlive() {
        val owner = root(MainActivity::class.java)
        val survivor = root(BrowserWindowActivity::class.java)
        val context = context(owner)
        val module = module(context)
        val answer = Answer()
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val finished = CountDownLatch(1)
        val uri = Uri.parse("content://portable.test/document")
        val stream = object : ByteArrayInputStream("portable data".toByteArray()) {
            override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
                entered.countDown()
                check(release.await(5, TimeUnit.SECONDS)) { "Test reader was not released" }
                return super.read(bytes, offset, length).also { if (it == -1) finished.countDown() }
            }
        }
        shadowOf(context.contentResolver).registerInputStream(uri, stream)
        module.chooseImport(answer.promise)
        idle()
        val request = requireNotNull(shadowOf(owner).nextStartedActivityForResult)
        try {
            context.onActivityResult(owner, request.requestCode, Activity.RESULT_OK, Intent().setData(uri))
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            context.onHostResume(survivor)
            destroy(owner)
            idle()
            assertEquals("Closing a picker owner must not cancel admitted application-owned I/O", 0, answer.terminals)
            release.countDown()
            assertTrue(finished.await(5, TimeUnit.SECONDS))
            // The worker posts the completion immediately after its read loop.
            val io = ReflectionHelpers.getField<java.util.concurrent.ExecutorService>(module, "io")
            io.submit {}.get(5, TimeUnit.SECONDS)
            idle()
            assertEquals(1, answer.resolutions)
            assertEquals("portable data", answer.value)
        } finally { release.countDown() }
    }

    private fun <T : ReactActivity> closingOwner(type: Class<T>) {
        val owner = root(type)
        val survivor = root(if (type == MainActivity::class.java) BrowserWindowActivity::class.java else MainActivity::class.java)
        val context = context(owner)
        val module = module(context)
        val first = Answer()
        module.chooseImport(first.promise)
        idle()
        val retiredRequest = requireNotNull(shadowOf(owner).nextStartedActivityForResult)
        context.onHostResume(survivor)

        destroy(owner)
        idle()
        assertEquals("Only the closed root's waiting picker is retired", 1, first.rejections)
        val next = Answer()
        module.chooseImport(next.promise)
        idle()
        val liveRequest = requireNotNull(shadowOf(survivor).nextStartedActivityForResult)
        assertNotEquals(retiredRequest.requestCode, liveRequest.requestCode)
        context.onActivityResult(owner, retiredRequest.requestCode, Activity.RESULT_CANCELED, null)
        context.onActivityResult(owner, liveRequest.requestCode, Activity.RESULT_CANCELED, null)
        idle()
        assertEquals(0, next.terminals)
        context.onActivityResult(survivor, liveRequest.requestCode, Activity.RESULT_CANCELED, null)
        idle()
        assertEquals(1, next.resolutions)
    }

    private fun module(context: BridgeReactContext) = BrowserDataModule(context).also { it.initialize(); modules.add(it) }
    private fun context(owner: Activity) = BridgeReactContext(RuntimeEnvironment.getApplication()).also { it.onHostResume(owner) }
    private fun idle() = shadowOf(Looper.getMainLooper()).idle()
    private fun destroy(root: ReactActivity) {
        ReflectionHelpers.callInstanceMethod<Void>(root, "onDestroy")
        roots.remove(root)
    }
    private fun <T : ReactActivity> root(type: Class<T>): T {
        val controller = Robolectric.buildActivity(type)
        val activity = controller.get()
        ReflectionHelpers.setField(activity, "mDelegate", object : ReactActivityDelegate(activity, "Test") {
            override fun onCreate(savedInstanceState: Bundle?) {}
            override fun onKeyDown(keyCode: Int, event: KeyEvent) = false
            override fun onKeyUp(keyCode: Int, event: KeyEvent) = false
            override fun onDestroy() {}
        })
        controller.create().start()
        roots.add(activity)
        return activity
    }

    private class Answer {
        var resolutions = 0
        var rejections = 0
        var value: Any? = null
        var error: Any? = null
        val terminals get() = resolutions + rejections
        val promise = Proxy.newProxyInstance(Promise::class.java.classLoader, arrayOf(Promise::class.java)) { _, method, args ->
            when (method.name) {
                "resolve" -> { resolutions++; value = args?.firstOrNull() }
                "reject" -> { rejections++; error = args?.firstOrNull() }
            }
            null
        } as Promise
    }
}

/** Native PiP event serialization is outside the portable picker/lifecycle boundary. */
@Implements(BrowserPictureInPicture::class)
class PortablePickerWithoutPipTelemetry {
    @Implementation fun suspendForExternalActivity() {}
}
