package dev.browser

import org.junit.Assert.*
import org.junit.Test

class SessionLifecyclePolicyTest {
    @Test fun repeatedCrashesStopUntilTheUserRetries() {
        val budget = SessionRecoveryBudget()
        assertTrue(budget.allowAutomaticRecovery("a", 0))
        assertTrue(budget.allowAutomaticRecovery("a", 1_000))
        assertFalse(budget.allowAutomaticRecovery("a", 2_000))
        assertFalse(budget.allowAutomaticRecovery("a", 120_000))
        assertTrue(budget.allowAutomaticRecovery("b", 2_000))
        budget.retry("a")
        assertTrue(budget.allowAutomaticRecovery("a", 120_001))
    }

    @Test fun isolatedFailuresDoNotConsumeTheNextWindow() {
        val budget = SessionRecoveryBudget()
        assertTrue(budget.allowAutomaticRecovery("a", 0))
        assertTrue(budget.allowAutomaticRecovery("a", 61_000))
        assertTrue(budget.allowAutomaticRecovery("a", 61_001))
        assertFalse(budget.allowAutomaticRecovery("a", 61_002))
    }

    @Test fun staleStateCannotReturnAfterCloseDisableOrClear() {
        val gate = SessionWriteGate()
        val old = Any()
        gate.register("a", old)
        assertNull(gate.capture("a", old))
        gate.setEnabled(true)
        val token = gate.capture("a", old)!!
        assertTrue(gate.accepts(token))
        gate.remove("a")
        gate.register("a", Any())
        assertFalse(gate.accepts(token))
        val b = Any()
        gate.register("b", b)
        val beforeDisable = gate.capture("b", b)!!
        gate.setEnabled(false)
        gate.setEnabled(true)
        assertFalse(gate.accepts(beforeDisable))
        val beforeClear = gate.capture("b", b)!!
        gate.beginClear()
        assertNull(gate.capture("b", b))
        gate.endClear()
        assertFalse(gate.accepts(beforeClear))
    }

    @Test fun aNewDocumentRejectsWritesCapturedFromTheSameOldSession() {
        val gate = SessionWriteGate()
        gate.setEnabled(true)
        val session = Any()
        gate.register("a", session)
        val previousDocument = gate.capture("a", session)!!
        gate.register("a", session)
        assertFalse(gate.accepts(previousDocument))
        assertTrue(gate.accepts(gate.capture("a", session)!!))
    }

    @Test fun clearKeepsEveryTabPausedUntilItsOwnExplicitResume() {
        val barrier = SessionIsolationBarrier()
        barrier.begin(setOf("a", "b"))
        assertFalse(barrier.allowAttach("c"))
        assertFalse(barrier.resume("a"))
        barrier.end()
        assertFalse(barrier.allowAttach("a"))
        assertFalse(barrier.allowAttach("b"))
        assertFalse(barrier.allowAttach("c"))
        assertTrue(barrier.resume("a"))
        assertTrue(barrier.allowAttach("a"))
        assertFalse(barrier.allowAttach("b"))
    }

    @Test fun navigationAttemptDuringClearRequiresExplicitResumeAfterCompletion() {
        val barrier = SessionIsolationBarrier()
        barrier.begin(emptySet())
        assertFalse(barrier.allowAttach("new-tab"))
        barrier.end()
        assertFalse(barrier.allowAttach("new-tab"))
        assertTrue(barrier.resume("new-tab"))
        assertTrue(barrier.allowAttach("new-tab"))
    }

    @Test fun anyProtectedActivityPreventsRelease() {
        val idle = SessionReleaseObservation(1, 2, 3, hasState = true, restorableConsent = true)
        assertTrue(idle.canInspect())
        val protected = listOf(
            idle.copy(attached = true), idle.copy(playing = true),
            idle.copy(recording = true), idle.copy(loading = true),
            idle.copy(hasPrompt = true), idle.copy(hasPermission = true),
            idle.copy(hasFiles = true), idle.copy(hasPopup = true),
            idle.copy(hasState = false),
        )
        protected.forEach { assertFalse(it.canInspect()) }
    }

    @Test fun asyncFormAnswerCannotReleaseANewDocumentOrReactivatedTab() {
        val idle = SessionReleaseObservation(1, 2, 3, hasState = true, restorableConsent = true)
        assertTrue(idle.canReleaseAfter(idle, false))
        assertFalse(idle.canReleaseAfter(idle, true))
        assertFalse(idle.canReleaseAfter(idle, null))
        assertFalse(idle.canReleaseAfter(idle.copy(documentVersion = 4), false))
        assertFalse(idle.canReleaseAfter(idle.copy(activityVersion = 4), false))
        assertFalse(idle.canReleaseAfter(idle.copy(sessionVersion = 4), false))
        assertFalse(idle.canReleaseAfter(idle.copy(attached = true), false))
    }

    @Test fun unknownSpaStateAndKeepAliveFailClosed() {
        val unknown = SessionReleaseObservation(1, 2, 3, hasState = true)
        assertFalse(unknown.canReleaseAfter(unknown, false))
        assertTrue("unknown-state" in unknown.protectionReasons())
        val empty = unknown.copy(emptyDocument = true)
        assertTrue(empty.canReleaseAfter(empty, false))
        assertFalse(empty.copy(keepAlive = true).canInspect())
        assertFalse(empty.copy(privateSession = true).canInspect())
    }

    @Test fun zoomCannotReadOrWriteStaleConfigWhileAnEarlierSaveIsPending() {
        val gate = BrowserConfigurationGate()
        data class Settings(val restore: Boolean, val desktop: Boolean, val scale: Int)
        var persisted = Settings(true, true, 100)
        val queuedSave = { persisted = Settings(false, false, 100) }
        gate.begin()
        var zoomReads = 0
        assertThrows(IllegalStateException::class.java) {
            gate.whenIdle { zoomReads++; persisted = persisted.copy(scale = 110) }
        }
        assertEquals(0, zoomReads)
        queuedSave()
        gate.finish()
        gate.whenIdle { persisted = persisted.copy(scale = 110) }
        assertEquals(Settings(false, false, 110), persisted)
    }

    @Test fun zoomWaitsForEveryPendingConfigMutationAndFailureReleasesTheGate() {
        val gate = BrowserConfigurationGate()
        gate.begin()
        gate.begin()
        gate.finish()
        assertThrows(IllegalStateException::class.java) { gate.whenIdle { fail("A pending write must block zoom") } }
        // Finishing the failed second write must also release the pending count.
        gate.finish()
        assertEquals("latest", gate.whenIdle { "latest" })
    }
}
