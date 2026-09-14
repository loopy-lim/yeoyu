package dev.browser

import android.app.Activity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.PixelCopy
import android.view.View
import android.view.ViewGroup
import android.view.TextureView
import com.workspacebrowser.MainActivity
import android.view.ViewTreeObserver
import android.util.Log
import android.widget.FrameLayout
import com.facebook.react.ReactRootView
import com.facebook.react.uimanager.BackgroundStyleApplicator
import com.facebook.react.views.view.ReactViewGroup

/** One in-memory, source-pane-only cover. Never adds children to Fabric's tree. */
internal object SpaceTransitionCover {
    private val policy = SpaceTransitionPolicy()
    private val returnPolicy = ReturnCoverPolicy()
    private val main = Handler(Looper.getMainLooper())
    private var active: Pending? = null
    private var coldPending: ColdPreparation? = null
    private var copyInFlight = false
    private var gestureActivity: Activity? = null
    private class Pending(
        val activity: Activity, val root: ViewGroup, val rootBounds: SpaceCoverRect,
        val sourceBounds: SpaceCoverRect, val bounds: SpaceCoverRect,
        val sourceOwner: BrowserSurfaceView, val source: GeckoSessionRegistry.Entry,
        val target: GeckoSessionRegistry.Entry, val ticket: SpaceTransitionPolicy.Ticket,
        val publication: CoverPublication, val returning: ReturnCapture? = null, val cold: Boolean = false,
    ) {
        var drawable: Drawable? = null
        var submitted = false
        var incoming: BrowserSurfaceView? = null
        var events = 0
        var timeout: Runnable? = null
        var preDraw: ViewTreeObserver.OnPreDrawListener? = null
        var detach: View.OnAttachStateChangeListener? = null
        var resumeObserver: LifecycleEventObserver? = null
    }

    private class ColdPreparation(
        val activity: Activity, val root: ViewGroup, val rootBounds: SpaceCoverRect,
        val sourceBounds: SpaceCoverRect, val bounds: SpaceCoverRect,
        val sourceOwner: BrowserSurfaceView, val source: GeckoSessionRegistry.Entry,
        val sourceIdentity: SpaceSurfaceIdentity, val targetId: String, val target: GeckoSessionRegistry.Entry,
        val started: Long, val publication: CoverPublication,
    ) {
        var timeout: Runnable? = null
        var preDraw: ViewTreeObserver.OnPreDrawListener? = null
        var detach: View.OnAttachStateChangeListener? = null
    }

    private class ReturnDestination(val identity: ReturnCoverTarget, val entry: GeckoSessionRegistry.Entry) {
        var owner: BrowserSurfaceView? = null
        var gecko: StableGeckoView? = null
        var texture: TextureView? = null
        var layout: ReturnCoverPolicy.Layout? = null
        var bounds: SpaceCoverRect? = null
        var frameObserved = false
        var listener: View.OnLayoutChangeListener? = null
    }
    private class ReturnCapture(val ticket: ReturnCoverPolicy.Ticket, val destinations: List<ReturnDestination>,
        val returnedView: org.mozilla.geckoview.GeckoView, var mayInstall: (() -> Boolean)?)

    /** Called by the existing await boundary. Paint is observed only after publication. */
    fun prepareReturn(activity: MainActivity?, from: String, after: Set<String>, returningEntry: GeckoSessionRegistry.Entry,
        returnedView: org.mozilla.geckoview.GeckoView, returnToken: Long,
        mayInstall: () -> Boolean, publish: ((() -> Unit) -> Unit)) {
        clear()
        val publication = CoverPublication(publish)
        val started = SystemClock.uptimeMillis()
        fun skip(reason: String) {
            if (activity?.packageName == "com.workspacebrowser.acceptance")
                Log.i("YeoyuSpaceCover", "event=return-skipped returnToken=$returnToken reason=$reason")
            publication.complete()
        }
        if (copyInFlight || activity == null || Build.VERSION.SDK_INT < 26 || activity.isInPictureInPictureMode ||
            activity.browserPip.hasDisplayTransfer || !returnWindowReady(activity, allowStarted = true) ||
            InputRouter.engine.chromeModalActive || InputRouter.engine.addressInputActive) {
            skip("activity-or-input copy=$copyInFlight activity=${activity != null} api=${Build.VERSION.SDK_INT}" +
                " pip=${activity?.isInPictureInPictureMode} home=${activity?.browserPip?.hasDisplayTransfer}" +
                " focused=${activity?.hasWindowFocus()} lifecycle=${activity?.lifecycle?.currentState}" +
                " windowVisibility=${activity?.window?.peekDecorView()?.windowVisibility}" +
                " decorAttached=${activity?.window?.peekDecorView()?.isAttachedToWindow} modal=${InputRouter.engine.chromeModalActive}" +
                " address=${InputRouter.engine.addressInputActive}")
            return
        }
        val pair = GeckoSessionRegistry.returnTransitionTargets(from, after, returningEntry)
            ?: run { skip("entries-or-source"); return }
        val (source, entries) = pair
        val destinations = after.zip(entries).map { (id, entry) -> ReturnDestination(returnIdentity(id, entry), entry) }
        val owner = source.owner ?: run { skip("entries-or-source"); return }
        val root = activity.findViewById<ViewGroup>(android.R.id.content)
        if (root == null || !root.isAttachedToWindow || !isBelow(owner, root) ||
            !fullyVisible(owner.gecko) || !stableSource(owner.gecko, root)) { skip("source-visibility"); return }
        val rootBounds = screenBounds(root)
        val sourceBounds = screenBounds(owner.gecko)
        val bounds = spaceCoverRootRect(sourceBounds, rootBounds)
        if (bounds == null || owner.width != owner.gecko.width || owner.height != owner.gecko.height) { skip("source-bounds"); return }
        val returnTicket = returnPolicy.begin(returnToken, destinations.map { it.identity }, started)
            ?: run { skip("targets"); return }
        val primary = destinations.first { it.entry === returningEntry }
        val ticket = policy.begin(identity(from, source), identity(primary.identity.tab, returningEntry), started)
            ?: run { returnPolicy.cancel(returnTicket); skip("source-target"); return }
        capture(Pending(activity, root, rootBounds, sourceBounds, bounds, owner, source, returningEntry, ticket,
            publication, ReturnCapture(returnTicket, destinations, returnedView, mayInstall)))
    }

