package dev.browser

import android.content.Context
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/** Local crash capture. The app ships no crash reporting: this keeps the last
 *  crashes on device only, so a reinstall-adjacent debugging session can read
 *  them. The previous handler still runs, preserving the system crash flow. */
internal object CrashJournal {
    private const val NAME = "crash-log.txt"
    private const val MAX_BYTES = 256 * 1024
    private const val KEEP_BYTES = 128 * 1024

    fun install(app: Context) {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching { append(app, thread, error) }
            previous?.uncaughtException(thread, error)
        }
    }

    fun lastCrash(context: Context): String? {
        val file = file(context) ?: return null
        if (!file.isFile) return null
        return runCatching { file.readText() }.getOrNull()?.takeLast(8_000)
    }

    private fun file(context: Context): File = File(context.applicationContext.noBackupFilesDir, NAME)

    private fun append(app: Context, thread: Thread, error: Throwable) {
        val file = file(app)
        if (file.length() > MAX_BYTES) file.delete()
        val trace = StringWriter().also { error.printStackTrace(PrintWriter(it)) }.toString()
        file.appendText("time=${System.currentTimeMillis()} thread=${thread.name}\n$trace\n\n")
        if (file.length() > KEEP_BYTES) {
            // Drop the oldest half so one noisy crash loop cannot grow forever.
            runCatching {
                val text = file.readText()
                file.writeText(text.substring(text.length / 2))
            }
        }
    }
}
