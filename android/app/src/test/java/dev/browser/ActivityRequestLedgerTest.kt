package dev.browser

import org.junit.Assert.*
import org.junit.Test

class ActivityRequestLedgerTest {
    @Test fun dispatchAllocatesDistinctCodesAndLateResultsCannotSettleAgain() {
        val ledger = ActivityRequestLedger<Any, String>()
        val owner = Any()
        val first = ledger.add(owner, "first")
        val second = ledger.add(owner, "second")
        assertNotEquals(first, second)
        assertEquals("second", ledger.take(second))
        assertNull(ledger.take(second))
        assertEquals("first", ledger.take(first))
    }

    @Test fun activityDestructionCancelsOnlyItsOwnRequests() {
        val ledger = ActivityRequestLedger<Any, String>()
        val firstOwner = Any(); val secondOwner = Any()
        val retired = ledger.add(firstOwner, "retired")
        val live = ledger.add(secondOwner, "live")
        assertEquals(listOf("retired"), ledger.cancelFor(firstOwner))
        assertNull(ledger.take(retired)); assertEquals("live", ledger.take(live))
    }
}
