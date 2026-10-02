package dev.browser

import android.Manifest
import android.app.Activity
import android.app.Application
import android.app.PendingIntent
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ProviderInfo
import android.content.res.AssetFileDescriptor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Looper
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import android.view.KeyEvent
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.PromiseImpl
import com.facebook.react.bridge.ReactApplicationContext
import com.workspacebrowser.MainActivity
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSession.PromptDelegate.FilePrompt
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers
import org.robolectric.shadows.ShadowContentResolver

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, shadows = [PortablePickerWithoutPipTelemetry::class])
class BrowserWindowActivityResultsTest {
    @After fun cancelCredentials() {
        CredentialActivityCoordinator.cancelAll()
        GeckoSessionRegistry.activityProvider = null
        val windows = ReflectionHelpers.getField<MutableMap<Activity, String>>(BrowserWindowCoordinator, "windows")
        windows.clear()
        ReflectionHelpers.getField<android.os.Handler>(BrowserWindowCoordinator, "main").removeCallbacksAndMessages(null)
    }

    @Test fun anAndroidPermissionAnswerInAnOsWindowSettlesItsPromise() {
        val activity = window()
        val answers = mutableListOf<Any?>()
        val promise = PromiseImpl(Callback { answers.add(it.single()) }, Callback { fail("Permission rejected") })
        PermissionCoordinator.request(activity, arrayOf(Manifest.permission.CAMERA), promise)
        val request = shadowOf(activity).lastRequestedPermission

        try {
            activity.onRequestPermissionsResult(request.requestCode, request.requestedPermissions,
                intArrayOf(PackageManager.PERMISSION_GRANTED))

            assertEquals(listOf(true), answers)
        } finally { PermissionCoordinator.handle(request.requestCode, intArrayOf(PackageManager.PERMISSION_DENIED)) }
    }

    @Test fun aCanceledFilePickerInAnOsWindowRetiresItsPrompt() {
        val activity = window()
        val session = GeckoSession()
        // Gecko supplies these prompts; its constructor has no public test factory.
        val prompt = FilePrompt::class.java.declaredConstructors.single().let {
            it.isAccessible = true
            it.newInstance("file-request", "Files", FilePrompt.Type.SINGLE, 0, arrayOf("*/*"), null) as FilePrompt
        }
        try {
            FilePromptCoordinator.start(activity, session, prompt) { true }
            val request = shadowOf(activity).nextStartedActivityForResult

            activity.onActivityResult(request.requestCode, Activity.RESULT_CANCELED, null)

            assertFalse(FilePromptCoordinator.hasPending(session))
            assertTrue(prompt.isComplete)
        } finally { FilePromptCoordinator.cancelPending(session) }
    }

    @Test fun closingAnOsWindowRetiresItsWaitingFilePrompt() {
        val activity = window()
        val session = GeckoSession()
        val prompt = filePrompt("file-owner-close")
        try {
            FilePromptCoordinator.start(activity, session, prompt) { true }

            ReflectionHelpers.callInstanceMethod<Void>(activity, "onDestroy")

            assertFalse("A file picker cannot keep waiting on its destroyed window", FilePromptCoordinator.hasPending(session))
            assertTrue(prompt.isComplete)
        } finally { FilePromptCoordinator.cancelPending(session) }
    }

    @Test fun closingMainRetiresItsWaitingFilePrompt() {
        val activity = browserActivity(MainActivity::class.java, "Yeoyu")
        val session = GeckoSession()
        val prompt = filePrompt("file-main-close")
        try {
            FilePromptCoordinator.start(activity, session, prompt) { true }

            ReflectionHelpers.callInstanceMethod<Void>(activity, "onDestroy")

            assertFalse(FilePromptCoordinator.hasPending(session))
            assertTrue(prompt.isComplete)
        } finally { FilePromptCoordinator.cancelPending(session) }
    }

    @Test fun aFilePickerResultFromAnotherWindowCannotDismissTheOwnersPrompt() {
        val owner = window()
        val other = window()
        val session = GeckoSession()
        val prompt = filePrompt("file-owner-result")
        try {
            FilePromptCoordinator.start(owner, session, prompt) { true }
            val request = shadowOf(owner).nextStartedActivityForResult

            other.onActivityResult(request.requestCode, Activity.RESULT_CANCELED, null)

            assertTrue(FilePromptCoordinator.hasPending(session))
            assertFalse(prompt.isComplete)
            owner.onActivityResult(request.requestCode, Activity.RESULT_CANCELED, null)
            assertFalse(FilePromptCoordinator.hasPending(session))
            assertTrue(prompt.isComplete)
        } finally { FilePromptCoordinator.cancelPending(session) }
    }

