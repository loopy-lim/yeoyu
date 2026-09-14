package dev.browser

import org.junit.Assert.*
import org.junit.Test

class ResizeCoverLifecycleTest {
    @Test fun theFirstTextureAfterDeferredLayoutCannotExposeTheOldBuffer() {
        val cover = ResizeCoverLifecycle()
        cover.resize(0)
        cover.captured(true)
        // Child layout is deferred 48 ms; its first updated buffer can still
        // contain the former viewport. Host resize + 120 ms is too early.
        assertFalse(cover.frame(47, layoutPending = true))
        assertFalse(cover.frame(64))
        assertFalse(cover.frame(120))
        assertFalse(cover.frame(160))
        assertTrue(cover.frame(184))
    }

    @Test fun lateTextureReadinessCannotExtendTheAbsoluteCaptureDeadline() {
        val cover = ResizeCoverLifecycle()
        cover.resize(0)
        cover.captured(true)
        assertFalse(cover.frame(490))
        assertFalse(cover.expire(499))
        assertTrue(cover.expire(500))
        assertFalse(cover.frame(610))
    }

    @Test fun actualChildLayoutDiscardsReadinessFromThePreviousViewport() {
        val cover = ResizeCoverLifecycle()
        cover.resize(0)
        cover.captured(true)
        assertFalse(cover.frame(16))
        cover.layoutApplied()
        assertFalse(cover.frame(80))
        assertFalse(cover.frame(136)) // Old viewport's frame + 120 ms is irrelevant.
        assertFalse(cover.frame(199))
        assertTrue(cover.frame(200))
    }

    @Test fun aRapidReversalWaitsForTheNewViewportWithoutAnotherCapture() {
        val cover = ResizeCoverLifecycle()
        cover.resize(0)
        cover.captured(true)
        assertFalse(cover.frame(16))
        assertFalse(cover.resize(100))
        assertFalse(cover.frame(116))
        assertFalse(cover.frame(136))
        assertFalse(cover.frame(235))
        assertTrue(cover.frame(236))
    }

    @Test fun repeatedActualLayoutsCannotMoveTheAbsoluteDeadline() {
        val cover = ResizeCoverLifecycle()
        cover.resize(0)
        cover.captured(true)
        for (time in 16L..496L step 16) {
            cover.layoutApplied()
            assertFalse(cover.frame(time))
        }
        assertFalse(cover.expire(499))
        assertTrue(cover.expire(500))
        cover.layoutApplied() // A late detached-view callback cannot revive it.
        assertFalse(cover.frame(620))
    }

    @Test fun aResizeAndItsReversalShareOneCapture() {
        val cover = ResizeCoverLifecycle()
        assertTrue(cover.resize(0))
        cover.captured(true)
        for (time in listOf(16L, 32L, 64L, 100L, 140L)) assertFalse(cover.resize(time))
        assertTrue(cover.active)
    }

    @Test fun captureReadbackCannotRetireItsOwnCover() {
        val cover = ResizeCoverLifecycle()
        cover.resize(0)
        assertFalse(cover.frame(150))
        cover.captured(true)
        assertFalse(cover.frame(151))
        assertTrue(cover.frame(271))
    }

    @Test fun onlyAFrameAfterTheLatestSizeSettlesRevealsTheSurface() {
        val cover = ResizeCoverLifecycle()
        cover.resize(0)
        cover.captured(true)
        cover.resize(190)
        assertFalse(cover.frame(200))
        assertFalse(cover.frame(274)) // The observed first post-resize update was still incomplete.
        assertFalse(cover.frame(306))
        assertFalse(cover.frame(309))
        assertFalse(cover.frame(310))
        assertTrue(cover.frame(320))
        assertFalse(cover.active)
        assertFalse(cover.frame(330))
    }

    @Test fun continuousResizingCannotExtendTheDeadlineOrRecaptureImmediately() {
        val cover = ResizeCoverLifecycle()
        cover.resize(0)
        cover.captured(true)
        for (time in 16L..496L step 16) assertFalse(cover.resize(time))
        assertFalse(cover.expire(499))
        assertTrue(cover.expire(500))
        assertFalse(cover.resize(512))
        assertFalse(cover.resize(560))
        assertFalse(cover.active)
        assertTrue(cover.resize(700))
    }

    @Test fun failedCaptureIsNotRetriedOnEveryAnimationFrame() {
        val cover = ResizeCoverLifecycle()
        cover.resize(0)
        cover.captured(false)
        assertFalse(cover.active)
        assertFalse(cover.resize(16))
        assertFalse(cover.resize(32))
        assertFalse(cover.frame(150))
        assertTrue(cover.resize(200))
    }

    @Test fun clearMakesLateFrameAndDeadlineHarmlessAndAllowsAnotherSession() {
        val cover = ResizeCoverLifecycle()
        cover.resize(0)
        cover.captured(true)
        cover.clear()
        assertFalse(cover.frame(200))
        assertFalse(cover.expire(500))
        assertTrue(cover.resize(501))
        cover.captured(true)
        assertFalse(cover.expire(600))
    }

    @Test fun idleSurfaceNeverNeedsFrameWork() {
        val cover = ResizeCoverLifecycle()
        assertFalse(cover.active)
        assertFalse(cover.frame(1000))
        assertFalse(cover.expire(1000))
    }

    @Test fun anOldTextureFrameCannotRevealAnUnappliedOrReentrantFinalLayout() {
        val cover = ResizeCoverLifecycle()
        cover.resize(0)
        cover.captured(true)
        lateinit var layout: ResizeLayoutCoalescer
        layout = ResizeLayoutCoalescer { _, _ ->
            assertFalse(cover.frame(160, layout.hasPending || layout.isApplying))
        }
        layout.request(800, 600, 0, true)
        cover.resize(32)
        layout.request(700, 600, 32, true)
        assertFalse(cover.frame(160, layout.hasPending || layout.isApplying))
        layout.flush()
        assertTrue(cover.active)
        assertFalse(cover.frame(161, layout.hasPending || layout.isApplying))
        assertTrue(cover.frame(281, layout.hasPending || layout.isApplying))
    }
}
