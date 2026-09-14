package dev.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class VideoRegionPolicyTest {
    private val viewport = VideoViewport(1024.0, 780.0, 1024.0, 780.0, 0.0, 0.0, 1.0)
    private val region = VideoRegion("document-1", "video-1", 1L, viewport,
        VideoCssRect(20.0, 263.2, 984.0, 390.0), true, 1920, 1080)

    private fun pixels(value: VideoRegion = region, width: Int = 2560, height: Int = 1950,
        sx: Double = 2.5, sy: Double = 2.5, ox: Double = 0.0, oy: Double = 0.0) =
        videoRegionToPixels(value, width, height, sx, sy, ox, oy)

    @Test fun mapsTheObservedFixtureUsingTheActualClientToSurfaceScale() {
        assertEquals(VideoPixelRect(50, 658, 2510, 1633), pixels())
        assertEquals(2460, pixels()!!.width)
        assertEquals(975, pixels()!!.height)
        // A paused, loaded video is still a valid video crop.
        assertEquals(pixels(), pixels(region.copy(playing = false)))
    }

    @Test fun appliesBothActualMatrixTranslationsBeforeRoundingInward() {
        assertEquals(VideoPixelRect(51, 658, 2510, 1632), pixels(ox = 0.25, oy = -0.75))
        assertNull(pixels(ox = 100.0))
        assertNull(pixels(oy = -700.0))
    }

    @Test fun fractionalEdgesNeverIncludeTheAdjacentPagePixels() {
        val fractional = region.copy(rect = VideoCssRect(20.01, 263.21, 983.98, 389.98))
        assertEquals(VideoPixelRect(51, 659, 2509, 1632), pixels(fractional))
    }

    @Test fun aStaleViewportOrMatrixCannotCropTheWrongSurface() {
        assertNull(pixels(region.copy(viewport = viewport.copy(width = 1000.0, visualWidth = 1000.0))))
        assertNull(pixels(region.copy(viewport = viewport.copy(height = 760.0, visualHeight = 760.0))))
        assertNull(pixels(width = 2563))
        assertNull(pixels(height = 1947))
        assertNull(pixels(sx = 2.0))
        assertNull(pixels(sy = 2.0))
        assertEquals(VideoPixelRect(50, 658, 2510, 1633), pixels(width = 2562, height = 1952))
    }

    @Test fun unknownVisualViewportZoomAndPanAreRejected() {
        for (value in listOf(viewport.copy(scale = 1.1), viewport.copy(offsetLeft = 1.0),
            viewport.copy(offsetTop = 1.0), viewport.copy(visualWidth = 1000.0),
            viewport.copy(visualHeight = 760.0))) {
            assertNull(value.toString(), pixels(region.copy(viewport = value)))
        }
    }

    @Test fun observedFractionalVisualViewportFitsItsIntegerLayoutViewport() {
        val observed = VideoViewport(1019.0, 769.0, 1018.6666870117188, 769.3333129882812, 0.0, 0.0, 1.0)
        // Use the existing valid video rectangle; only these viewport measurements
        // and source dimensions come from the 1.5-scale emulator observation.
        assertNotNull(pixels(region.copy(viewport = observed), width = 1528, height = 1154, sx = 1.5, sy = 1.5))
    }

    @Test fun visualViewportRoundingUsesTheSameTwoSurfacePixelBudgetAtEveryDensity() {
        for (difference in listOf(-0.8, 0.8)) {
            assertNotNull(pixels(region.copy(viewport = viewport.copy(visualWidth = viewport.width + difference))))
            assertNotNull(pixels(region.copy(viewport = viewport.copy(visualHeight = viewport.height + difference))))
        }
        for (difference in listOf(-0.80001, 0.80001)) {
            assertNull(pixels(region.copy(viewport = viewport.copy(visualWidth = viewport.width + difference))))
            assertNull(pixels(region.copy(viewport = viewport.copy(visualHeight = viewport.height + difference))))
        }
    }

    @Test fun observedYoutubeLayoutAndVisualSizesCanDescribeTheSameSurface() {
        val observed = VideoViewport(1020.0, 770.0, 1018.6666870117188, 769.3333129882812, 0.0, 0.0, 1.0)
        val video = region.copy(viewport = observed, rect = VideoCssRect(16.0, 68.0, 690.0, 388.0))
        assertEquals(VideoPixelRect(24, 102, 1059, 684),
            pixels(video, width = 1528, height = 1154, sx = 1.5, sy = 1.5))
        assertEquals(VideoPixelRect(24, 102, 1059, 684),
            pixels(video.copy(viewport = observed.copy(width = 1020.01)),
                width = 1528, height = 1154, sx = 1.5, sy = 1.5))
    }

    @Test fun visualSizeMustMatchTheSurfaceEvenWhenTheLayoutIsLarger() {
        val opposed = viewport.copy(width = 1024.8, visualWidth = 1023.2)
        assertEquals(VideoPixelRect(50, 658, 2510, 1633), pixels(region.copy(viewport = opposed)))
        val beyondSurface = viewport.copy(width = 1024.8, visualWidth = 1025.6)
        assertNull(pixels(region.copy(viewport = beyondSurface)))
        // Matching layout coordinates cannot validate a stale visual viewport.
        assertNull(pixels(region.copy(viewport = viewport.copy(visualWidth = 1000.0))))
        assertNull(pixels(region.copy(viewport = viewport.copy(visualHeight = 760.0))))
    }

    @Test fun observedSpringAfterFullscreenReturnUsesTheActualMatrixWithoutLayoutRescaling() {
        val observed = region.copy(
            viewport = VideoViewport(1275.0, 971.0, 1024.0, 780.0, 0.0, 0.0, 1.0),
            rect = VideoCssRect(16.0, 68.0, 907.0, 379.98333740234375),
            videoWidth = 1280, videoHeight = 536,
        )
        // Physical b41dc: source 2560x1950; the visible video starts at (40,170).
        assertEquals(VideoPixelRect(40, 170, 2307, 1119), pixels(observed))
        assertEquals(VideoPixelRect(40, 170, 2307, 1119), pixels(observed.copy(playing = false)))
        assertNull(pixels(observed, width = 2563))
        assertNull(pixels(observed, sx = 2.0))
    }

    @Test fun layoutCannotBeSmallerThanTheVisualViewportBeyondTwoSurfacePixels() {
        for (value in listOf(viewport.copy(width = 1023.2), viewport.copy(height = 779.2))) {
            assertNotNull(pixels(region.copy(viewport = value)))
        }
        for (value in listOf(viewport.copy(width = 1023.19999), viewport.copy(height = 779.19999))) {
            assertNull(pixels(region.copy(viewport = value)))
        }
    }

    @Test fun largerLayoutCannotExposeVideosBeyondTheVisibleSurface() {
        val larger = viewport.copy(width = 1275.0, height = 971.0)
        for (rect in listOf(VideoCssRect(1000.0, 20.0, 25.0, 100.0),
            VideoCssRect(20.0, 760.0, 100.0, 21.0))) {
            assertNull(pixels(region.copy(viewport = larger, rect = rect)))
        }
    }

    @Test fun aVideoInsideLayoutButOutsideVisualViewportIsStillRejected() {
        val narrower = viewport.copy(visualWidth = 1023.5, visualHeight = 779.5)
        assertNull(pixels(region.copy(viewport = narrower, rect = VideoCssRect(1000.0, 20.0, 24.0, 100.0))))
        assertNull(pixels(region.copy(viewport = narrower, rect = VideoCssRect(20.0, 760.0, 100.0, 20.0))))
    }

    @Test fun partiallyOffscreenVideosAreRejectedInsteadOfClippedToOtherContent() {
        for (rect in listOf(VideoCssRect(-0.01, 20.0, 100.0, 100.0),
            VideoCssRect(20.0, -0.01, 100.0, 100.0), VideoCssRect(1000.0, 20.0, 25.0, 100.0),
            VideoCssRect(20.0, 760.0, 100.0, 21.0))) {
            assertNull(rect.toString(), pixels(region.copy(rect = rect)))
        }
    }

    @Test fun tinyFloatingPointBoundaryNoiseIsClampedOnlyAtTheSourceEdge() {
        val full = region.copy(rect = VideoCssRect(-1e-9, -1e-9, 1024.000000002, 780.000000002))
        assertEquals(VideoPixelRect(0, 0, 2560, 1950), pixels(full))
    }

    @Test fun minimumUsefulCropIsMeasuredAfterInwardPixelRounding() {
        assertEquals(VideoPixelRect(50, 50, 66, 66), pixels(region.copy(rect = VideoCssRect(20.0, 20.0, 6.4, 6.4))))
        assertNull(pixels(region.copy(rect = VideoCssRect(20.01, 20.0, 6.4, 6.4))))
        assertNull(pixels(region.copy(rect = VideoCssRect(20.0, 20.01, 6.4, 6.4))))
    }

    @Test fun invalidIdentitySequenceAndUnloadedVideoCannotBeUsed() {
        for (value in listOf(region.copy(documentToken = " "), region.copy(videoToken = ""),
            region.copy(sequence = 0L), region.copy(sequence = -1L),
            region.copy(sequence = 9_007_199_254_740_992L), region.copy(videoWidth = 0),
            region.copy(videoHeight = -1))) {
            assertNull(value.toString(), pixels(value))
        }
        assertEquals(pixels(), pixels(region.copy(sequence = 9_007_199_254_740_991L)))
    }

    @Test fun everyCoordinateAndDimensionMustBeFiniteAndSizesPositive() {
        for (number in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)) {
            for (rect in listOf(region.rect.copy(x = number), region.rect.copy(y = number),
                region.rect.copy(width = number), region.rect.copy(height = number))) {
                assertNull(pixels(region.copy(rect = rect)))
            }
            for (value in listOf(viewport.copy(width = number), viewport.copy(height = number),
                viewport.copy(visualWidth = number), viewport.copy(visualHeight = number),
                viewport.copy(offsetLeft = number), viewport.copy(offsetTop = number), viewport.copy(scale = number))) {
                assertNull(pixels(region.copy(viewport = value)))
            }
            assertNull(pixels(sx = number)); assertNull(pixels(sy = number))
            assertNull(pixels(ox = number)); assertNull(pixels(oy = number))
        }
        for (number in listOf(0.0, -1.0)) {
            assertNull(pixels(region.copy(rect = region.rect.copy(width = number))))
            assertNull(pixels(region.copy(rect = region.rect.copy(height = number))))
            assertNull(pixels(region.copy(viewport = viewport.copy(width = number))))
            assertNull(pixels(region.copy(viewport = viewport.copy(height = number))))
            assertNull(pixels(region.copy(viewport = viewport.copy(visualWidth = number))))
            assertNull(pixels(region.copy(viewport = viewport.copy(visualHeight = number))))
            assertNull(pixels(sx = number)); assertNull(pixels(sy = number))
        }
        assertNull(pixels(width = 0)); assertNull(pixels(height = -1))
    }
}
