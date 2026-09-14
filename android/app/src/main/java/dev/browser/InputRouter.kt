package dev.browser
import android.view.KeyEvent
import com.facebook.react.bridge.Arguments

object InputRouter {
 val engine=RemapEngine()
 fun windowFocusChanged(focused:Boolean) {
  if(!focused) engine.reset()
  GeckoSessionRegistry.emit?.invoke("BrowserWindowFocus",Arguments.createMap().apply{putBoolean("focused",focused)})
 }
 fun dispatch(event:KeyEvent,deliver:(KeyEvent)->Boolean):Boolean {
  if(event.action!=KeyEvent.ACTION_DOWN && event.action!=KeyEvent.ACTION_UP)return deliver(event)
  if(event.action==KeyEvent.ACTION_DOWN) SpaceTransitionCover.keyInput()
  val key=when(event.keyCode) {
   KeyEvent.KEYCODE_LEFT_BRACKET->"["
   KeyEvent.KEYCODE_RIGHT_BRACKET->"]"
   else->KeyEvent.keyCodeToString(event.keyCode).removePrefix("KEYCODE_")
  }
  return when(val action=engine.route(key,event.action==KeyEvent.ACTION_DOWN,event.isMetaPressed,event.isCtrlPressed,event.isAltPressed,event.isShiftPressed)) {
   KeyAction.Pass->deliver(event)
   KeyAction.Consume->true
   is KeyAction.Command->{GeckoSessionRegistry.emit?.invoke("BrowserCommand",Arguments.createMap().apply{putString("command",action.command)});true}
   is KeyAction.InputKey->{GeckoSessionRegistry.emit?.invoke("BrowserInputKey",Arguments.createMap().apply{putString("key",action.key)});true}
  }
 }
}
