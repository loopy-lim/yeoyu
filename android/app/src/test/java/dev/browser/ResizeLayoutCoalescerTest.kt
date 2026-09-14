package dev.browser

import org.junit.Assert.*
import org.junit.Test

class ResizeLayoutCoalescerTest {
    @Test fun severalCoveredMeasurementsApplyOnlyTheLastActualBounds() {
        val applied = mutableListOf<Pair<Int, Int>>()
        val layout = ResizeLayoutCoalescer { w, h -> applied.add(w to h) }
        layout.request(900, 600, 0, true)
        layout.request(850, 600, 16, true)
        val final = layout.request(800, 600, 32, true)
        assertEquals(emptyList<Pair<Int, Int>>(), applied)
        layout.settle(final!!, 79)
        assertTrue(applied.isEmpty())
        layout.settle(final, 80)
        assertEquals(listOf(800 to 600), applied)
        assertFalse(layout.hasPending)
    }

    @Test fun reversingBothAxesDoesNotReplayAnIntermediateLayoutOrAnOldTask() {
        val applied = mutableListOf<Pair<Int, Int>>()
        val layout = ResizeLayoutCoalescer { w, h -> applied.add(w to h) }
        val old = layout.request(650, 800, 0, true)
        layout.request(700, 750, 16, true)
        val latest = layout.request(800, 650, 32, true)
        assertTrue(applied.isEmpty())
        layout.settle(old!!, 100)
        assertTrue(applied.isEmpty())
        layout.settle(latest!!, 100)
        assertEquals(listOf(800 to 650), applied)
        layout.settle(latest, 120)
        assertEquals(1, applied.size)
    }

    @Test fun failedCaptureKeepsImmediateLayoutAndCancelsAnyPendingSize() {
        val applied = mutableListOf<Pair<Int, Int>>()
        val layout = ResizeLayoutCoalescer { w, h -> applied.add(w to h) }
        val old = layout.request(900, 600, 0, true)
        assertTrue(applied.isEmpty())
        assertNull(layout.request(800, 600, 16, false))
        layout.settle(old!!, 100)
        assertEquals(listOf(800 to 600), applied)
        assertFalse(layout.hasPending)
    }

    @Test fun hardDeadlineFlushesLatestBoundsEvenDuringContinuousResizing() {
        val applied = mutableListOf<Pair<Int, Int>>()
        val layout = ResizeLayoutCoalescer { w, h -> applied.add(w to h) }
        for (time in 0L..496L step 16) layout.request(1000 - time.toInt(), 600, time, true)
        assertTrue(applied.isEmpty())
        layout.flush()
        assertEquals(listOf(504 to 600), applied)
        assertFalse(layout.hasPending)
    }

    @Test fun pipFlushPublishesFinalGeometryBeforeTheCallerReadsIt() {
        var bounds = 1000 to 700
        val layout = ResizeLayoutCoalescer { w, h -> bounds = w to h }
        val old = layout.request(800, 600, 0, true)
        assertEquals(1000 to 700, bounds)
        layout.flush()
        assertEquals(800 to 600, bounds)
        layout.settle(old!!, 100)
        assertEquals(800 to 600, bounds)
    }

    @Test fun clearDuringHostSizeChangeFlushesCurrentBoundsBeforeItsOnLayoutArrives() {
        val applied = mutableListOf<Pair<Int, Int>>()
        val layout = ResizeLayoutCoalescer { w, h -> applied.add(w to h) }
        val old = layout.request(800, 600, 0, true)
        assertTrue(applied.isEmpty())
        layout.flush(700, 500)
        assertEquals(listOf(700 to 500), applied)
        layout.settle(old!!, 100)
        assertEquals(1, applied.size)
    }

    @Test fun detachedOrReplacedOwnerDiscardsPendingWorkAndOldTaskCannotFlushNewOwner() {
        val applied = mutableListOf<Pair<Int, Int>>()
        val layout = ResizeLayoutCoalescer { w, h -> applied.add(w to h) }
        val old = layout.request(800, 600, 0, true)
        layout.discard()
        val fresh = layout.request(400, 300, 100, true)
        assertTrue(applied.isEmpty())
        layout.settle(old!!, 200)
        assertTrue(applied.isEmpty())
        layout.settle(fresh!!, 200)
        assertEquals(listOf(400 to 300), applied)
    }

    @Test fun flushInvalidatesOldWorkBeforeReentrantLayoutSchedulesTheNextSize() {
        val applied = mutableListOf<Pair<Int, Int>>()
        lateinit var layout: ResizeLayoutCoalescer
        var nested: Long? = null
        layout = ResizeLayoutCoalescer { w, h ->
            assertTrue(layout.isApplying)
            assertFalse(layout.hasPending)
            applied.add(w to h)
            if (w == 800) nested = layout.request(700, 500, 100, true)
        }
        val old = layout.request(800, 600, 0, true)
        assertTrue(applied.isEmpty())
        layout.flush()
        assertFalse(layout.isApplying)
        layout.settle(old!!, 200)
        assertEquals(listOf(800 to 600), applied)
        assertTrue(layout.hasPending)
        layout.settle(nested!!, 200)
        assertEquals(listOf(800 to 600, 700 to 500), applied)
    }

    @Test fun hiddenZeroSizedLayoutCannotRemainDeferredBehindTheCover() {
        val applied = mutableListOf<Pair<Int, Int>>()
        val layout = ResizeLayoutCoalescer { w, h -> applied.add(w to h) }
        layout.request(800, 600, 0, true)
        assertTrue(applied.isEmpty())
        assertNull(layout.request(0, 0, 16, true))
        assertEquals(listOf(0 to 0), applied)
        assertFalse(layout.hasPending)
    }
}
