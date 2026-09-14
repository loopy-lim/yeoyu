package dev.browser

import android.content.Context
import android.os.Build
import android.view.View
import android.view.Window
import android.view.WindowInsets
import android.view.WindowInsetsController
import org.json.JSONObject

/** Single insets implementation shared by BrowserModule and MainActivity. */
object ImmersiveMode {
 private const val PREFS="browser-ui"
 fun isEnabled(context:Context):Boolean {
  val json=context.getSharedPreferences(PREFS,0).getString("preferences",null)?:return true
  return runCatching {JSONObject(json).optBoolean("fullscreen",true)}.getOrDefault(true)
 }
 fun set(window:Window?,enabled:Boolean) {
  if(window==null)return
  if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.R) {
   val controller=window.insetsController?:return
   // Only the immersive direction may touch decor fits. Forcing it back to true
   // under the enforced edge-to-edge of API 35+ leaves the window surface
   // undrawn (black), so disabled relies on show() alone.
   if(enabled)window.setDecorFitsSystemWindows(false)
   controller.systemBarsBehavior=if(enabled)WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE else WindowInsetsController.BEHAVIOR_DEFAULT
   if(enabled)controller.hide(WindowInsets.Type.systemBars())else controller.show(WindowInsets.Type.systemBars())
  } else {
   window.decorView.systemUiVisibility=if(enabled)
    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
   else 0
  }
 }
}
