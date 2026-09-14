package dev.browser

import org.junit.Assert.*
import org.junit.Test

class PopupRequestTest {
    @Test fun cancellationBeforeAdoptionDeclinesOnlyOnce() {
        val results = mutableListOf<String?>()
        val closed = mutableListOf<String>()
        val request = PopupRequest<String>({ results.add(it) }, { closed.add(it) })
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
        val request = PopupRequest<String>({ results.add(it) }, { closed.add(it) })
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
        val request = PopupRequest<String>({ results.add(it) }, { closed.add(it) })
        request.adopt("child") { replies.add(it) }
        request.cancel("Popup request timed out")
        request.opened()
        request.cancel("Opener closed")
        assertEquals(listOf("child"), results)
        assertEquals(listOf("child"), closed)
        assertEquals(listOf("Popup request timed out"), replies)
    }
}
