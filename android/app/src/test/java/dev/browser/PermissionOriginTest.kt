package dev.browser

import org.junit.Assert.*
import org.junit.Test

class PermissionOriginTest {
    @Test fun preservesSubdomainsAndNondefaultPorts() {
        assertEquals("https://www.example.com", permissionOrigin("https://WWW.example.com/page"))
        assertEquals("https://example.com:8443", permissionOrigin("https://example.com:8443/page"))
        assertEquals("https://example.com:9443", permissionOrigin("https://example.com:9443/page"))
        assertNotEquals(permissionOrigin("https://example.com"), permissionOrigin("https://www.example.com"))
        assertNotEquals(permissionOrigin("https://example.com:8443"), permissionOrigin("https://example.com:9443"))
    }

    @Test fun normalizesOnlySchemeHostCaseAndDefaultPorts() {
        assertEquals("https://example.com", permissionOrigin("HTTPS://EXAMPLE.COM:443/path?q=1#fragment"))
        assertEquals("http://example.com", permissionOrigin("http://example.com:80/"))
        assertEquals("https://example.com:80", permissionOrigin("https://example.com:80/"))
        assertEquals("https://[::1]:8443", permissionOrigin("https://[::1]:8443/path"))
    }

    @Test fun rejectsOpaqueOrMalformedOrigins() {
        for (value in listOf(null, "", "not a URL", "file:///tmp/page.html", "about:blank", "https://", "https://example.com:65536"))
            assertNull(permissionOrigin(value))
    }
}
