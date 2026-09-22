package dev.browser

import org.junit.Assert.*
import org.junit.Test

class BrowserPermissionRevocationTest {
    @Test fun matchesOnlyTheExactWebOriginAndKind() {
        val origin = "https://example.com:8443"
        assertTrue(matchesPermissionReset("https://example.com:8443/page", "geolocation", false, origin, "geolocation"))
        for (uri in listOf("https://example.com:9443", "http://example.com:8443", "https://www.example.com:8443"))
            assertFalse(matchesPermissionReset(uri, "geolocation", false, origin, "geolocation"))
        assertFalse(matchesPermissionReset(origin, "notifications", false, origin, "geolocation"))
    }

    @Test fun resetAllPreservesPrivateInternalAndUnsupportedPermissions() {
        assertTrue(matchesPermissionReset("https://example.com", "autoplay", false, null, null))
        assertFalse(matchesPermissionReset("https://example.com", "autoplay", true, null, null))
        assertFalse(matchesPermissionReset("moz-extension://extension-id", "notifications", false, null, null))
        assertFalse(matchesPermissionReset("https://example.com", "persistent-storage", false, null, null))
        assertFalse(matchesPermissionReset("https://example.com", null, false, null, null))
    }
}
