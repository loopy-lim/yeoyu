package dev.browser

import org.junit.Assert.*
import org.junit.Test

class WebNotificationPolicyTest {
    @Test fun requiresAWebsiteOriginThatMatchesTheEnginePrincipal() {
        assertEquals("https://example.com:8443", webNotificationOrigin("https://example.com:8443/path?secret=1", "https://example.com:8443^userContextId=2"))
        assertNull(webNotificationOrigin(null, "https://example.com"))
        assertNull(webNotificationOrigin("https://other.com", "https://example.com"))
        assertNull(webNotificationOrigin("moz-extension://id", "moz-extension://id"))
        assertNull(webNotificationOrigin("https://example.com", "http://example.com"))
        assertNull(webNotificationOrigin("https://example.com", "https://example.com:8443"))
        assertNull(webNotificationOrigin("https://example.com", "https://example.com/forged-path"))
    }

    @Test fun privateNotificationsHaveNoPageContentAndCannotAppearInBackground() {
        val privateContent = webNotificationPresentation(true, true, true, true, "Secret title", "Secret message", "https://secret.example")!!
        assertFalse(privateContent.title.contains("Secret"))
        assertFalse(privateContent.text.contains("Secret"))
        assertNull(privateContent.origin)
        assertFalse(privateContent.allowActions)
        assertNull(webNotificationPresentation(true, false, true, true, "Secret", "Secret", "https://secret.example"))
        val normal = webNotificationPresentation(false, false, true, true, "Delivery", "Ready", "https://example.com")!!
        assertEquals("Delivery", normal.title)
        assertEquals("Ready", normal.text)
        assertEquals("https://example.com", normal.origin)
        assertTrue(normal.allowActions)
    }

    @Test fun deniedSystemPermissionOrDisabledChannelCannotReportShown() {
        assertNull(webNotificationPresentation(false, true, false, true, "title", "body", "https://example.com"))
        assertNull(webNotificationPresentation(false, true, true, false, "title", "body", "https://example.com"))
    }

    @Test fun untrustedTextIsBoundedAndControlCharactersAreRemoved() {
        val result = webNotificationPresentation(false, true, true, true, "a\u202Eb\u0000c", "x".repeat(100_000), "https://example.com")!!
        assertEquals("abc", result.title)
        assertTrue(result.text.length < 10_000)
    }

    @Test fun replacedTokensCannotClickOrDismissTheReplacement() {
        val ledger = WebNotificationLedger<String>(2)
        val key = WebNotificationKey("https://example.com", "tag", false)
        ledger.add(key, "https://example.com", "old-token", "old", emptyList())
        val replaced = ledger.add(key, "https://example.com", "new-token", "new", emptyList())
        assertEquals(listOf("old"), replaced.map { it.entry.value })
        assertFalse(replaced.single().notifyEngine)
        assertNull(ledger.consume("old-token", -1))
        assertEquals("new", ledger.consume("new-token", -1)?.value)
        assertNull(ledger.consume("new-token", -1))
    }

    @Test fun tagsAreIsolatedByPrincipalAndPrivateMode() {
        val ledger = WebNotificationLedger<String>(4)
        val normal = WebNotificationKey("https://example.com", "tag", false)
        val private = WebNotificationKey("https://example.com^privateBrowsingId=1", "tag", true)
        val partition = WebNotificationKey("https://example.com^userContextId=2", "tag", false)
        ledger.add(normal, "https://example.com", "normal", "normal", emptyList())
        ledger.add(private, "https://example.com", "private", "private", emptyList())
        ledger.add(partition, "https://example.com", "partition", "partition", emptyList())
        assertEquals("normal", ledger.remove(normal)?.value)
        assertEquals("private", ledger.consume("private", -1)?.value)
        assertEquals("partition", ledger.consume("partition", -1)?.value)
    }

    @Test fun delayedEngineCloseForOldInstanceDoesNotRetireReplacement() {
        val ledger = WebNotificationLedger<Any>(2)
        val key = WebNotificationKey("https://example.com", "tag", false)
        val old = Any()
        val replacement = Any()
        ledger.add(key, "https://example.com", "old", old, emptyList())
        ledger.add(key, "https://example.com", "replacement", replacement, emptyList())
        assertTrue(ledger.removeWhere { it.key == key && it.value === old }.isEmpty())
        assertSame(replacement, ledger.consume("replacement", -1)?.value)
    }

