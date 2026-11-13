package dev.browser

import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import org.json.JSONObject
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.WebExtension
import java.io.IOException
import java.util.IdentityHashMap
import java.util.UUID

/** Native coordinator for the built-in Reader Mode content script. Main thread only. */
internal object BrowserReaderMode {
    private const val EXTENSION_ID = "reader-mode@yeoyu"
    private const val NATIVE_APP = "yeoyu_reader"
    private const val TOGGLE_TIMEOUT_MS = 4_000L

    private val main = Handler(Looper.getMainLooper())
    private val bindings = IdentityHashMap<GeckoSession, Binding>()
    private var extension: WebExtension? = null
    private var initializing = false
    private var currentStyle = ReaderStyle()

    private class Binding(
        val tabId: String,
        val session: GeckoSession,
        val current: () -> Boolean,
        val generation: () -> Long,
    ) {
        var port: WebExtension.Port? = null
        var documentToken: String? = null
        var documentGeneration: Long = -1L
        var state: ReaderTabState = ReaderTabState()
        val pendingRequests = linkedMapOf<String, PendingToggle>()
    }

    private class PendingToggle(
        val reply: (Result<Boolean>) -> Unit,
        val timeout: Runnable,
    )

    fun initialize(runtime: GeckoRuntime) {
        if (initializing || extension != null) return
        initializing = true
        runtime.webExtensionController
            .ensureBuiltIn("resource://android/assets/yeoyu-reader/", EXTENSION_ID)
            .accept({ installed ->
                fun ready(value: WebExtension?) {
                    initializing = false
                    extension = value
                    if (value != null) {
                        bindings.values.toList().forEach { attachDelegate(it, value) }
                    }
                }
                if (installed == null || installed.id != EXTENSION_ID || !installed.isBuiltIn) {
                    ready(null)
                } else {
                    runtime.webExtensionController
                        .setAllowedInPrivateBrowsing(installed, true)
                        .accept({ allowed -> ready(allowed) }, { ready(installed) })
                }
            }, {
                initializing = false
            })
    }

    fun bind(tabId: String, session: GeckoSession, current: () -> Boolean, generation: () -> Long) {
        retire(session)
        val binding = Binding(tabId, session, current, generation)
        bindings[session] = binding
        extension?.let { attachDelegate(binding, it) }
    }

    private fun attachDelegate(binding: Binding, installed: WebExtension) {
        binding.session.webExtensionController.setMessageDelegate(installed, object : WebExtension.MessageDelegate {
            override fun onConnect(port: WebExtension.Port) {
                val sender = port.sender
                if (bindings[binding.session] !== binding ||
                    !binding.current() ||
                    port.name != NATIVE_APP ||
                    sender.session !== binding.session ||
                    sender.webExtension.id != EXTENSION_ID ||
                    !sender.isTopLevel ||
                    sender.environmentType != WebExtension.MessageSender.ENV_TYPE_CONTENT_SCRIPT ||
                    !isEligibleReaderUrl(sender.url)
                ) {
                    port.disconnect()
                    return
                }
                if (binding.port !== port) {
                    runCatching { binding.port?.disconnect() }
                    binding.port = port
                    binding.documentToken = null
                    binding.documentGeneration = binding.generation()
                }
                port.setDelegate(object : WebExtension.PortDelegate {
                    override fun onPortMessage(message: Any, p: WebExtension.Port) {
                        if (p === binding.port) receive(binding, p, message)
                    }
                    override fun onDisconnect(p: WebExtension.Port) {
                        if (p === binding.port) {
                            binding.port = null
                            failPending(binding, IOException("Reader page disconnected"))
                        }
                    }
                })
            }
        }, NATIVE_APP)
    }

    private fun receive(binding: Binding, port: WebExtension.Port, raw: Any) {
        if (bindings[binding.session] !== binding || !binding.current()) {
            runCatching { port.disconnect() }
            return
        }
        val obj = raw as? JSONObject ?: return
        if (obj.optString("type") != "reader-state") return
        val token = obj.optString("documentToken").takeIf { it.isNotEmpty() } ?: return
        val url = obj.optString("url")
        if (!isEligibleReaderUrl(url)) return

        val gen = binding.generation()
        if (binding.documentToken == null || binding.documentGeneration != gen) {
            binding.documentToken = token
            binding.documentGeneration = gen
            runCatching {
                port.postMessage(JSONObject().apply {
                    put("type", "connected")
                    put("documentToken", token)
                    put("style", currentStyle.toJson())
                })
            }
        } else if (binding.documentToken != token) {
            binding.documentToken = token
        }

        val nextState = ReaderTabState(
            readerable = obj.optBoolean("readerable", false),
            active = obj.optBoolean("active", false),
        )
        if (nextState != binding.state) {
            binding.state = nextState
            emitState(binding)
        }

        val requestId = obj.optString("requestId").takeIf { it.isNotEmpty() }
        if (requestId != null) {
            val pending = binding.pendingRequests.remove(requestId)
            if (pending != null) {
                main.removeCallbacks(pending.timeout)
                if (obj.optBoolean("ok", true)) {
                    pending.reply(Result.success(nextState.active))
                } else {
                    pending.reply(Result.failure(IllegalStateException(obj.optString("error", "unreadable"))))
                }
            }
        }
    }

