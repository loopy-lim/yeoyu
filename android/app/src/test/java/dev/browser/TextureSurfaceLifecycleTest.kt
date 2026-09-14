package dev.browser

import org.junit.Assert.*
import org.junit.Test

class TextureSurfaceLifecycleTest {
    @Test fun ordinaryFramesDoNotRecreateAnAvailableSurface() {
        val lifecycle = TextureSurfaceLifecycle()
        var publications = 0
        lifecycle.available { publications++ }
        repeat(120) { lifecycle.updated { publications++ } }
        assertEquals(1, publications)
    }

    @Test fun explicitRecoveryPublishesOnlyOneReplacement() {
        val lifecycle = TextureSurfaceLifecycle()
        var replacements = 0
        lifecycle.requestRefresh()
        repeat(120) { lifecycle.updated { replacements++ } }
        assertEquals(1, replacements)
    }

    @Test fun resizingKeepsThePendingReplacementAndStillPublishesItsSize() {
        val lifecycle = TextureSurfaceLifecycle()
        val events = mutableListOf<String>()
        lifecycle.requestRefresh()
        lifecycle.sizeChanged { events.add("size:800x600") }
        lifecycle.updated { events.add("replacement") }
        lifecycle.updated { events.add("unexpected-frame") }
        assertEquals(listOf("size:800x600", "replacement"), events)
    }

    @Test fun newlyAvailableSurfaceSatisfiesAnOlderRecoveryRequest() {
        val lifecycle = TextureSurfaceLifecycle()
        val events = mutableListOf<String>()
        lifecycle.requestRefresh()
        lifecycle.available { events.add("new-surface") }
        lifecycle.updated { events.add("redundant-replacement") }
        assertEquals(listOf("new-surface"), events)
    }

    @Test fun destructionPreservesOwnershipAndDropsThePendingReplacement() {
        for (releaseByAndroid in listOf(false, true)) {
            val lifecycle = TextureSurfaceLifecycle()
            lifecycle.requestRefresh()
            var destroys = 0
            assertEquals(releaseByAndroid, lifecycle.destroyed {
                destroys++
                releaseByAndroid
            })
            var replacements = 0
            lifecycle.updated { replacements++ }
            assertEquals(1, destroys)
            assertEquals(0, replacements)
        }
    }

    @Test fun recoveryRequestedWhilePublishingIsNotLost() {
        val lifecycle = TextureSurfaceLifecycle()
        var replacements = 0
        lifecycle.requestRefresh()
        lifecycle.updated {
            replacements++
            lifecycle.requestRefresh()
        }
        lifecycle.updated { replacements++ }
        lifecycle.updated { replacements++ }
        assertEquals(2, replacements)
    }

    @Test fun recoveryRequestedByInitialPublicationIsNotLost() {
        val lifecycle = TextureSurfaceLifecycle()
        lifecycle.available { lifecycle.requestRefresh() }
        var replacements = 0
        lifecycle.updated { replacements++ }
        lifecycle.updated { replacements++ }
        assertEquals(1, replacements)
    }

    @Test fun detachThenAttachPublishesTheNewSurfaceWithoutFrameResumes() {
        val lifecycle = TextureSurfaceLifecycle()
        val events = mutableListOf<String>()
        lifecycle.available { events.add("first") }
        lifecycle.requestRefresh()
        lifecycle.destroyed { events.add("destroy"); false }
        lifecycle.available { events.add("reattached") }
        lifecycle.updated { events.add("unexpected-frame") }
        assertEquals(listOf("first", "destroy", "reattached"), events)
    }
}
