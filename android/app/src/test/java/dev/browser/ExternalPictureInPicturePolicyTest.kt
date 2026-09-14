package dev.browser

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

class ExternalPictureInPicturePolicyTest {
    private fun source(id: String = "video", version: Long = 1) = ExternalPipSource(id, version, Any(), Any())
    private fun claim(policy: ExternalPictureInPicturePolicy, source: ExternalPipSource = source()) =
        policy.begin(source, source.tabId, "other", setOf(source.tabId))

    @Test fun externalWindowStaysHiddenUntilTheActualConfirmedMode() {
        val window = ExternalPipWindowPresentation(1L)
        window.update(1L, confirmedActive = false, inPip = false, valid = true)
        assertFalse(window.windowVisible)
        window.update(1L, confirmedActive = false, inPip = true, valid = true)
        assertFalse(window.windowVisible)
        window.update(1L, confirmedActive = true, inPip = true, valid = true)
        assertTrue(window.windowVisible)
        assertTrue(window.viewportVisible)
    }

    @Test fun externalExpandDrawsATransparentViewportWithoutRemovingTheWindowFromSync() {
        val window = ExternalPipWindowPresentation(1L)
        window.update(1L, confirmedActive = true, inPip = true, valid = true)
        repeat(2) {
            window.update(1L, confirmedActive = true, inPip = false, valid = true)
            assertTrue("Window alpha must stay nonzero until the exit frame is drawn", window.windowVisible)
            assertFalse("Only the external viewport becomes transparent", window.viewportVisible)
        }
        window.finish()
        assertTrue(window.windowVisible)
        assertFalse(window.viewportVisible)
    }

    @Test fun lateInvalidationAndModeCallbacksCannotRevealAFinishedExit() {
        val window = ExternalPipWindowPresentation(1L)
        window.update(1L, confirmedActive = true, inPip = true, valid = true)
        window.update(1L, confirmedActive = true, inPip = false, valid = true)
        window.update(1L, confirmedActive = true, inPip = false, valid = false)
        window.finish()
        window.update(1L, confirmedActive = true, inPip = true, valid = true)
        assertTrue(window.windowVisible)
        assertFalse(window.viewportVisible)
    }

    @Test fun cancelledExpandCanShowTheSameValidPipWithoutAcceptingAnotherTicket() {
        val window = ExternalPipWindowPresentation(2L)
        window.update(2L, confirmedActive = true, inPip = true, valid = true)
        window.update(2L, confirmedActive = true, inPip = false, valid = true)
        window.update(1L, confirmedActive = true, inPip = true, valid = true)
        assertFalse(window.viewportVisible)
        window.update(2L, confirmedActive = true, inPip = true, valid = true)
        assertTrue(window.windowVisible)
        assertTrue(window.viewportVisible)
        window.update(1L, confirmedActive = true, inPip = false, valid = false)
        assertTrue(window.viewportVisible)
    }

    @Test fun rejectedEntryAndPinnedInvalidationKeepTheirExistingHiddenCleanup() {
        val rejected = ExternalPipWindowPresentation(1L)
        rejected.finish()
        rejected.update(1L, confirmedActive = true, inPip = true, valid = true)
        assertFalse(rejected.windowVisible)
        val invalid = ExternalPipWindowPresentation(2L)
        invalid.update(2L, confirmedActive = true, inPip = true, valid = true)
        invalid.finish()
        assertFalse(invalid.windowVisible)
        assertFalse(invalid.viewportVisible)
    }

    @Test fun transparentExitDoesNotConsumePausedVideoReadiness() {
        val region = VideoRegion("doc", "video", 1L,
            VideoViewport(1024.0, 780.0, 1024.0, 780.0, 0.0, 0.0, 1.0),
            VideoCssRect(20.0, 20.0, 640.0, 360.0), false, 1920, 1080)
        val video = VideoPipPresentation(region)
        video.update(region.copy(sequence = 2L), true)
        video.textureUpdated(); video.textureUpdated(); video.pinned(true)
        val window = ExternalPipWindowPresentation(1L)
        window.update(1L, confirmedActive = true, inPip = true, valid = video.valid)
        window.update(1L, confirmedActive = true, inPip = false, valid = video.valid)
        video.pinned(false)
        assertTrue(video.ready)
        assertFalse(video.awaitingPinnedFrames)
        assertTrue(window.windowVisible)
        assertFalse(window.viewportVisible)
        window.update(1L, confirmedActive = true, inPip = true, valid = video.valid)
        video.pinned(true)
        assertTrue(video.visible)
        assertTrue(window.viewportVisible)
    }

