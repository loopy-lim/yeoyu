package dev.browser

import org.junit.Assert.*
import org.junit.Test

class ReturnCoverPolicyTest {
    private val a = ReturnCoverTarget("a", Any(), Any(), 2)
    private val b = ReturnCoverTarget("b", Any(), Any(), 7)
    private val ownerA = Any()
    private val ownerB = Any()
    private fun begin(p: ReturnCoverPolicy, targets: List<ReturnCoverTarget> = listOf(a, b), now: Long = 100) =
        p.begin(41, targets, now).also { assertNotNull("valid return must reserve", it) }!!
    private fun bind(p: ReturnCoverPolicy, t: ReturnCoverPolicy.Ticket, target: ReturnCoverTarget, owner: Any, now: Long = 120): ReturnCoverPolicy.Layout {
        assertTrue(p.attached(t, target, owner, now))
        return p.layoutApplied(t, target, owner, 1444, 1765, now).also { assertNotNull(it) }!!
    }
    private fun observation(target: ReturnCoverTarget, owner: Any, layout: ReturnCoverPolicy.Layout) =
        ReturnCoverPolicy.Observation(target, owner, layout)

    @Test fun `one incoming frame does not expose the other blank pane`() {
        val p = ReturnCoverPolicy(); val t = begin(p)
        assertTrue(p.captured(t, 110))
        val la = bind(p, t, a, ownerA); val lb = bind(p, t, b, ownerB)
        assertTrue(p.frame(t, a, ownerA, la, 130))
        assertFalse(p.reveal(t, listOf(observation(a, ownerA, la), observation(b, ownerB, lb)), 131))
        assertTrue(p.displayed)
        assertTrue(p.frame(t, b, ownerB, lb, 140))
        assertTrue("frame readiness waits for pre-draw reveal", p.displayed)
        assertFalse(p.reveal(t, listOf(observation(a, ownerA, la)), 141))
        assertTrue(p.reveal(t, listOf(observation(a, ownerA, la), observation(b, ownerB, lb)), 142))
        assertFalse(p.displayed); assertNull(p.current)
    }
    @Test fun `returned video can paint before the remounted partner`() {
        val p = ReturnCoverPolicy(); val t = begin(p); assertTrue(p.captured(t, 110))
        val lb = bind(p, t, b, ownerB)
        assertTrue(p.frame(t, b, ownerB, lb, 125))
        assertFalse(p.reveal(t, listOf(observation(b, ownerB, lb)), 126))
        val la = bind(p, t, a, ownerA, 130)
        assertTrue(p.frame(t, a, ownerA, la, 140))
        assertTrue(p.reveal(t, listOf(observation(b, ownerB, lb), observation(a, ownerA, la)), 141))
    }
    @Test fun `one destination remains bounded without inventing a second pane`() {
        val p = ReturnCoverPolicy(); val t = begin(p, listOf(a)); assertTrue(p.captured(t, 110))
        val la = bind(p, t, a, ownerA); assertTrue(p.frame(t, a, ownerA, la, 125))
        assertTrue(p.reveal(t, listOf(observation(a, ownerA, la)), 126))
    }
    @Test fun `invalid or ambiguous target lists cannot start a cover`() {
        val p = ReturnCoverPolicy()
        for (targets in listOf(emptyList(), listOf(a, b, ReturnCoverTarget("c", Any(), Any(), 1)),
            listOf(a, a), listOf(a, b.copy(entry = a.entry)), listOf(a, b.copy(session = a.session)),
            listOf(a.copy(tab = " ")))) {
            assertNull(p.begin(41, targets, 100)); assertNull(p.current)
        }
        assertNull(p.begin(0, listOf(a), 100)); assertFalse(p.displayed)
    }
    @Test fun `same tab with replaced entry session or document cannot satisfy readiness`() {
        val p = ReturnCoverPolicy(); val t = begin(p, listOf(a)); assertTrue(p.captured(t, 110))
        val la = bind(p, t, a, ownerA)
        for (wrong in listOf(a.copy(entry = Any()), a.copy(session = Any()), a.copy(document = 3))) {
            assertFalse(p.attached(t, wrong, ownerA, 121))
            assertFalse(p.frame(t, wrong, ownerA, la, 122))
        }
        assertTrue(p.frame(t, a, ownerA, la, 125))
        assertFalse(p.reveal(t, listOf(observation(a.copy(document = 3), ownerA, la)), 126))
        assertTrue(p.displayed)
        assertTrue(p.reveal(t, listOf(observation(a, ownerA, la)), 127))
    }
    @Test fun `owner identity uses exact reference rather than value equality`() {
        data class Handle(val value: Int)
        val owner = Handle(1); val equalOwner = Handle(1)
        val p = ReturnCoverPolicy(); val t = begin(p, listOf(a)); assertTrue(p.captured(t, 110))
        val la = bind(p, t, a, owner)
        assertFalse(p.attached(t, a, equalOwner, 121))
        assertFalse(p.frame(t, a, equalOwner, la, 122))
        assertTrue(p.frame(t, a, owner, la, 125))
        assertFalse(p.reveal(t, listOf(observation(a, equalOwner, la)), 126))
        assertTrue(p.reveal(t, listOf(observation(a, owner, la)), 127))
    }
    @Test fun `entry and session identity also reject equal replacement objects`() {
        data class Handle(val value: Int)
        val target = ReturnCoverTarget("a", Handle(1), Handle(2), 2)
        val p = ReturnCoverPolicy(); val t = begin(p, listOf(target)); assertTrue(p.captured(t, 110))
        val la = bind(p, t, target, ownerA)
        assertFalse(p.frame(t, target.copy(entry = Handle(1)), ownerA, la, 125))
        assertFalse(p.frame(t, target.copy(session = Handle(2)), ownerA, la, 126))
        assertTrue(p.frame(t, target, ownerA, la, 127))
    }
    @Test fun `attachment and old layout evidence before capture cannot reveal`() {
        val p = ReturnCoverPolicy(); val old = begin(p, listOf(a), 0); assertTrue(p.captured(old, 1))
        val oldLayout = bind(p, old, a, ownerA, 2)
        val t = begin(p, listOf(a), 100)
        assertFalse(p.attached(t, a, ownerA, 101))
        assertTrue(p.captured(t, 110)); assertTrue(p.attached(t, a, ownerA, 120))
        assertFalse(p.frame(t, a, ownerA, oldLayout, 121))
        assertFalse(p.reveal(t, listOf(observation(a, ownerA, oldLayout)), 122))
        val la = p.layoutApplied(t, a, ownerA, 1444, 1765, 123)!!
        assertTrue(p.frame(t, a, ownerA, la, 124))
        assertTrue(p.reveal(t, listOf(observation(a, ownerA, la)), 125))
    }
    @Test fun `resize after one painted frame resets only that target readiness`() {
        val p = ReturnCoverPolicy(); val t = begin(p); assertTrue(p.captured(t, 110))
        val la = bind(p, t, a, ownerA); val lb = bind(p, t, b, ownerB)
        assertTrue(p.frame(t, a, ownerA, la, 130)); assertTrue(p.frame(t, b, ownerB, lb, 131))
        val nextA = p.layoutApplied(t, a, ownerA, 1515, 1765, 140)!!
        assertFalse(p.frame(t, a, ownerA, la, 141))
        assertFalse(p.reveal(t, listOf(observation(a, ownerA, nextA), observation(b, ownerB, lb)), 142))
        assertTrue(p.frame(t, a, ownerA, nextA, 143))
        assertFalse("pre-draw must present the same geometry epoch", p.reveal(t, listOf(observation(a, ownerA, la), observation(b, ownerB, lb)), 144))
        assertTrue(p.reveal(t, listOf(observation(a, ownerA, nextA), observation(b, ownerB, lb)), 145))
    }
    @Test fun `zero size invalidates a previously ready layout`() {
        val p = ReturnCoverPolicy(); val t = begin(p, listOf(a)); assertTrue(p.captured(t, 110))
        val la = bind(p, t, a, ownerA); assertTrue(p.frame(t, a, ownerA, la, 130))
        assertNull(p.layoutApplied(t, a, ownerA, 0, 1765, 140))
        assertFalse(p.reveal(t, listOf(observation(a, ownerA, la)), 141))
    }
    @Test fun `new return ignores old copy frame cancellation and deadline`() {
        val p = ReturnCoverPolicy(); val old = begin(p, listOf(a), 0); assertTrue(p.captured(old, 1))
        val oldLayout = bind(p, old, a, ownerA, 2)
        val t = begin(p, listOf(b), 100); assertTrue(p.captured(t, 110)); val lb = bind(p, t, b, ownerB)
        assertFalse(p.captured(old, 121)); assertFalse(p.frame(old, a, ownerA, oldLayout, 122))
        assertFalse(p.cancel(old)); assertFalse(p.expire(old, 500)); assertSame(t, p.current)
        assertTrue(p.frame(t, b, ownerB, lb, 501)); assertTrue(p.reveal(t, listOf(observation(b, ownerB, lb)), 502))
    }
    @Test fun `duplicate copy cannot reset an installed cover`() {
        val p = ReturnCoverPolicy(); val t = begin(p, listOf(a)); assertTrue(p.captured(t, 110))
        val la = bind(p, t, a, ownerA); assertTrue(p.frame(t, a, ownerA, la, 130))
        assertFalse(p.captured(t, 140))
        assertTrue(p.reveal(t, listOf(observation(a, ownerA, la)), 141))
    }
    @Test fun `absolute deadline includes copy and is not reset by layout or frame`() {
        val p = ReturnCoverPolicy(); val t = begin(p, listOf(a), 100)
        assertTrue(p.captured(t, 550)); val la = bind(p, t, a, ownerA, 580)
        assertFalse(p.expire(t, 599)); assertTrue(p.frame(t, a, ownerA, la, 599))
        assertFalse(p.reveal(t, listOf(observation(a, ownerA, la)), 600))
        assertNull(p.current); assertFalse(p.displayed)
    }
    @Test fun `late copy reaches the original deadline without publishing pixels`() {
        val p = ReturnCoverPolicy(); val t = begin(p, listOf(a), 100)
        assertFalse(p.captured(t, 600)); assertNull(p.current); assertFalse(p.displayed)
    }
    @Test fun `cancel is exact once and late copy cannot revive closed targets`() {
        val p = ReturnCoverPolicy(); val t = begin(p)
        assertTrue(p.cancel(t)); assertFalse(p.cancel(t)); assertFalse(p.captured(t, 110))
        assertFalse(p.attached(t, a, ownerA, 120)); assertNull(p.current)
    }
    @Test fun `native return snapshot cleanup cannot clear the policy owned paint wait`() {
        // The native caller may clear its return bookkeeping after ACK/adoption.
        // The policy must own its target snapshot, rather than consult that list again.
        val nativeTargets = mutableListOf(a, b)
        val p = ReturnCoverPolicy(); val t = begin(p, nativeTargets); assertTrue(p.captured(t, 110))
        nativeTargets.clear()
        val lb = bind(p, t, b, ownerB) // Same video may have been adopted and its parked lease removed.
        assertTrue(p.frame(t, b, ownerB, lb, 130)); assertTrue(p.displayed)
        val la = bind(p, t, a, ownerA, 140)
        assertTrue(p.frame(t, a, ownerA, la, 150))
        assertTrue(p.reveal(t, listOf(observation(a, ownerA, la), observation(b, ownerB, lb)), 151))
    }