    @Test fun capacityEvictsOldestAndMakesItsActionsStale() {
        val ledger = WebNotificationLedger<String>(2)
        fun add(id: String) = ledger.add(WebNotificationKey("https://example.com", id, false), "https://example.com", id, id, emptyList())
        add("first"); add("second")
        val evicted = add("third")
        assertEquals(listOf("first"), evicted.map { it.entry.value })
        assertTrue(evicted.single().notifyEngine)
        assertNull(ledger.consume("first", -1))
        assertEquals("second", ledger.consume("second", -1)?.value)
        assertEquals("third", ledger.consume("third", -1)?.value)
    }

    @Test fun invalidActionDoesNotConsumeTheNotificationAndValidActionIsOneShot() {
        val ledger = WebNotificationLedger<String>(2)
        ledger.add(WebNotificationKey("https://example.com", "tag", false), "https://example.com", "token", "value", listOf("open", "archive"))
        assertNull(ledger.consume("token", 2))
        assertNull(ledger.consume("token", -2))
        val clicked = ledger.consume("token", 1)!!
        assertEquals("archive", clicked.actions[1])
        assertNull(ledger.consume("token", 1))
    }

    @Test fun foregroundLossOnlyRetiresPrivateNotificationsAndOriginResetIsExact() {
        val ledger = WebNotificationLedger<String>(5)
        fun add(id: String, origin: String, private: Boolean) = ledger.add(WebNotificationKey(origin, id, private), origin, id, id, emptyList())
        add("private", "https://example.com", true)
        add("normal", "https://example.com", false)
        add("port", "https://example.com:8443", false)
        assertEquals(listOf("private"), ledger.removeWhere { it.key.privateBrowsing }.map { it.value })
        assertNull(ledger.consume("private", -1))
        assertEquals(listOf("normal"), ledger.removeWhere { it.origin == "https://example.com" }.map { it.value })
        assertNull(ledger.consume("normal", -1))
        assertEquals("port", ledger.consume("port", -1)?.value)
    }

    @Test fun previousProcessTokenHasNoCallbackInNewLedger() {
        val old = WebNotificationLedger<String>(2)
        old.add(WebNotificationKey("https://example.com", "tag", false), "https://example.com", "old-token", "old", emptyList())
        assertNull(WebNotificationLedger<String>(2).consume("old-token", -1))
        assertEquals(listOf("old"), old.removeWhere { true }.map { it.value })
        assertNull(old.consume("old-token", -1))
    }

    @Test fun serviceWorkerWindowNeedsFreshNormalClickAndExactOrigin() {
        val activation = WebNotificationActivation()
        assertNull(activation.consume("https://example.com/page", 1_000))
        activation.begin("https://example.com", false, 1_000)
        assertNull(activation.consume("https://other.example/page", 1_001))
        assertNull(activation.consume("https://example.com/page", 1_002))
        activation.begin("https://example.com", false, 2_000)
        assertEquals("https://example.com", activation.consume("https://example.com/page?x=1", 2_001))
        assertNull(activation.consume("https://example.com/page", 2_002))
        activation.begin("https://example.com", true, 3_000)
        assertNull(activation.consume("https://example.com/page", 3_001))
        activation.begin("https://example.com", false, 4_000)
        assertNull(activation.consume("https://example.com/page", 9_000))
    }

    @Test fun serviceWorkerWindowRejectsCredentialUrlsAndClearedActivation() {
        val activation = WebNotificationActivation()
        for (url in listOf("javascript:alert(1)", "https://user:secret@example.com/path", "https://example.com:8443/path", "https://example.com/\u0000")) {
            activation.begin("https://example.com", false, 100)
            assertNull(activation.consume(url, 101))
        }
        activation.begin("https://example.com", false, 100)
        activation.clear()
        assertNull(activation.consume("https://example.com", 101))
        activation.begin("https://example.com", false, 100)
        assertNull(activation.consume("https://example.com", 99))
    }
}