    @Test fun taskCreatingFlagsCannotMoveTheExternalHostAwayFromMainBeforePip() {
        // Physical failure used 0x10800000: NEW_TASK | EXCLUDE_FROM_RECENTS.
        assertFalse(externalPipLaunchFlagsAllowed(0x10800000))
        assertFalse(externalPipLaunchFlagsAllowed(0x08000000)) // MULTIPLE_TASK
        assertFalse(externalPipLaunchFlagsAllowed(0x00080000)) // NEW_DOCUMENT
        assertTrue(externalPipLaunchFlagsAllowed(0))
        assertTrue(externalPipLaunchFlagsAllowed(0x00800000))
    }

    @Test fun manifestKeepsTheNewActivityInItsCallersTaskUntilAndroidPinsIt() {
        val manifest = generateSequence(File(System.getProperty("user.dir"))) { it.parentFile }
            .flatMap { sequenceOf(File(it, "src/main/AndroidManifest.xml"), File(it, "android/app/src/main/AndroidManifest.xml")) }
            .first { it.isFile }
        val activities = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(manifest)
            .getElementsByTagName("activity")
        val activity = (0 until activities.length).map { activities.item(it) }.single {
            it.attributes.getNamedItem("android:name")?.nodeValue == "dev.browser.ExternalPictureInPictureActivity"
        }
        fun attribute(name: String) = activity.attributes.getNamedItem("android:$name")?.nodeValue ?: ""
        assertTrue("External must start above Main in the same task", attribute("launchMode") in setOf("", "standard"))
        assertEquals("", attribute("taskAffinity"))
        assertTrue(attribute("documentLaunchMode") in setOf("", "none"))
    }

    @Test fun ordinaryEntryWaitsForResumeAndCanOnlyBeRequestedOncePerLease() {
        val policy = ExternalPictureInPicturePolicy()
        val first = claim(policy)!!
        assertFalse(policy.requestEntry(first.ticket, resumed = false))
        assertFalse(policy.confirm(first.ticket))
        assertFalse(policy.requestEntry(first.ticket + 1, resumed = true))
        assertTrue(policy.requestEntry(first.ticket, resumed = true))
        assertEquals(ExternalPipPhase.PREPARING, policy.phase)
        assertFalse(policy.canShowActivity(first.ticket, true))
        assertFalse(policy.requestEntry(first.ticket, resumed = true))
        assertTrue(policy.confirm(first.ticket))
        assertFalse(policy.confirm(first.ticket))
        assertFalse(policy.requestEntry(first.ticket, resumed = true))
        assertTrue(policy.canShowActivity(first.ticket, true))
    }

    @Test fun rejectedOrdinaryRequestReturnsTheLeaseWithoutActivatingATabOrRetrying() {
        val policy = ExternalPictureInPicturePolicy()
        val first = claim(policy)!!
        assertTrue(policy.requestEntry(first.ticket, resumed = true))
        // Rejection and deadline share the PREPARING-only rollback boundary.
        assertEquals(first, policy.timeout(first.ticket))
        assertNull(policy.returning)
        assertFalse(policy.requestEntry(first.ticket, resumed = true))
        assertFalse(policy.confirm(first.ticket))
        val next = claim(policy)!!
        assertTrue(policy.requestEntry(next.ticket, resumed = true))
        assertNull(policy.timeout(first.ticket))
        assertTrue(policy.confirm(next.ticket))
    }

    @Test fun synchronousModeConfirmationWinsOverALateRejectedRequestResult() {
        val policy = ExternalPictureInPicturePolicy()
        val first = claim(policy)!!
        assertTrue(policy.requestEntry(first.ticket, resumed = true))
        assertTrue(policy.confirm(first.ticket))
        assertNull(policy.timeout(first.ticket))
        assertEquals(first, policy.lease)
        assertTrue(policy.canShowActivity(first.ticket, true))
    }

