package dev.browser

import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.util.Base64
import org.mozilla.geckoview.Image
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

/** Extension icons reach React as PNG data URIs; Gecko owns the source bitmaps.
 * Failed or missing icons stay empty and the interface falls back to letter
 * tiles, so an unreadable icon never blocks the action itself. */
internal object BrowserExtensionIcons {
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val cache = HashMap<String, String>()
    private const val MAX_EDGE = 64

    fun cached(key: String): String = synchronized(cache) { cache[key] ?: "" }

    /** One load per key; a failed fetch is remembered as absent until forget(). */
    fun load(key: String, icon: Image?, onReady: () -> Unit) {
        if (icon == null) return
        synchronized(cache) { if (cache.containsKey(key)) return }
        synchronized(cache) { cache[key] = "" }
        io.execute {
            val done = { data: String ->
                main.post {
                    synchronized(cache) { if (data.isNotEmpty()) cache[key] = data }
                    onReady()
                }
            }
            try {
                icon.getBitmap(MAX_EDGE).accept({ bitmap -> done(encode(bitmap)) }, { done("") })
            } catch (_: Exception) { done("") }
        }
    }

    fun forget(id: String) {
        synchronized(cache) {
            cache.remove(id)
            cache.remove(actionKey(id))
        }
    }

    fun actionKey(id: String) = "action:$id"

    private fun encode(bitmap: Bitmap?): String {
        bitmap ?: return ""
        return try {
            val output = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)
            "data:image/png;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
        } catch (_: Exception) {
            ""
        }
    }
}
