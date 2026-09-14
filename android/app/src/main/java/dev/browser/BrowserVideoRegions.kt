package dev.browser

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import org.json.JSONObject
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.WebExtension
import java.util.IdentityHashMap
import java.util.UUID

internal class VideoRegionWatchSubscription(
    private val onPinned: (Boolean) -> Unit,
    private val onCancel: () -> Unit,
) {
    fun setPinned(value: Boolean) = onPinned(value)
    fun cancel() = onCancel()
}

/** Geometry from our bundled content script, bound to one live session/document/port. Main thread only. */
internal object BrowserVideoRegions {
    private const val EXTENSION_ID = "video-pip@yeoyu"
    private const val NATIVE_APP = "yeoyu_video"
    private val main = Handler(Looper.getMainLooper())
    private val bindings = IdentityHashMap<GeckoSession, Binding>()
    private var extension: WebExtension? = null
    private var initializing = false
    private var diagnostics = false
    private fun diagnosticSession(session: GeckoSession) = diagnostics && !session.settings.usePrivateMode

    internal fun tracePixelRejection(session: GeckoSession, region: VideoRegion,
        width: Int, height: Int, matrix: FloatArray) {
        if (diagnosticSession(session)) Log.d("YeoyuVideoRegion", "pixels-rejected session=${System.identityHashCode(session)}" +
            " source=${width}x$height viewport=${region.viewport} rect=${region.rect} matrix=${matrix.joinToString()}")
    }

    private class Binding(val session: GeckoSession, val current: () -> Boolean, val generation: () -> Long) {
        var peer: Peer? = null
        val candidates = LinkedHashSet<Peer>()
        val retiredDocuments = LinkedHashSet<String>()
        val recoveries = LinkedHashSet<Recovery>()
    }
    private class Peer(val binding: Binding, val port: WebExtension.Port, val generation: Long) {
        val channel = VideoRegionChannel()
        val requests = linkedMapOf<String, Request>()
        var watch: Watch? = null
        var handshakeTimeout: Runnable? = null
    }
    private class Request(val callback: (VideoRegion?) -> Unit, val timeout: Runnable, val canRecover: Boolean)
    private class Recovery(val generation: Long, val document: String?,
        val callback: (VideoRegion?) -> Unit, val timeout: Runnable)
    private class Watch(val id: String, val region: VideoRegion, val callback: (VideoRegion?) -> Unit) {
        val policy = VideoRegionWatchPolicy(SystemClock.elapsedRealtime())
        var expiry: Runnable? = null
    }

    private fun traceWatch(peer: Peer, watch: Watch, event: String, detail: String = "") {
        if (!diagnosticSession(peer.binding.session)) return
        Log.d("YeoyuVideoRegion", "watch-$event generation=${peer.generation}" +
            " session=${System.identityHashCode(peer.binding.session)} watch=${System.identityHashCode(watch)}" +
            " ageMs=${SystemClock.elapsedRealtime() - watch.policy.startedAt}" +
            " acknowledged=${watch.policy.acknowledged} timer=${watch.policy.timerGeneration}" +
            " deadline=${watch.policy.deadlineAt} detail=$detail")
    }

    fun initialize(runtime: GeckoRuntime, diagnostics: Boolean = false) {
        if (initializing || extension != null) return
        this.diagnostics = diagnostics
        initializing = true
        if (diagnostics) Log.d("YeoyuVideoRegion", "extension-install-start")
        runtime.webExtensionController.ensureBuiltIn("resource://android/assets/yeoyu-video/", EXTENSION_ID).accept({ installed ->
            fun ready(value: WebExtension?) {
                initializing = false
                extension = value
                if (diagnostics) Log.d("YeoyuVideoRegion", "extension-install-ready=${value != null}")
                if (value != null) bindings.values.toList().forEach { attachDelegate(it, value) }
            }
            // Only our packaged observer gets private access; no user extension is changed.
            if (installed == null || installed.id != EXTENSION_ID || !installed.isBuiltIn) {
                ready(null)
                bindings.values.toList().forEach(::invalidate)
            } else {
                runtime.webExtensionController.setAllowedInPrivateBrowsing(installed, true).accept({ allowed ->
                    ready(allowed)
                }, {
                    // Ordinary browsing remains usable if private observer permission fails.
                    if (diagnostics) Log.d("YeoyuVideoRegion", "extension-private-access-failed")
                    ready(installed)
                })
            }
        }, {
            initializing = false
            if (diagnostics) Log.d("YeoyuVideoRegion", "extension-install-failed")
            // Browsing remains available. Without a verified region, PiP cannot show page content.
            bindings.values.toList().forEach(::invalidate)
        })
    }

