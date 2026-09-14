package dev.browser

import org.junit.Assert.*
import org.junit.Test

class PendingSurfaceAdmissionsTest {
    private class View(var tabId: String, var attached: Boolean = true)
    private class Harness {
        val pending = PendingSurfaceAdmissions<View>()
        var admitted = setOf<String>()
        val bound = mutableListOf<View>()
        val blocked = mutableListOf<String>()
        var clearing = false
        fun mount(view: View) {
            if (!pending.request(view, view.tabId, "https://example.test/${view.tabId}", admitted, clearing) {
                pending.detach(view)
            }) return
            bound.add(view)
        }
        fun reconcile(ids: Set<String>) {
            admitted = ids
            pending.takeAdmitted(ids) { view, id -> view.attached && view.tabId == id }.forEach {
                if (it.requiresResume) blocked.add(it.id) else mount(it.view)
            }
        }
    }

    @Test fun admissionBeforeMountBindsImmediately() {
        val h = Harness()
        val view = View("a")
        h.reconcile(setOf("a"))
        h.mount(view)
        assertEquals(listOf(view), h.bound)
        assertTrue(h.pending.ids().isEmpty())
    }

    @Test fun mountBeforeAdmissionRetriesOnceAfterNativeReconciliation() {
        val h = Harness()
        val view = View("a")
        h.mount(view)
        assertTrue(h.bound.isEmpty())
        h.reconcile(setOf("a"))
        h.reconcile(setOf("a"))
        assertEquals(listOf(view), h.bound)
        assertTrue(h.pending.ids().isEmpty())
    }

    @Test fun anIntermediateOlderSnapshotMustNotDiscardANewerMount() {
        val h = Harness()
        val view = View("new")
        h.mount(view)
        h.reconcile(setOf("old"))
        assertTrue(h.bound.isEmpty())
        h.reconcile(setOf("old", "new"))
        assertEquals(listOf(view), h.bound)
    }

    @Test fun aClosedTabCannotBeOpenedByALateSurface() {
        val h = Harness()
        h.reconcile(setOf("closed"))
        h.reconcile(emptySet())
        h.mount(View("closed"))
        h.reconcile(setOf("another"))
        assertTrue(h.bound.isEmpty())
    }

    @Test fun tabClosureRemovesAnAlreadyQueuedSurface() {
        val h = Harness()
        h.mount(View("closed"))
        h.pending.removeTab("closed")
        h.reconcile(setOf("closed"))
        assertTrue(h.bound.isEmpty())
    }

    @Test fun detachedAndReassignedViewsCannotBeRetried() {
        val h = Harness()
        val detached = View("a")
        val reassigned = View("b")
        val dropped = View("c")
        h.mount(detached)
        h.mount(reassigned)
        h.mount(dropped)
        detached.attached = false
        reassigned.tabId = "other"
        h.pending.detach(dropped)
        h.reconcile(setOf("a", "b", "c"))
        assertTrue(h.bound.isEmpty())
        assertTrue(h.pending.ids().isEmpty())
    }

    @Test fun replacementOfAViewKeepsOnlyItsCurrentTabRequest() {
        val h = Harness()
        val view = View("old")
        h.mount(view)
        view.tabId = "new"
        h.mount(view)
        h.reconcile(setOf("old"))
        assertTrue(h.bound.isEmpty())
        h.reconcile(setOf("old", "new"))
        assertEquals(listOf(view), h.bound)
    }

    @Test fun clearBeforeAdmissionPreservesExplicitResumeAcrossIntermediateSnapshots() {
        val h = Harness()
        h.mount(View("a"))
        h.pending.pauseAll()
        h.reconcile(setOf("old"))
        h.reconcile(setOf("old", "a"))
        assertTrue(h.bound.isEmpty())
        assertEquals(listOf("a"), h.blocked)
    }

    @Test fun mountDuringClearStaysPausedAfterClearHasFinished() {
        val h = Harness()
        val view = View("a")
        h.clearing = true
        h.mount(view)
        h.clearing = false
        h.mount(view) // A duplicate bind must not forget the earlier clear.
        h.reconcile(setOf("a"))
        assertTrue(h.bound.isEmpty())
        assertEquals(listOf("a"), h.blocked)
    }
}
