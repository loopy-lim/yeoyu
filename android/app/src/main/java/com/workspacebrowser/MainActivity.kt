package com.workspacebrowser

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {
  val browserPip by lazy { dev.browser.BrowserPictureInPicture(this, ::launchPictureInPictureReturn) }
  private var externalDeliveryId: String? = null
  private var browserFullscreenPreference: Boolean? = null
  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    super.onCreate(savedInstanceState)
    dev.browser.PendingExternalLinks.initialize(applicationContext)
    dev.browser.DownloadCoordinator.initialize(applicationContext)
    externalDeliveryId = savedInstanceState?.getString("yeoyu.externalDeliveryId") ?: java.util.UUID.randomUUID().toString()
    dev.browser.PendingExternalLinks.receive(applicationContext, intent, checkNotNull(externalDeliveryId))
    // Fabric owns the React surface; this native ancestor only intercepts raw
    // pre-IME keys and leaves layout/content ownership with that surface.
    val content = findViewById<android.view.ViewGroup>(android.R.id.content)
    val gateway = dev.browser.BrowserInputRoot(this)
    while (content.childCount > 0) {
      val child = content.getChildAt(0)
      val layout = child.layoutParams
      content.removeViewAt(0)
      gateway.addView(child, layout)
    }
    content.addView(gateway, android.view.ViewGroup.LayoutParams(
      android.view.ViewGroup.LayoutParams.MATCH_PARENT,
      android.view.ViewGroup.LayoutParams.MATCH_PARENT
    ))
    browserPip.attach(gateway)
    dev.browser.ExternalPictureInPicture.attachBrowser(this)
    refreshBrowserFullscreen()
  }

  override fun onNewIntent(intent: android.content.Intent) {
    dev.browser.ExternalPictureInPicture.trace("main-new-intent", this,
      detail = "action=${intent.action} launcher=${intent.hasCategory(android.content.Intent.CATEGORY_LAUNCHER)} flags=${intent.flags}")
    browserPip.onNewIntent(intent)
    super.onNewIntent(intent)
    setIntent(intent)
    externalDeliveryId = java.util.UUID.randomUUID().toString()
    dev.browser.PendingExternalLinks.receive(applicationContext, intent, checkNotNull(externalDeliveryId))
  }

  private fun launchPictureInPictureReturn(intent: android.content.Intent) {
    // This is our existing singleTask Activity, not an external launch. Do not
    // route through the override which cancels pending PiP work for other apps.
    super.startActivityForResult(intent, -1, null)
  }

  fun goHome() {
    val home = android.content.Intent(android.content.Intent.ACTION_MAIN)
      .addCategory(android.content.Intent.CATEGORY_HOME)
      .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
    // Home must retain normal onUserLeaveHint/auto-PiP behavior. The external
    // activity override intentionally suppresses PiP for pickers and settings.
    super.startActivityForResult(home, -1, null)
  }

  fun launchExternalPictureInPicture(intent: android.content.Intent, options: android.os.Bundle? = null) {
    // Same-app display transfer; the generic external-launch guard is for pickers/settings.
    // Main stays underneath until the resumed External Activity moves itself into PiP.
    require(dev.browser.externalPipLaunchFlagsAllowed(intent.flags)) { "External PiP must launch in the caller task" }
    super.startActivityForResult(intent, -1, options)
  }

  fun setBrowserFullscreen(enabled: Boolean) {
    browserFullscreenPreference = enabled
    refreshBrowserFullscreen()
  }

  fun refreshBrowserFullscreen() {
    if (isInPictureInPictureMode) return
    val preference = browserFullscreenPreference ?: dev.browser.ImmersiveMode.isEnabled(this)
    dev.browser.ImmersiveMode.set(window, dev.browser.browserImmersiveEnabled(
      preference, dev.browser.GeckoSessionRegistry.hasContentFullscreen()
    ))
  }

  override fun onSaveInstanceState(outState: android.os.Bundle) {
    externalDeliveryId?.let { outState.putString("yeoyu.externalDeliveryId", it) }
    super.onSaveInstanceState(outState)
  }

  override fun dispatchTouchEvent(event: android.view.MotionEvent): Boolean {
    if (dev.browser.SpaceTransitionCover.touch(this, event)) return true
    return super.dispatchTouchEvent(event)
  }
  override fun dispatchGenericMotionEvent(event: android.view.MotionEvent): Boolean {
    if (event.actionMasked == android.view.MotionEvent.ACTION_SCROLL)
      dev.browser.SpaceTransitionCover.scrollInput(this)
    return super.dispatchGenericMotionEvent(event)
  }
  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean =
      dev.browser.InputRouter.dispatch(event) { super.dispatchKeyEvent(it) }
  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
      dev.browser.PermissionCoordinator.handle(requestCode, grantResults)
      super.onRequestPermissionsResult(requestCode, permissions, grantResults)
      browserPip.onExternalActivityResult()
  }
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
      dev.browser.DefaultBrowserCoordinator.handleActivityResult(requestCode)
      dev.browser.CredentialActivityCoordinator.handle(requestCode, resultCode, data)
      dev.browser.FilePromptCoordinator.handle(this, requestCode, resultCode, data)
      super.onActivityResult(requestCode, resultCode, data)
      browserPip.onExternalActivityResult()
  }

  // Activity.startActivity and the two-argument overload funnel through here.
  override fun startActivityForResult(intent: android.content.Intent, requestCode: Int, options: android.os.Bundle?) {
    browserPip.suspendForExternalActivity()
    try {
      super.startActivityForResult(intent, requestCode, options)
    } catch (failure: Exception) {
      browserPip.externalActivityLaunchFailed()
      throw failure
    }
  }

  override fun startIntentSenderForResult(
    intent: android.content.IntentSender,
    requestCode: Int,
    fillInIntent: android.content.Intent?,
    flagsMask: Int,
    flagsValues: Int,
    extraFlags: Int,
    options: android.os.Bundle?
  ) {
    browserPip.suspendForExternalActivity()
    try {
      super.startIntentSenderForResult(intent, requestCode, fillInIntent, flagsMask, flagsValues, extraFlags, options)
    } catch (failure: Exception) {
      browserPip.externalActivityLaunchFailed()
      throw failure
    }
  }

  override fun onDestroy() {
    dev.browser.SpaceTransitionCover.activityStopped(this, destroyed = true)
    dev.browser.ExternalPictureInPicture.browserDestroyed(this)
    browserPip.destroy()
    dev.browser.DefaultBrowserCoordinator.cancelForActivity(this)
    dev.browser.CredentialActivityCoordinator.cancelForActivity(this)
    super.onDestroy()
  }
  override fun onWindowFocusChanged(hasFocus: Boolean) {
    if (hasFocus) refreshBrowserFullscreen()
    super.onWindowFocusChanged(hasFocus)
    dev.browser.InputRouter.windowFocusChanged(hasFocus)
  }

  override fun onPause() {
    dev.browser.SpaceTransitionCover.activityStopped(this)
    dev.browser.InputRouter.engine.reset()
    browserPip.onPause()
    super.onPause()
  }

  override fun onResume() {
    super.onResume()
    dev.browser.ExternalPictureInPicture.browserResumed(this)
    browserPip.onResume()
    refreshBrowserFullscreen()
  }

  override fun onStop() {
    browserPip.onStop()
    dev.browser.ExternalPictureInPicture.browserStopped(this)
    super.onStop()
  }

  override fun onUserLeaveHint() {
    browserPip.onUserLeaveHint()
    super.onUserLeaveHint()
  }

  override fun onPictureInPictureModeChanged(active: Boolean, configuration: android.content.res.Configuration) {
    browserPip.onModeChanged(active)
    super.onPictureInPictureModeChanged(active, configuration)
    if (!active) refreshBrowserFullscreen()
  }

  override fun onPictureInPictureUiStateChanged(state: android.app.PictureInPictureUiState) {
    super.onPictureInPictureUiStateChanged(state)
    if (android.os.Build.VERSION.SDK_INT >= 35 && state.isTransitioningToPip)
      browserPip.onTransitioningToPictureInPicture()
  }


  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "Yeoyu"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