    fun bind(session: GeckoSession, current: () -> Boolean, generation: () -> Long) {
        retire(session)
        val binding = Binding(session, current, generation)
        bindings[session] = binding
        extension?.let { attachDelegate(binding, it) }
    }

    private fun attachDelegate(binding: Binding, installed: WebExtension) {
        binding.session.webExtensionController.setMessageDelegate(installed, object : WebExtension.MessageDelegate {
            override fun onConnect(port: WebExtension.Port) {
                val sender = port.sender
                if (bindings[binding.session] !== binding || !binding.current() || port.name != NATIVE_APP ||
                    sender.session !== binding.session || sender.webExtension.id != EXTENSION_ID || !sender.isTopLevel ||
                    sender.environmentType != WebExtension.MessageSender.ENV_TYPE_CONTENT_SCRIPT ||
                    !(sender.url.startsWith("https://") || sender.url.startsWith("http://"))) {
                    port.disconnect()
                    return
                }
                val peer = Peer(binding, port, binding.generation())
                if (binding.candidates.size >= 4) { port.disconnect(); return }
                binding.candidates.add(peer)
                peer.handshakeTimeout = Runnable { closePeer(peer, retireDocument = false, reason = "handshake-expired") }
                    .also { main.postDelayed(it, 1_000L) }
                port.setDelegate(object : WebExtension.PortDelegate {
                    override fun onPortMessage(message: Any, port: WebExtension.Port) {
                        if (port === peer.port) receive(peer, message)
                    }
                    override fun onDisconnect(port: WebExtension.Port) {
                        if (port === peer.port) closePeer(peer, retireDocument = false, disconnect = false, reason = "port-disconnected")
                    }
                })
            }
        }, NATIVE_APP)
    }

    private fun live(peer: Peer): Boolean = bindings[peer.binding.session] === peer.binding &&
        peer.binding.peer === peer && peer.binding.current() && peer.binding.generation() == peer.generation

    private fun connected(peer: Peer): Boolean = bindings[peer.binding.session] === peer.binding &&
        (peer.binding.peer === peer || peer in peer.binding.candidates) && peer.binding.current() &&
        peer.binding.generation() == peer.generation

