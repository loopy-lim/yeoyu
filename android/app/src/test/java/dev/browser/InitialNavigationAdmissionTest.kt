package dev.browser

import org.junit.Assert.*
import org.junit.Test

class InitialNavigationAdmissionTest {
    private val target = "https://fixture.invalid/lifecycle-c"
    private val blank = "about:blank"
    private fun policy(initial: String = target, open: Boolean = true) = InitialNavigationAdmission(initial, open) { true }

    @Test fun `observed synthetic triplet cannot publish blank or consume document start`() {
        val p = policy()
        assertFalse(p.acceptPageStart(blank))
        assertFalse(p.acceptLocation(blank, false))
        assertFalse(p.acceptHistoryChange()) // Both callbacks follow LocationChange in the same Gecko message.
        assertFalse(p.acceptPageStop(true))
        assertFalse(p.locationAccepted)
        assertTrue(p.acceptPageStart(target))
        assertTrue(p.acceptLocation(target, false))
        assertTrue(p.locationAccepted)
        assertTrue(p.acceptPageStop(true))
    }

    @Test fun `suppression decisions leave real target and one real document generation intact`() {
        val p = policy()
        var url = target
        var documents = 0
        var flushes = 0
        if (p.acceptPageStart(blank)) documents++
        if (p.acceptLocation(blank, false)) url = blank
        if (p.acceptPageStop(true)) flushes++
        assertEquals(target, url)
        assertEquals(0, documents)
        assertEquals(0, flushes)
        if (p.acceptPageStart(target)) documents++
        if (p.acceptLocation(target, false)) url = target
        if (p.acceptPageStop(true)) flushes++
        assertEquals(target, url)
        assertEquals(1, documents)
        assertEquals(1, flushes)
    }

    @Test fun `state admission keeps saved history through startup and admits genuine restored history`() {
        val p = policy()
        assertFalse(p.acceptSessionState(target, blank))
        assertFalse(p.acceptSessionState(target, target))
        assertFalse(p.acceptPageStart(blank))
        assertFalse(p.acceptLocation(blank, false))
        assertFalse(p.acceptPageStop(true))
        assertFalse(p.acceptSessionState(target, blank))
        assertTrue(p.acceptPageStart(target))
        assertFalse(p.acceptSessionState(target, target))
        assertTrue(p.acceptLocation(target, false))
        assertTrue(p.acceptSessionState(target, target))
    }

    @Test fun `late bootstrap snapshot cannot bind blank history to accepted real URL`() {
        val p = policy()
        p.acceptPageStart(blank); p.acceptLocation(blank, false); p.acceptPageStop(true)
        p.acceptPageStart(target); p.acceptLocation(target, false)
        assertFalse(p.acceptSessionState(target, blank))
        assertFalse(p.acceptSessionState(target, null))
        assertTrue(p.acceptSessionState(target, target))
    }

    @Test fun `initial explicit blank retains its page events and state before location`() {
        val p = policy(blank)
        assertTrue(p.acceptSessionState(blank, blank))
        assertTrue(p.acceptPageStart(blank))
        assertTrue(p.acceptLocation(blank, false))
        assertTrue(p.acceptHistoryChange())
        assertTrue(p.acceptPageStop(true))
        assertTrue(p.locationAccepted)
    }

    @Test fun `popup session excludes suppression even with nonblank initial metadata`() {
        val p = policy(open = false)
        assertTrue(p.acceptSessionState(target, blank))
        assertTrue(p.acceptPageStart(blank))
        assertTrue(p.acceptLocation(blank, false))
        assertTrue(p.acceptPageStop(true))
        assertTrue(p.locationAccepted)
    }

    @Test fun `later blank and history navigation remain real events without user gesture`() {
        val p = policy()
        p.acceptPageStart(blank); p.acceptLocation(blank, false); p.acceptPageStop(true)
        assertTrue(p.acceptPageStart(target))
        assertTrue(p.acceptLocation(target, false))
        assertTrue(p.acceptPageStop(true))
        assertTrue(p.acceptPageStart(blank))
        assertTrue(p.acceptLocation(blank, false))
        assertTrue(p.acceptHistoryChange())
        assertTrue(p.acceptPageStop(true))
        assertTrue(p.acceptSessionState(blank, blank))
    }

