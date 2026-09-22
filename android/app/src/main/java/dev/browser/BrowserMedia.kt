package dev.browser

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
import com.workspacebrowser.MainActivity
import com.workspacebrowser.R

/** Keeps engine media alive outside the app and mirrors it to the shade.
 *  Started while the activity is still foreground (onUserLeaveHint); the
 *  registry's media callbacks start and stop it thereafter. Private tabs
 *  never appear here (see GeckoSessionRegistry.backgroundMedia). */
internal object BrowserMediaCoordinator {
    const val CHANNEL = "yeoyu.media"

    fun channels(context: Context) {
        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.media_notification_channel), NotificationManager.IMPORTANCE_LOW).apply {
                setSound(null, null)
                enableVibration(false)
            })
    }

    fun onMediaChanged() {
        val app = GeckoSessionRegistry.activityProvider?.invoke()?.applicationContext ?: return
        if (GeckoSessionRegistry.backgroundMedia() != null) start(app)
        else stop(app)
    }

    /** Called while the activity is still foreground, before any background
     *  start restriction can apply. */
    fun onUserLeaveHint(activity: android.app.Activity) {
        if (activity.isInPictureInPictureMode) return
        val app = activity.applicationContext
        if (GeckoSessionRegistry.backgroundMedia() != null) start(app)
    }

    fun onPictureInPictureChanged(active: Boolean) {
        // The PiP surface already keeps video alive and on screen.
        if (active) stop(GeckoSessionRegistry.activityProvider?.invoke()?.applicationContext ?: return)
    }

    private fun start(app: Context) {
        channels(app)
        try {
            app.startService(Intent(app, BrowserMediaService::class.java).setAction(BrowserMediaService.ACTION_REFRESH))
        } catch (_: Exception) {}
    }

    private fun stop(app: Context) {
        try { app.stopService(Intent(app, BrowserMediaService::class.java)) } catch (_: Exception) {}
    }
}

class BrowserMediaService : Service() {
    private var session: MediaSessionCompat? = null
    private var focus: AudioFocusRequest? = null
    private var currentTabId: String? = null

    private fun media(): Pair<String, GeckoSessionRegistry.Entry>? = GeckoSessionRegistry.backgroundMedia()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        BrowserMediaCoordinator.channels(this)
        val media = MediaSessionCompat(this, "YeoyuMedia")
        media.setCallback(object : MediaSessionCompat.Callback() {
            override fun onPlay() = control(true)
            override fun onPause() = control(false)
            override fun onStop() {
                GeckoSessionRegistry.backgroundMedia()?.let { (id, _) -> GeckoSessionRegistry.mediaSetPlayback(id, false) }
            }
        })
        session = media
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY -> control(true)
            ACTION_PAUSE -> control(false)
        }
        val playing = media() ?: run {
            stopSelf()
            return START_NOT_STICKY
        }
        currentTabId = playing.first
        startInForeground(playing.first, playing.second)
        return START_NOT_STICKY
    }

    private fun control(play: Boolean) {
        currentTabId?.let { GeckoSessionRegistry.mediaSetPlayback(it, play) }
    }

    private fun startInForeground(id: String, entry: GeckoSessionRegistry.Entry) {
        val mediaSession = session ?: return
        val playing = entry.playing
        val title = entry.mediaTitle?.takeIf { it.isNotBlank() }
            ?: entry.title.takeIf { it.isNotBlank() }
            ?: hostOf(entry.url)
        mediaSession.isActive = true
        mediaSession.setPlaybackState(PlaybackStateCompat.Builder()
            .setActions(PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or PlaybackStateCompat.ACTION_STOP)
            .setState(if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED, 0L, 0f)
            .build())
        mediaSession.setMetadata(MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, hostOf(entry.url))
            .build())
        val toggle = if (playing) ACTION_PAUSE else ACTION_PLAY
        val toggleIcon = if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        val label = getString(if (playing) R.string.media_action_pause else R.string.media_action_play)
        val builder = NotificationCompat.Builder(this, BrowserMediaCoordinator.CHANNEL)
            .setSmallIcon(R.drawable.ic_notification_media)
            .setContentTitle(getString(R.string.media_playing_title))
            .setContentText(title)
            .setContentIntent(returnIntent())
            .setOngoing(true).setSilent(true).setOnlyAlertOnce(true)
            .addAction(toggleIcon, label, serviceIntent(toggle))
            .setStyle(MediaStyle().setMediaSession(mediaSession.sessionToken).setShowActionsInCompactView(0))
        val notification: Notification = builder.build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        updateFocus(playing, entry)
    }

    private fun updateFocus(playing: Boolean, entry: GeckoSessionRegistry.Entry) {
        val manager = getSystemService(AudioManager::class.java)
        if (!playing || focus != null) return
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_UNKNOWN).build())
            .setOnAudioFocusChangeListener({ change ->
                val engine = GeckoSessionRegistry.backgroundMedia()?.second?.media
                when (change) {
                    AudioManager.AUDIOFOCUS_LOSS ->
                        currentTabId?.let { GeckoSessionRegistry.mediaSetPlayback(it, false) }
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK ->
                        engine?.notifySystemAudioFocusChange(org.mozilla.geckoview.MediaSession.SYSTEM_AUDIO_FOCUS_TRANSIENT_LOSS)
                    AudioManager.AUDIOFOCUS_GAIN ->
                        engine?.notifySystemAudioFocusChange(org.mozilla.geckoview.MediaSession.SYSTEM_AUDIO_FOCUS_GAIN)
                    else -> Unit
                }
            }, Handler(Looper.getMainLooper())).build()
        focus = request
        manager.requestAudioFocus(request)
    }

    private fun hostOf(url: String): String =
        try { android.net.Uri.parse(url).host?.removePrefix("www.").orEmpty() } catch (_: Exception) { "" }

    private fun returnIntent(): PendingIntent = PendingIntent.getActivity(
        this, 0, Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun serviceIntent(action: String): PendingIntent = PendingIntent.getService(
        this, if (action == ACTION_PLAY) 1 else 2,
        Intent(this, BrowserMediaService::class.java).setAction(action),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    override fun onDestroy() {
        focus?.let { getSystemService(AudioManager::class.java)?.abandonAudioFocusRequest(it) }
        focus = null
        session?.release()
        session = null
        super.onDestroy()
    }

    companion object {
        private const val NOTIFICATION_ID = 4
        const val ACTION_REFRESH = "dev.browser.MEDIA_REFRESH"
        const val ACTION_PLAY = "dev.browser.MEDIA_PLAY"
        const val ACTION_PAUSE = "dev.browser.MEDIA_PAUSE"
    }
}
