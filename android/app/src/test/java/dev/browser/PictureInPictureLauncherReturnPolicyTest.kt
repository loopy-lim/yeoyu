package dev.browser

import org.junit.Assert.*
import org.junit.Test

class PictureInPictureLauncherReturnPolicyTest {
    private fun request(policy: PictureInPictureLauncherReturnPolicy, entryTicket: Long): PictureInPictureLauncherReturnRequest {
        val request = policy.request(entryTicket, preparing = true)
        assertNotNull("A launcher reopen during entry must be remembered", request)
        return request!!
    }

    @Test fun aLauncherReturnDuringEntrySurvivesResumeUntilTheLateActiveCallback() {
        val policy = PictureInPictureLauncherReturnPolicy()
        val request = policy.request(41, preparing = true)
        assertNotNull(request)
        // Home -> launcher -> onResume(false) -> transfer restore -> late mode(true).
        assertFalse(policy.foregroundResumed())
        assertTrue(policy.pending)
        assertEquals(request, policy.claimOnActive())
        assertNull(policy.claimOnActive())
        assertTrue(policy.pending)
    }

    @Test fun stablePipAndOrdinaryForegroundLaunchesDoNotScheduleAnotherLaunch() {
        val policy = PictureInPictureLauncherReturnPolicy()
        assertNull(policy.request(41, preparing = false))
        assertNull(policy.request(null, preparing = true))
        assertFalse(policy.pending)
        assertNull(policy.claimOnActive())
    }

    @Test fun repeatedLauncherDeliveryCannotRepeatTheSameReturn() {
        val policy = PictureInPictureLauncherReturnPolicy()
        val request = policy.request(41, preparing = true)
        assertNotNull(request)
        assertEquals(request, policy.request(41, preparing = true))
        assertEquals(request, policy.claimOnActive())
        // Re-preparing the same OS entry after a local restore can have a new transfer ticket.
        assertEquals(request, policy.request(43, preparing = true))
        assertNull(policy.claimOnActive())
    }

    @Test fun foregroundResumeClearsOnlyAReturnWhoseActiveBoundaryWasSeen() {
        val policy = PictureInPictureLauncherReturnPolicy()
        val request = request(policy, 41)
        assertFalse(policy.foregroundResumed())
        assertTrue(policy.owns(request))
        policy.claimOnActive()
        assertTrue(policy.foregroundResumed())
        assertFalse(policy.pending)
        assertFalse(policy.owns(request))
        assertNull(policy.claimOnActive())
    }

    @Test fun modeExitOrNewHomeOrExternalLaunchOrDestroyCancelsQueuedWork() {
        val policy = PictureInPictureLauncherReturnPolicy()
        for (claimBeforeCancel in listOf(false, true)) {
            val request = request(policy, 41)
            if (claimBeforeCancel) policy.claimOnActive()
            assertTrue(policy.cancel())
            assertFalse(policy.owns(request))
            assertFalse(policy.pending)
            assertNull(policy.claimOnActive())
        }
    }

    @Test fun anOldDeadlineOrLaunchFailureCannotCancelANewerHomeAttempt() {
        val policy = PictureInPictureLauncherReturnPolicy()
        val old = request(policy, 41)
        policy.claimOnActive()
        policy.cancel()
        val next = request(policy, 44)
        assertFalse(policy.cancel(old))
        assertFalse(policy.owns(old))
        assertTrue(policy.owns(next))
        assertEquals(next, policy.claimOnActive())
    }

    @Test fun timeoutReleasesAutoEntrySuppressionWhenTheOsCancelsItsEntry() {
        val policy = PictureInPictureLauncherReturnPolicy()
        val request = request(policy, 41)
        assertFalse(policy.foregroundResumed())
        assertTrue(policy.cancel(request))
        assertFalse(policy.pending)
        assertNull(policy.claimOnActive())
    }

    @Test fun aFailedReturnIsNotRetriedByDuplicateActiveCallbacks() {
        val policy = PictureInPictureLauncherReturnPolicy()
        val request = request(policy, 41)
        assertEquals(request, policy.claimOnActive())
        assertTrue(policy.cancel(request))
        assertNull(policy.claimOnActive())
        assertFalse(policy.pending)
    }
}
