package dev.browser

import android.app.AlertDialog
import android.os.Handler
import android.os.Looper
import com.workspacebrowser.R
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.WebResponse

/** Owns one response until explicit save consent. Declining never reaches the journal. */
internal object PrivateDownloadConfirmation {
    private val main = Handler(Looper.getMainLooper())
    private data class Pending(val session: GeckoSession, val response: WebResponse, val dialog: AlertDialog, val timeout: Runnable)
    private var pending: Pending? = null

    fun request(session: GeckoSession, response: WebResponse, current: () -> Boolean, save: () -> Unit,
        ownerHasFocus: (android.app.Activity) -> Boolean = { it.hasWindowFocus() }) {
        // The dialog must be created and shown on the main thread; content-menu
        // fetches arrive here on the NativeModules bridge thread.
        val invoke = Runnable { show(session, response, current, save, ownerHasFocus, 0) }
        if (Looper.myLooper() == Looper.getMainLooper()) invoke.run() else main.post(invoke)
    }

    private fun show(session: GeckoSession, response: WebResponse, current: () -> Boolean, save: () -> Unit,
        ownerHasFocus: (android.app.Activity) -> Boolean, attempt: Int) {
        val activity = GeckoSessionRegistry.activityProvider?.invoke()
        // Right after the content sheet dismisses, window focus returns to the
        // activity over a few frames; a backgrounded app never regains it, so
        // a short retry distinguishes the two before declining.
        if (activity != null && !activity.isFinishing && !activity.isDestroyed && !ownerHasFocus(activity) && attempt < 3) {
            main.postDelayed({ show(session, response, current, save, ownerHasFocus, attempt + 1) }, 250)
            return
        }
        if (pending != null || activity == null || activity.isFinishing || activity.isDestroyed || !ownerHasFocus(activity) || !current()) {
            runCatching { response.body?.close() }; return
        }
        fun finish(allow: Boolean) {
            val request = pending?.takeIf { it.response === response } ?: return
            val accepted = allow && !activity.isFinishing && !activity.isDestroyed && request.dialog.isShowing &&
                request.dialog.window?.decorView?.hasWindowFocus() == true && current()
            pending = null
            main.removeCallbacks(request.timeout)
            request.dialog.dismiss()
            if (accepted) save() else runCatching { response.body?.close() }
        }
        val timeout = Runnable { finish(false) }
        val dialog = AlertDialog.Builder(activity)
            .setTitle(BrowserAppStrings.get(activity, R.string.browser_private_download_title))
            .setMessage(BrowserAppStrings.get(activity, R.string.browser_private_download_detail))
            .setNegativeButton(BrowserAppStrings.get(activity, R.string.browser_cancel)) { _, _ -> finish(false) }
            .setPositiveButton(BrowserAppStrings.get(activity, R.string.browser_save_file)) { _, _ -> finish(true) }
            .setOnCancelListener { finish(false) }
            .create()
        pending = Pending(session, response, dialog, timeout)
        dialog.setOnDismissListener { finish(false) }
        main.postDelayed(timeout, 60_000)
        try { dialog.show() } catch (_: RuntimeException) { finish(false) }
    }

    fun cancel(session: GeckoSession) {
        val request = pending?.takeIf { it.session === session } ?: return
        pending = null
        main.removeCallbacks(request.timeout)
        request.dialog.dismiss()
        runCatching { request.response.body?.close() }
    }
    fun hasPending(session: GeckoSession) = pending?.session === session
}