    private fun receive(peer: Peer, value: Any) {
        if (!connected(peer)) { closePeer(peer, retireDocument = true, reason = "stale-binding"); return }
        if (value is JSONObject && value.optString("type") == "observer-probe") {
            if (diagnosticSession(peer.binding.session)) Log.d("YeoyuVideoRegion", "observer-probe current=${value.optBoolean("current")} alive=${value.optBoolean("alive")} deadObject=${value.optBoolean("deadObject")} document=${value.optString("documentToken") == peer.channel.documentToken}")
            return
        }
        val message = (value as? JSONObject)?.let(::parseVideoRegionMessage) ?: run {
            closePeer(peer, retireDocument = true, reason = "malformed-message")
            return
        }
        if (message.documentToken in peer.binding.retiredDocuments) { closePeer(peer, retireDocument = false, reason = "retired-document"); return }
        val watch = peer.watch
        if (!peer.channel.accept(message, SystemClock.elapsedRealtime(), peer.requests.keys, watch?.id)) {
            if (diagnosticSession(peer.binding.session) && message.requestId != null) Log.d("YeoyuVideoRegion", "measure-rejected pending=${message.requestId in peer.requests} document=${peer.channel.documentToken == message.documentToken} watch=${message.watchId == watch?.id}")
            if (watch != null && message.watchId != null) traceWatch(peer, watch, "rejected",
                "sameWatch=${message.watchId == watch.id} sameDocument=${peer.channel.documentToken == message.documentToken}")
            return
        }
        if (diagnosticSession(peer.binding.session) && message.requestId != null) {
            Log.d("YeoyuVideoRegion", "measure playing=${message.region?.playing} viewport=${message.region?.viewport} " +
                "rect=${message.region?.rect}")
        }
        if (peer.binding.peer !== peer) {
            // Do not let an old document's reconnect close the current player before
            // its document identity and message have been checked.
            peer.binding.peer?.let { closePeer(it, retireDocument = false, reason = "peer-replaced") }
            // Closing an old watch/request may synchronously navigate or retire this
            // session. Keep the candidate visible to that invalidation until it returns.
            if (!connected(peer)) return
            peer.binding.candidates.remove(peer)
            peer.handshakeTimeout?.let(main::removeCallbacks)
            peer.handshakeTimeout = null
            peer.binding.peer = peer
            if (diagnosticSession(peer.binding.session)) Log.d("YeoyuVideoRegion", "observer-connected generation=${peer.generation} session=${System.identityHashCode(peer.binding.session)}")
            try { peer.port.postMessage(JSONObject().put("type", "connected").put("documentToken", message.documentToken)) }
            catch (_: RuntimeException) { closePeer(peer, retireDocument = false, reason = "connected-post-failed"); return }
            // A reconnect is only transport repair. It must not change the source
            // document or spend another retry if this new port also stops replying.
            peer.binding.recoveries.toList().forEach { recovery ->
                completeRecovery(peer.binding, recovery,
                    reconnect = live(peer) && recovery.generation == peer.generation && recovery.document == message.documentToken)
            }
        }
        message.requestId?.let { id -> peer.requests.remove(id)?.let {
            main.removeCallbacks(it.timeout)
            it.callback(message.region)
        } }
        // Requests can synchronously transfer ownership and replace the active watch.
        if (!live(peer) || watch == null || peer.watch !== watch || message.watchId != watch.id) return
        val region = message.region?.takeIf {
            it.documentToken == watch.region.documentToken && it.videoToken == watch.region.videoToken
        }
        if (region == null) {
            if (diagnosticSession(peer.binding.session)) {
                val observerReason = value.optString("reason").takeIf { it in setOf("page-hidden", "unavailable-region") } ?: "unknown"
                traceWatch(peer, watch, "invalid-reply", "region=${message.region != null}" +
                    " sameDocument=${message.documentToken == watch.region.documentToken}" +
                    " sameVideo=${value.optString("videoToken") == watch.region.videoToken} observerReason=$observerReason")
            }
            cancelWatch(peer, watch, notify = true,
                reason = if (message.region == null) "explicit-null" else "identity-mismatch")
        } else {
            val firstAck = !watch.policy.acknowledged
            watch.policy.accepted(SystemClock.elapsedRealtime())
            if (firstAck) traceWatch(peer, watch, "first-ack", "playing=${region.playing} sequence=${region.sequence}")
            refreshWatchExpiry(peer, watch)
            watch.callback(region)
        }
    }

    fun latest(session: GeckoSession): VideoRegion? = bindings[session]?.peer?.takeIf(::live)
        ?.channel?.latest(SystemClock.elapsedRealtime())

    /** A transition waits for a fresh measurement; it never navigates or reloads the page to obtain one. */
    fun request(session: GeckoSession, callback: (VideoRegion?) -> Unit) = request(session, callback, recover = true)

