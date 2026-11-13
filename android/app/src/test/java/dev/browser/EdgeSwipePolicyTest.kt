package dev.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EdgeSwipePolicyTest {
    private fun env(
        canGoBack: Boolean = true,
        canGoForward: Boolean = true,
    ) = EdgeSwipeEnvironment(
        propDisabled = false,
        canGoBack = canGoBack,
        canGoForward = canGoForward,
        imeVisible = false,
        resizeCoverActive = false,
        sessionOpen = true,
        pointerCount = 1,
    )

    private fun phoneBounds(
        viewWidth: Int = 1080,
        viewLocationX: Int = 0,
        windowWidth: Int = 1080,
        systemGestureLeft: Int = 90,
        systemGestureRight: Int = 90,
        density: Float = 3f,
    ) = EdgeSwipeBounds(
        viewWidth = viewWidth,
        viewLocationX = viewLocationX,
        windowWidth = windowWidth,
        systemGestureLeft = systemGestureLeft,
        systemGestureRight = systemGestureRight,
        density = density,
    )

    @Test fun armsOnlyForActiveInteractiveSessions() {
        assertTrue(EdgeSwipePolicy.canArm(env()))
        assertFalse(EdgeSwipePolicy.canArm(env(canGoBack = false, canGoForward = false)))
        assertFalse(EdgeSwipePolicy.canArm(env().copy(propDisabled = true)))
        assertFalse(EdgeSwipePolicy.canArm(env().copy(imeVisible = true)))
        assertFalse(EdgeSwipePolicy.canArm(env().copy(resizeCoverActive = true)))
        assertFalse(EdgeSwipePolicy.canArm(env().copy(sessionOpen = false)))
        assertFalse(EdgeSwipePolicy.canArm(env().copy(pointerCount = 2)))
    }

    @Test fun coexistsWithAndroidSystemGestureInsetsOnPhoneAndTablet() {
        val phone = phoneBounds() // density=3 -> system inset 90px (30dp) + inner 28dp = 174px (58dp)
        // Inside browser edge corridor immediately inward of OS bezel
        assertEquals(
            EdgeSwipeDirection.BACK,
            EdgeSwipePolicy.detectEdgeDirection(120f, phone, env()),
        )
        assertEquals(
            EdgeSwipeDirection.FORWARD,
            EdgeSwipePolicy.detectEdgeDirection(1080f - 120f, phone, env()),
        )
        // Mid-canvas touch never triggers edge navigation
        assertNull(EdgeSwipePolicy.detectEdgeDirection(540f, phone, env()))

        // Respects history availability
        assertNull(EdgeSwipePolicy.detectEdgeDirection(120f, phone, env(canGoBack = false)))
        assertNull(EdgeSwipePolicy.detectEdgeDirection(1080f - 120f, phone, env(canGoForward = false)))

        // Tablet with expanded sidebar: viewLocationX=840 > systemGestureLeft=90 -> overlap=0 -> 32dp (96px) standalone edge
        val tabletPane = phoneBounds(
            viewWidth = 1560,
            viewLocationX = 840,
            windowWidth = 2400,
            systemGestureLeft = 90,
            systemGestureRight = 90,
        )
        assertEquals(
            EdgeSwipeDirection.BACK,
            EdgeSwipePolicy.detectEdgeDirection(60f, tabletPane, env()),
        )
        assertNull(EdgeSwipePolicy.detectEdgeDirection(130f, tabletPane, env()))
    }

    @Test fun classifiesHorizontalEdgeIntentAndRejectsVerticalOrReverseMotion() {
        val slop = 24f
        assertEquals(
            EdgeMoveIntent.ACCEPT,
            EdgeSwipePolicy.classifyMove(EdgeSwipeDirection.BACK, dx = 36f, dy = 8f, touchSlop = slop),
        )
        assertEquals(
            EdgeMoveIntent.REJECT,
            EdgeSwipePolicy.classifyMove(EdgeSwipeDirection.BACK, dx = 10f, dy = 40f, touchSlop = slop),
        )
        assertEquals(
            EdgeMoveIntent.REJECT,
            EdgeSwipePolicy.classifyMove(EdgeSwipeDirection.BACK, dx = -30f, dy = 0f, touchSlop = slop),
        )
        assertEquals(
            EdgeMoveIntent.UNDECIDED,
            EdgeSwipePolicy.classifyMove(EdgeSwipeDirection.BACK, dx = 12f, dy = 4f, touchSlop = slop),
        )

        assertEquals(
            EdgeMoveIntent.ACCEPT,
            EdgeSwipePolicy.classifyMove(EdgeSwipeDirection.FORWARD, dx = -42f, dy = 10f, touchSlop = slop),
        )
        assertEquals(
            EdgeMoveIntent.REJECT,
            EdgeSwipePolicy.classifyMove(EdgeSwipeDirection.FORWARD, dx = 32f, dy = 0f, touchSlop = slop),
        )
    }

    @Test fun backsOffForWebHorizontalScrollersAndCarousels() {
        // Regular page at horizontal boundary -> allows edge navigation
        assertTrue(
            EdgeSwipePolicy.canEdgeNavigate(
                EdgeSwipeDirection.BACK,
                handledResult = EdgeSwipePolicy.INPUT_RESULT_HANDLED,
                scrollableDirections = EdgeSwipePolicy.SCROLLABLE_FLAG_RIGHT,
            ),
        )
        assertTrue(
            EdgeSwipePolicy.canEdgeNavigate(
                EdgeSwipeDirection.FORWARD,
                handledResult = EdgeSwipePolicy.INPUT_RESULT_HANDLED,
                scrollableDirections = EdgeSwipePolicy.SCROLLABLE_FLAG_LEFT,
            ),
        )

        // Carousel / horizontally scrolled container can still scroll in swipe direction -> rejects
        assertFalse(
            EdgeSwipePolicy.canEdgeNavigate(
                EdgeSwipeDirection.BACK,
                handledResult = EdgeSwipePolicy.INPUT_RESULT_HANDLED,
                scrollableDirections = EdgeSwipePolicy.SCROLLABLE_FLAG_LEFT,
            ),
        )
        assertFalse(
            EdgeSwipePolicy.canEdgeNavigate(
                EdgeSwipeDirection.FORWARD,
                handledResult = EdgeSwipePolicy.INPUT_RESULT_HANDLED,
                scrollableDirections = EdgeSwipePolicy.SCROLLABLE_FLAG_RIGHT,
            ),
        )

        // JS touchstart/touchmove preventDefault carousel or touch-action:none -> rejects
        assertFalse(
            EdgeSwipePolicy.canEdgeNavigate(
                EdgeSwipeDirection.BACK,
                handledResult = EdgeSwipePolicy.INPUT_RESULT_HANDLED_CONTENT,
                scrollableDirections = 0,
            ),
        )
        assertFalse(
            EdgeSwipePolicy.canEdgeNavigate(
                EdgeSwipeDirection.FORWARD,
                handledResult = EdgeSwipePolicy.INPUT_RESULT_IGNORED,
                scrollableDirections = 0,
            ),
        )
    }

    @Test fun commitsOnDistanceOrDirectionalFlingVelocity() {
        val trigger = 252f
        val minFlingDist = 120f
        val minFlingVel = 1560f

        assertTrue(EdgeSwipePolicy.shouldCommitSwipe(EdgeSwipeDirection.BACK, 260f, 200f, trigger, minFlingDist, minFlingVel))
        assertTrue(EdgeSwipePolicy.shouldCommitSwipe(EdgeSwipeDirection.BACK, 130f, 1800f, trigger, minFlingDist, minFlingVel))
        assertFalse(EdgeSwipePolicy.shouldCommitSwipe(EdgeSwipeDirection.BACK, 180f, 400f, trigger, minFlingDist, minFlingVel))
        assertFalse(EdgeSwipePolicy.shouldCommitSwipe(EdgeSwipeDirection.BACK, 60f, 2400f, trigger, minFlingDist, minFlingVel))

        assertTrue(EdgeSwipePolicy.shouldCommitSwipe(EdgeSwipeDirection.FORWARD, -260f, -200f, trigger, minFlingDist, minFlingVel))
        assertTrue(EdgeSwipePolicy.shouldCommitSwipe(EdgeSwipeDirection.FORWARD, -130f, -1800f, trigger, minFlingDist, minFlingVel))
        assertFalse(EdgeSwipePolicy.shouldCommitSwipe(EdgeSwipeDirection.FORWARD, -180f, -400f, trigger, minFlingDist, minFlingVel))
    }
}