    @Test fun `explicit blank or history request during startup overrides synthetic recognition`() {
        for (afterBlankStart in listOf(false, true)) {
            val p = policy()
            if (afterBlankStart) assertFalse(p.acceptPageStart(blank))
            p.navigationRequested()
            assertTrue(p.acceptPageStart(blank))
            assertTrue(p.acceptLocation(blank, false))
            assertTrue(p.acceptPageStop(true))
            assertTrue(p.acceptSessionState(blank, blank))
        }
    }

    @Test fun `explicit nonblank replacement keeps recognition of the pending synthetic cycle`() {
        val p = policy()
        p.navigationRequested("https://replacement.invalid/")
        assertFalse(p.acceptPageStart(blank))
        assertFalse(p.acceptLocation(blank, false))
        assertFalse(p.acceptPageStop(true))
        assertTrue(p.acceptPageStart("https://replacement.invalid/"))
        assertTrue(p.acceptLocation("https://replacement.invalid/", false))
        assertTrue(p.locationAccepted)
    }

    @Test fun `a real start before initial blank prevents eating any later blank cycle`() {
        val p = policy()
        assertTrue(p.acceptPageStart(target))
        assertTrue(p.acceptPageStart(blank))
        assertTrue(p.acceptLocation(blank, false))
        assertTrue(p.acceptPageStop(true))
    }

    @Test fun `blank location without expected start is not heuristically suppressed`() {
        val p = policy()
        assertTrue(p.acceptLocation(blank, false))
        assertTrue(p.acceptPageStop(true))
        assertTrue(p.locationAccepted)
    }

    @Test fun `gesture location or real redirect interrupts recognition without losing stop`() {
        for ((uri, gesture) in listOf(blank to true, "https://redirect.invalid/" to false)) {
            val p = policy()
            assertFalse(p.acceptPageStart(blank))
            assertTrue(p.acceptLocation(uri, gesture))
            assertTrue(p.acceptHistoryChange())
            assertTrue(p.acceptPageStop(true))
            assertTrue(p.locationAccepted)
        }
    }

    @Test fun `failed stop or incomplete triplet is not consumed as synthetic success`() {
        val startedOnly = policy()
        startedOnly.acceptPageStart(blank)
        assertTrue(startedOnly.acceptPageStop(true))
        val failed = policy()
        failed.acceptPageStart(blank); failed.acceptLocation(blank, false)
        assertTrue(failed.acceptPageStop(false))
        assertTrue(failed.acceptPageStart(blank))
        assertTrue(failed.acceptLocation(blank, false))
        assertTrue(failed.acceptPageStop(true))
    }

    @Test fun `synthetic recognition is one-shot even when next navigation is blank`() {
        val p = policy()
        assertFalse(p.acceptPageStart(blank))
        assertFalse(p.acceptLocation(blank, false))
        assertFalse(p.acceptPageStop(true))
        assertTrue(p.acceptPageStart(blank))
        assertTrue(p.acceptLocation(blank, false))
        assertTrue(p.acceptPageStop(true))
    }

    @Test fun `null location does not open state or cold cover admission`() {
        val p = policy()
        assertTrue(p.acceptLocation(null, false))
        assertFalse(p.locationAccepted)
        assertFalse(p.acceptSessionState(target, blank))
        assertTrue(p.acceptLocation(target, false))
        assertTrue(p.locationAccepted)
    }

    @Test fun `retired exact entry rejects all late callbacks and cannot admit a replacement`() {
        var owner: Any = Any()
        val original = owner
        val p = InitialNavigationAdmission(target, true) { owner === original }
        p.acceptPageStart(target); p.acceptLocation(target, false)
        assertTrue(p.locationAccepted)
        owner = Any()
        assertFalse(p.locationAccepted)
        assertFalse(p.acceptPageStart(target))
        assertFalse(p.acceptLocation(blank, true))
        assertFalse(p.acceptHistoryChange())
        assertFalse(p.acceptPageStop(true))
        assertFalse(p.acceptSessionState(target, target))
        p.navigationRequested()
        assertFalse(p.acceptPageStart(blank))
        val replacement = policy()
        assertFalse(replacement.locationAccepted)
        assertFalse(replacement.acceptPageStart(blank))
    }

    @Test fun `error presentation history stays eligible under the existing normalized target`() {
        val p = policy()
        p.acceptPageStart(target)
        assertTrue(p.acceptLocation("about:neterror?u=fixture", false))
        assertTrue(p.locationAccepted)
        assertTrue(p.acceptSessionState(target, "about:neterror?u=fixture"))
    }
}