    /** A new selection supersedes Return pixels, but must not clear a just-installed Space cover. */
    fun tabTransition() { if (active?.returning != null) clear("new-transition") }
    fun returnDocumentChanged(id: String) {
        val p = active?.takeIf { it.returning != null } ?: return
        if (p.ticket.source.tab == id || p.returning!!.destinations.any { it.identity.tab == id }) clear("document-changed")
    }

    fun prepare(activity: Activity?, from: String?, to: String?, reply: () -> Unit) {
        if (activity?.packageName == "com.workspacebrowser.acceptance") {
            val source = from?.let(GeckoSessionRegistry::entry)
            val target = to?.let(GeckoSessionRegistry::entry)
            Log.i("YeoyuBootstrap", "event=space-prepare from=$from to=$to sourcePresent=${source != null}" +
                " targetPresent=${target != null} sourceDocument=${source?.documentGeneration}" +
                " targetDocument=${target?.documentGeneration} copyInFlight=$copyInFlight")
        }
        clear()
        if (copyInFlight || activity == null || from == null || to == null || Build.VERSION.SDK_INT < 26 ||
            activity.isInPictureInPictureMode || !activity.hasWindowFocus() ||
            InputRouter.engine.chromeModalActive || InputRouter.engine.addressInputActive) { reply(); return }
        val pair = GeckoSessionRegistry.spaceTransitionPair(from, to)
        if (pair == null) {
            if (activity.packageName == "com.workspacebrowser.acceptance")
                Log.i("YeoyuBootstrap", "event=space-pair-unavailable from=$from to=$to")
            reply(); return
        }
        val (source, target) = pair
        val owner = source.owner ?: run { reply(); return }
        val root = activity.findViewById<ViewGroup>(android.R.id.content)
        if (root == null || !root.isAttachedToWindow || !isBelow(owner, root) ||
            !fullyVisible(owner.gecko) || !stableSource(owner.gecko, root)) { reply(); return }
        val rootBounds = screenBounds(root)
        val sourceBounds = screenBounds(owner.gecko)
        val bounds = spaceCoverRootRect(sourceBounds, rootBounds)
        if (bounds == null || owner.width != owner.gecko.width || owner.height != owner.gecko.height) { reply(); return }
        val ticket = policy.begin(identity(from, source), identity(to, target), SystemClock.uptimeMillis())
            ?: run { reply(); return }
        capture(Pending(activity, root, rootBounds, sourceBounds, bounds, owner, source, target, ticket,
            CoverPublication { install -> try { install() } finally { reply() } }))
    }