    @Test fun acceptedEntryOutlivesItsReservationDeadlineButStaysHiddenUntilModeCallback() {
        val policy = ExternalPictureInPicturePolicy()
        val first = claim(policy)!!
        assertTrue(policy.requestEntry(first.ticket, resumed = true))
        assertTrue(policy.acceptEntry(first.ticket))
        assertEquals(ExternalPipPhase.ENTERING, policy.phase)
        assertFalse(policy.requestEntry(first.ticket, resumed = true))
        assertNull(policy.timeout(first.ticket)) // Old 1.5s reservation timer.
        assertFalse(policy.canShowActivity(first.ticket, true))
        assertTrue(policy.confirm(first.ticket)) // Observed emulator mode callback arrived at 1.992s.
        assertNull(policy.timeout(first.ticket, ExternalPipPhase.ENTERING))
        assertTrue(policy.canShowActivity(first.ticket, true))
    }

    @Test fun acceptedEntryHasItsOwnBoundedRollbackWithoutRevivingOrCancellingAnotherLease() {
        val policy = ExternalPictureInPicturePolicy()
        val first = claim(policy)!!
        assertTrue(policy.requestEntry(first.ticket, resumed = true))
        assertTrue(policy.acceptEntry(first.ticket))
        assertFalse(policy.acceptEntry(first.ticket))
        assertEquals(first, policy.timeout(first.ticket, ExternalPipPhase.ENTERING))
        assertNull(policy.returning)
        val next = claim(policy)!!
        assertTrue(policy.requestEntry(next.ticket, resumed = true))
        assertTrue(policy.confirm(next.ticket)) // A callback may run before enter() returns.
        assertFalse(policy.acceptEntry(next.ticket))
        assertFalse(policy.confirm(first.ticket))
        assertNull(policy.timeout(first.ticket, ExternalPipPhase.ENTERING))
        assertEquals(next, policy.lease)
    }

    @Test fun expandedPausedActivityWaitsForResumeInsteadOfBeingClosed() {
        val state = ExternalPipActivityState()
        state.onResumed(); state.onPaused()
        assertEquals(ExternalPipExit.NONE, state.exit(active = true, inPip = false, finishing = false))
        state.onResumed()
        assertEquals(ExternalPipExit.RETURN, state.exit(active = true, inPip = false, finishing = false))
    }

    @Test fun stopBeforeModeFalseClosesTheLeaseWithoutReturningTheTab() {
        val state = ExternalPipActivityState()
        state.onResumed(); state.onPaused(); state.onStopped()
        assertEquals(ExternalPipExit.NONE, state.exit(active = true, inPip = true, finishing = false))
        assertEquals(ExternalPipExit.CLOSE, state.exit(active = true, inPip = false, finishing = false))
    }

    @Test fun wakingAPausedPipClearsOldStopBeforeLaterExpand() {
        val state = ExternalPipActivityState()
        state.onResumed(); state.onPaused(); state.onStopped()
        state.onStarted() // PiP starts again without becoming the resumed activity.
        assertFalse(state.stopped)
        assertEquals(ExternalPipExit.NONE, state.exit(active = true, inPip = false, finishing = false))
        state.onResumed()
        assertEquals(ExternalPipExit.RETURN, state.exit(active = true, inPip = false, finishing = false))
    }

    @Test fun modeFalseBeforeStopAlsoClosesAndUnconfirmedStopDoesNotBecomeClose() {
        val state = ExternalPipActivityState()
        state.onResumed(); state.onPaused()
        assertEquals(ExternalPipExit.NONE, state.exit(active = true, inPip = false, finishing = false))
        state.onStopped()
        assertEquals(ExternalPipExit.CLOSE, state.exit(active = true, inPip = false, finishing = false))
        assertEquals(ExternalPipExit.NONE, state.exit(active = false, inPip = false, finishing = false))
    }

