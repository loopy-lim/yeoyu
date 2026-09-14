package dev.browser

import org.junit.Assert.*
import org.junit.Test

class VideoRegionWatchPolicyTest {
    @Test fun preparingWithoutAnAckHasNoCompetingInitialDeadline() {
        val watch = VideoRegionWatchPolicy(100L)
        assertNull(watch.deadlineAt)
        assertFalse(watch.canExpire(watch.timerGeneration, 1_600L))
        watch.setPinned(true, 1_600L)
        assertNull(watch.deadlineAt) // Viewport owns the initial ACK plus texture budget.
        assertFalse(watch.canExpire(watch.timerGeneration, 2_700L))
    }

    @Test fun earlyAckSurvivesSlowEntryAndStartsHeartbeatBudgetAtPin() {
        val watch = VideoRegionWatchPolicy(100L)
        watch.accepted(150L)
        assertTrue(watch.acknowledged)
        assertNull(watch.deadlineAt)
        assertFalse(watch.canExpire(watch.timerGeneration, 1_600L))
        watch.setPinned(true, 1_600L)
        assertEquals(2_600L, watch.deadlineAt)
        assertFalse(watch.canExpire(watch.timerGeneration, 2_599L))
        assertTrue(watch.canExpire(watch.timerGeneration, 2_600L))
    }

    @Test fun firstPinnedAckStartsExpiryAndFreshHeartbeatsInvalidateOldTimers() {
        val watch = VideoRegionWatchPolicy(0L)
        watch.setPinned(true, 100L)
        assertNull(watch.deadlineAt)
        watch.accepted(200L)
        val oldTimer = watch.timerGeneration
        assertEquals(1_200L, watch.deadlineAt)
        watch.accepted(450L)
        assertFalse(watch.canExpire(oldTimer, 1_500L))
        assertFalse(watch.canExpire(watch.timerGeneration, 1_449L))
        assertTrue(watch.canExpire(watch.timerGeneration, 1_450L))
    }

    @Test fun unpinAndRepinCannotReviveAQueuedEarlierDeadline() {
        val watch = VideoRegionWatchPolicy(0L)
        watch.accepted(50L); watch.setPinned(true, 100L)
        val beforeReturn = watch.timerGeneration
        watch.setPinned(false, 200L)
        assertNull(watch.deadlineAt)
        assertFalse(watch.canExpire(beforeReturn, 1_500L))
        watch.accepted(250L) // Paused or playing geometry is equally valid evidence.
        assertNull(watch.deadlineAt)
        watch.setPinned(true, 1_600L)
        assertEquals(2_600L, watch.deadlineAt)
        assertFalse(watch.canExpire(beforeReturn, 3_000L))
    }

    @Test fun cancellationIsImmediateInEveryPhaseAndCannotBeRearmed() {
        for (pin in listOf(false, true)) {
            val watch = VideoRegionWatchPolicy(0L)
            watch.accepted(10L); watch.setPinned(pin, 20L)
            val oldTimer = watch.timerGeneration
            watch.cancel()
            assertNull(watch.deadlineAt)
            assertFalse(watch.canExpire(oldTimer, 2_000L))
            watch.setPinned(true, 2_000L); watch.accepted(2_010L)
            assertNull(watch.deadlineAt)
        }
    }

    @Test fun duplicatePinCallbacksDoNotExtendAStalledHeartbeat() {
        val watch = VideoRegionWatchPolicy(0L)
        watch.accepted(10L); watch.setPinned(true, 20L)
        val timer = watch.timerGeneration
        watch.setPinned(true, 900L)
        assertEquals(timer, watch.timerGeneration)
        assertEquals(1_020L, watch.deadlineAt)
        assertTrue(watch.canExpire(timer, 1_020L))
    }
}
