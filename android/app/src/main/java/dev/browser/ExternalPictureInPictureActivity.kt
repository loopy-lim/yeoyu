package dev.browser

import android.app.Activity
import android.content.res.Configuration
import android.os.Bundle

/** A native display host only. The existing GeckoSession and DOM stay in the registry. */
class ExternalPictureInPictureActivity : Activity() {
    private var ticket = -1L
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setPipWindowVisible(false)
        ticket = intent.getLongExtra("ticket", -1L)
        ExternalPictureInPicture.trace("created", this, ticket, "saved=${savedInstanceState != null}")
        if (!ExternalPictureInPicture.attachActivity(this, ticket)) finish()
    }
    /** Keep decor drawing for window transitions without exposing the unpinned stage. */
    internal fun setPipWindowVisible(visible: Boolean) {
        val alpha = if (visible) 1f else 0f
        val attributes = window.attributes
        ExternalPictureInPicture.traceExitBoundary(this, ticket, "alpha-before", "requested=$alpha")
        if (attributes.alpha != alpha) {
            attributes.alpha = alpha
            window.attributes = attributes
        }
        ExternalPictureInPicture.traceExitBoundary(this, ticket, "alpha-after", "requested=$alpha")
    }
    override fun onStart() {
        super.onStart()
        ExternalPictureInPicture.activityStarted(this, ticket)
    }
    override fun onResume() {
        super.onResume()
        ExternalPictureInPicture.activityResumed(this, ticket)
    }
    override fun onPause() {
        ExternalPictureInPicture.activityPaused(this, ticket)
        super.onPause()
    }
    override fun onPictureInPictureModeChanged(active: Boolean, configuration: Configuration) {
        ExternalPictureInPicture.traceExitBoundary(this, ticket, "mode-before",
            "active=$active config=${configuration.screenWidthDp}x${configuration.screenHeightDp}", begin = !active)
        super.onPictureInPictureModeChanged(active, configuration)
        ExternalPictureInPicture.modeChanged(this, ticket, active)
        ExternalPictureInPicture.traceExitBoundary(this, ticket, "mode-after", "active=$active")
    }
    override fun onConfigurationChanged(newConfig: Configuration) {
        ExternalPictureInPicture.traceExitBoundary(this, ticket, "config-before",
            "incoming=${newConfig.screenWidthDp}x${newConfig.screenHeightDp}", begin = true)
        super.onConfigurationChanged(newConfig)
        ExternalPictureInPicture.traceExitBoundary(this, ticket, "config-after",
            "incoming=${newConfig.screenWidthDp}x${newConfig.screenHeightDp}")
    }
    override fun onStop() {
        ExternalPictureInPicture.activityStopped(this, ticket)
        super.onStop()
    }
    override fun onDestroy() {
        ExternalPictureInPicture.activityDestroyed(this, ticket)
        super.onDestroy()
    }
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        ExternalPictureInPicture.trace("window-focus", this, ticket, "focused=$hasFocus")
    }
    override fun finish() {
        ExternalPictureInPicture.trace("activity-finish-called", this, ticket)
        super.finish()
    }
    @Deprecated("Back returns the external tab to the browser")
    override fun onBackPressed() { ExternalPictureInPicture.expand(this, ticket) }
}