    fun navigationStarted(session: GeckoSession) {
        val binding = bindings[session] ?: return
        failPending(binding, IllegalStateException("Navigation interrupted reader mode"))
        binding.documentToken = null
        binding.documentGeneration = binding.generation()
        if (binding.state.readerable || binding.state.active) {
            binding.state = ReaderTabState(readerable = false, active = false)
            emitState(binding)
        }
    }

    fun locationChanged(session: GeckoSession, url: String?) {
        val binding = bindings[session] ?: return
        if (!isEligibleReaderUrl(url)) {
            if (binding.state.readerable || binding.state.active) {
                binding.state = ReaderTabState(readerable = false, active = false)
                emitState(binding)
            }
            return
        }
        val port = binding.port ?: return
        runCatching {
            port.postMessage(JSONObject().apply {
                put("type", "check-readerable")
                put("style", currentStyle.toJson())
            })
        }
    }

    fun pageStopped(session: GeckoSession, url: String?) {
        locationChanged(session, url)
    }

    fun retire(session: GeckoSession) {
        val binding = bindings.remove(session) ?: return
        failPending(binding, IllegalStateException("Tab was closed"))
        runCatching { binding.port?.disconnect() }
        binding.port = null
    }

    fun setReaderMode(tabId: String, enabled: Boolean, reply: (Result<Boolean>) -> Unit) {
        val binding = bindings.values.firstOrNull { it.tabId == tabId && it.current() }
        if (binding == null) {
            reply(Result.failure(IllegalStateException("Tab is unavailable")))
            return
        }
        val port = binding.port
        if (port == null) {
            reply(Result.failure(IllegalStateException("Reader mode is not ready for this page")))
            return
        }
        val requestId = UUID.randomUUID().toString()
        val timeout = Runnable {
            val pending = binding.pendingRequests.remove(requestId)
            pending?.reply(Result.failure(IOException("Reader mode request timed out")))
        }
        binding.pendingRequests[requestId] = PendingToggle(reply, timeout)
        main.postDelayed(timeout, TOGGLE_TIMEOUT_MS)
        try {
            port.postMessage(JSONObject().apply {
                put("type", "set-reader-mode")
                put("requestId", requestId)
                put("enabled", enabled)
                put("style", currentStyle.toJson())
            })
        } catch (error: Exception) {
            binding.pendingRequests.remove(requestId)
            main.removeCallbacks(timeout)
            reply(Result.failure(error))
        }
    }

    fun configureStyle(json: String) {
        val parsed = parseReaderStyle(json) ?: return
        currentStyle = parsed
        broadcastStyle()
    }

    fun updateTextScale(textScale: Double) {
        val nextFont = fontSizeForTextScale(textScale)
        if (currentStyle.fontSizePx == nextFont) return
        currentStyle = currentStyle.copy(fontSizePx = nextFont)
        broadcastStyle()
    }

    fun stateFor(tabId: String): ReaderTabState? =
        bindings.values.firstOrNull { it.tabId == tabId && it.current() }?.state

    private fun broadcastStyle() {
        val payload = JSONObject().apply {
            put("type", "update-reader-style")
            put("style", currentStyle.toJson())
        }
        bindings.values.forEach { binding ->
            if (binding.current()) {
                binding.port?.let { port -> runCatching { port.postMessage(payload) } }
            }
        }
    }

    private fun failPending(binding: Binding, failure: Throwable) {
        if (binding.pendingRequests.isEmpty()) return
        val items = binding.pendingRequests.values.toList()
        binding.pendingRequests.clear()
        items.forEach { item ->
            main.removeCallbacks(item.timeout)
            item.reply(Result.failure(failure))
        }
    }

    private fun emitState(binding: Binding) {
        if (!binding.current()) return
        GeckoSessionRegistry.emit?.invoke("BrowserReaderState", Arguments.createMap().apply {
            putString("tabId", binding.tabId)
            putBoolean("readerable", binding.state.readerable)
            putBoolean("active", binding.state.active)
        })
    }
}
