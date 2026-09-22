package dev.browser

import org.junit.Assert.*
import org.junit.Test
import org.mozilla.geckoview.GeckoSession.PermissionDelegate as P

class BrowserPermissionDefaultsTest {
    @Test fun autoplayUsesQuietDefaultsWithoutPrompting() {
        assertEquals(P.ContentPermission.VALUE_ALLOW, defaultContentPermissionDecision(P.PERMISSION_AUTOPLAY_INAUDIBLE, null))
        assertEquals(P.ContentPermission.VALUE_DENY, defaultContentPermissionDecision(P.PERMISSION_AUTOPLAY_AUDIBLE, null))
        assertEquals(P.ContentPermission.VALUE_DENY, defaultContentPermissionDecision(P.PERMISSION_AUTOPLAY_INAUDIBLE, false))
        assertEquals(P.ContentPermission.VALUE_ALLOW, defaultContentPermissionDecision(P.PERMISSION_AUTOPLAY_AUDIBLE, true))
    }

    @Test fun sensitivePermissionsHaveNoImplicitGrant() {
        for (permission in listOf(P.PERMISSION_GEOLOCATION, P.PERMISSION_DESKTOP_NOTIFICATION, P.PERMISSION_PERSISTENT_STORAGE)) {
            assertNull(defaultContentPermissionDecision(permission, null))
        }
    }

    @Test fun dismissalQuietsOnlyTheRequestedCapabilitiesUntilNavigation() {
        val prompts = DocumentPermissionPrompts()
        prompts.dismiss("https://example.com", "camera,microphone")
        assertFalse(prompts.shouldPrompt("https://example.com", "camera"))
        assertFalse(prompts.shouldPrompt("https://example.com", "microphone,camera"))
        assertTrue(prompts.shouldPrompt("https://example.com", "geolocation"))
        assertTrue(prompts.shouldPrompt("https://other.example", "camera"))
        prompts.clear()
        assertTrue(prompts.shouldPrompt("https://example.com", "camera"))
    }
}