    @Test fun fullscreenLaunchFailureNeverRevealsTheExternalActivityWhileEntryIsPending() {
        val policy = ExternalPictureInPicturePolicy()
        val first = claim(policy)!!
        assertFalse(policy.canShowActivity(first.ticket, false))
        assertFalse(policy.canShowActivity(first.ticket, true))
        assertTrue(policy.requestEntry(first.ticket, resumed = true))
        policy.confirm(first.ticket)
        assertTrue(policy.canShowActivity(first.ticket, true))
        assertFalse(policy.canShowActivity(first.ticket, false))
        policy.finish(first.ticket)
        val second = claim(policy)!!
        assertTrue(policy.requestEntry(second.ticket, resumed = true))
        policy.confirm(second.ticket)
        assertFalse(policy.canShowActivity(first.ticket, true))
        assertTrue(policy.canShowActivity(second.ticket, true))
    }

    @Test fun replacingOneSplitPaneNeverLeasesThePaneThatRemainsVisible() {
        assertNull(externalPipSource("A", "C", setOf("A", "B"), setOf("A", "C"), setOf("A"), "A"))
        assertEquals("A", externalPipSource("A", "C", setOf("A", "B"), setOf("C", "B"), setOf("A"), "A"))
    }
    @Test fun collapsingSplitFindsLeavingPlayingPaneEvenWhenDomainActiveIdIsUnchanged() {
        assertEquals("B", externalPipSource("A", "A", setOf("A", "B"), setOf("A"), setOf("B"), "B"))
    }
    @Test fun actualFocusedPlayingPaneWinsWhenBothPanesLeave() {
        assertEquals("B", externalPipSource("A", "C", setOf("A", "B"), setOf("C"), setOf("A", "B"), "B"))
    }
    @Test fun normalSplitFocusKeepsBothVisibleAndClosedSourceNeverLeasesItsNeighbour() {
        assertNull(externalPipSource("A", "B", setOf("A", "B"), null, setOf("A"), "A"))
        assertNull(externalPipSource(null, "C", setOf("A", "B"), setOf("C"), setOf("B"), "B"))
    }
    @Test fun leavingSplitUsesItsOnlyPlayingPaneWhenDomainActiveWasSilent() {
        assertEquals("B", externalPipSource("A", "C", setOf("A", "B"), null, setOf("B"), null))
    }
    @Test fun exitModeCallbackWaitsForResumeOrStopToDistinguishExpandFromClose() {
        assertEquals(ExternalPipExit.NONE, externalPipExit(true, false, false, false, false))
        assertEquals(ExternalPipExit.RETURN, externalPipExit(true, false, true, false, false))
        assertEquals(ExternalPipExit.CLOSE, externalPipExit(true, false, false, true, false))
        assertEquals(ExternalPipExit.CLOSE, externalPipExit(true, true, false, true, true))
    }
    @Test fun initialActivityResumeAndScreenOffDoNotExpandOrDestroyTheLease() {
        assertEquals(ExternalPipExit.NONE, externalPipExit(false, false, true, false, false))
        assertEquals(ExternalPipExit.NONE, externalPipExit(true, true, false, true, false))
        assertEquals(ExternalPipExit.RETURN, externalPipExit(true, false, true, false, false))
    }
    @Test fun movingTheSameSessionBetweenExternalAndHomeRetainsItsAudioRequest() {
        val external = source()
        val home = external.copy(view = Any())
        assertTrue(samePipAudioSession(external, home))
        assertFalse(samePipAudioSession(external, home.copy(session = Any())))
        assertFalse(samePipAudioSession(external, home.copy(sessionVersion = 2)))
        assertFalse(samePipAudioSession(external, home.copy(tabId = "other")))
        assertFalse(samePipAudioSession(null, home))
    }

    @Test fun preparingProtectsTheExactSourceBeforeReactCanDetachIt() {
        val policy = ExternalPictureInPicturePolicy()
        val source = source()
        val lease = claim(policy, source)
        assertNotNull(lease)
        assertEquals(ExternalPipPhase.PREPARING, policy.phase)
        assertTrue(policy.owns(source))
        assertFalse(policy.owns(source.copy(session = Any())))
        assertFalse(policy.owns(source.copy(view = Any())))
        assertFalse(policy.owns(source.copy(sessionVersion = 2)))
    }

