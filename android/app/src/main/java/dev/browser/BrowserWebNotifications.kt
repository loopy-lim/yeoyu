package dev.browser

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import com.workspacebrowser.MainActivity
import com.workspacebrowser.R
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.WebNotification
import org.mozilla.geckoview.WebNotificationDelegate
import java.util.UUID

/** Delivers notifications from the already-authorized Gecko runtime. No site data is persisted. */
object BrowserWebNotifications : WebNotificationDelegate {
    private const val CHANNEL = "yeoyu.websites"
    private const val SILENT_CHANNEL = "yeoyu.websites.silent"
    private const val TAG_PREFIX = "yeoyu.web-notification."
    private const val CLICK = "dev.browser.WEB_NOTIFICATION_CLICK"
    private const val DELETE = "dev.browser.WEB_NOTIFICATION_DELETE"
    private const val INTENT_SCHEME = "yeoyu-notification"
    private const val NOTIFICATION_ID = 1
    private val main = Handler(Looper.getMainLooper())
    private val live = WebNotificationLedger<WebNotification>()
    private val activation = WebNotificationActivation()
    private var context: Context? = null
    private var manager: NotificationManager? = null
    private var installedRuntime: GeckoRuntime? = null
    private var foreground = false

    /** Call when creating the runtime, before admitting website sessions. */
    fun initialize(app: Context, runtime: GeckoRuntime) {
        check(Looper.myLooper() == Looper.getMainLooper())
        if (installedRuntime === runtime) return
        dismissAll()
        installedRuntime?.webNotificationDelegate = null
        context = app.applicationContext
        manager = app.getSystemService(NotificationManager::class.java)
        manager?.let { notifications ->
            notifications.createNotificationChannel(NotificationChannel(CHANNEL, "웹사이트 알림", NotificationManager.IMPORTANCE_DEFAULT))
            notifications.createNotificationChannel(NotificationChannel(SILENT_CHANNEL, "조용한 웹사이트 알림", NotificationManager.IMPORTANCE_LOW).apply {
                setSound(null, null)
                enableVibration(false)
            })
            // A previous process cannot supply live Gecko callbacks. Cancel only our namespace.
            notifications.activeNotifications.filter { it.tag?.startsWith(TAG_PREFIX) == true }.forEach {
                notifications.cancel(it.tag, it.id)
            }
        }
        installedRuntime = runtime
        runtime.webNotificationDelegate = this
    }

    override fun onShowNotification(notification: WebNotification) = onMain { show(notification) }

    override fun onCloseNotification(notification: WebNotification) = onMain {
        // Gecko returns the same Java instance. A delayed close for a replaced
        // instance must never close the replacement's engine listener or shade item.
        live.removeWhere { it.key == key(notification) && it.value === notification }.forEach(::retire)
    }

    fun onHostResumed() = onMain {
        foreground = true
        if (!systemAllowed()) dismissAll()
        else live.removeWhere { !channelAllowed(channel(it.value)) }.forEach(::retire)
    }

    fun onHostStopped() = onMain {
        foreground = false
        activation.clear()
        dismissPrivate()
    }

    fun dismissPrivate() = onMain {
        live.removeWhere { it.key.privateBrowsing }.forEach(::retire)
    }

    fun dismissAll() = onMain {
        activation.clear()
        live.removeWhere { true }.forEach(::retire)
    }

    /** Call after an origin's notification grant is reset; null resets all normal origins. */
    fun dismissForOrigin(origin: String?) = onMain {
        activation.clear()
        live.removeWhere { !it.key.privateBrowsing && (origin == null || it.origin == origin) }.forEach(::retire)
    }

    internal fun consumeWindowActivation(uri: String): String? {
        check(Looper.myLooper() == Looper.getMainLooper())
        if (!foreground || !systemAllowed()) { activation.clear(); return null }
        return activation.consume(uri, SystemClock.elapsedRealtime())
    }

    /** Return true even for stale/malformed notification intents so they never become external links. */
    fun handleIntent(intent: Intent?): Boolean {
        if (intent?.action != CLICK) return false
        val identity = intentIdentity(intent, "click") ?: return true
        onMain {
            val entry = live.consume(identity.first, identity.second) ?: return@onMain
            cancelAndroid(entry.token)
            try {
                if (systemAllowed() && channelAllowed(channel(entry.value))) {
                    activation.begin(entry.origin, entry.key.privateBrowsing, SystemClock.elapsedRealtime())
                    if (identity.second == -1) entry.value.click()
                    else entry.value.click(entry.actions[identity.second])
                }
            } catch (_: Exception) {
                activation.clear()
                // A live notification can outlast its Gecko document; never reopen a URL as fallback.
            } finally {
                acknowledgeDismissal(entry.value)
            }
        }
        return true
    }

    internal fun handleDelete(intent: Intent?) {
        if (intent?.action != DELETE) return
        val identity = intentIdentity(intent, "delete") ?: return
        if (identity.second != -1) return
        onMain { live.consume(identity.first, -1)?.let(::retire) }
    }

