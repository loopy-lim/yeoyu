@file:Suppress("OVERRIDE_DEPRECATION")
package dev.browser
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
class BrowserPackage:ReactPackage {
 override fun createNativeModules(reactContext:ReactApplicationContext):List<NativeModule> = listOf(BrowserModule(reactContext), BrowserDataModule(reactContext), BrowserExtensionsModule(reactContext))
 override fun createViewManagers(reactContext:ReactApplicationContext):List<ViewManager<*,*>> = listOf(BrowserSurfaceManager())
}