    @Test fun `install precedes publication and duplicate copy cannot repeat either`() {
        val events = mutableListOf<String>()
        val preparation = VideoPipPreparation()
        val ticket = preparation.begin { events += "published" }
        val publication = CoverPublication { install -> preparation.complete(ticket, install) }
        assertTrue(publication.complete { events += "installed" })
        assertFalse(publication.complete { events += "late-install" })
        assertEquals(listOf("installed", "published"), events)
    }
    @Test fun `cancelled preparation never installs its late copied pixels`() {
        val events = mutableListOf<String>()
        val preparation = VideoPipPreparation()
        val ticket = preparation.begin { events += "old-published" }
        val publication = CoverPublication { install -> preparation.complete(ticket, install) }
        val next = preparation.begin { events += "new-published" }
        assertFalse(publication.complete { events += "stale-installed" })
        preparation.complete(next)
        assertEquals(listOf("old-published", "new-published"), events)
    }
    @Test fun `copy failure and late success publish exactly once`() {
        val events = mutableListOf<String>()
        val preparation = VideoPipPreparation()
        val ticket = preparation.begin { events += "published" }
        val publication = CoverPublication { install -> preparation.complete(ticket, install) }
        publication.complete()
        assertFalse(publication.complete { events += "late-installed" })
        assertEquals(listOf("published"), events)
    }
    @Test fun `installation failure still publishes and closes its continuation`() {
        var published = 0
        val preparation = VideoPipPreparation()
        val ticket = preparation.begin { published++ }
        val publication = CoverPublication { install -> preparation.complete(ticket, install) }
        try { publication.complete { throw IllegalStateException("overlay rejected") }; fail() }
        catch (_: IllegalStateException) { }
        assertEquals(1, published)
        assertFalse(publication.complete { fail("late copy") })
    }
    @Test fun `reentrant install cannot publish or install twice`() {
        var published = 0; var installs = 0
        val publication = CoverPublication { install -> try { install() } finally { published++ } }
        assertTrue(publication.complete { installs++; assertFalse(publication.complete { installs++ }) })
        assertEquals(1, published); assertEquals(1, installs)
    }
    @Test fun `both incoming web areas must fit the copied source without overlap`() {
        val source = SpaceCoverRect(100, 50, 1100, 850)
        assertTrue(returnCoverFramesFit(source, listOf(SpaceCoverRect(100, 90, 595, 850), SpaceCoverRect(605, 90, 1100, 850))))
        assertTrue(returnCoverFramesFit(source, listOf(SpaceCoverRect(100, 80, 1100, 435), SpaceCoverRect(100, 445, 1100, 850))))
        assertFalse(returnCoverFramesFit(source, listOf(SpaceCoverRect(99, 90, 595, 850), SpaceCoverRect(605, 90, 1100, 850))))
        assertFalse(returnCoverFramesFit(source, listOf(SpaceCoverRect(100, 90, 700, 850), SpaceCoverRect(605, 90, 1100, 850))))
        assertFalse(returnCoverFramesFit(source, listOf(SpaceCoverRect(100, 90, 100, 850), SpaceCoverRect(605, 90, 1100, 850))))
        assertFalse(returnCoverFramesFit(source, emptyList()))
    }

    @Test fun `single return must exactly cover the former content bounds`() {
        val source = SpaceCoverRect(100, 50, 1100, 850)
        assertTrue(returnCoverFramesFit(source, listOf(source)))
        assertFalse(returnCoverFramesFit(source, listOf(SpaceCoverRect(101, 50, 1101, 850))))
        assertFalse(returnCoverFramesFit(source, listOf(SpaceCoverRect(101, 50, 1100, 850))))
        assertFalse(returnCoverFramesFit(source, listOf(SpaceCoverRect(100, 51, 1100, 850))))
        assertFalse(returnCoverFramesFit(source, listOf(source, source, source)))
    }
    @Test fun `single return late copy still publishes without installing expired pixels`() {
        val p = ReturnCoverPolicy(); val ticket = begin(p, listOf(a), 100)
        val preparation = VideoPipPreparation()
        var published = 0; var installed = 0
        val bridge = preparation.begin { published++ }
        val publication = CoverPublication { install -> preparation.complete(bridge, install) }
        publication.complete { if (p.captured(ticket, 600)) installed++ }
        assertEquals(0, installed); assertEquals(1, published)
        assertFalse(p.displayed); assertFalse(publication.complete { installed++ })
    }
}
