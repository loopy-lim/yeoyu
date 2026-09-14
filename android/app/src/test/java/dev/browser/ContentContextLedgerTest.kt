package dev.browser

import org.junit.Assert.*
import org.junit.Test

class ContentContextLedgerTest {
    @Test fun selectionConsumesExactlyTheRetainedLinkAndCannotBeReplayed() {
        val ledger = ContentContextLedger()
        val id = ledger.offer("https://example.com/link", "https://example.com/image", 100) { true }
        assertEquals("https://example.com/image", ledger.consume(id, "image", 101))
        try { ledger.consume(id, "link", 102); fail("replayed context request") }
        catch (_: IllegalStateException) { }
    }

    @Test fun navigationReplacementAndExpiryInvalidateContextActions() {
        val ledger = ContentContextLedger()
        var current = true
        val stale = ledger.offer("https://example.com/a", null, 100) { current }
        current = false
        try { ledger.consume(stale, "link", 101); fail("navigated request accepted") }
        catch (_: IllegalStateException) { }
        val old = ledger.offer("https://example.com/a", null, 200) { true }
        val next = ledger.offer("https://example.com/b", null, 300) { true }
        try { ledger.consume(old, "link", 301); fail("replaced menu accepted") }
        catch (_: IllegalStateException) { }
        try { ledger.consume(next, "link", 60_301); fail("expired menu accepted") }
        catch (_: IllegalStateException) { }
    }
}