    private fun request(session: GeckoSession, callback: (VideoRegion?) -> Unit, recover: Boolean) {
        val binding = bindings[session]
        val peer = binding?.peer?.takeIf(::live)
        if (peer == null) {
            val recovery = binding?.recoveries?.firstOrNull { it.generation == binding.generation() }
            if (recover && binding != null && binding.current() && recovery != null) {
                awaitReconnect(binding, recovery.generation, recovery.document, callback)
                return
            }
            if (diagnosticSession(session)) Log.d("YeoyuVideoRegion", "measure-unavailable installed=${extension != null} bound=${bindings.containsKey(session)}")
            callback(null); return
        }
        val id = UUID.randomUUID().toString()
        if (diagnosticSession(session)) Log.d("YeoyuVideoRegion", "measure-start generation=${peer.generation} session=${System.identityHashCode(session)}")
        val timeout = Runnable { peer.requests.remove(id)?.let {
            if (diagnosticSession(session)) Log.d("YeoyuVideoRegion", "measure-timeout generation=${peer.generation} live=${live(peer)}")
            if (recover && live(peer)) reconnect(peer, it.callback) else it.callback(null)
        } }
        peer.requests[id] = Request(callback, timeout, recover)
        main.postDelayed(timeout, 450L)
        try { peer.port.postMessage(JSONObject().put("type", "measure").put("requestId", id)
            .put("diagnostics", diagnosticSession(session))) }
        catch (_: RuntimeException) {
            if (diagnosticSession(session)) Log.d("YeoyuVideoRegion", "measure-post-failed")
            peer.requests.remove(id)?.let {
                main.removeCallbacks(it.timeout)
                if (recover && live(peer)) reconnect(peer, it.callback) else it.callback(null)
            }
        }
    }

    private fun reconnect(peer: Peer, callback: (VideoRegion?) -> Unit) {
        val binding = peer.binding
        val pending = peer.requests.values.toList()
        peer.requests.clear()
        pending.forEach { main.removeCallbacks(it.timeout) }
        awaitReconnect(binding, peer.generation, peer.channel.documentToken, callback)
        pending.filter { it.canRecover }.forEach {
            awaitReconnect(binding, peer.generation, peer.channel.documentToken, it.callback)
        }
        if (diagnosticSession(peer.binding.session)) Log.d("YeoyuVideoRegion", "measure-reconnect generation=${peer.generation}")
        // A native Port can outlive its responsive content transport after SPA
        // playback changes. Disconnect without retiring the still-live document;
        // the observer reconnects without touching the page, player or decoder.
        closePeer(peer, retireDocument = false, reason = "measure-reconnect")
        pending.filterNot { it.canRecover }.forEach { it.callback(null) }
    }

    private fun awaitReconnect(binding: Binding, generation: Long, document: String?, callback: (VideoRegion?) -> Unit) {
        lateinit var recovery: Recovery
        val timeout = Runnable { completeRecovery(binding, recovery, reconnect = false) }
        recovery = Recovery(generation, document, callback, timeout)
        binding.recoveries.add(recovery)
        main.postDelayed(timeout, 600L)
    }

    private fun completeRecovery(binding: Binding, recovery: Recovery, reconnect: Boolean) {
        if (!binding.recoveries.remove(recovery)) return
        main.removeCallbacks(recovery.timeout)
        if (diagnosticSession(binding.session)) Log.d("YeoyuVideoRegion", "measure-reconnected=$reconnect generation=${recovery.generation}")
        if (reconnect) request(binding.session, recovery.callback, recover = false)
        else recovery.callback(null)
    }