    /** Only an intended, admitted cold target may load before the old React pane is removed. */
    fun prepareCold(activity: Activity?, from: String, to: String, url: String, reply: () -> Unit) {
        if (GeckoSessionRegistry.entry(to)?.initialNavigationLocationAccepted == true) {
            prepare(activity, from, to, reply); return
        }
        clear()
        val started = SystemClock.uptimeMillis()
        val publication = CoverPublication { install -> try { install() } finally { reply() } }
        if (copyInFlight || activity !is MainActivity || activity.lifecycle.currentState != Lifecycle.State.RESUMED ||
            activity.browserPip.hasDisplayTransfer || Build.VERSION.SDK_INT < 26 || activity.isInPictureInPictureMode ||
            !activity.hasWindowFocus() || activity.isFinishing || activity.isDestroyed ||
            InputRouter.engine.chromeModalActive || InputRouter.engine.addressInputActive) { publication.complete(); return }
        val source = GeckoSessionRegistry.coldSpaceSource(from, to) ?: run { publication.complete(); return }
        val owner = source.owner ?: run { publication.complete(); return }
        val root = activity.findViewById<ViewGroup>(android.R.id.content)
        if (root == null || !root.isAttachedToWindow || !isBelow(owner, root) ||
            !fullyVisible(owner.gecko) || !stableSource(owner.gecko, root)) { publication.complete(); return }
        val rootBounds = screenBounds(root)
        val sourceBounds = screenBounds(owner.gecko)
        val bounds = spaceCoverRootRect(sourceBounds, rootBounds)
        if (bounds == null || owner.width != owner.gecko.width || owner.height != owner.gecko.height) { publication.complete(); return }
        val sourceIdentity = identity(from, source)
        val target = try { GeckoSessionRegistry.prepareColdSpaceTarget(activity, to, url) }
            catch (_: RuntimeException) { null }
        if (target == null) { publication.complete(); return }
        val p = ColdPreparation(activity, root, rootBounds, sourceBounds, bounds, owner, source, sourceIdentity,
            to, target, started, publication)
        coldPending = p
        p.timeout = Runnable { if (coldPending === p) clearCold("initial-location-deadline") }
        p.preDraw = ViewTreeObserver.OnPreDrawListener {
            if (coldPending === p && !validCold(p)) clearCold("initial-source-changed")
            true
        }
        p.detach = object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(view: View) {}
            override fun onViewDetachedFromWindow(view: View) { if (coldPending === p) clearCold("initial-root-detached") }
        }
        try {
            root.viewTreeObserver.addOnPreDrawListener(p.preDraw)
            root.addOnAttachStateChangeListener(p.detach)
            main.postDelayed(p.timeout!!, maxOf(0L, started + SpaceTransitionPolicy.MAX_DURATION_MS - SystemClock.uptimeMillis()))
            // Covers an accepted callback that arrived synchronously during ensure; never waits through JS.
            initialNavigationReady(to, target)
        } catch (_: RuntimeException) { if (coldPending === p) clearCold("initial-setup-failed") }
    }

    fun initialNavigationReady(id: String, entry: GeckoSessionRegistry.Entry) {
        val p = coldPending ?: return
        if (id != p.targetId || entry !== p.target) return
        if (!validCold(p)) { clearCold("initial-identity-changed"); return }
        if (!entry.initialNavigationLocationAccepted) return
        val pair = GeckoSessionRegistry.spaceTransitionPair(p.sourceIdentity.tab, id)
        if (copyInFlight || pair?.first !== p.source || pair.second !== entry) { clearCold("initial-ineligible"); return }
        // Promotion transfers the same publication and original budget, without completing either.
        detachCold(p)
        val ticket = policy.begin(p.sourceIdentity, identity(id, entry), p.started)
            ?: run { p.publication.complete(); return }
        capture(Pending(p.activity, p.root, p.rootBounds, p.sourceBounds, p.bounds, p.sourceOwner,
            p.source, entry, ticket, p.publication, cold = true))
    }

    fun coldDocumentChanged(id: String, entry: GeckoSessionRegistry.Entry) {
        val waiting = coldPending
        if (waiting != null && id == waiting.sourceIdentity.tab && entry === waiting.source) clearCold("initial-source-navigation")
        val p = active
        if (p?.cold == true && ((id == p.ticket.source.tab && entry === p.source) ||
            (id == p.ticket.target.tab && entry === p.target))) clear("cold-document-changed")
    }
    fun coldEntryRetired(id: String, entry: GeckoSessionRegistry.Entry) {
        val p = coldPending
        if (p != null && ((id == p.sourceIdentity.tab && entry === p.source) ||
            (id == p.targetId && entry === p.target))) clearCold("initial-entry-retired")
        coldDocumentChanged(id, entry)
    }
    private fun validCold(p: ColdPreparation): Boolean =
        SystemClock.uptimeMillis() - p.started < SpaceTransitionPolicy.MAX_DURATION_MS &&
        p.activity is MainActivity && p.activity.lifecycle.currentState == Lifecycle.State.RESUMED &&
        !p.activity.browserPip.hasDisplayTransfer && !p.activity.isFinishing && !p.activity.isDestroyed &&
        !p.activity.isInPictureInPictureMode && p.activity.hasWindowFocus() &&
        !InputRouter.engine.chromeModalActive && !InputRouter.engine.addressInputActive &&
        p.root.isAttachedToWindow && p.root.isShown && screenBounds(p.root) == p.rootBounds &&
        GeckoSessionRegistry.coldSpaceSource(p.sourceIdentity.tab, p.targetId) === p.source &&
        GeckoSessionRegistry.entry(p.targetId) === p.target && p.target.session.isOpen && p.target.owner == null &&
        !p.target.fullscreen && !ExternalPictureInPicture.holdsSession(p.target.session) &&
        p.sourceIdentity.matches(identity(p.sourceIdentity.tab, p.source)) && p.source.owner === p.sourceOwner &&
        p.sourceOwner.gecko.session === p.source.session && p.sourceOwner.gecko.parent === p.sourceOwner &&
        screenBounds(p.sourceOwner.gecko) == p.sourceBounds && fullyVisible(p.sourceOwner.gecko) && stableSource(p.sourceOwner.gecko, p.root)

    private fun detachCold(p: ColdPreparation) {
        if (coldPending === p) coldPending = null
        runCatching { p.timeout?.let(main::removeCallbacks) }
        runCatching { p.preDraw?.let { if (p.root.viewTreeObserver.isAlive) p.root.viewTreeObserver.removeOnPreDrawListener(it) } }
        runCatching { p.detach?.let(p.root::removeOnAttachStateChangeListener) }
        p.timeout = null; p.preDraw = null; p.detach = null
    }
    private fun clearCold(reason: String) {
        val p = coldPending ?: return
        // Invalidate first: late native callbacks cannot publish again or capture another entry with the same id.
        coldPending = null
        if (p.activity.packageName == "com.workspacebrowser.acceptance")
            Log.i("YeoyuSpaceCover", "event=$reason from=${p.sourceIdentity.tab} to=${p.targetId} ageMs=${SystemClock.uptimeMillis() - p.started}")
        try { detachCold(p) } finally { p.publication.complete() }
    }

    private fun capture(pending: Pending) {
        try { capturePixels(pending) }
        catch (_: RuntimeException) { if (active === pending) clear("capture-failed") else complete(pending) }
        catch (_: OutOfMemoryError) { if (active === pending) clear("capture-failed") else complete(pending) }
    }
    private fun capturePixels(pending: Pending) {
        val root = pending.root
        val ticket = pending.ticket
        active = pending
        trace(pending, "requested")
        pending.preDraw = ViewTreeObserver.OnPreDrawListener {
            if (active === pending) {
                if (!valid(pending, beforeCopy = pending.drawable == null)) clear()
                else if (pending.returning != null && pending.drawable != null) revealReturn(pending)
            }
            true
        }.also { root.viewTreeObserver.addOnPreDrawListener(it) }
        pending.detach = object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(view: View) = Unit
            override fun onViewDetachedFromWindow(view: View) { if (active === pending) clear() }
        }.also(root::addOnAttachStateChangeListener)
        pending.timeout = Runnable { if (active === pending) clear("deadline") }.also {
            main.postDelayed(it, maxOf(0L, ticket.started + SpaceTransitionPolicy.MAX_DURATION_MS - SystemClock.uptimeMillis()))
        }
        if (pending.returning != null && !returnWindowReady(pending.activity)) {
            if (!validReturn(pending, beforeCopy = true, allowStarted = true)) { clear("resume-wait-invalid"); return }
            awaitReturnResume(pending)
            return
        }
        copyPixels(pending)
    }

    /** The active pending and its original deadline include this wait; no pixels are copied in STARTED. */
    private fun awaitReturnResume(p: Pending) {
        val lifecycle = (p.activity as MainActivity).lifecycle
        lateinit var observer: LifecycleEventObserver
        observer = LifecycleEventObserver { _, event ->
            if (active === p && p.resumeObserver === observer) {
                if (event == Lifecycle.Event.ON_RESUME) {
                    try {
                        stopWaitingForReturnResume(p)
                        if (validReturn(p, beforeCopy = true)) {
                            trace(p, "resumed-for-copy")
                            copyPixels(p)
                        } else clear("resume-wait-invalid")
                    } catch (_: RuntimeException) { if (active === p) clear("resume-copy-failed") else complete(p) }
                    catch (_: OutOfMemoryError) { if (active === p) clear("resume-copy-failed") else complete(p) }
                } else if (event == Lifecycle.Event.ON_PAUSE || event == Lifecycle.Event.ON_STOP ||
                    event == Lifecycle.Event.ON_DESTROY) clear("resume-wait-cancelled")
            }
        }
        p.resumeObserver = observer // addObserver can synchronously dispatch the current lifecycle.
        trace(p, "awaiting-resume")
        lifecycle.addObserver(observer)
    }

    private fun stopWaitingForReturnResume(p: Pending) {
        val observer = p.resumeObserver ?: return
        p.resumeObserver = null // Late callbacks cannot start another copy, even while removal is reentrant.
        (p.activity as? MainActivity)?.lifecycle?.removeObserver(observer)
    }

    private fun copyPixels(pending: Pending) {
        if (active !== pending) return
        if (pending.returning != null && !validReturn(pending, beforeCopy = true)) { clear("invalid-before-copy"); return }
        if (pending.returning != null) trace(pending, "copy-started")
        val root = pending.root
        val owner = pending.sourceOwner
        val bounds = pending.bounds
        val ticket = pending.ticket
        val bitmapSize = spaceCoverBitmapSize(bounds.width, bounds.height) ?: run { clear("invalid-size"); return }
        var bitmap: Bitmap? = null
        try {
            bitmap = Bitmap.createBitmap(bitmapSize.first, bitmapSize.second, Bitmap.Config.ARGB_8888)
            val captured = bitmap
            val location = IntArray(2)
            owner.gecko.getLocationInWindow(location)
            val windowRect = Rect(location[0], location[1], location[0] + owner.gecko.width, location[1] + owner.gecko.height)
            // Copy only the source pane from the composited window, retaining its ancestor clip/rounded corners.
            copyInFlight = true
            PixelCopy.request(pending.activity.window, windowRect, captured, { result ->
                copyInFlight = false
                try {
                    if (active !== pending || result != PixelCopy.SUCCESS || !valid(pending, beforeCopy = true)) {
                        captured.recycle() // Never displayed.
                        if (active === pending) clear()
                    } else {
                        val drawable = try {
                            spaceCoverDrawable(captured, bounds.width, bounds.height) { clipAncestors(pending, it) }
                        } catch (_: RuntimeException) { null } catch (_: OutOfMemoryError) { null }
                        if (drawable == null) {
                            captured.recycle() // Recording was never submitted for display.
                            if (active === pending) clear("unsupported-clip")
                            return@request
                        }
                        var installed = false
                        complete(pending) {
                            // The native preparation may have been replaced while PixelCopy was pending.
                            if (active === pending && valid(pending, beforeCopy = true) &&
                                policy.captured(ticket, SystemClock.uptimeMillis()) &&
                                (pending.returning?.let { returnPolicy.captured(it.ticket, SystemClock.uptimeMillis()) } != false)) {
                                drawable.setBounds(bounds.left, bounds.top, bounds.right, bounds.bottom)
                                pending.drawable = drawable
                                pending.submitted = true
                                root.overlay.add(drawable)
                                installed = true
                                pending.returning?.mayInstall = null // ACK/adopt cannot cancel paint readiness after installation.
                                trace(pending, "installed")
                                pending.returning?.destinations?.forEach { destination ->
                                    destination.entry.owner?.let { attached(destination.identity.tab, destination.entry, it) }
                                }
                            }
                        } // Publication happens after installation, never after waiting for incoming paint.
                        if (!installed) {
                            if (!pending.submitted) captured.recycle() // Never submitted for display.
                            if (active === pending) clear("install-skipped")
                        }
                    }
                } catch (_: RuntimeException) {
                    if (!pending.submitted && !captured.isRecycled) captured.recycle()
                    if (active === pending) clear("copy-callback-failed") else complete(pending)
                } catch (_: OutOfMemoryError) {
                    if (!pending.submitted && !captured.isRecycled) captured.recycle()
                    if (active === pending) clear("copy-callback-failed") else complete(pending)
                }
            }, main)
        } catch (_: RuntimeException) {
            copyInFlight = false
            bitmap?.recycle()
            if (active === pending) clear()
        } catch (_: OutOfMemoryError) {
            copyInFlight = false
            bitmap?.recycle()
            if (active === pending) clear()
        }
    }

    fun attached(id: String, entry: GeckoSessionRegistry.Entry, owner: BrowserSurfaceView) {
        val p = active ?: return
        if (p.returning != null) { attachReturn(p, id, entry, owner); return }
        if (id != p.ticket.target.tab) return
        if (entry !== p.target || entry.owner !== owner ||
            !spaceCoverCanObserveOwner(owner.isAttachedToWindow, isBelow(owner, p.root)) ||
            !valid(p) || !policy.attached(p.ticket, identity(id, entry), owner)) { clear(); return }
        p.incoming = owner
        trace(p, "incoming-attached")
    }
    fun textureUpdated(view: StableGeckoView) {
        val p = active ?: return
        if (p.returning != null) { returnTextureUpdated(p, view); return }
        val owner = p.incoming ?: return
        if (owner.gecko !== view) return
        if (!valid(p) || p.target.owner !== owner || view.session !== p.target.session || !isBelow(owner, p.root) ||
            screenBounds(view) != p.sourceBounds || !fullyVisible(view)) { clear(); return }
        if (p.cold && p.target.lastContentfulPaintDocument != p.ticket.target.document) return
        if (policy.frame(p.ticket, identity(p.ticket.target.tab, p.target), owner)) clear("target-texture")
    }
    fun textureInvalidated(view: StableGeckoView) {
        // Departure is expected. Only the bound destination can invalidate the lease here.
        if (active?.incoming?.gecko === view || active?.returning?.destinations?.any { it.gecko === view } == true) clear("texture-invalidated")
    }
    private fun returnIdentity(id: String, entry: GeckoSessionRegistry.Entry) =
        ReturnCoverTarget(id, entry, entry.session, entry.documentGeneration)

    private fun attachReturn(p: Pending, id: String, entry: GeckoSessionRegistry.Entry, owner: BrowserSurfaceView) {
        val capture = p.returning ?: return
        val destination = capture.destinations.firstOrNull { it.identity.tab == id } ?: return
        if (p.drawable == null) return // Capture completion will bind any already-present destination.
        if (entry !== destination.entry || entry.owner !== owner || !valid(p) ||
            !spaceCoverCanObserveOwner(owner.isAttachedToWindow, isBelow(owner, p.root)) ||
            !returnPolicy.attached(capture.ticket, returnIdentity(id, entry), owner, SystemClock.uptimeMillis())) { clear(); return }
        if (destination.owner === owner) return
        val gecko = owner.gecko as? StableGeckoView ?: run { clear(); return }
        if (entry === p.target && gecko !== capture.returnedView) { clear("returned-view-changed"); return }
        destination.owner = owner
        destination.gecko = gecko
        destination.listener = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
            if (active === p) invalidateReturnLayout(p, destination)
        }.also { owner.addOnLayoutChangeListener(it); gecko.addOnLayoutChangeListener(it) }
        trace(p, "incoming-attached:${id}")
    }
    private fun invalidateReturnLayout(p: Pending, d: ReturnDestination) {
        val capture = p.returning ?: return
        val owner = d.owner ?: return
        d.layout = null; d.bounds = null; d.frameObserved = false
        returnPolicy.layoutApplied(capture.ticket, d.identity, owner, 0, 0, SystemClock.uptimeMillis())
    }
    /** An update must follow a settled actual child/texture layout, including coalesced resize completion. */
    private fun returnLayout(p: Pending, d: ReturnDestination): ReturnCoverPolicy.Layout? {
        val capture = p.returning ?: return null
        val owner = d.owner ?: return null
        val gecko = d.gecko ?: return null
        val texture = gecko.textureForCapture()
        if (texture != null && d.texture == null) {
            d.texture = texture
            d.listener?.let(texture::addOnLayoutChangeListener)
        }
        if (d.entry.owner !== owner || owner.gecko !== gecko || gecko.session !== d.identity.session ||
            gecko.parent !== owner || !isBelow(owner, p.root) || !fullyVisible(gecko) || !stableSource(gecko, p.root) ||
            owner.isLayoutRequested || gecko.isLayoutRequested || owner.isGeckoLayoutPending ||
            texture == null || texture !== d.texture || !texture.isAvailable || texture.isLayoutRequested ||
            owner.width != gecko.width || owner.height != gecko.height || texture.width != gecko.width || texture.height != gecko.height) {
            invalidateReturnLayout(p, d)
            return null
        }
        val bounds = screenBounds(gecko)
        if (d.bounds != bounds || d.layout == null) {
            d.bounds = bounds
            d.frameObserved = false
            d.layout = returnPolicy.layoutApplied(capture.ticket, d.identity, owner, gecko.width, gecko.height, SystemClock.uptimeMillis())
        }
        return d.layout
    }
    private fun returnTextureUpdated(p: Pending, view: StableGeckoView) {
        val capture = p.returning ?: return
        val d = capture.destinations.firstOrNull { it.gecko === view } ?: return
        if (!valid(p)) { clear(); return }
        val layout = returnLayout(p, d) ?: return
        if (returnPolicy.frame(capture.ticket, returnIdentity(d.identity.tab, d.entry), d.owner!!, layout, SystemClock.uptimeMillis()) && !d.frameObserved) {
            d.frameObserved = true
            trace(p, "incoming-texture:${d.identity.tab}")
            p.root.postInvalidateOnAnimation() // Reveal during the next pre-draw, never half-way through this draw.
        }
    }
    private fun revealReturn(p: Pending) {
        val capture = p.returning ?: return
        val observations = capture.destinations.map { d ->
            val layout = returnLayout(p, d) ?: return
            ReturnCoverPolicy.Observation(returnIdentity(d.identity.tab, d.entry), d.owner!!, layout)
        }
        if (!returnCoverFramesFit(p.sourceBounds, capture.destinations.map { it.bounds!! })) { clear("target-bounds"); return }
        if (returnPolicy.reveal(capture.ticket, observations, SystemClock.uptimeMillis())) clear("targets-painted")
    }
    fun touch(activity: Activity, event: MotionEvent): Boolean {
        if (coldPending?.activity === activity) clearCold("initial-input")
        val p = active
        val down = event.actionMasked == MotionEvent.ACTION_DOWN
        val end = event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL
        if (p == null && gestureActivity !== activity) return false
        if (p != null && p.activity !== activity) return false
        val inside = p?.sourceBounds?.let {
            event.rawX >= it.left && event.rawX < it.right && event.rawY >= it.top && event.rawY < it.bottom
        } ?: false
        val consume = policy.touch(down, end, inside)
        if (p != null) clear(if (consume) "covered-input" else "other-input")
        if (down) gestureActivity = if (consume) activity else null
        if (end) gestureActivity = null
        return consume
    }
    fun scrollInput(activity: Activity) {
        if (coldPending?.activity === activity) clearCold("initial-scroll")
        if (active?.activity === activity) clear("scroll-input")
    }
    fun keyInput() { clear("key-input") }
    fun activityStopped(activity: Activity, destroyed: Boolean = false) {
        if (coldPending?.activity === activity) clearCold("initial-stopped")
        if (active?.activity === activity) clear()
        if (destroyed && gestureActivity === activity) {
            policy.touch(false, true, false)
            gestureActivity = null
        }
    }
    private fun identity(id: String, entry: GeckoSessionRegistry.Entry) =
        SpaceSurfaceIdentity(id, entry.session, entry.documentGeneration)
    private fun valid(p: Pending, beforeCopy: Boolean = false): Boolean {
        if (p.returning != null) return validReturn(p, beforeCopy, allowStarted = p.resumeObserver != null)
        if (!p.root.isAttachedToWindow || !p.root.isShown || screenBounds(p.root) != p.rootBounds ||
            p.activity.isFinishing || p.activity.isDestroyed || p.activity.isInPictureInPictureMode ||
            GeckoSessionRegistry.entry(p.ticket.source.tab) !== p.source ||
            GeckoSessionRegistry.entry(p.ticket.target.tab) !== p.target ||
            !p.ticket.source.matches(identity(p.ticket.source.tab, p.source)) ||
            !p.ticket.target.matches(identity(p.ticket.target.tab, p.target)) ||
            p.source.fullscreen || p.target.fullscreen || InputRouter.engine.chromeModalActive ||
            InputRouter.engine.addressInputActive || ExternalPictureInPicture.holdsSession(p.source.session) ||
            ExternalPictureInPicture.holdsSession(p.target.session)) return false
        return !beforeCopy || (p.source.owner === p.sourceOwner && p.sourceOwner.gecko.session === p.source.session &&
            p.sourceOwner.gecko.parent === p.sourceOwner && screenBounds(p.sourceOwner.gecko) == p.sourceBounds &&
            fullyVisible(p.sourceOwner.gecko) && stableSource(p.sourceOwner.gecko, p.root))
    }
    /** PixelCopy reads our visible window Surface; keyboard focus can arrive after OS Expand. */
    private fun returnWindowReady(activity: Activity, allowStarted: Boolean = false): Boolean {
        val main = activity as? MainActivity ?: return false
        val decor = main.window.peekDecorView() ?: return false
        val state = main.lifecycle.currentState
        return !main.isFinishing && !main.isDestroyed &&
            (state == Lifecycle.State.RESUMED || (allowStarted && state == Lifecycle.State.STARTED)) &&
            decor.isAttachedToWindow && decor.windowVisibility == View.VISIBLE
    }
    private fun validReturn(p: Pending, beforeCopy: Boolean, allowStarted: Boolean = false): Boolean {
        val capture = p.returning ?: return false
        if (!returnWindowReady(p.activity, allowStarted) || returnPolicy.current !== capture.ticket || SystemClock.uptimeMillis() - capture.ticket.started >= ReturnCoverPolicy.MAX_DURATION_MS ||
            !p.root.isAttachedToWindow || !p.root.isShown || screenBounds(p.root) != p.rootBounds ||
            p.activity.isFinishing || p.activity.isDestroyed || p.activity.isInPictureInPictureMode ||
            (p.activity as? MainActivity)?.browserPip?.hasDisplayTransfer == true || ExternalPictureInPicture.hasLease ||
            GeckoSessionRegistry.entry(p.ticket.source.tab) !== p.source ||
            !p.ticket.source.matches(identity(p.ticket.source.tab, p.source)) || p.source.fullscreen ||
            GeckoSessionRegistry.isPictureInPictureBlocked(p.ticket.source.tab) || InputRouter.engine.chromeModalActive || InputRouter.engine.addressInputActive ||
            capture.destinations.any { d -> GeckoSessionRegistry.entry(d.identity.tab) !== d.entry ||
                !d.identity.matches(returnIdentity(d.identity.tab, d.entry)) || !d.entry.session.isOpen || d.entry.fullscreen ||
                GeckoSessionRegistry.isPictureInPictureBlocked(d.identity.tab) ||
                (d.owner != null && (d.entry.owner !== d.owner || d.owner?.gecko !== d.gecko)) }) return false
        return !beforeCopy || (capture.mayInstall?.invoke() == true &&
            capture.destinations.all { it.entry.owner == null || it.entry === p.source } &&
            p.source.owner === p.sourceOwner && p.sourceOwner.gecko.session === p.source.session &&
            p.sourceOwner.gecko.parent === p.sourceOwner && screenBounds(p.sourceOwner.gecko) == p.sourceBounds &&
            fullyVisible(p.sourceOwner.gecko) && stableSource(p.sourceOwner.gecko, p.root))
    }
    /** Reuse RN's actual inner-border clip, not the elevation outline or a guessed radius. */
    private fun clipAncestors(p: Pending, canvas: Canvas): Boolean {
        if (!stableForCapture(p.sourceOwner.gecko)) return false
        var ancestor: View? = p.sourceOwner
        var reactClip = false
        while (ancestor != null) {
            val view = ancestor
            if (!view.isAttachedToWindow || !view.matrix.isIdentity || view.scrollX != 0 || view.scrollY != 0 ||
                view.clipToOutline || view.width <= 0 || view.height <= 0 || !stableForCapture(view)) return false
            // Only ancestors whose dispatchDraw contract is known may contribute to this snapshot.
            if (view !== p.root && view !== p.sourceOwner && view !is ReactViewGroup &&
                view !is ReactRootView && view !is BrowserInputRoot && view.javaClass != FrameLayout::class.java) return false
            val rect = screenBounds(view)
            val x = (rect.left - p.sourceBounds.left).toFloat()
            val y = (rect.top - p.sourceBounds.top).toFloat()
            canvas.translate(x, y)
            view.clipBounds?.let(canvas::clipRect)
            if (view is ViewGroup) {
                if (view.clipChildren) canvas.clipRect(0, 0, view.width, view.height)
                if (view.clipToPadding) canvas.clipRect(view.paddingLeft, view.paddingTop,
                    view.width - view.paddingRight, view.height - view.paddingBottom)
            }
            if (view is ReactViewGroup) {
                when (view.overflow) {
                    "hidden", "scroll" -> {
                        BackgroundStyleApplicator.clipToPaddingBox(view, canvas)
                        reactClip = true
                    }
                    null, "visible" -> Unit
                    else -> return false
                }
            }
            canvas.translate(-x, -y)
            if (view === p.root) return reactClip
            ancestor = view.parent as? View
        }
        return false
    }
    private fun stableSource(source: View, root: View): Boolean {
        var ancestor: View? = source
        while (ancestor != null) {
            if (!stableForCapture(ancestor)) return false
            if (ancestor === root) return true
            ancestor = ancestor.parent as? View
        }
        return false
    }
    private fun stableForCapture(view: View): Boolean {
        // Transition alpha is public only from API29. Older unknown opacity skips this optional cover.
        val transitionAlpha = if (Build.VERSION.SDK_INT >= 29) view.transitionAlpha else null
        return spaceCoverStableAncestor(view.alpha, transitionAlpha, view.animation != null,
            (view as? ViewGroup)?.layoutTransition?.isRunning == true) &&
            view.getTag(com.facebook.react.R.id.filter) == null &&
            view.getTag(com.facebook.react.R.id.mix_blend_mode) == null
    }
    private fun fullyVisible(view: View): Boolean {
        if (!view.isShown || !view.isAttachedToWindow || view.width <= 0 || view.height <= 0) return false
        val rect = Rect()
        if (!view.getLocalVisibleRect(rect) || rect != Rect(0, 0, view.width, view.height)) return false
        var ancestor: View? = view
        while (ancestor != null) {
            if (!ancestor.matrix.isIdentity) return false
            ancestor = ancestor.parent as? View
        }
        return true
    }
    private fun screenBounds(view: View): SpaceCoverRect {
        val pos = IntArray(2)
        view.getLocationOnScreen(pos)
        return SpaceCoverRect(pos[0], pos[1], pos[0] + view.width, pos[1] + view.height)
    }
    private fun isBelow(view: View, root: View): Boolean {
        var ancestor: View? = view
        while (ancestor != null) {
            if (ancestor === root) return true
            ancestor = ancestor.parent as? View
        }
        return false
    }
    private fun complete(p: Pending, install: () -> Unit = {}) {
        try { p.publication.complete(install) } catch (_: RuntimeException) { } catch (_: OutOfMemoryError) { }
    }
    private fun trace(p: Pending, event: String) {
        if (p.activity.packageName != "com.workspacebrowser.acceptance" || p.events++ >= 18) return
        val readiness = if (p.returning == null) "" else
            " lifecycle=${(p.activity as? MainActivity)?.lifecycle?.currentState}" +
                " windowVisibility=${p.activity.window.peekDecorView()?.windowVisibility}" +
                " decorAttached=${p.activity.window.peekDecorView()?.isAttachedToWindow} focused=${p.activity.hasWindowFocus()}"
        Log.i("YeoyuSpaceCover", "event=$event sequence=${p.ticket.sequence} ageMs=${SystemClock.uptimeMillis()-p.ticket.started}" +
            " from=${p.ticket.source.tab} to=${p.ticket.target.tab} sourceDocument=${p.ticket.source.document}" +
            " targetDocument=${p.ticket.target.document} incoming=${System.identityHashCode(p.incoming)} bounds=${p.bounds}" +
            " returnToken=${p.returning?.ticket?.returnToken}$readiness")
    }
    private fun clear(reason: String = "cancelled") {
        clearCold(reason)
        val p = active ?: return
        trace(p, reason)
        active = null
        policy.cancel(p.ticket)
        p.returning?.let { returnPolicy.cancel(it.ticket); it.mayInstall = null }
        try {
            runCatching { stopWaitingForReturnResume(p) }
            runCatching { p.timeout?.let(main::removeCallbacks) }
            runCatching { p.preDraw?.let { if (p.root.viewTreeObserver.isAlive) p.root.viewTreeObserver.removeOnPreDrawListener(it) } }
            runCatching { p.detach?.let(p.root::removeOnAttachStateChangeListener) }
            runCatching { p.drawable?.let(p.root.overlay::remove) }
        } catch (_: RuntimeException) { } finally {
            p.drawable = null // A displayed bitmap is not recycled while RenderThread may retain it.
            p.incoming = null
            p.returning?.destinations?.forEach { d ->
                d.listener?.let { listener ->
                    runCatching { d.owner?.removeOnLayoutChangeListener(listener) }
                    runCatching { d.gecko?.removeOnLayoutChangeListener(listener) }
                    runCatching { d.texture?.removeOnLayoutChangeListener(listener) }
                }
                d.listener = null; d.owner = null; d.gecko = null; d.texture = null; d.layout = null
            }
            complete(p)
        }
    }
}
