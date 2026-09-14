package dev.browser

import org.junit.Assert.*
import org.junit.Test

class VideoPipPreparationTest {
    @Test fun newerTransitionSettlesOldBridgeAndRejectsItsLateMeasurement() {
        val gate = VideoPipPreparation()
        val settled = mutableListOf<String>()
        var claims = 0
        val old = gate.begin { settled += "old" }
        val next = gate.begin { settled += "next" }
        assertEquals(listOf("old"), settled)
        gate.complete(old) { claims++ }
        gate.complete(next) { claims++ }
        gate.complete(next) { claims++ }
        assertEquals(1, claims)
        assertEquals(listOf("old", "next"), settled)
    }

    @Test fun cancelSettlesOnceAndLateReplyCannotLaunch() {
        val gate = VideoPipPreparation()
        var done = 0
        val ticket = gate.begin { done++ }
        gate.cancel()
        gate.cancel()
        gate.complete(ticket) { fail("cancelled request launched") }
        assertEquals(1, done)
    }

    @Test fun launchExceptionStillSettlesBridgeAndCannotReplay() {
        val gate = VideoPipPreparation()
        var done = 0
        val ticket = gate.begin { done++ }
        try { gate.complete(ticket) { throw IllegalStateException("launch rejected") }; fail() }
        catch (_: IllegalStateException) { }
        gate.complete(ticket) { fail("settled request replayed") }
        assertEquals(1, done)
    }

    @Test fun synchronousReplyAndReentrantDoneRetainNewestRequest() {
        val gate = VideoPipPreparation()
        var newest = 0L
        val done = mutableListOf<String>()
        gate.begin { done += "first"; newest = gate.begin { done += "third" } }
        val superseded = gate.begin { done += "second" }
        gate.complete(superseded) { fail("reentrant request superseded") }
        gate.complete(newest) { done += "claim" }
        assertEquals(listOf("first", "second", "claim", "third"), done)
    }
}
