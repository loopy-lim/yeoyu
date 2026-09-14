package dev.rustra.bridge

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.turbomodule.core.interfaces.CallInvokerHolder

/** Browser-owned compatibility overlay for Rustra main's asynchronous installer. */
class RustraBridgeModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  companion object { init { System.loadLibrary("rustra_bridge") } }
  @Volatile private var invalidated = false

  override fun getName(): String = "RustraBridge"

  override fun invalidate() {
    invalidated = true
    nativeInvalidate()
    super.invalidate()
  }

  @ReactMethod
  fun install(promise: Promise) {
    try {
      // Promise methods arrive on the native-module queue. JSI allocations and
      // global-object mutation must run on the queue that owns the JS runtime.
      val accepted = reactApplicationContext.runOnJSQueueThread {
        try {
          if (invalidated || !reactApplicationContext.hasActiveReactInstance()) {
            promise.reject("ERR_RUNTIME_CLOSED", "React runtime is no longer active")
            return@runOnJSQueueThread
          }
          // Read the pointer here, not before dispatch: the runtime may reload.
          val pointer = reactApplicationContext.javaScriptContextHolder?.get()
          if (pointer == null || pointer == 0L) {
            promise.reject("ERR_NO_RUNTIME", "JavaScript context pointer is null")
          } else if (nativeInstall(pointer, reactApplicationContext.jsCallInvokerHolder)) {
            promise.resolve(true)
          } else {
            promise.reject("ERR_INSTALL", "Failed to install Rustra onto the JSI runtime")
          }
        } catch (error: Exception) {
          promise.reject("ERR_INSTALL", error)
        }
      }
      if (!accepted) promise.reject("ERR_RUNTIME_CLOSED", "JavaScript queue rejected installation")
    } catch (error: Exception) {
      promise.reject("ERR_INSTALL", error)
    }
  }

  private external fun nativeInstall(pointer: Long, holder: CallInvokerHolder?): Boolean
  private external fun nativeInvalidate()
}
