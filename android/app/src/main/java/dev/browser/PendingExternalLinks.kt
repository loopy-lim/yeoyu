package dev.browser

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import java.io.File
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

/** Intent delivery precedes React startup. Events only wake the durable FIFO reader. */
object PendingExternalLinks {
    private val worker = Executors.newSingleThreadExecutor { Thread(it, "yeoyu-incoming-links").apply { isDaemon = true } }
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var app: Context? = null
    private var queue: PendingLinkQueue? = null
    private val unpersisted = mutableListOf<PendingLink>()
    private val rejectedRecords = mutableListOf<RejectedPendingLink>()

    fun initialize(context: Context) { app = context.applicationContext }

    fun receive(context: Context, intent: Intent?, deliveryId: String) {
        initialize(context)
        if (intent?.action != Intent.ACTION_VIEW) return
        val url = ExternalLinkPolicy.webUri(intent.dataString)
        if (url == null) {
            main.post { GeckoSessionRegistry.emit?.invoke("BrowserExternalLinkFailed", Arguments.createMap().apply {
                putString("requestId", deliveryId); putString("code", "UNSAFE_WEB_ADDRESS")
                putString("error", "External link rejected: only HTTP(S) addresses without credentials are allowed.")
            }) }
            return
        }
        worker.execute {
            if (unpersisted.none { it.id == deliveryId }) unpersisted.add(PendingLink(deliveryId, url))
            try {
                drainUnpersisted()
                main.post { GeckoSessionRegistry.emit?.invoke("BrowserExternalLinksChanged", Arguments.createMap()) }
            } catch (failure: Exception) {
                main.post { GeckoSessionRegistry.emit?.invoke("BrowserExternalLinkFailed", Arguments.createMap().apply {
                    putString("error", "External link could not be saved: ${failure.message}")
                }) }
            }
        }
    }

    private fun store(): PendingLinkQueue = queue ?: PendingLinkQueue(
        File(checkNotNull(app) { "External links are not initialized" }.filesDir, "browser-incoming-links-v1"),
        onRejected = { rejectedRecords.add(it) }
    ).also { queue = it }

    private fun drainUnpersisted() {
        val target = store()
        while (unpersisted.isNotEmpty()) {
            val next = unpersisted.first()
            target.enqueue(next.url, next.id)
            unpersisted.removeAt(0)
        }
    }

    /** Called from the native module queue, never Android's UI thread. */
    fun pendingJson(): String = worker.submit<String> {
        drainUnpersisted()
        // JS calls pendingJson after installing its listeners. A migration may have
        // run during Activity startup, so keep its notices until this live read.
        val notices = rejectedRecords.toList()
        rejectedRecords.clear()
        notices.forEach { record -> main.post {
            GeckoSessionRegistry.emit?.invoke("BrowserExternalLinkFailed", Arguments.createMap().apply {
                putString("requestId", record.id); putString("code", record.reason)
                putString("quarantineFile", record.quarantineFile)
                putString("error", "A saved external link was rejected (${record.reason}) and quarantined as ${record.quarantineFile}. Other links can still open.")
            })
        } }
        JSONArray().apply { store().pending().forEach { link ->
            put(JSONObject().put("id", link.id).put("url", link.url))
        } }.toString()
    }.get()

    fun acknowledge(id: String) {
        worker.submit { store().acknowledge(id) }.get()
    }

    /** Called from the native module queue. Notices remain deferred to a live pendingJson read. */
    fun reject(id: String) {
        worker.submit { store().reject(id) }.get()
        main.post { GeckoSessionRegistry.emit?.invoke("BrowserExternalLinksChanged", Arguments.createMap()) }
    }
}
