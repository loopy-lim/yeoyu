package dev.browser

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import com.workspacebrowser.R
import java.io.File

/** Shade visibility for downloads. Progress is quiet and ongoing; completion
 *  opens the saved file. Everything no-ops without POST_NOTIFICATIONS. */
internal object DownloadNotifications {
    private const val PROGRESS_CHANNEL = "yeoyu.downloads"
    private const val COMPLETE_CHANNEL = "yeoyu.downloads.complete"

    fun channels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(PROGRESS_CHANNEL, context.getString(R.string.downloads_channel_progress), NotificationManager.IMPORTANCE_LOW)
        )
        manager.createNotificationChannel(
            NotificationChannel(COMPLETE_CHANNEL, context.getString(R.string.downloads_channel_complete), NotificationManager.IMPORTANCE_DEFAULT)
        )
    }

    private fun id(id: String): Int = 0x64000000 or (id.hashCode() and 0xFFFFFF)

    private fun allowed(context: Context): Boolean {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return false
        if (!manager.areNotificationsEnabled()) return false
        return Build.VERSION.SDK_INT < 33 ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    }

    fun progress(context: Context, id: String, filename: String, bytes: Long, total: Long?) {
        if (!allowed(context)) return
        val builder = NotificationCompat.Builder(context, PROGRESS_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification_download)
            .setContentTitle(context.getString(R.string.download_running, filename))
            .setOngoing(true).setOnlyAlertOnce(true).setSilent(true)
            .setProgress(100, 0, total == null)
        if (total != null && total > 0) {
            builder.setProgress(100, ((bytes * 100) / total).toInt().coerceIn(0, 100), false)
        }
        notify(context, id, builder)
    }

    fun completed(context: Context, id: String, filename: String, mime: String?, uri: String?) {
        if (!allowed(context)) return
        val content = uri?.let { openIntent(context, it, mime) } ?: run {
            cancel(context, id); return
        }
        val builder = NotificationCompat.Builder(context, COMPLETE_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification_download)
            .setContentTitle(context.getString(R.string.download_complete_title))
            .setContentText(filename)
            .setContentIntent(content)
            .setAutoCancel(true)
        notify(context, id, builder)
    }

    fun cancel(context: Context?, id: String) {
        if (context == null) return
        try { context.getSystemService(NotificationManager::class.java)?.cancel(id(id)) } catch (_: Exception) {}
    }

    private fun notify(context: Context, id: String, builder: NotificationCompat.Builder) {
        try {
            context.getSystemService(NotificationManager::class.java)
                ?.notify(id(id), builder.build())
        } catch (_: Exception) {}
    }

    private fun openIntent(context: Context, uri: String, mime: String?): PendingIntent {
        val parsed = Uri.parse(uri)
        val data = if (parsed.scheme == "file") {
            androidx.core.content.FileProvider.getUriForFile(
                context, "${context.packageName}.downloads", File(parsed.path ?: uri))
        } else parsed
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(data, mime?.takeIf { it.isNotBlank() } ?: "*/*")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(context, id(uri), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
}
