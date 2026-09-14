package dev.browser

import org.junit.Assert.*
import org.junit.Test

class PermissionRequestLedgerTest {
    @Test fun anAllowAnswerCannotGrantAfterTheOwningDocumentChanges() {
        val owner = Any()
        val ledger = PermissionRequestLedger<String>()
        ledger.add(7, owner, documentGeneration = 3, value = "camera callback")

        val resolution = ledger.resolve(
            id = 7,
            allow = true,
            isOwnerAlive = { it === owner },
            currentDocument = { 4 },
        )

        assertNotNull(resolution)
        assertEquals("camera callback", resolution!!.value)
        assertFalse(resolution.allow)
    }

    @Test fun ownerCancellationReturnsOnlyThatDocumentsRequestsAndMakesThemUnresolvable() {
        val first = Any()
        val second = Any()
        val ledger = PermissionRequestLedger<String>()
        ledger.add(4, first, documentGeneration = 1, value = "content")
        ledger.add(5, first, documentGeneration = 1, value = "media")
        ledger.add(6, second, documentGeneration = 8, value = "other tab")

        assertEquals(listOf(4, 5), ledger.cancelForOwner(first).map { it.id })
        assertNull(ledger.resolve(4, true, { true }, { 1 }))
        assertEquals(
            "other tab",
            ledger.resolve(6, true, { true }, { 8 })!!.value,
        )
    }

    @Test fun bridgeCancellationDrainsEveryPendingRequest() {
        val ledger = PermissionRequestLedger<String>()
        ledger.add(10, Any(), documentGeneration = 2, value = "one")
        ledger.add(11, Any(), documentGeneration = 7, value = "two")

        assertEquals(listOf(10, 11), ledger.cancelAll().map { it.id })
        assertTrue(ledger.cancelAll().isEmpty())
    }
}