    @Test fun closingAnotherWindowPreservesTheOwnersFilePicker() {
        val owner = window()
        val other = window()
        val session = GeckoSession()
        val prompt = filePrompt("file-other-close")
        try {
            FilePromptCoordinator.start(owner, session, prompt) { true }

            ReflectionHelpers.callInstanceMethod<Void>(other, "onDestroy")

            assertTrue(FilePromptCoordinator.hasPending(session))
            assertFalse(prompt.isComplete)
            ReflectionHelpers.callInstanceMethod<Void>(owner, "onDestroy")
            assertFalse(FilePromptCoordinator.hasPending(session))
            assertTrue(prompt.isComplete)
        } finally { FilePromptCoordinator.cancelPending(session) }
    }

    @Test fun aFinishedWindowCannotOpenAFilePickerOrRetireAnotherOwnersPrompt() {
        val owner = window()
        val closed = window()
        val session = GeckoSession()
        val prompt = filePrompt("file-live-owner")
        val stale = filePrompt("file-stale-owner")
        try {
            FilePromptCoordinator.start(owner, session, prompt) { true }
            assertNotNull(shadowOf(owner).nextStartedActivityForResult)
            closed.finish()

            FilePromptCoordinator.start(closed, GeckoSession(), stale) { true }

            assertTrue(stale.isComplete)
            assertNull(shadowOf(closed).nextStartedActivityForResult)
            assertTrue(FilePromptCoordinator.hasPending(session))
            assertFalse(prompt.isComplete)
        } finally { FilePromptCoordinator.cancelPending(session) }
    }