    @Test fun aSecondPlayingTabCannotStealTheExistingLease() {
        val policy = ExternalPictureInPicturePolicy()
        val first = claim(policy)
        assertNotNull(first)
        assertNull(claim(policy, source("second")))
        assertEquals(first, policy.lease)
        assertTrue(policy.requestEntry(first!!.ticket, resumed = true))
        assertTrue(policy.confirm(first.ticket))
        assertNull(claim(policy, source("third")))
    }

    @Test fun simpleFocusBetweenVisibleSplitPanesAndNoopSelectionDoNotStartPip() {
        val policy = ExternalPictureInPicturePolicy()
        val source = source()
        assertNull(policy.begin(source, "video", "other", setOf("video", "other")))
        assertNull(policy.begin(source, "video", "video", setOf("video")))
        assertNull(policy.begin(source, null, "other", setOf("video")))
        assertNotNull(claim(policy, source))
    }

    @Test fun unsupportedDeniedBlockedDisabledPausedAndHomePipLeaveTheSourceUnclaimed() {
        val policy = ExternalPictureInPicturePolicy()
        val source = source()
        assertNull(policy.begin(source, "video", "other", emptySet(), available = false))
        assertNull(policy.begin(source, "video", "other", emptySet(), blocked = true))
        assertNull(policy.begin(source, "video", "other", emptySet(), enabled = false))
        assertNull(policy.begin(source, "video", "other", emptySet(), playing = false))
        assertNull(policy.begin(source, "video", "other", emptySet(), homeBusy = true))
        assertNotNull(claim(policy, source))
    }

    @Test fun sourceSelectionReturnsSynchronouslyAndLateEntryCannotResurrectIt() {
        val policy = ExternalPictureInPicturePolicy()
        val lease = claim(policy)
        assertNotNull(lease)
        assertEquals(lease, policy.finish(lease!!.ticket))
        assertNull(policy.lease)
        assertEquals(ExternalPipPhase.IDLE, policy.phase)
        assertFalse(policy.confirm(lease.ticket))
        assertNull(policy.returning)
    }

    @Test fun expandPublishesOneReturnTokenAndOnlyItsAcknowledgementClearsIt() {
        val policy = ExternalPictureInPicturePolicy()
        val lease = claim(policy)
        assertNotNull(lease)
        assertTrue(policy.requestEntry(lease!!.ticket, resumed = true))
        policy.confirm(lease.ticket)
        policy.finish(lease.ticket, requestReturn = true)
        val returned = policy.returning
        assertEquals("video", returned?.tabId)
        assertNull(policy.finish(lease.ticket, requestReturn = true))
        policy.acknowledge(returned!!.token - 1)
        assertEquals(returned, policy.returning)
        assertNull(claim(policy))
        policy.acknowledge(returned.token)
        assertNull(policy.returning)
        assertNotNull(claim(policy))
    }

    @Test fun oldTimeoutCannotCancelActiveOrReplacementLease() {
        val policy = ExternalPictureInPicturePolicy()
        val first = claim(policy)
        assertNotNull(first)
        assertEquals(first, policy.timeout(first!!.ticket))
        val second = claim(policy)
        assertNotNull(second)
        assertTrue(second!!.ticket > first.ticket)
        assertNull(policy.timeout(first.ticket))
        assertTrue(policy.requestEntry(second.ticket, resumed = true))
        assertTrue(policy.confirm(second.ticket))
        assertNull(policy.timeout(second.ticket))
        assertEquals(second, policy.lease)
    }

    @Test fun closeOrRetirementHasNoTabActivationAndStaleCloseCannotTouchNewSession() {
        val policy = ExternalPictureInPicturePolicy()
        val first = claim(policy)
        assertNotNull(first)
        assertTrue(policy.requestEntry(first!!.ticket, resumed = true))
        policy.confirm(first.ticket)
        assertEquals(first, policy.finish(first.ticket))
        assertNull(policy.returning)
        val second = claim(policy, source(version = 2))
        assertNotNull(second)
        assertNull(policy.finish(first.ticket))
        assertEquals(second, policy.lease)
    }
}
