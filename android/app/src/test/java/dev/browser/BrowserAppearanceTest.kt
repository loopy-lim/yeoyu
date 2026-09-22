package dev.browser

import org.junit.Assert.assertEquals
import org.junit.Test

class BrowserAppearanceTest {
    @Test fun legacyAndMalformedModesFollowSystem() {
        for (value in arrayOf(null, "", "auto", "DARK", "unknown"))
            assertEquals("system", BrowserAppearance.normalizeMode(value))
    }

    @Test fun explicitModesKeepTheirMeaning() {
        for (value in arrayOf("system", "light", "dark"))
            assertEquals(value, BrowserAppearance.normalizeMode(value))
    }
}