    private fun show(notification: WebNotification) {
        val app = context ?: run { acknowledgeDismissal(notification); return }
        val notifications = manager ?: run { acknowledgeDismissal(notification); return }
        val origin = webNotificationOrigin(notification.source, notification.origin)
        val channel = channel(notification)
        val presentation = origin?.let {
            webNotificationPresentation(notification.privateBrowsing, foreground, systemAllowed(), channelAllowed(channel), notification.title, notification.text, it)
        } ?: run { acknowledgeDismissal(notification); return }
        val token = UUID.randomUUID().toString()
        val actions = if (presentation.allowActions) notification.actions.take(3) else emptyList()
        val evicted = live.add(key(notification), origin, token, notification, actions.map { it.name })
        evicted.forEach {
            cancelAndroid(it.entry.token)
            if (it.notifyEngine) acknowledgeDismissal(it.entry.value)
        }
        try {
            val publicVersion = NotificationCompat.Builder(app, channel)
                .setSmallIcon(R.drawable.ic_web_notification).setContentTitle("Yeoyu")
                .setContentText("웹사이트에서 새 알림을 보냈습니다").build()
            val builder = NotificationCompat.Builder(app, channel)
                .setSmallIcon(R.drawable.ic_web_notification)
                .setContentTitle(presentation.title).setContentText(presentation.text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(presentation.text))
                .setSubText(presentation.origin)
                .setContentIntent(clickIntent(app, token, -1))
                .setDeleteIntent(deleteIntent(app, token))
                .setAutoCancel(true).setOnlyAlertOnce(true).setLocalOnly(true)
                .setSilent(notification.silent || notification.privateBrowsing)
                .setVisibility(if (notification.privateBrowsing) NotificationCompat.VISIBILITY_SECRET else NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(publicVersion)
            actions.forEachIndexed { index, action ->
                builder.addAction(0, notificationText(action.title, 80), clickIntent(app, token, index))
            }
            // No timeout: requireInteraction remains meaningful and every dismissal has a callback.
            // Site icon URLs are never fetched by this native adapter.
            notifications.notify(TAG_PREFIX + token, NOTIFICATION_ID, builder.build())
            notification.show()
        } catch (_: Exception) {
            live.consume(token, -1)?.let(::retire)
        }
    }

    private fun retire(entry: LiveWebNotification<WebNotification>) {
        cancelAndroid(entry.token)
        acknowledgeDismissal(entry.value)
    }

    private fun cancelAndroid(token: String) {
        try { manager?.cancel(TAG_PREFIX + token, NOTIFICATION_ID) } catch (_: Exception) {}
    }

    private fun acknowledgeDismissal(notification: WebNotification) {
        try { notification.dismiss() } catch (_: Exception) {}
    }

    private fun key(notification: WebNotification) = WebNotificationKey(notification.origin, notification.tag, notification.privateBrowsing)
    private fun channel(notification: WebNotification) = if (notification.silent || notification.privateBrowsing) SILENT_CHANNEL else CHANNEL
    private fun channelAllowed(id: String): Boolean = manager?.getNotificationChannel(id)?.importance?.let { it != NotificationManager.IMPORTANCE_NONE } == true
    private fun systemAllowed(): Boolean {
        val app = context ?: return false
        return manager?.areNotificationsEnabled() == true &&
            (Build.VERSION.SDK_INT < 33 || app.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
    }

    private fun clickIntent(app: Context, token: String, actionIndex: Int): PendingIntent =
        PendingIntent.getActivity(app, 0, Intent(app, MainActivity::class.java).apply {
            action = CLICK
            data = identityUri("click", token, actionIndex)
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT)

    private fun deleteIntent(app: Context, token: String): PendingIntent =
        PendingIntent.getBroadcast(app, 0, Intent(app, WebNotificationDismissReceiver::class.java).apply {
            action = DELETE
            data = identityUri("delete", token, -1)
        }, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT)

    private fun identityUri(event: String, token: String, actionIndex: Int): Uri = Uri.Builder()
        .scheme(INTENT_SCHEME).authority(event).appendPath(token).appendPath(actionIndex.toString()).build()

    private fun intentIdentity(intent: Intent, event: String): Pair<String, Int>? {
        val data = intent.data ?: return null
        if (data.scheme != INTENT_SCHEME || data.authority != event || data.query != null || data.fragment != null) return null
        val parts = data.pathSegments
        if (parts.size != 2 || !parts[0].matches(Regex("[0-9a-f-]{36}"))) return null
        return parts[0] to (parts[1].toIntOrNull() ?: return null)
    }

    private fun onMain(work: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) work() else main.post(work)
    }
}

/** Explicit immutable delete intent only; clicking uses an Activity PendingIntent directly. */
class WebNotificationDismissReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) { BrowserWebNotifications.handleDelete(intent) }
}
