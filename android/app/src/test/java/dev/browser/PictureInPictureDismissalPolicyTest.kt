package dev.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class PictureInPictureDismissalPolicyTest {
    @Test fun videoEndingDismissesOnlyTheBackgroundPictureInPictureOnce() {
        val policy = PictureInPictureDismissalPolicy()
        policy.beginEntry()
        val request = policy.request()
        assertNotNull(request)
        assertNull(policy.request())
        assertEquals(PictureInPictureDismissalAction.BACKGROUND, policy.claim(request!!, inPip = true))
        assertEquals(PictureInPictureDismissalAction.NONE, policy.claim(request, inPip = true))
        // A rejected OS move does not turn into a retry loop or foreground launch.
        assertNull(policy.request())
    }

    @Test fun launcherRequestedAfterInvalidationCancelsTheQueuedBackgroundMove() {
        val policy = PictureInPictureDismissalPolicy()
        policy.beginEntry()
        val request = policy.request()!!
        policy.requestForeground()
        assertEquals(PictureInPictureDismissalAction.NONE, policy.claim(request, inPip = true))
        assertNull(policy.request())
    }

    @Test fun lateEntryCallbacksCannotEraseAnEarlierLauncherRequest() {
        val policy = PictureInPictureDismissalPolicy()
        policy.beginEntry() // pause(pip=true), before the Android entry callback
        policy.requestForeground()
        policy.beginEntry() // transitioning/mode(true) for the same entry
        assertNull(policy.request())
    }

    @Test fun launcherSurvivesIntermediateRestoreBeforeLateEntryConfirmation() {
        val policy = PictureInPictureDismissalPolicy()
        val launcher = PictureInPictureLauncherReturnPolicy()
        policy.beginEntry()
        val request = launcher.request(entryTicket = 7L, preparing = true)
        assertNotNull(request)
        policy.requestForeground()
        // An intermediate normal resume restores the view before Android confirms entry.
        launcher.foregroundResumed()
        policy.cancel()
        policy.beginEntry(foregroundRequested = launcher.pending)
        assertNull(policy.request())
        assertEquals(request, launcher.claimOnActive())
        assertNull(launcher.claimOnActive())
    }

    @Test fun expandThatAlreadyLeftPictureInPictureOnlyRestoresTheView() {
        val policy = PictureInPictureDismissalPolicy()
        policy.beginEntry()
        val request = policy.request()!!
        assertEquals(PictureInPictureDismissalAction.RESTORE, policy.claim(request, inPip = false))
    }

    @Test fun restoredOrDestroyedEntryRejectsOldWorkWithoutConsumingTheNextEntry() {
        val policy = PictureInPictureDismissalPolicy()
        policy.beginEntry()
        val first = policy.request()!!
        policy.cancel()
        assertEquals(PictureInPictureDismissalAction.NONE, policy.claim(first, inPip = true))
        policy.beginEntry()
        val second = policy.request()!!
        assertEquals(PictureInPictureDismissalAction.NONE, policy.claim(first, inPip = true))
        assertEquals(PictureInPictureDismissalAction.BACKGROUND, policy.claim(second, inPip = true))
    }

    @Test fun aNewUserHomeEntryCanDismissAfterThePreviousForegroundReturn() {
        val policy = PictureInPictureDismissalPolicy()
        policy.beginEntry()
        policy.requestForeground()
        policy.cancel()
        policy.beginEntry()
        assertEquals(PictureInPictureDismissalAction.BACKGROUND, policy.claim(policy.request()!!, inPip = true))
    }

    @Test fun noEntryCannotScheduleAWindowMove() {
        assertNull(PictureInPictureDismissalPolicy().request())
    }
}
