package dev.browser

import org.junit.Assert.*
import org.junit.Test

class VideoPipPresentationTest {
    private val region = VideoRegion("doc", "video", 1, VideoViewport(100.0, 100.0, 100.0, 100.0, 0.0, 0.0, 1.0),
        VideoCssRect(0.0, 0.0, 100.0, 100.0), true, 100, 100)

    @Test fun slowOsEntryCannotConsumeTheFirstFrameDeadlineBeforePinning() {
        val lease = VideoPipPresentation(region)
        assertFalse(lease.awaitingPinnedFrames)
        lease.update(region.copy(sequence = 2), true)
        assertFalse(lease.awaitingPinnedFrames)
        lease.textureUpdated()
        assertFalse(lease.awaitingPinnedFrames)
        assertFalse(lease.visible)
        lease.pinned(true)
        assertTrue(lease.awaitingPinnedFrames)
        assertFalse(lease.visible)
        lease.textureUpdated()
        assertFalse(lease.awaitingPinnedFrames)
        assertTrue(lease.visible)
    }

    @Test fun unpinningCancelsMissingFramesAndPreventsALateDeadlineFromInvalidatingReturn() {
        val lease = VideoPipPresentation(region)
        lease.pinned(true)
        assertTrue(lease.awaitingPinnedFrames)
        lease.pinned(false)
        assertFalse(lease.awaitingPinnedFrames)
        lease.update(region.copy(sequence = 2, playing = false), true)
        lease.textureInvalidated()
        assertFalse(lease.awaitingPinnedFrames)
        assertTrue(lease.valid)
        lease.pinned(true)
        assertTrue(lease.awaitingPinnedFrames)
        lease.invalidate()
        assertFalse(lease.awaitingPinnedFrames)
    }

    @Test fun pausedFramesPreparedBeforePinningAreRetainedWithoutAnotherFrameDeadline() {
        val lease = VideoPipPresentation(region)
        lease.update(region.copy(sequence = 2, playing = false), true)
        lease.textureUpdated(); lease.textureUpdated()
        assertTrue(lease.ready)
        assertFalse(lease.awaitingPinnedFrames)
        assertFalse(lease.visible)
        lease.pinned(true)
        assertTrue(lease.visible)
        assertFalse(lease.awaitingPinnedFrames)
        lease.pinned(false)
        assertFalse(lease.visible)
        assertTrue(lease.ready)
        assertFalse(lease.awaitingPinnedFrames)
    }

    @Test fun firstPinnedFrameWaitsForLiveWatchAndThenShowsPausedVideo() {
        val lease = VideoPipPresentation(region)
        lease.pinned(true)
        assertFalse(lease.visible)
        assertEquals(VideoPipRegionUpdate.APPLY, lease.update(region.copy(sequence = 2, playing = false), true))
        assertFalse(lease.visible)
        lease.textureUpdated()
        assertFalse(lease.visible)
        lease.textureUpdated()
        assertTrue(lease.visible)
        lease.pinned(false)
        assertFalse(lease.visible)
    }

    @Test fun watchBeforeOsConfirmationCannotExposeFullscreenActivity() {
        val lease = VideoPipPresentation(region)
        assertEquals(VideoPipRegionUpdate.APPLY, lease.update(region.copy(sequence = 2), true))
        lease.textureUpdated()
        lease.textureUpdated()
        assertFalse(lease.visible)
        lease.pinned(true)
        assertTrue(lease.visible)
    }

    @Test fun documentChangeHidesBeforeReturnAndLateOriginalReplyCannotRevive() {
        val lease = VideoPipPresentation(region)
        lease.pinned(true)
        lease.update(region.copy(sequence = 2), true)
        assertEquals(VideoPipRegionUpdate.INVALID, lease.update(region.copy(documentToken = "new", sequence = 3), true))
        assertFalse(lease.visible)
        assertFalse(lease.valid)
        assertEquals(VideoPipRegionUpdate.IGNORE, lease.update(region.copy(sequence = 4), true))
        assertFalse(lease.visible)
    }

    @Test fun expiredWatchAndReplacedSessionBothFailClosed() {
        for (reply in listOf(null, region.copy(sequence = 2))) {
            val lease = VideoPipPresentation(region)
            assertEquals(VideoPipRegionUpdate.INVALID, lease.update(reply, false))
            lease.pinned(true)
            assertFalse(lease.visible)
        }
    }

    @Test fun duplicateAndOldGeometryCannotMoveTheCropBack() {
        val lease = VideoPipPresentation(region)
        assertEquals(VideoPipRegionUpdate.APPLY, lease.update(region.copy(sequence = 3), true))
        assertEquals(VideoPipRegionUpdate.IGNORE, lease.update(region.copy(sequence = 2), true))
        assertEquals(VideoPipRegionUpdate.IGNORE, lease.update(region.copy(sequence = 3), true))
        lease.invalidate()
        assertEquals(VideoPipRegionUpdate.IGNORE, lease.update(region.copy(sequence = 4), true))
        assertFalse(lease.visible)
    }

    @Test fun movedGeometryMasksOldTextureUntilNewFramesArrive() {
        val lease = VideoPipPresentation(region)
        lease.pinned(true)
        lease.textureUpdated() // Before the live watch: not evidence for this crop.
        lease.textureUpdated()
        lease.update(region.copy(sequence = 2), true)
        assertFalse(lease.visible)
        lease.textureUpdated(); lease.textureUpdated()
        assertTrue(lease.visible)
        lease.update(region.copy(sequence = 3, rect = region.rect.copy(x = 1.0, width = 99.0)), true)
        assertFalse(lease.visible)
        lease.textureUpdated()
        assertFalse(lease.visible)
        lease.textureUpdated()
        assertTrue(lease.visible)
    }

    @Test fun surfaceInvalidationNeedsFreshFramesButHeartbeatDoesNotFlicker() {
        val lease = VideoPipPresentation(region)
        lease.pinned(true)
        lease.update(region.copy(sequence = 2), true)
        lease.textureUpdated(); lease.textureUpdated()
        lease.update(region.copy(sequence = 3, playing = false), true)
        assertTrue(lease.visible)
        lease.textureInvalidated()
        assertFalse(lease.visible)
        lease.textureUpdated(); lease.textureUpdated()
        assertTrue(lease.visible)
    }
}