    fun watch(session: GeckoSession, region: VideoRegion, onChanged: (VideoRegion?) -> Unit): VideoRegionWatchSubscription {
        val peer = bindings[session]?.peer?.takeIf(::live)
        val current = peer?.channel?.latest(SystemClock.elapsedRealtime())
        if (peer == null || peer.watch != null || current?.documentToken != region.documentToken || current.videoToken != region.videoToken) {
            if (diagnosticSession(session)) Log.d("YeoyuVideoRegion", "watch-unavailable live=${peer != null}" +
                " occupied=${peer?.watch != null} cached=${current != null}" +
                " sameDocument=${current?.documentToken == region.documentToken} sameVideo=${current?.videoToken == region.videoToken}")
            val invalid = Runnable { onChanged(null) }
            main.post(invalid)
            return VideoRegionWatchSubscription({}, { main.removeCallbacks(invalid) })
        }
        val watch = Watch(UUID.randomUUID().toString(), region, onChanged)
        peer.watch = watch
        traceWatch(peer, watch, "subscribed")
        try {
            peer.port.postMessage(JSONObject().put("type", "watch").put("enabled", true)
                .put("videoToken", region.videoToken).put("watchId", watch.id))
        } catch (_: RuntimeException) {
            main.post { if (peer.watch === watch) cancelWatch(peer, watch, notify = true, reason = "post-failed") }
        }
        return VideoRegionWatchSubscription({ pinned ->
            if (peer.watch === watch) {
                watch.policy.setPinned(pinned, SystemClock.elapsedRealtime())
                traceWatch(peer, watch, "pinned", "active=$pinned")
                refreshWatchExpiry(peer, watch)
            }
        }, { cancelWatch(peer, watch, notify = false, reason = "subscriber-cancelled") })
    }

    private fun refreshWatchExpiry(peer: Peer, watch: Watch) {
        watch.expiry?.let(main::removeCallbacks)
        watch.expiry = null
        val deadline = watch.policy.deadlineAt ?: return
        val generation = watch.policy.timerGeneration
        watch.expiry = Runnable {
            if (peer.watch === watch && watch.policy.canExpire(generation, SystemClock.elapsedRealtime()))
                cancelWatch(peer, watch, notify = true, reason = "heartbeat-expired")
        }.also { main.postDelayed(it, (deadline - SystemClock.elapsedRealtime()).coerceAtLeast(0L)) }
    }

    private fun cancelWatch(peer: Peer, watch: Watch, notify: Boolean, reason: String) {
        if (peer.watch !== watch) return
        traceWatch(peer, watch, "cancelled", "reason=$reason notify=$notify")
        peer.watch = null
        watch.policy.cancel()
        watch.expiry?.let(main::removeCallbacks)
        try { peer.port.postMessage(JSONObject().put("type", "watch").put("enabled", false).put("watchId", watch.id)) }
        catch (_: RuntimeException) {}
        if (notify) watch.callback(null)
    }

    fun navigationStarted(session: GeckoSession) { bindings[session]?.let(::invalidate) }
    private fun invalidate(binding: Binding) {
        binding.recoveries.toList().forEach { completeRecovery(binding, it, reconnect = false) }
        (binding.candidates.toList() + listOfNotNull(binding.peer)).forEach {
            closePeer(it, retireDocument = true, reason = "binding-invalidated")
        }
    }
    fun retire(session: GeckoSession) { bindings.remove(session)?.let(::invalidate) }

    private fun closePeer(peer: Peer, retireDocument: Boolean, disconnect: Boolean = true, reason: String) {
        if (peer.binding.peer !== peer && peer !in peer.binding.candidates) return
        if (peer.binding.peer === peer) peer.binding.peer = null
        peer.binding.candidates.remove(peer)
        peer.handshakeTimeout?.let(main::removeCallbacks)
        if (retireDocument) peer.channel.documentToken?.let {
            peer.binding.retiredDocuments.add(it)
            while (peer.binding.retiredDocuments.size > 16) peer.binding.retiredDocuments.remove(peer.binding.retiredDocuments.first())
        }
        peer.channel.invalidate()
        val requests = peer.requests.values.toList()
        peer.requests.clear()
        val watch = peer.watch
        peer.watch = null
        watch?.let {
            traceWatch(peer, it, "cancelled", "reason=$reason retireDocument=$retireDocument disconnect=$disconnect")
            it.policy.cancel()
        }
        watch?.expiry?.let(main::removeCallbacks)
        if (disconnect) try { peer.port.disconnect() } catch (_: RuntimeException) {}
        requests.forEach { main.removeCallbacks(it.timeout); it.callback(null) }
        watch?.callback?.invoke(null)
    }
}
