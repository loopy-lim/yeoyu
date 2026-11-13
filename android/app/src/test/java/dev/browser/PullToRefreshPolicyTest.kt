package dev.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PullToRefreshPolicyTest {
    private fun baseEnv() = PullToRefreshEnvironment(
        propDisabled = false,
        imeVisible = false,
        isOnline = true,
        isLoading = false,
        isRefreshing = false,
        resizeCoverActive = false,
        sessionOpen = true,
        scrollY = 0,
        url = "https://example.com/article",
    )

    @Test fun allowsPullOnlyWhenTopOnlineIdleAndInteractive() {
        assertTrue(PullToRefreshPolicy.canBeginPull(baseEnv()))

        // Input / editing states
        assertFalse(PullToRefreshPolicy.canBeginPull(baseEnv().copy(propDisabled = true)))
        assertFalse(PullToRefreshPolicy.canBeginPull(baseEnv().copy(imeVisible = true)))

        // Offline policy
        assertFalse(PullToRefreshPolicy.canBeginPull(baseEnv().copy(isOnline = false)))
        assertTrue(PullToRefreshPolicy.canBeginPull(baseEnv().copy(isOnline = false, url = "file:///sdcard/page.html")))

        // Loading / lifecycle / scroll guards
        assertFalse(PullToRefreshPolicy.canBeginPull(baseEnv().copy(isLoading = true)))
        assertFalse(PullToRefreshPolicy.canBeginPull(baseEnv().copy(isRefreshing = true)))
        assertFalse(PullToRefreshPolicy.canBeginPull(baseEnv().copy(resizeCoverActive = true)))
        assertFalse(PullToRefreshPolicy.canBeginPull(baseEnv().copy(sessionOpen = false)))
        assertFalse(PullToRefreshPolicy.canBeginPull(baseEnv().copy(scrollY = 12)))

        // Internal / blank URLs
        assertFalse(PullToRefreshPolicy.canBeginPull(baseEnv().copy(url = "")))
        assertFalse(PullToRefreshPolicy.canBeginPull(baseEnv().copy(url = "about:blank")))
        assertFalse(PullToRefreshPolicy.canBeginPull(baseEnv().copy(url = "yeoyu://newtab")))
    }

    @Test fun respectsGeckoInputResultDetailAndWebAppOverscrollBehavior() {
        // Scrollable page at top with vertical overscroll allowed
        assertTrue(
            PullToRefreshPolicy.canOverscrollTop(
                PullToRefreshPolicy.INPUT_RESULT_HANDLED,
                scrollableDirections = 0,
                overscrollDirections = PullToRefreshPolicy.OVERSCROLL_FLAG_VERTICAL,
            )
        )

        // Nested container or root still scrollable upward
        assertFalse(
            PullToRefreshPolicy.canOverscrollTop(
                PullToRefreshPolicy.INPUT_RESULT_HANDLED,
                scrollableDirections = PullToRefreshPolicy.SCROLLABLE_FLAG_TOP,
                overscrollDirections = PullToRefreshPolicy.OVERSCROLL_FLAG_VERTICAL,
            )
        )

        // Web app disables vertical overscroll (`overscroll-behavior-y: contain/none`)
        assertFalse(
            PullToRefreshPolicy.canOverscrollTop(
                PullToRefreshPolicy.INPUT_RESULT_HANDLED,
                scrollableDirections = 0,
                overscrollDirections = PullToRefreshPolicy.OVERSCROLL_FLAG_NONE,
            )
        )
        assertFalse(
            PullToRefreshPolicy.canOverscrollTop(
                PullToRefreshPolicy.INPUT_RESULT_HANDLED,
                scrollableDirections = 0,
                overscrollDirections = PullToRefreshPolicy.OVERSCROLL_FLAG_HORIZONTAL,
            )
        )

        // Web app handles touch event directly (`touchstart`/`touchmove` preventDefault)
        assertFalse(
            PullToRefreshPolicy.canOverscrollTop(
                PullToRefreshPolicy.INPUT_RESULT_HANDLED_CONTENT,
                scrollableDirections = 0,
                overscrollDirections = PullToRefreshPolicy.OVERSCROLL_FLAG_VERTICAL,
            )
        )
        assertFalse(
            PullToRefreshPolicy.canOverscrollTop(
                PullToRefreshPolicy.INPUT_RESULT_IGNORED,
                scrollableDirections = 0,
                overscrollDirections = PullToRefreshPolicy.OVERSCROLL_FLAG_VERTICAL,
            )
        )

        // Short static page without scrollable element
        assertTrue(
            PullToRefreshPolicy.canOverscrollTop(
                PullToRefreshPolicy.INPUT_RESULT_UNHANDLED,
                scrollableDirections = 0,
                overscrollDirections = PullToRefreshPolicy.OVERSCROLL_FLAG_NONE,
            )
        )
        assertFalse(
            PullToRefreshPolicy.canOverscrollTop(
                PullToRefreshPolicy.INPUT_RESULT_UNHANDLED,
                scrollableDirections = 0,
                overscrollDirections = PullToRefreshPolicy.OVERSCROLL_FLAG_HORIZONTAL,
            )
        )
    }

    @Test fun computesBoundedMonotonicDampedDragDistance() {
        assertEquals(0f, PullToRefreshPolicy.computeDampedDrag(-20f, 144f, 224f), 0.001f)
        assertEquals(0f, PullToRefreshPolicy.computeDampedDrag(0f, 144f, 224f), 0.001f)

        val mid = PullToRefreshPolicy.computeDampedDrag(180f, 144f, 224f)
        val trigger = PullToRefreshPolicy.computeDampedDrag(288f, 144f, 224f)
        val high = PullToRefreshPolicy.computeDampedDrag(1200f, 144f, 224f)

        assertEquals(90f, mid, 0.001f)
        assertEquals(144f, trigger, 0.001f)
        assertTrue(high > trigger)
        assertEquals(224f, high, 0.001f)
    }
}
