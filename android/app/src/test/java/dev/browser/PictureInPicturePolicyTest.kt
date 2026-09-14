package dev.browser

import org.junit.Assert.*
import org.junit.Test

class PictureInPicturePolicyTest {
    private val available = PictureInPictureAvailability(true, true, true, true)
    private val tab = PictureInPictureTarget("tab", 7)

    @Test fun automaticEntryRequiresOptInAndAVisibleAllowedTarget() {
        val policy = PictureInPicturePolicy()
        policy.configure(false, "tab", false)
        assertFalse(policy.canAutoEnter(available))
        policy.configure(true, "tab", false)
        assertTrue(policy.canAutoEnter(available))
        assertFalse(policy.canAutoEnter(available.copy(supported = false)))
        assertFalse(policy.canAutoEnter(available.copy(allowed = false)))
        assertFalse(policy.canAutoEnter(available.copy(resumed = false)))
        assertFalse(policy.canAutoEnter(available.copy(hasSurface = false)))
        policy.configure(true, null, false)
        assertFalse(policy.canAutoEnter(available))
    }

    @Test fun explicitEntryIgnoresChromeModalButNeverExternalActivityOrPermissionDenial() {
        val policy = PictureInPicturePolicy()
        policy.configure(true, "tab", true)
        assertEquals("chrome-blocked", policy.reason(available))
        assertNull(policy.reason(available, explicit = true))
        policy.suspendForExternalActivity()
        assertEquals("external-activity", policy.reason(available, explicit = true))
        policy.resume()
        assertEquals("permission-denied", policy.reason(available.copy(allowed = false), explicit = true))
    }

    @Test fun failedEntryRetiresItsTicketAndLateCompletionCannotOwnANewerTransfer() {
        val policy = PictureInPicturePolicy()
        policy.configure(true, "tab", false)
        val failed = policy.begin(tab, available)!!
        assertEquals(PictureInPicturePhase.PREPARING, policy.phase)
        assertTrue(policy.cancel(failed))
        val next = policy.begin(tab.copy(sessionVersion = 8), available)!!
        assertFalse(policy.confirm(failed))
        assertFalse(policy.cancel(failed))
        assertEquals(8L, policy.target?.sessionVersion)
        assertTrue(policy.confirm(next))
        assertEquals(PictureInPicturePhase.ACTIVE, policy.phase)
    }

    @Test fun activeTargetStaysFixedWhileJsSelectionChangesAndDuplicateEntryIsRejected() {
        val policy = PictureInPicturePolicy()
        policy.configure(true, "tab", false)
        val ticket = policy.begin(tab, available)!!
        assertTrue(policy.confirm(ticket))
        policy.configure(true, "next", false)
        assertEquals(tab, policy.target)
        assertNull(policy.begin(PictureInPictureTarget("next", 9), available))
        assertEquals(tab, policy.finish())
        assertNull(policy.finish())
        assertEquals(PictureInPicturePhase.IDLE, policy.phase)
        assertFalse(policy.confirm(ticket))
    }

    @Test fun oldConfiguredSurfaceCannotBecomeTheNextPipTarget() {
        val policy = PictureInPicturePolicy()
        policy.configure(true, "next", false)
        assertNull(policy.begin(tab, available))
        assertEquals(PictureInPicturePhase.IDLE, policy.phase)
    }

    @Test fun externalLaunchSuppressionSurvivesConfigurationUpdatesUntilResume() {
        val policy = PictureInPicturePolicy()
        policy.configure(true, "tab", false)
        policy.suspendForExternalActivity()
        policy.configure(true, "tab", false)
        assertFalse(policy.canAutoEnter(available))
        policy.resume()
        assertTrue(policy.canAutoEnter(available))
    }

    @Test fun explicitEntryCannotBypassAnEnginePermissionOrFilePrompt() {
        val policy = PictureInPicturePolicy()
        policy.configure(true, "tab", false)
        val prompt = available.copy(nativeBlocked = true)
        assertEquals("native-prompt", policy.reason(prompt, explicit = true))
        assertFalse(policy.canAutoEnter(prompt))
        assertNull(policy.begin(tab, prompt, explicit = true))
    }

    @Test fun aspectRatioRejectsUnlaidOutViewsAndClampsExtremeBrowserWindows() {
        assertNull(pictureInPictureAspectRatio(0, 100))
        assertNull(pictureInPictureAspectRatio(100, -1))
        assertEquals(239 to 100, pictureInPictureAspectRatio(4000, 100))
        assertEquals(100 to 239, pictureInPictureAspectRatio(100, 4000))
        assertEquals(1920 to 1080, pictureInPictureAspectRatio(1920, 1080))
    }

    @Test fun returningTheViewPreservesARecoverySessionEvenBeforeRegistryAdmissionCompletes() {
        val view = Any()
        val captured = Any()
        val replacement = Any()
        val result = pictureInPictureRestoration(true, view, view, captured, replacement, null)
        assertTrue(result.returnView)
        assertFalse(result.releaseCapturedSession)
    }

    @Test fun returningAReboundHostReleasesOnlyTheObsoleteCapturedSession() {
        val view = Any()
        val captured = Any()
        val result = pictureInPictureRestoration(true, view, view, captured, captured, Any())
        assertTrue(result.returnView)
        assertTrue(result.releaseCapturedSession)
        assertFalse(pictureInPictureRestoration(true, view, view, captured, captured, captured).releaseCapturedSession)
    }

    @Test fun detachedOrReplacedHostCannotTakeTheTransferredViewBack() {
        val view = Any()
        val session = Any()
        assertFalse(pictureInPictureRestoration(false, view, view, session, session, session).returnView)
        assertFalse(pictureInPictureRestoration(true, Any(), view, session, session, session).returnView)
    }

