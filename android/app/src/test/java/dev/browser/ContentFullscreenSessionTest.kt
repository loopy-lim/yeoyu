package dev.browser

import org.junit.Assert.*
import org.junit.Test

class ContentFullscreenSessionTest {
    private class Harness {
        val session = Any()
        var current = true
        var visible = true
        var exits = 0
        var throwOnExit = false
        val changes = mutableListOf<Boolean>()
        val state = ContentFullscreenSession(session, { current }, { visible }, {
            exits++
            if (throwOnExit) error("session exit failed")
        }, changes::add)
        fun enter() = state.onFullScreen(session, true)
    }

    @Test fun engineCallbackEntersAndExitsWithoutChangingTheSession() {
        val h = Harness()
        h.enter()
        assertEquals(listOf(true), h.changes)
        assertTrue(h.state.fullscreen)
        h.state.onFullScreen(h.session, false)
        assertEquals(listOf(true, false), h.changes)
        assertFalse(h.state.fullscreen)
        assertEquals(0, h.exits)
    }

    @Test fun backRequestsNativeExitOnceAndWaitsForTheEngineCallback() {
        val h = Harness()
        h.enter()
        h.state.requestExit()
        h.state.requestExit()
        assertEquals(1, h.exits)
        assertTrue("Keep the expanded pane until Gecko confirms exit", h.state.fullscreen)
        h.state.onFullScreen(h.session, false)
        assertFalse(h.state.fullscreen)
        assertEquals(listOf(true, false), h.changes)
    }

    @Test fun repeatedCallbacksDoNotPublishDuplicateLayoutTransitions() {
        val h = Harness()
        h.enter()
        h.enter()
        h.state.onFullScreen(h.session, false)
        h.state.onFullScreen(h.session, false)
        assertEquals(listOf(true, false), h.changes)
    }

    @Test fun aRetiredSessionOrWrongCallbackSessionCannotChangeTheReplacementPane() {
        val h = Harness()
        h.state.onFullScreen(Any(), true)
        h.current = false
        h.enter()
        assertTrue(h.changes.isEmpty())
        assertEquals(0, h.exits)
    }

    @Test fun hiddenSessionCannotEnterAndRequestsNativeExit() {
        val h = Harness()
        h.visible = false
        h.enter()
        h.enter()
        assertFalse(h.state.fullscreen)
        assertTrue(h.changes.isEmpty())
        assertEquals(1, h.exits)
    }

    @Test fun detachingImmediatelyClearsUiStateAndLateEnterCannotRestoreIt() {
        val h = Harness()
        h.enter()
        h.visible = false
        h.state.leave()
        assertFalse(h.state.fullscreen)
        assertEquals(listOf(true, false), h.changes)
        assertEquals(1, h.exits)
        h.visible = true
        h.enter()
        assertFalse("A queued old enter cannot survive detach and reattach", h.state.fullscreen)
        h.state.onFullScreen(h.session, false)
        h.enter()
        assertTrue("A fresh enter after exit acknowledgement is allowed", h.state.fullscreen)
    }

    @Test fun retireClearsBeforeAnyLateCallbackAndNeverRequestsExitOnADeadEngine() {
        val h = Harness()
        h.enter()
        h.state.retire()
        h.enter()
        h.state.onFullScreen(h.session, false)
        h.state.requestExit()
        assertFalse(h.state.fullscreen)
        assertEquals(listOf(true, false), h.changes)
        assertEquals(0, h.exits)
    }

    @Test fun aFailedNativeExitCanBeRetriedWithoutPrematurelyCollapsingThePane() {
        val h = Harness()
        h.enter()
        h.throwOnExit = true
        assertThrows(IllegalStateException::class.java) { h.state.requestExit() }
        assertTrue(h.state.fullscreen)
        h.throwOnExit = false
        h.state.requestExit()
        assertEquals(2, h.exits)
        h.state.onFullScreen(h.session, false)
        assertFalse(h.state.fullscreen)
    }

    @Test fun detachStillClearsUiStateWhenTheNativeExitFails() {
        val h = Harness()
        h.enter()
        h.throwOnExit = true
        assertThrows(IllegalStateException::class.java) { h.state.leave() }
        assertFalse(h.state.fullscreen)
        assertEquals(listOf(true, false), h.changes)
        h.visible = true
        h.enter()
        assertFalse("A failed exit cannot resurrect the hidden page's fullscreen state", h.state.fullscreen)
    }

    @Test fun synchronousExitAcknowledgementDoesNotBlockTheNextUserEnter() {
        val session = Any()
        val changes = mutableListOf<Boolean>()
        lateinit var state: ContentFullscreenSession<Any>
        state = ContentFullscreenSession(session, { true }, { true }, {
            state.onFullScreen(session, false)
        }, changes::add)
        state.onFullScreen(session, true)
        state.leave()
        state.onFullScreen(session, true)
        assertTrue(state.fullscreen)
        assertEquals(listOf(true, false, true), changes)
    }

    @Test fun aNewSessionCanEnterWhileRetiredSessionCallbacksStaySilent() {
        val old = Harness()
        old.enter()
        old.state.retire()
        old.current = false
        val replacement = Harness()
        replacement.enter()
        old.state.onFullScreen(old.session, false)
        old.enter()
        assertEquals(listOf(true, false), old.changes)
        assertEquals(listOf(true), replacement.changes)
        assertTrue(replacement.state.fullscreen)
    }

    @Test fun userBarPreferenceIsRestoredAfterTemporaryContentFullscreen() {
        assertFalse(browserImmersiveEnabled(false, false))
        assertTrue("Settings or focus updates cannot show bars over web fullscreen", browserImmersiveEnabled(false, true))
        assertFalse(browserImmersiveEnabled(false, false))
        assertTrue(browserImmersiveEnabled(true, false))
    }
}
