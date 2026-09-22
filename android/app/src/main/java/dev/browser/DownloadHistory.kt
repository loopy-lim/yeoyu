package dev.browser

/** One instance per coordinator, used exclusively on its serialized state worker. */
internal class DownloadHistory(private val store: DownloadJournal) {
    var records = emptyList<DownloadRecord>()
    private var loaded = false
    var state = "ready"
        private set
    var message = ""
        private set
    val canReset: Boolean get() = state == "damaged"
    val backupName: String? get() = store.backupName
    val writableJournal: DownloadJournal? get() = if (loaded) store else null

    fun load(now: Long, cleanup: (DownloadRecord) -> DownloadRecord = { it }): Boolean {
        // A UI retry must not read durable "running" entries back as interrupted jobs.
        if (loaded) return true
        return try {
            val recovered = store.recover(now)
            val cleaned = recovered.map {
                if (!it.active && it.state != "completed" && it.pendingUri != null) cleanup(it) else it
            }
            if (cleaned != recovered) store.write(cleaned)
            records = cleaned
            loaded = true
            state = "ready"
            message = if (backupName == null) "" else "Download history is available again. The previous history was backed up; downloaded files were kept. Return to the website to retry the download."
            true
        } catch (failure: Exception) { failed(failure); false }
    }

    fun recover(now: Long, cleanup: (DownloadRecord) -> DownloadRecord = { it }): Boolean {
        if (loaded) return true
        return try {
            // Revalidate at the moment of consent: a newer/now-valid journal is never erased.
            store.resetDamagedHistory()
            load(now, cleanup)
        } catch (failure: Exception) { failed(failure); false }
    }

    private fun failed(failure: Exception) {
        state = (failure as? DownloadHistoryException)?.state ?: "unavailable"
        message = when (state) {
            "damaged" -> "Download history is damaged, so new downloads are paused. You can back up the history and start a new list. Downloaded files will stay."
            "unsupported" -> failure.message.orEmpty()
            else -> "Download history could not be accessed or safely backed up. History and downloaded files were kept. Free some storage or try again."
        }
    }
}
