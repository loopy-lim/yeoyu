package dev.browser
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.viewmanagers.BrowserSurfaceManagerDelegate
import com.facebook.react.viewmanagers.BrowserSurfaceManagerInterface

class BrowserSurfaceManager:SimpleViewManager<BrowserSurfaceView>(),BrowserSurfaceManagerInterface<BrowserSurfaceView> {
 private val generatedDelegate=BrowserSurfaceManagerDelegate(this)
 override fun getDelegate()=generatedDelegate
 override fun getName()="BrowserSurface"
 override fun createViewInstance(context:ThemedReactContext)=BrowserSurfaceView(context)
 @ReactProp(name="tabId") override fun setTabId(view:BrowserSurfaceView,value:String?) {view.tabId=value.orEmpty()}
 @ReactProp(name="initialUrl") override fun setInitialUrl(view:BrowserSurfaceView,value:String?) {view.initialUrl=value?:"about:blank"}
 @ReactProp(name="active") override fun setActive(view:BrowserSurfaceView,value:Boolean) {if(value)view.gecko.requestFocus()}
 override fun onAfterUpdateTransaction(view:BrowserSurfaceView) {super.onAfterUpdateTransaction(view);view.bind()}
 override fun onDropViewInstance(view:BrowserSurfaceView) {view.release();super.onDropViewInstance(view)}
 override fun loadUrl(view:BrowserSurfaceView,url:String?) {url?.let{GeckoSessionRegistry.load(view.context,view.tabId,it)}}
 override fun goBack(view:BrowserSurfaceView) {GeckoSessionRegistry.navigate(view.context,view.tabId,"back")}
 override fun goForward(view:BrowserSurfaceView) {GeckoSessionRegistry.navigate(view.context,view.tabId,"forward")}
 override fun reload(view:BrowserSurfaceView) {GeckoSessionRegistry.navigate(view.context,view.tabId,"reload")}
 override fun focusContent(view:BrowserSurfaceView) {view.gecko.requestFocus()}
 override fun getExportedCustomDirectEventTypeConstants():Map<String,Any> = mapOf(
  "topNavigation" to mapOf("registrationName" to "onNavigation"),
  "topFocused" to mapOf("registrationName" to "onFocused"))
}