    @Test fun lateAudioFocusLossCannotOwnANewerRequestForTheSameSession() {
        val policy = PictureInPictureAudioFocusPolicy()
        val session = Any()
        val first = policy.begin(tab, session)
        assertTrue(policy.owns(first, tab, session))
        policy.clear()
        val next = policy.begin(tab, session)
        assertFalse(policy.owns(first, tab, session))
        assertTrue(policy.owns(next, tab, session))
    }

    @Test fun retiredOrReplacedSessionRejectsItsPendingAudioFocusCallback() {
        val policy = PictureInPictureAudioFocusPolicy()
        val session = Any()
        val token = policy.begin(tab, session)
        assertFalse(policy.owns(token, null, null))
        assertFalse(policy.owns(token, tab.copy(sessionVersion = 8), session))
        assertFalse(policy.owns(token, tab, Any()))
        policy.clear()
        assertFalse(policy.owns(token, tab, session))
    }

    @Test fun systemAudioFocusCanReturnAfterTheDisplayTransferEnds() {
        val display = PictureInPicturePolicy()
        display.configure(true, tab.tabId, false)
        display.confirm(display.begin(tab, available)!!)
        val audio = PictureInPictureAudioFocusPolicy()
        val session = Any()
        val token = audio.begin(tab, session)
        display.finish()
        assertEquals(PictureInPicturePhase.IDLE, display.phase)
        assertTrue(audio.owns(token, tab, session))
        audio.clear()
        assertFalse(audio.owns(token, tab, session))
    }

    @Test fun restoredWindowRejectsTheOldPipLayoutAndPendingLayoutPass() {
        val normal = PictureInPictureWindowSize(1200, 800)
        val pip = PictureInPictureWindowSize(400, 270)
        assertFalse(pictureInPictureWindowRestored(pip, normal, pip, false))
        assertFalse(pictureInPictureWindowRestored(normal, normal, pip, true))
        assertTrue(pictureInPictureWindowRestored(normal, normal, pip, false))
    }

    @Test fun cancelledEntryCanRestoreWithoutEverReceivingASmallPipLayout() {
        val normal = PictureInPictureWindowSize(1200, 800)
        assertTrue(pictureInPictureWindowRestored(normal, normal, null, false))
        assertFalse(pictureInPictureWindowRestored(PictureInPictureWindowSize(0, 0), normal, null, false))
    }

    @Test fun returningToARotatedOrResizedWindowDoesNotRequireTheOldWindowSize() {
        val normal = PictureInPictureWindowSize(1200, 800)
        val pip = PictureInPictureWindowSize(400, 270)
        assertTrue(pictureInPictureWindowRestored(PictureInPictureWindowSize(800, 1200), normal, pip, false))
        assertTrue(pictureInPictureWindowRestored(PictureInPictureWindowSize(750, 800), normal, pip, false))
    }

    @Test fun pausedAudioNeverReacquiresFocusMerelyBecauseTheBrowserResumes() {
        val intent = PictureInPicturePlaybackIntent()
        assertTrue(intent.canAcquire(playing = true))
        intent.requestPause(playing = true)
        assertFalse(intent.canAcquire(playing = true)) // Gecko pause acknowledgement may be late.
        intent.observe(playing = true)
        assertFalse(intent.canAcquire(playing = true))
        intent.observe(playing = false)
        assertFalse(intent.canAcquire(playing = false))
    }

    @Test fun aNewPlaybackAfterPauseCanReacquireFocus() {
        val intent = PictureInPicturePlaybackIntent()
        intent.requestPause(playing = true)
        intent.observe(playing = false)
        intent.observe(playing = true)
        assertTrue(intent.canAcquire(playing = true))
        intent.requestPause(playing = false)
        assertFalse(intent.canAcquire(playing = false))
        intent.requestPlay()
        assertTrue(intent.canAcquire(playing = false, explicitPlay = true))
    }

    @Test fun viewportFitShowsTheWholeOriginalTabWithCenteredLetterboxing() {
        val fit = pictureInPictureViewportFit(1920, 1080, 480, 360)!!
        assertEquals(0.25, fit.scale, 0.000001)
        assertEquals(0.0, fit.offsetX, 0.000001)
        assertEquals(45.0, fit.offsetY, 0.000001)
        assertEquals(480.0, fit.offsetX + 1920 * fit.scale, 0.000001)
        assertEquals(315.0, fit.offsetY + 1080 * fit.scale, 0.000001)
    }

    @Test fun portraitViewportKeepsItsFullHeightInsideAWidePipWindow() {
        val fit = pictureInPictureViewportFit(900, 1600, 480, 270)!!
        assertEquals(0.16875, fit.scale, 0.000001)
        assertEquals(164.0625, fit.offsetX, 0.000001)
        assertEquals(0.0, fit.offsetY, 0.000001)
        assertEquals(270.0, 1600 * fit.scale, 0.000001)
    }

    @Test fun viewportFitRejectsUnlaidOutSizesAndHandlesExtremeDimensions() {
        assertNull(pictureInPictureViewportFit(0, 1080, 480, 270))
        assertNull(pictureInPictureViewportFit(1920, 1080, 480, 0))
        assertNull(pictureInPictureViewportFit(1920, -1, 480, 270))
        val fit = pictureInPictureViewportFit(Int.MAX_VALUE, 1, 1, 1)!!
        assertTrue(fit.scale.isFinite() && fit.scale > 0)
        assertEquals(1.0, Int.MAX_VALUE * fit.scale, 0.000001)
        assertTrue(fit.offsetY >= 0 && fit.offsetY < 0.5)
    }
}
