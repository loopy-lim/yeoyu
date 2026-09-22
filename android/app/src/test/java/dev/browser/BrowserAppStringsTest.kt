package dev.browser

import android.app.Application
import com.workspacebrowser.R
import java.util.Locale
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class BrowserAppStringsTest {
    private lateinit var original: Locale

    @Before fun rememberLocale() { original = Locale.getDefault() }
    @After fun restoreLocale() {
        Locale.setDefault(original)
        BrowserAppStrings.setLanguage("system")
    }

    @Test fun explicitChoiceOverridesDeviceAndSystemFollowsIt() {
        val context = RuntimeEnvironment.getApplication()
        Locale.setDefault(Locale.KOREAN)
        BrowserAppStrings.setLanguage("en")
        assertEquals("Cancel", BrowserAppStrings.get(context, R.string.browser_cancel))
        BrowserAppStrings.setLanguage("system")
        assertEquals("취소", BrowserAppStrings.get(context, R.string.browser_cancel))
        Locale.setDefault(Locale.JAPANESE)
        assertEquals("Cancel", BrowserAppStrings.get(context, R.string.browser_cancel))
    }
}
