package dev.browser

import org.junit.Assert.*
import org.junit.Test

class PopupRequestTest {
    private class Session(var open: Boolean = false)

    @Test fun alreadyOpenChildCannotBypassNativeNewWindowSetup() {
        val results = mutableListOf<Session?>()
        val request = PopupRequest<Session>({ results.add(it) }, {}, { it.open })
        val error = assertThrows(IllegalStateException::class.java) {
            request.adopt(Session(open = true)) {}
        }
        assertEquals("New windows require an unopened session", error.message)
        assertNull(request.child)
        assertTrue(results.isEmpty())
        request.cancel("Adoption failed")
        assertEquals(listOf<Session?>(null), results)
    }

    @Test fun engineMayOpenChildOnlyAfterItReceivesTheResult() {
        val session = Session()
        val replies = mutableListOf<String?>()
        val request = PopupRequest<Session>({ child ->
            assertSame(session, child)
            assertFalse(child!!.open)
            // GeckoRuntime sees false, then opens and attaches native window info.
            child.open = true
        }, {}, { it.open })
        assertTrue(request.adopt(session) { replies.add(it) })
        assertTrue(session.open)
        assertTrue(replies.isEmpty())
        request.opened()
        assertEquals(listOf<String?>(null), replies)
    }

    @Test fun cancellationBeforeAdoptionDeclinesOnlyOnce() {
        val results = mutableListOf<String?>()
        val closed = mutableListOf<String>()
        val request = PopupRequest<String>({ results.add(it) }, { closed.add(it) }, { false })
        request.cancel("Opener closed")
        request.cancel("Timeout")
        assertEquals(listOf<String?>(null), results)
        assertTrue(closed.isEmpty())
        assertFalse(request.adopt("child") {})
    }

    @Test fun adoptionWaitsForOpenAndSuccessfulAckCannotBeCancelled() {
        val results = mutableListOf<String?>()
        val closed = mutableListOf<String>()
        val replies = mutableListOf<String?>()
        val request = PopupRequest<String>({ results.add(it) }, { closed.add(it) }, { false })
        assertTrue(request.adopt("child") { replies.add(it) })
        assertEquals(listOf("child"), results)
        assertTrue(replies.isEmpty())
        assertFalse(request.adopt("duplicate") {})
        request.opened()
        request.opened()
        request.cancel("Late timeout")
        assertEquals(listOf<String?>(null), replies)
        assertTrue(closed.isEmpty())
    }

    @Test fun timeoutAfterAdoptionClosesChildAndRejectsAckWithoutSecondResult() {
        val results = mutableListOf<String?>()
        val closed = mutableListOf<String>()
        val replies = mutableListOf<String?>()
        val request = PopupRequest<String>({ results.add(it) }, { closed.add(it) }, { false })
        request.adopt("child") { replies.add(it) }
        request.cancel("Popup request timed out")
        request.opened()
        request.cancel("Opener closed")
        assertEquals(listOf("child"), results)
        assertEquals(listOf("child"), closed)
        assertEquals(listOf("Popup request timed out"), replies)
    }
}
