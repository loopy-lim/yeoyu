package dev.browser

import org.junit.Assert.*
import org.junit.Test

class ResizeCoverGestureGateTest {
    @Test fun aGestureStartedOnTheSnapshotStaysBlockedAfterItDisappears() {
        val gate = ResizeCoverGestureGate()
        val page = Any()
        assertTrue(gate.consume(true, false, true, page))
        assertTrue(gate.consume(false, false, false, page))
        assertTrue(gate.consume(false, true, false, page))
        assertFalse(gate.consume(true, false, false, page))
    }

    @Test fun aDragStartedBeforeTheSnapshotKeepsItsEntireGesture() {
        val gate = ResizeCoverGestureGate()
        val page = Any()
        assertFalse(gate.consume(true, false, false, page))
        assertFalse(gate.consume(false, false, true, page))
        assertFalse(gate.consume(false, false, true, page)) // Another pointer joins.
        assertFalse(gate.consume(false, true, true, page))
        assertTrue(gate.consume(true, false, true, page))
    }

    @Test fun cancellationConsumesTheBlockedGestureAndLetsTheNextOneStart() {
        val gate = ResizeCoverGestureGate()
        val page = Any()
        assertTrue(gate.consume(true, false, true, page))
        assertTrue(gate.consume(false, true, false, page)) // ACTION_CANCEL
        assertFalse(gate.consume(true, false, false, page))
        assertFalse(gate.consume(false, true, false, page))
    }

    @Test fun aReplacementSessionNeverReceivesThePreviousSessionsGestureTail() {
        val gate = ResizeCoverGestureGate()
        val oldPage = Any()
        val newPage = Any()
        assertFalse(gate.consume(true, false, false, oldPage))
        assertTrue(gate.consume(false, false, false, newPage))
        assertTrue(gate.consume(false, true, false, newPage))
        assertFalse(gate.consume(true, false, false, newPage))
    }

    @Test fun releaseOrDetachDropsTheTargetAndConsumesAnyRemainingTail() {
        for (covered in listOf(false, true)) {
            val gate = ResizeCoverGestureGate()
            val page = Any()
            gate.consume(true, false, covered, page)
            gate.invalidate()
            assertTrue(gate.consume(false, false, false, null))
            assertTrue(gate.consume(false, true, false, null))
            assertFalse(gate.consume(true, false, false, page))
        }
    }

    @Test fun aFreshDownRecoversWhenThePreviousEndWasNotDelivered() {
        val gate = ResizeCoverGestureGate()
        val page = Any()
        assertTrue(gate.consume(true, false, true, page))
        gate.invalidate()
        assertFalse(gate.consume(true, false, false, page))
        assertFalse(gate.consume(false, true, false, page))
    }
}