    @Test fun closingTheOwnerAfterFileSelectionPreservesItsAdmittedCopy() {
        val owner = window()
        val session = GeckoSession()
        val prompt = filePrompt("file-admitted-copy")
        val app = RuntimeEnvironment.getApplication()
        val selected = File.createTempFile("file-owner-copy", ".txt", app.cacheDir).apply { writeText("selected bytes") }
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val authority = "test.upload.owner"
        val uri = Uri.parse("content://$authority/selected.txt")
        val provider = object : ContentProvider() {
            override fun onCreate() = true
            override fun getType(uri: Uri) = "text/plain"
            override fun query(uri: Uri, projection: Array<out String>?, selection: String?,
                selectionArgs: Array<out String>?, sortOrder: String?) =
                MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME)).apply { addRow(arrayOf("selected.txt")) }
            override fun insert(uri: Uri, values: ContentValues?): Uri? = error("Unexpected provider write")
            override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = error("Unexpected provider delete")
            override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = error("Unexpected provider update")
            override fun openAssetFile(uri: Uri, mode: String): AssetFileDescriptor {
                entered.countDown()
                check(release.await(5, TimeUnit.SECONDS)) { "Test provider was not released" }
                return AssetFileDescriptor(ParcelFileDescriptor.open(selected, ParcelFileDescriptor.MODE_READ_ONLY), 0, selected.length())
            }
        }
        provider.attachInfo(app, ProviderInfo().apply { this.authority = authority; exported = true })
        ShadowContentResolver.registerProviderInternal(authority, provider)
        try {
            FilePromptCoordinator.start(owner, session, prompt) { true }
            val request = shadowOf(owner).nextStartedActivityForResult
            owner.onActivityResult(request.requestCode, Activity.RESULT_OK, Intent().setData(uri))
            assertTrue("Provider I/O must start before the owner closes", entered.await(5, TimeUnit.SECONDS))

            ReflectionHelpers.callInstanceMethod<Void>(owner, "onDestroy")

            assertTrue(FilePromptCoordinator.hasPending(session))
            assertFalse(prompt.isComplete)
            release.countDown()
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            while (FilePromptCoordinator.hasPending(session) && System.nanoTime() < deadline) {
                shadowOf(Looper.getMainLooper()).idle()
                Thread.sleep(5)
            }
            assertFalse(FilePromptCoordinator.hasPending(session))
            assertTrue(prompt.isComplete)
            assertTrue("Approved copies remain available to the surviving tab", FilePromptCoordinator.hasSessionFilesOrPending(session))
        } finally {
            release.countDown()
            FilePromptCoordinator.releaseSession(session)
            selected.delete()
        }
    }

    @Test fun closingAnOsWindowDeniesItsAndroidRequestAndLateResultsCannotGrantTheNextWindow() {
        val first = window()
        val firstAnswers = mutableListOf<Any?>()
        PermissionCoordinator.request(first, arrayOf(Manifest.permission.CAMERA),
            PromiseImpl(Callback { firstAnswers.add(it.single()) }, Callback { fail("Permission rejected") }))
        val retired = shadowOf(first).lastRequestedPermission
        var nextCode: Int? = null
        try {
            ReflectionHelpers.callInstanceMethod<Void>(first, "onDestroy")
            assertEquals(listOf(false), firstAnswers)

            val next = window()
            val nextAnswers = mutableListOf<Any?>()
            PermissionCoordinator.request(next, arrayOf(Manifest.permission.RECORD_AUDIO),
                PromiseImpl(Callback { nextAnswers.add(it.single()) }, Callback { fail("Permission rejected") }))
            val request = shadowOf(next).lastRequestedPermission
            nextCode = request.requestCode
            assertNotEquals(retired.requestCode, request.requestCode)

            next.onRequestPermissionsResult(retired.requestCode, retired.requestedPermissions,
                intArrayOf(PackageManager.PERMISSION_GRANTED))
            assertEquals(listOf(false), firstAnswers)
            assertTrue(nextAnswers.isEmpty())

            next.onRequestPermissionsResult(request.requestCode, request.requestedPermissions,
                intArrayOf(PackageManager.PERMISSION_GRANTED))
            assertEquals(listOf(true), nextAnswers)
        } finally {
            PermissionCoordinator.handle(retired.requestCode, intArrayOf(PackageManager.PERMISSION_DENIED))
            nextCode?.let { PermissionCoordinator.handle(it, intArrayOf(PackageManager.PERMISSION_DENIED)) }
        }
    }

    @Test fun closingTheMainBrowserDeniesItsPendingAndroidPermission() {
        val activity = browserActivity(MainActivity::class.java, "Yeoyu")
        val answers = mutableListOf<Any?>()
        PermissionCoordinator.request(activity, arrayOf(Manifest.permission.CAMERA),
            PromiseImpl(Callback { answers.add(it.single()) }, Callback { fail("Permission rejected") }))
        val request = shadowOf(activity).lastRequestedPermission
        try {
            ReflectionHelpers.callInstanceMethod<Void>(activity, "onDestroy")
            assertEquals(listOf(false), answers)
        } finally { PermissionCoordinator.handle(request.requestCode, intArrayOf(PackageManager.PERMISSION_DENIED)) }
    }

    @Test fun aFinishedWindowCannotStartAnotherAndroidPermissionRequest() {
        val activity = window()
        activity.finish()
        val answers = mutableListOf<Any?>()
        PermissionCoordinator.request(activity, arrayOf(Manifest.permission.CAMERA),
            PromiseImpl(Callback { answers.add(it.single()) }, Callback { fail("Permission rejected") }))
        val request = shadowOf(activity).lastRequestedPermission
        try {
            assertEquals(listOf(false), answers)
            assertNull(request)
        } finally { request?.let { PermissionCoordinator.handle(it.requestCode, intArrayOf(PackageManager.PERMISSION_DENIED)) } }
    }

    @Test fun windowPermissionBackBelongsToItsTabEvenWhenAnotherActivityIsCurrent() {
        val owner = window()
        val other = window()
        BrowserWindowCoordinator.register(owner, "owner-tab")
        BrowserWindowCoordinator.register(other, "other-tab")
        val context = BridgeReactContext(RuntimeEnvironment.getApplication())
        context.onHostResume(other)
        configureWindowPrompt(context, "owner-tab", true)

        owner.onBackPressedDispatcher.onBackPressed()
        assertFalse("Back dismisses the owner's permission, preserving its window", owner.isFinishing)
        assertFalse(other.isFinishing)

        other.onBackPressedDispatcher.onBackPressed()
        assertTrue("Other windows retain their normal Back action", other.isFinishing)
        configureWindowPrompt(context, "owner-tab", false)
        owner.onBackPressedDispatcher.onBackPressed()
        assertTrue("Back resumes normal window navigation after the prompt closes", owner.isFinishing)
    }

    @Test fun escapeIsConsumedOnlyWhileThatWindowHasAPermissionPrompt() {
        val owner = window()
        val other = window()
        BrowserWindowCoordinator.register(owner, "owner-tab")
        BrowserWindowCoordinator.register(other, "other-tab")
        val context = BridgeReactContext(RuntimeEnvironment.getApplication())
        context.onHostResume(other)
        configureWindowPrompt(context, "owner-tab", true)

        assertTrue(owner.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ESCAPE)))
        assertTrue(owner.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ESCAPE)))
        assertFalse(owner.isFinishing)
        assertFalse(other.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ESCAPE)))
    }

    @Test fun aCredentialAnswerInAnOsWindowReachesGecko() {
        val activity = window()
        GeckoSessionRegistry.activityProvider = { activity }
        val pendingIntent = PendingIntent.getActivity(RuntimeEnvironment.getApplication(), 7,
            Intent("test.credential"), PendingIntent.FLAG_IMMUTABLE)
        val answers = mutableListOf<Intent?>()
        val result = CredentialActivityCoordinator.onStartActivityForResult(pendingIntent)
        result.accept({ answers.add(it) }, { fail("Credential result rejected: $it") })
        val request = shadowOf(activity).lastIntentSenderRequest
        val answer = Intent().putExtra("credential", "credential-result")

        activity.onActivityResult(request.requestCode, Activity.RESULT_OK, answer)
        shadowOf(Looper.getMainLooper()).idle()

        assertEquals(listOf(answer), answers)
    }

    @Test fun closingAnOsWindowCancelsItsPendingCredentialRequest() {
        val activity = window()
        GeckoSessionRegistry.activityProvider = { activity }
        val pendingIntent = PendingIntent.getActivity(RuntimeEnvironment.getApplication(), 8,
            Intent("test.credential.close"), PendingIntent.FLAG_IMMUTABLE)
        val failures = mutableListOf<Throwable?>()
        CredentialActivityCoordinator.onStartActivityForResult(pendingIntent)
            .accept({ fail("Closed window must not approve a credential") }, { failures.add(it) })

        ReflectionHelpers.callInstanceMethod<Void>(activity, "onDestroy")
        shadowOf(Looper.getMainLooper()).idle()

        assertEquals(1, failures.size)
        assertTrue(failures.single() is java.util.concurrent.CancellationException)
    }

    private fun window() = browserActivity(BrowserWindowActivity::class.java, "YeoyuWindow")

    private fun filePrompt(id: String): FilePrompt = FilePrompt::class.java.declaredConstructors.single().let {
        it.isAccessible = true
        it.newInstance(id, "Files", FilePrompt.Type.SINGLE, 0, arrayOf("*/*"), null) as FilePrompt
    }

    private fun configureWindowPrompt(context: ReactApplicationContext, tabId: String, enabled: Boolean) {
        val module = BrowserModule(context)
        val configure = module.javaClass.declaredMethods.firstOrNull { it.name == "configureWindowPermissionPrompt" }
        assertNotNull("The native bridge must address window permission prompts by tab", configure)
        configure!!.invoke(module, tabId, enabled)
        // Registry-change JS notices are outside this input-routing boundary;
        // drain the module's real UI-thread dispatch without loading native JNI maps.
        ReflectionHelpers.getField<android.os.Handler>(BrowserWindowCoordinator, "main").removeCallbacksAndMessages(null)
        shadowOf(Looper.getMainLooper()).idle()
    }

    private fun <T : ReactActivity> browserActivity(type: Class<T>, component: String): T {
        val lifecycle = Robolectric.buildActivity(type)
        val activity = lifecycle.get()
        // Keep Android callbacks and our real coordinators, without starting Hermes.
        ReflectionHelpers.setField(activity, "mDelegate", object : ReactActivityDelegate(activity, component) {
            override fun onCreate(savedInstanceState: Bundle?) {}
            override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {}
            override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {}
            override fun onKeyDown(keyCode: Int, event: KeyEvent) = false
            override fun onKeyUp(keyCode: Int, event: KeyEvent) = false
            override fun onDestroy() {}
        })
        return lifecycle.create().start().get()
    }
}
