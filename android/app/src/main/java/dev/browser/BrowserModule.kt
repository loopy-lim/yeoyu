package dev.browser
import android.content.ClipData
import android.content.ClipboardManager
import android.os.Build
import android.view.HapticFeedbackConstants
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONArray
import org.json.JSONObject

/** Platform storage and configuration only; all snapshot validation/mutation remains in Rust. */
class BrowserModule(context:ReactApplicationContext):ReactContextBaseJavaModule(context) {
 override fun getName()="BrowserRuntime"
 override fun initialize() {
  GeckoSessionRegistry.emit={name,payload -> if(reactApplicationContext.hasActiveReactInstance())
   reactApplicationContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name,payload)}
  GeckoSessionRegistry.activityProvider={ reactApplicationContext.currentActivity }
  PendingExternalLinks.initialize(reactApplicationContext)
  DownloadCoordinator.initialize(reactApplicationContext)
 }
 private fun <T> complete(promise:Promise, result:Result<T>) {
  result.fold({ promise.resolve(if(it is Unit) null else it) }, { promise.reject("BROWSER",it) })
 }
 private fun onUi(promise:Promise, operation:()->Unit) {
  UiThreadUtil.runOnUiThread {
   try { operation() } catch(failure:Exception) { promise.reject("BROWSER",failure) }
  }
 }
 private fun pictureInPicture(): BrowserPictureInPicture =
  (reactApplicationContext.currentActivity as? com.workspacebrowser.MainActivity)?.browserPip
   ?: throw IllegalStateException("No active browser window")
 @ReactMethod fun getPictureInPictureState(promise:Promise) = onUi(promise) {
  promise.resolve(pictureInPicture().status())
 }
 @ReactMethod fun prepareSpaceTransition(previousTabId:String?,nextTabId:String?,promise:Promise) = onUi(promise) {
  SpaceTransitionCover.prepare(reactApplicationContext.currentActivity,previousTabId,nextTabId) { promise.resolve(null) }
 }
 @ReactMethod fun prepareColdSpaceTransition(previousTabId:String,nextTabId:String,nextUrl:String,promise:Promise) = onUi(promise) {
  SpaceTransitionCover.prepareCold(reactApplicationContext.currentActivity,previousTabId,nextTabId,nextUrl) { promise.resolve(null) }
 }
 @ReactMethod fun prepareTabTransition(previousTabId:String?,nextTabId:String?,nextVisibleTabIdsJson:String?,promise:Promise) = onUi(promise) {
  ExternalPictureInPicture.prepare(previousTabId,nextTabId,nextVisibleTabIdsJson) { promise.resolve(null) }
 }
 @ReactMethod fun configureExternalPictureInPicture(enabled:Boolean,visibleTabIdsJson:String,blocked:Boolean) {
  UiThreadUtil.runOnUiThread { ExternalPictureInPicture.configure(enabled,visibleTabIdsJson,blocked) }
 }
 @ReactMethod fun getExternalPictureInPictureState(promise:Promise) = onUi(promise) {
  promise.resolve(ExternalPictureInPicture.status())
 }
 @ReactMethod fun acknowledgeExternalPictureInPictureReturn(token:Double) {
  UiThreadUtil.runOnUiThread { ExternalPictureInPicture.acknowledge(token) }
 }
 @ReactMethod fun configurePictureInPicture(enabled:Boolean,tabId:String?,blocked:Boolean) {
  UiThreadUtil.runOnUiThread {
   (reactApplicationContext.currentActivity as? com.workspacebrowser.MainActivity)
    ?.browserPip?.configure(enabled,tabId,blocked)
  }
 }
 @ReactMethod fun enterPictureInPicture(promise:Promise) = onUi(promise) {
  promise.resolve(pictureInPicture().enter())
 }
 @ReactMethod fun openPictureInPictureSettings(promise:Promise) = onUi(promise) {
  pictureInPicture().openSettings()
  promise.resolve(null)
 }
 @ReactMethod fun goHome(promise:Promise) = onUi(promise) {
  val activity=reactApplicationContext.currentActivity as? com.workspacebrowser.MainActivity
   ?: throw IllegalStateException("No active browser window")
  activity.goHome()
  promise.resolve(null)
 }
 @ReactMethod fun exitContentFullscreen(id:String) {
  UiThreadUtil.runOnUiThread { GeckoSessionRegistry.exitContentFullscreen(id) }
 }
 @ReactMethod fun initializeBrowserTools(promise:Promise) = onUi(promise) {
  GeckoSessionRegistry.initializeTools(reactApplicationContext) { complete(promise,it) }
 }
 @ReactMethod fun configureBrowserTools(json:String,promise:Promise) = onUi(promise) {
  GeckoSessionRegistry.configureTools(reactApplicationContext,json) { complete(promise,it) }
 }
 @ReactMethod fun getBrowserDiagnostics(promise:Promise) = onUi(promise) {
  promise.resolve(GeckoSessionRegistry.diagnostics())
 }
 @ReactMethod fun clearBrowserData(host:String?,category:String,promise:Promise) = onUi(promise) {
  GeckoSessionRegistry.clearBrowsingData(reactApplicationContext,host,category) { complete(promise,it) }
 }
 @ReactMethod fun releaseInactiveTabs(promise:Promise) = onUi(promise) {
  GeckoSessionRegistry.releaseInactive { complete(promise,it) }
 }
 @ReactMethod fun retryTab(id:String,promise:Promise) = onUi(promise) {
  GeckoSessionRegistry.retry(reactApplicationContext,id) { complete(promise,it) }
 }
 @ReactMethod fun pendingExternalLinks(promise:Promise) {
  try { promise.resolve(PendingExternalLinks.pendingJson()) } catch(failure:Exception) { promise.reject("EXTERNAL_LINK",failure) }
 }
 @ReactMethod fun acknowledgeExternalLink(id:String,promise:Promise) {
  try { PendingExternalLinks.acknowledge(id); promise.resolve(null) } catch(failure:Exception) { promise.reject("EXTERNAL_LINK",failure) }
 }
 @ReactMethod fun rejectExternalLink(id:String,promise:Promise) {
  try { PendingExternalLinks.reject(id); promise.resolve(null) } catch(failure:Exception) { promise.reject("EXTERNAL_LINK",failure) }
 }
 @ReactMethod fun getDefaultBrowserStatus(promise:Promise) {
  try { promise.resolve(DefaultBrowserCoordinator.status(reactApplicationContext)) } catch(failure:Exception) { promise.reject("BROWSER_ROLE",failure) }
 }
 @ReactMethod fun requestDefaultBrowser(promise:Promise) = onUi(promise) {
  val activity=reactApplicationContext.currentActivity ?: throw IllegalStateException("No active browser window")
  DefaultBrowserCoordinator.request(activity) { promise.resolve(it) }
 }
 @ReactMethod fun listDownloads(promise:Promise) {
  try { promise.resolve(DownloadCoordinator.list(reactApplicationContext)) } catch(failure:Exception) { promise.reject("DOWNLOAD",failure) }
 }
 @ReactMethod fun cancelDownload(id:String,promise:Promise) {
  try { promise.resolve(DownloadCoordinator.cancel(id)) } catch(failure:Exception) { promise.reject("DOWNLOAD",failure) }
 }
 @ReactMethod fun openDownload(id:String,promise:Promise) {
  try {
   val activity=reactApplicationContext.currentActivity ?: throw IllegalStateException("No active browser window")
   DownloadCoordinator.open(activity,id)
   promise.resolve(null)
  } catch(failure:Exception) { promise.reject("DOWNLOAD",failure) }
 }
 @ReactMethod fun shareUrl(url:String,promise:Promise) = onUi(promise) {
  val activity=reactApplicationContext.currentActivity ?: throw IllegalStateException("No active browser window")
  ExternalNavigationCoordinator.share(activity,url)
  promise.resolve(null)
 }
 @ReactMethod fun consumeContentContext(requestId:String,target:String,promise:Promise) = onUi(promise) {
  promise.resolve(ExternalNavigationCoordinator.consumeContext(requestId,target))
 }
 @ReactMethod fun addListener(name:String) {}
 @ReactMethod fun removeListeners(count:Double) {}
 @ReactMethod fun setAddressInputActive(enabled:Boolean) {
  UiThreadUtil.runOnUiThread {
   InputRouter.engine.addressInputActive=enabled && reactApplicationContext.currentActivity?.hasWindowFocus()==true
  }
 }
 @ReactMethod fun setChromeModalActive(enabled:Boolean) {
  UiThreadUtil.runOnUiThread {
   InputRouter.engine.chromeModalActive=enabled && reactApplicationContext.currentActivity?.hasWindowFocus()==true
  }
 }
 @ReactMethod fun configureKeys(json:String) {
  val list=JSONArray(json)
  val bindings=(0 until list.length()).map { val v=list.getJSONObject(it)
   KeyBinding(v.getString("key"),v.optBoolean("meta"),v.optBoolean("ctrl"),v.optBoolean("alt"),v.optBoolean("shift"),v.getString("command")) }
  UiThreadUtil.runOnUiThread { InputRouter.engine.bindings=bindings }
 }
 /** Tab payloads carry {id, private}; the registry keeps both the live id set
  *  and each tab's browsing mode so sessions adopt the right engine profile. */
 @ReactMethod fun setTabMetadataCount(count:Int) {
  UiThreadUtil.runOnUiThread { GeckoSessionRegistry.setTabMetadataCount(count) }
 }
 @ReactMethod fun reconcileTabs(payload:ReadableArray) {
  val keep=HashSet<String>(); val privateIds=HashSet<String>()
  for(i in 0 until payload.size()) {
   if(payload.getType(i) != com.facebook.react.bridge.ReadableType.Map) continue
   val v=payload.getMap(i) ?: continue
   val id=v.getString("id") ?: continue
   keep.add(id)
   if(v.getBoolean("private")) privateIds.add(id)
  }
  UiThreadUtil.runOnUiThread {GeckoSessionRegistry.reconcile(keep, privateIds)}
 }
 @ReactMethod fun refreshMedia() {UiThreadUtil.runOnUiThread {GeckoSessionRegistry.allMedia()}}
 @ReactMethod fun loadTabUrl(id:String,url:String) {
  UiThreadUtil.runOnUiThread { GeckoSessionRegistry.load(reactApplicationContext,id,url) }
 }
 @ReactMethod fun resolveNewSession(requestId:Int,tabId:String,isPrivate:Boolean,promise:Promise) {
  UiThreadUtil.runOnUiThread {
   GeckoSessionRegistry.resolveNewSession(reactApplicationContext,requestId,tabId,isPrivate) { error ->
    if(error == null) promise.resolve(null) else promise.reject("POPUP",error)
   }
  }
 }
 @ReactMethod fun cancelNewSession(requestId:Int) {
  UiThreadUtil.runOnUiThread { GeckoSessionRegistry.cancelNewSession(requestId) }
 }
 @ReactMethod fun pauseMedia(id:String) {UiThreadUtil.runOnUiThread {GeckoSessionRegistry.pause(id)}}
 @ReactMethod fun readSnapshot(promise:Promise) {
  promise.resolve(reactApplicationContext.getSharedPreferences("browser",0).getString("snapshot",null))
 }
 @ReactMethod fun saveSnapshot(json:String,promise:Promise) {
  val prefs=reactApplicationContext.getSharedPreferences("browser",0)
  try {
   SnapshotPersistence({ key -> prefs.getString(key,null) }) { changes ->
    val edit=prefs.edit()
    changes.forEach { (key,value) -> if(value==null) edit.remove(key) else edit.putString(key,value) }
    edit.commit()
   }.save(json)
   promise.resolve(null)
  } catch(_:Exception) { promise.reject("STORAGE","Snapshot write failed; previous data has been retained") }
 }
 @ReactMethod fun readLastGoodSnapshot(promise:Promise) {
  promise.resolve(reactApplicationContext.getSharedPreferences("browser",0).getString("snapshot.lastGood",null))
 }
 /** Preserves a damaged snapshot under a timestamped key before any
  *  recovery path can overwrite it with defaults. */
 @ReactMethod fun quarantineSnapshot(json:String,promise:Promise) {
  val prefs=reactApplicationContext.getSharedPreferences("browser",0)
  val edit=prefs.edit().putString("snapshot.corrupt-"+System.currentTimeMillis(),json)
  // Move the corrupt main value into quarantine in the same transaction.
  // The next restored save must not rotate these bad bytes over lastGood.
  if(prefs.getString("snapshot",null)==json) edit.remove("snapshot")
  if(edit.commit())promise.resolve(null)
  else promise.reject("STORAGE","Snapshot quarantine failed")
 }
 @ReactMethod fun readUiPreferences(promise:Promise) {
  promise.resolve(reactApplicationContext.getSharedPreferences("browser-ui",0).getString("preferences",null))
 }
 @ReactMethod fun saveUiPreferences(json:String,promise:Promise) {
  if(reactApplicationContext.getSharedPreferences("browser-ui",0).edit().putString("preferences",json).commit())promise.resolve(null)
  else promise.reject("STORAGE","UI preferences write failed")
 }
 @ReactMethod fun setFullscreen(enabled:Boolean) {
  UiThreadUtil.runOnUiThread {
   (reactApplicationContext.currentActivity as? com.workspacebrowser.MainActivity)?.setBrowserFullscreen(enabled)
  }
 }
 @ReactMethod fun readFavicon(host:String,promise:Promise) {
  promise.resolve(reactApplicationContext.getSharedPreferences("browser-favicons",0).getString(host,null))
 }
 @ReactMethod fun saveFavicon(host:String,data:String,promise:Promise) {
  if(reactApplicationContext.getSharedPreferences("browser-favicons",0).edit().putString(host,data).commit())promise.resolve(null)
  else promise.reject("STORAGE","Favicon write failed")
 }
 @ReactMethod fun clearFavicon(host:String) {
  reactApplicationContext.getSharedPreferences("browser-favicons",0).edit().remove(host).apply()
 }
 @ReactMethod fun findInPage(id:String,text:String,backward:Boolean) {
  UiThreadUtil.runOnUiThread {GeckoSessionRegistry.find(id,text,backward)}
 }
 @ReactMethod fun findClose(id:String) {UiThreadUtil.runOnUiThread {GeckoSessionRegistry.findClear(id)}}
 @ReactMethod fun zoom(id:String,direction:String) {UiThreadUtil.runOnUiThread {GeckoSessionRegistry.zoom(id,direction)}}
 @ReactMethod fun copyToClipboard(text:String) {
  reactApplicationContext.getSystemService(ClipboardManager::class.java)
   .setPrimaryClip(ClipData.newPlainText("URL",text))
 }
 /** "tick" for tab switches, "click" for favorites/spaces. Uses the view
  *  haptic feedback path: no VIBRATE permission needed, and it no-ops when
  *  the user disabled haptics system-wide. */
 @ReactMethod fun haptic(kind:String) {
  UiThreadUtil.runOnUiThread {
   val view=reactApplicationContext.currentActivity?.window?.decorView ?: return@runOnUiThread
   val constant=if(kind == "click")
    if(Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
   else HapticFeedbackConstants.CLOCK_TICK
   try { view.performHapticFeedback(constant) } catch (_:Exception) {}
  }
 }
 /** Host→css list (already filtered to enabled entries by JS) for boost injection. */
 @ReactMethod fun setBoosts(json:String) {
  val list=JSONArray(json)
  val map=(0 until list.length()).mapNotNull { val v=list.getJSONObject(it)
   val host=v.getString("host").lowercase().removePrefix("www.")
   if(host.isEmpty()) null else host to v.getString("css") }.toMap()
  UiThreadUtil.runOnUiThread { GeckoSessionRegistry.setBoosts(map) }
 }
 /** Per-site permission rules from JS: [{origin, kind, allow}]. Requests
  *  without a stored rule are surfaced to the user by GeckoSessionRegistry. */
 @ReactMethod fun setSitePermissionRules(json:String) {
  val list=JSONArray(json)
  val rules=(0 until list.length()).mapNotNull { val v=list.getJSONObject(it)
   val origin=v.optString("origin"); val kind=v.optString("kind")
   if(origin.isEmpty() || kind.isEmpty()) null
   else GeckoSessionRegistry.SitePermissionRule(origin,kind,v.getBoolean("allow")) }
  UiThreadUtil.runOnUiThread { GeckoSessionRegistry.setSitePermissionRules(rules) }
 }
 /** Resolves a pending permission request raised via BrowserPermissionRequest. */
 @ReactMethod fun resolvePermission(requestId:Int, allow:Boolean) {
  UiThreadUtil.runOnUiThread { GeckoSessionRegistry.resolvePermission(requestId,allow) }
 }
 /** Freezes the tab's last composited frame over the surface so focus
  *  transitions to chrome inputs don't blink the page. */
 @ReactMethod fun captureRendering(id:String) {
  UiThreadUtil.runOnUiThread { GeckoSessionRegistry.captureForTransition(id) }
 }
 /** Resolves true when the Android runtime permission is (now) held; false on denial.
  *  Known policy-only kinds and pre-33 notifications need no runtime grant. */
 @ReactMethod fun requestAndroidPermission(kind:String,promise:Promise) {
  val wanted=when(kind) {
   "camera"->arrayOf(android.Manifest.permission.CAMERA)
   "microphone"->arrayOf(android.Manifest.permission.RECORD_AUDIO)
   "geolocation"->arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION,android.Manifest.permission.ACCESS_COARSE_LOCATION)
   "notifications"->if(Build.VERSION.SDK_INT >= 33) arrayOf(android.Manifest.permission.POST_NOTIFICATIONS) else emptyArray()
   else->emptyArray()
  }
  if(wanted.isEmpty()) { promise.resolve(true); return }
  if(wanted.all { androidx.core.content.ContextCompat.checkSelfPermission(reactApplicationContext,it) == android.content.pm.PackageManager.PERMISSION_GRANTED }) {
   promise.resolve(true); return
  }
  val activity=reactApplicationContext.currentActivity
  if(activity == null) { promise.resolve(false); return }
  UiThreadUtil.runOnUiThread { PermissionCoordinator.request(activity,wanted,promise) }
 }
 @ReactMethod fun readHistory(promise:Promise) {
  promise.resolve(reactApplicationContext.getSharedPreferences("browser-history",0).getString("entries",null))
 }
 @ReactMethod fun saveHistory(json:String,promise:Promise) {
  if(reactApplicationContext.getSharedPreferences("browser-history",0).edit().putString("entries",json).commit())promise.resolve(null)
  else promise.reject("STORAGE","History write failed")
 }
 @ReactMethod fun readSitePermissions(promise:Promise) {
  promise.resolve(reactApplicationContext.getSharedPreferences("browser-site-permissions",0).getString("rules",null))
 }
 @ReactMethod fun saveSitePermissions(json:String,promise:Promise) {
  if(reactApplicationContext.getSharedPreferences("browser-site-permissions",0).edit().putString("rules",json).commit())promise.resolve(null)
  else promise.reject("STORAGE","Site permission write failed")
 }
 override fun invalidate() {
  val retiringEmitter = GeckoSessionRegistry.emit
  UiThreadUtil.runOnUiThread {
   // Complete requests while their JS bridge still owns the registry. A
   // delayed cleanup must not tear down a replacement React instance.
   if (GeckoSessionRegistry.emit === retiringEmitter) {
    ExternalPictureInPicture.shutdown()
    InputRouter.engine.reset()
    GeckoSessionRegistry.cancelPendingRequests()
    GeckoSessionRegistry.dismissPrompts()
    CredentialActivityCoordinator.cancelAll()
    ExternalNavigationCoordinator.clearContextRequests()
    GeckoSessionRegistry.activityProvider=null
    GeckoSessionRegistry.emit=null
   }
  }
  super.invalidate()
 }
}
