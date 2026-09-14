package dev.browser

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class VideoRegionMessagesTest {
    private fun message(sequence: Int = 1, document: String = "document-1") = JSONObject("""{
      "type":"video-region","documentToken":"$document","videoToken":"video-1","sequence":$sequence,
      "viewport":{"width":1024,"height":780,"visualWidth":1024,"visualHeight":780,"offsetLeft":0,"offsetTop":0,"scale":1},
      "rect":{"x":20,"y":263.2,"width":984,"height":390},"playing":true,"videoWidth":1920,"videoHeight":1080
    }""")

    @Test fun preservesOnlyTypedGeometryAndRequestIdentity() {
        val parsed = parseVideoRegionMessage(message().put("requestId", "request-1").put("watchId", "watch-1"))!!
        assertEquals(263.2, parsed.region!!.rect.y, 0.0)
        assertEquals("request-1", parsed.requestId)
        assertEquals("watch-1", parsed.watchId)
        assertTrue(parsed.region.playing)
    }

    @Test fun wrongTypesAndUnsafeIdentifiersDoNotBecomeCropAuthority() {
        for (json in listOf(message().put("playing", "true"), message().put("sequence", "1"),
                message().put("sequence", 1.5), message().put("sequence", 9_007_199_254_740_992.0),
                message().put("videoWidth", 0), message().put("documentToken", ""),
                message().put("watchId", 1), message().put("videoToken", "x".repeat(129)))) {
            assertNull(json.toString(), parseVideoRegionMessage(json))
        }
    }

    @Test fun pausedVideoStillHasAValidRegionForRemotePause() {
        val region = parseVideoRegionMessage(message().put("playing", false))!!.region!!
        assertFalse(region.playing)
        assertEquals("video-1", region.videoToken)
    }

    @Test fun explicitInvalidationRemovesTheOldRectangle() {
        val channel = VideoRegionChannel()
        channel.accept(parseVideoRegionMessage(message())!!, 100)
        assertNotNull(channel.latest(100))
        val invalid = message(2).put("rect", JSONObject.NULL).put("playing", false)
        assertTrue(channel.accept(parseVideoRegionMessage(invalid)!!, 200))
        assertNull(channel.latest(200))
    }

    @Test fun lateSequenceAndDifferentDocumentCannotRefreshTheCrop() {
        val channel = VideoRegionChannel()
        assertTrue(channel.accept(parseVideoRegionMessage(message(2))!!, 100))
        assertFalse(channel.accept(parseVideoRegionMessage(message(1))!!, 800))
        assertFalse(channel.accept(parseVideoRegionMessage(message(3, "other"))!!, 800))
        assertNotNull(channel.latest(850))
        assertNull(channel.latest(851))
    }

    @Test fun retiringAndBackwardsTimeNeverReturnCachedGeometry() {
        val channel = VideoRegionChannel()
        channel.accept(parseVideoRegionMessage(message())!!, 100)
        assertNull(channel.latest(99))
        channel.invalidate()
        assertNull(channel.latest(100))
    }

    @Test fun aTimedOutRequestCannotRefreshGeometryOrConsumeTheNextSequence() {
        val channel = VideoRegionChannel()
        channel.accept(parseVideoRegionMessage(message())!!, 100)
        val requests = mutableSetOf("request-1")
        requests.remove("request-1") // The native 450ms timeout removed this request.
        val late = parseVideoRegionMessage(message(50).put("requestId", "request-1"))!!
        assertFalse(channel.accept(late, 800, requests))
        assertEquals(1L, channel.latest(850)!!.sequence)
        assertNull(channel.latest(851))
        assertTrue(channel.accept(parseVideoRegionMessage(message(2))!!, 900))
        assertEquals(2L, channel.latest(900)!!.sequence)
    }

    @Test fun oldWatchMessagesCannotRefreshOrReplaceTheActiveWatchGeometry() {
        val channel = VideoRegionChannel()
        val active = parseVideoRegionMessage(message().put("watchId", "watch-2"))!!
        assertTrue(channel.accept(active, 100, watchId = "watch-2"))
        val old = parseVideoRegionMessage(message(50).put("watchId", "watch-1"))!!
        assertFalse(channel.accept(old, 800, watchId = "watch-2"))
        assertFalse(channel.accept(old, 800)) // No active watch also rejects tagged updates.
        assertEquals(1L, channel.latest(850)!!.sequence)
        assertNull(channel.latest(851))
        assertTrue(channel.accept(parseVideoRegionMessage(message(2).put("watchId", "watch-2"))!!, 900, watchId = "watch-2"))
    }

    @Test fun everySuppliedRequestAndWatchIdentityMustMatchBeforeCaching() {
        val channel = VideoRegionChannel()
        val reply = parseVideoRegionMessage(message().put("requestId", "request-1").put("watchId", "watch-1"))!!
        assertFalse(channel.accept(reply, 100, setOf("request-1"), "watch-2"))
        assertFalse(channel.accept(reply, 100, emptySet(), "watch-1"))
        assertNull(channel.documentToken)
        assertNull(channel.latest(100))
        assertTrue(channel.accept(reply, 100, setOf("request-1"), "watch-1"))
        val heartbeat = parseVideoRegionMessage(message(2))!!
        assertTrue(channel.accept(heartbeat, 200))
        assertEquals(2L, channel.latest(200)!!.sequence)
    }
}
