package dev.browser

import android.app.Activity
import android.app.PendingIntent
import android.content.Intent
import android.os.Handler
import android.os.Looper
import java.util.concurrent.CancellationException
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoRuntime

/** Gecko's FIDO2 activity bridge. Credentials remain inside Gecko and the OS provider. */
object CredentialActivityCoordinator : GeckoRuntime.ActivityDelegate {
    private val main = Handler(Looper.getMainLooper())
    private class Request(val result: GeckoResult<Intent>) { var timeout: Runnable? = null }
    private val requests = ActivityRequestLedger<Activity, Request>()

    override fun onStartActivityForResult(intent: PendingIntent): GeckoResult<Intent> {
        val activity = GeckoSessionRegistry.activityProvider?.invoke()
        if (activity == null || activity.isFinishing || activity.isDestroyed)
            return GeckoResult.fromException(CancellationException("No active browser window"))
        val result = GeckoResult<Intent>()
        val request = Request(result)
        val code = try { requests.add(activity, request) } catch (failure: IllegalStateException) {
            return GeckoResult.fromException(failure)
        }
        val timeout = Runnable { requests.take(code)?.let { cancel(it) } }
        request.timeout = timeout
        main.postDelayed(timeout, 120_000)
        result.setCancellationDelegate(object : GeckoResult.CancellationDelegate {
            override fun cancel(): GeckoResult<Boolean> {
                val canceled = GeckoResult<Boolean>()
                main.post {
                    val removed = requests.take(code)
                    removed?.timeout?.let(main::removeCallbacks)
                    // GeckoResult.cancel completes the original result itself when this returns true.
                    canceled.complete(removed != null)
                }
                return canceled
            }
        })
        try { activity.startIntentSenderForResult(intent.intentSender, code, null, 0, 0, 0) }
        catch (failure: Exception) {
            requests.take(code)?.let {
                it.timeout?.let(main::removeCallbacks)
                it.result.completeExceptionally(failure)
            }
        }
        return result
    }

    fun handle(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        val request = requests.take(requestCode) ?: return false
        request.timeout?.let(main::removeCallbacks)
        if (resultCode == Activity.RESULT_OK && data != null) request.result.complete(data)
        else request.result.completeExceptionally(CancellationException("Credential selection canceled"))
        return true
    }
    fun cancelForActivity(activity: Activity) { requests.cancelFor(activity).forEach(::cancel) }
    fun cancelAll() { requests.cancelAll().forEach(::cancel) }
    private fun cancel(request: Request) {
        request.timeout?.let(main::removeCallbacks)
        request.result.completeExceptionally(CancellationException("Credential selection canceled or expired"))
    }
}
