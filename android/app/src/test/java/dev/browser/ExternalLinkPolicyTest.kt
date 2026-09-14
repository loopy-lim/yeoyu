package dev.browser

import org.junit.Assert.*
import org.junit.Test

class ExternalLinkPolicyTest {
    private fun allowed(uri: String, gesture: Boolean = true, subframe: Boolean = false,
        target: String? = null, packagedIntent: Boolean = false) =
        ExternalLinkPolicy.appTarget(uri, gesture, subframe, target, packagedIntent, "com.workspacebrowser")

    @Test fun foregroundUserGestureIsRequiredForEveryExternalRoute() {
        assertNotNull(allowed("mailto:person@example.com"))
        assertNotNull(allowed("tel:+821012345678"))
        assertNull(allowed("mailto:person@example.com", gesture = false))
        assertNull(allowed("tel:123", subframe = true))
        assertNull(allowed("https://example.com"))
        assertNull(allowed("unknown:payload"))
    }

    @Test fun aPackagedIntentCannotBypassDangerousSchemeOrSelfLoopChecks() {
        listOf("javascript:alert(1)", "file:///data/a", "content://private/a", "data:text/plain,a", "blob:https://example.com/a", "about:blank").forEach {
            assertNull(allowed(it, target = "com.example.app", packagedIntent = true))
        }
        assertNull(allowed("authapp:callback", target = "com.workspacebrowser", packagedIntent = true))
        assertNull(allowed("authapp:callback", packagedIntent = true))
        assertNull(allowed("authapp:callback", target = "bad/package", packagedIntent = true))
        assertNotNull(allowed("authapp:callback", target = "com.example.app", packagedIntent = true))
    }

    @Test fun fallbackAndContextTargetsOnlyAcceptHttpWithAHost() {
        assertEquals("https://example.com/image?a=1", ExternalLinkPolicy.webUri("https://example.com/image?a=1"))
        assertNull(ExternalLinkPolicy.webUri("javascript:alert(1)"))
        assertNull(ExternalLinkPolicy.webUri("https:///no-host"))
        assertNull(ExternalLinkPolicy.webUri("https://example.com\r\nInjected: value"))
    }

    @Test fun theSameDocumentCannotRepeatedlyLaunchTheSameApp() {
        val guard = ExternalLaunchGuard()
        assertTrue(guard.acquire("tab", "https://example.com", "tel:123", 1000))
        assertFalse(guard.acquire("tab", "https://example.com", "tel:123", 1001))
        assertTrue(guard.acquire("tab", "https://example.com", "tel:456", 1001))
        assertTrue(guard.acquire("tab", "https://other.example", "tel:123", 1001))
        assertTrue(guard.acquire("tab", "https://example.com", "tel:123", 7000))
    }
}
