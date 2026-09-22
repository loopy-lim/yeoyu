package com.workspacebrowser

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          add(dev.browser.BrowserPackage())
          add(dev.rustra.bridge.RustraBridgePackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Fabric only creates its mouse/stylus pointer dispatcher when this
    // flag is enabled before the React surface is constructed.
    com.facebook.react.config.ReactFeatureFlags.dispatchPointerEvents = true
    dev.browser.CrashJournal.install(this)
    dev.browser.BrowserShortcuts.push(this)
    loadReactNative(this)
  }

  override fun onTrimMemory(level: Int) {
    super.onTrimMemory(level)
    // UI_HIDDEN signals visibility, not memory pressure. Preserve active media.
    if (level == android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW ||
        level == android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL ||
        level >= android.content.ComponentCallbacks2.TRIM_MEMORY_BACKGROUND) {
      android.os.Handler(android.os.Looper.getMainLooper()).post {
        dev.browser.GeckoSessionRegistry.onMemoryPressure()
      }
    }
  }
}
