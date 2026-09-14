package dev.browser

import org.json.JSONObject

internal data class VideoRegionMessage(
    val documentToken: String,
    val sequence: Long,
    val region: VideoRegion?,
    val requestId: String?,
    val watchId: String?,
)

/** Only geometry crosses this bridge; media URLs, page text and file data do not. */
internal fun parseVideoRegionMessage(value: JSONObject): VideoRegionMessage? = runCatching {
    require(value.get("type") == "video-region")
    fun token(json: JSONObject, name: String): String = (json.get(name) as String).also {
        require(it.isNotBlank() && it.length <= 128)
    }
    fun number(json: JSONObject, name: String): Double = (json.get(name) as Number).toDouble().also {
        require(it.isFinite())
    }
    fun optionalToken(name: String): String? = if (value.has(name) && !value.isNull(name)) token(value, name) else null
    val document = token(value, "documentToken")
    val sequence = number(value, "sequence")
    require(sequence in 1.0..9_007_199_254_740_991.0 && sequence == sequence.toLong().toDouble())
    val region = if (value.get("rect") === JSONObject.NULL) null else {
        val box = value.getJSONObject("rect")
        val viewport = value.getJSONObject("viewport")
        val videoWidth = number(value, "videoWidth")
        val videoHeight = number(value, "videoHeight")
        require(videoWidth in 1.0..Int.MAX_VALUE.toDouble() && videoWidth == videoWidth.toInt().toDouble())
        require(videoHeight in 1.0..Int.MAX_VALUE.toDouble() && videoHeight == videoHeight.toInt().toDouble())
        VideoRegion(document, token(value, "videoToken"), sequence.toLong(),
            VideoViewport(number(viewport, "width"), number(viewport, "height"),
                number(viewport, "visualWidth"), number(viewport, "visualHeight"),
                number(viewport, "offsetLeft"), number(viewport, "offsetTop"), number(viewport, "scale")),
            VideoCssRect(number(box, "x"), number(box, "y"), number(box, "width"), number(box, "height")),
            value.get("playing") as Boolean, videoWidth.toInt(), videoHeight.toInt())
    }
    VideoRegionMessage(document, sequence.toLong(), region, optionalToken("requestId"), optionalToken("watchId"))
}.getOrNull()

/** One content document per native port. A late message cannot refresh another document's crop. */
internal class VideoRegionChannel {
    var documentToken: String? = null; private set
    private var sequence = 0L
    private var region: VideoRegion? = null
    private var receivedAt = 0L

    fun accept(message: VideoRegionMessage, now: Long, requestIds: Set<String> = emptySet(), watchId: String? = null): Boolean {
        if ((message.requestId != null && message.requestId !in requestIds) ||
            (message.watchId != null && message.watchId != watchId)) return false
        if ((documentToken != null && documentToken != message.documentToken) || message.sequence <= sequence) return false
        documentToken = message.documentToken
        sequence = message.sequence
        region = message.region
        receivedAt = now
        return true
    }

    fun latest(now: Long): VideoRegion? = region?.takeIf { now >= receivedAt && now - receivedAt <= 750L }
    fun invalidate() { region = null }
}
