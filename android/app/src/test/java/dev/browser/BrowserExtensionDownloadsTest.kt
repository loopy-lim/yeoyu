package dev.browser

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowserExtensionDownloadsTest {
    private val owner = "moz-extension://owned-uuid/"

    @Test fun exportSchemesMatchTheInspectedDashboardPackages() {
        for (url in arrayOf("data:text/plain;charset=utf-8,%7B%7D", "data:text/plain,filters", "data:application/json;base64,e30=", "blob:moz-extension://owned-uuid/export-id"))
            assertTrue(url, BrowserExtensionDownloads.allowedResponse(owner, url))
    }

    @Test fun foreignAndPrivilegedAddressesCannotEnterTheExportPath() {
        for (url in arrayOf("blob:moz-extension://another-uuid/export-id", "blob:https://example.com/export-id", "blob:moz-extension://owned-uuid/", "blob:moz-extension://user@owned-uuid/export-id", "blob:moz-extension://owned-uuid:44/export-id", "data:text/html,<script>x</script>", "data:image/svg+xml,active", "data:text/plain", "file:///private/data", "content://provider/data", "resource://gre/file", "moz-extension://owned-uuid/secrets", "https://example.com/export"))
            assertFalse(url, BrowserExtensionDownloads.allowedResponse(owner, url))
        assertFalse(BrowserExtensionDownloads.allowedResponse("https://example.com/", "data:text/plain,export"))
    }

    @Test fun localNavigationRequiresTheExactOwningExtensionDocument() {
        assertTrue(BrowserExtensionDownloads.allowedNavigation(owner, owner + "dashboard.html", "data:text/plain,export", false))
        assertTrue(BrowserExtensionDownloads.allowedNavigation(owner, owner + "options", "blob:moz-extension://owned-uuid/id", false))
        for (trigger in arrayOf(null, "https://example.com/", "moz-extension://another-uuid/settings", "moz-extension://owned-uuid:80/options", "moz-extension://user@owned-uuid/options"))
            assertFalse(BrowserExtensionDownloads.allowedNavigation(owner, trigger, "data:text/plain,export", false))
        assertFalse(BrowserExtensionDownloads.allowedNavigation(owner, owner, "data:text/plain,export", true))
    }

    @Test fun dashboardIframeExportsHaveTheSamePrincipalBoundaryAsTopLevelExports() {
        // uBlock 1.74 embeds 1p-filters.html in its dashboard iframe and exports
        // through a detached data:text/plain download anchor inside that frame.
        val export = "data:text/plain;charset=utf-8,%7C%7Clocalhost%24script"
        assertTrue(BrowserExtensionDownloads.allowedNavigation(owner, owner + "1p-filters.html", export, false))
        for (frame in arrayOf(null, "data:text/html,sandbox", "https://example.com/frame", "moz-extension://foreign-uuid/1p-filters.html"))
            assertFalse(BrowserExtensionDownloads.allowedNavigation(owner, frame, export, false))
        assertFalse(BrowserExtensionDownloads.allowedNavigation(owner, owner + "1p-filters.html", export, true))
    }
}
