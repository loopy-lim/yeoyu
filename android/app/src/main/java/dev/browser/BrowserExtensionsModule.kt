package dev.browser

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil

class BrowserExtensionsModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "BrowserExtensions"
    // React Native async exports must return JVM void. runOnUiThread returns
    // boolean in RN 0.87, so an inferred expression body breaks module loading.
    private fun onUi(promise: Promise, task: () -> Unit) {
        UiThreadUtil.runOnUiThread {
            try { GeckoSessionRegistry.extensionRuntime(reactApplicationContext); task() }
            catch (error: Exception) { promise.reject("EXTENSION", error) }
        }
    }
    private fun reply(promise: Promise): (Result<String>) -> Unit = { result ->
        result.fold({ promise.resolve(it) }, { promise.reject("EXTENSION", it) })
    }
    @ReactMethod fun list(promise: Promise) = onUi(promise) { BrowserExtensionHost.refresh(reply(promise)) }
    @ReactMethod fun install(slug: String, promise: Promise) = onUi(promise) { BrowserExtensionHost.install(slug, reply(promise)) }
    @ReactMethod fun search(query: String, promise: Promise) = onUi(promise) { BrowserExtensionHost.search(query, reply(promise)) }
    @ReactMethod fun revokeOptional(id: String, kind: String, value: String, promise: Promise) = onUi(promise) {
        BrowserExtensionHost.revokeOptional(id, kind, value, reply(promise))
    }
    @ReactMethod fun modify(id: String, operation: String, value: Boolean, promise: Promise) = onUi(promise) {
        BrowserExtensionHost.modify(id, operation, value, reply(promise))
    }
    @ReactMethod fun openAction(id: String, anchorX: Double, anchorY: Double, promise: Promise) = onUi(promise) {
        BrowserExtensionHost.openAction(id, anchorX.toFloat(), anchorY.toFloat()); promise.resolve(null)
    }
    @ReactMethod fun openOptions(id: String, promise: Promise) = onUi(promise) { BrowserExtensionHost.openOptions(id); promise.resolve(null) }
    @ReactMethod fun setActiveTab(id: String?) { UiThreadUtil.runOnUiThread { BrowserExtensionHost.setActiveTab(id) } }
    @ReactMethod fun claimTabRequest(id: Int, promise: Promise) = onUi(promise) { promise.resolve(BrowserExtensionHost.claimTabRequest(id)) }
    @ReactMethod fun resolveTabRequest(id: Int, success: Boolean) { UiThreadUtil.runOnUiThread { BrowserExtensionHost.resolveTabRequest(id, success) } }
}
