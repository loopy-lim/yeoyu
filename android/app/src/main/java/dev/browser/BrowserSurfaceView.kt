package dev.browser
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Region
import android.graphics.drawable.Drawable
import android.os.SystemClock
import android.os.Trace
import android.view.MotionEvent
import android.view.View
import android.view.ViewTreeObserver
import android.widget.FrameLayout
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoView
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.PanZoomController

class BrowserSurfaceView(val reactContext:ThemedReactContext):FrameLayout(reactContext) {
 var gecko:GeckoView=StableGeckoView(reactContext)
  private set
 private val coverGesture=ResizeCoverGestureGate()
 @Suppress("UNNECESSARY_LATEINIT") // Guard callbacks from Android's View constructor.
 private lateinit var resizeCover:GeckoResizeCover
 @Suppress("UNNECESSARY_LATEINIT")
 private lateinit var pullToRefresh:PullToRefreshHelper
 private val touchDetailObserver = object : GeckoTouchDetailObserver {
  override fun shouldRequestDetailResult(event:MotionEvent) =
   ::pullToRefresh.isInitialized && pullToRefresh.shouldRequestDetailResult(event)
  override fun onDetailResult(actionMasked:Int, result:GeckoResult<PanZoomController.InputResultDetail>) {
   if(::pullToRefresh.isInitialized) pullToRefresh.onDetailResult(actionMasked, result)
  }
 }
 private val childLayout=ResizeLayoutCoalescer(::layoutGecko)
 private var childLayoutTask:Runnable?=null
 private var hostLayoutDepth=0
 internal val isGeckoLayoutPending:Boolean get()=childLayout.hasPending || childLayout.isApplying
 internal val isResizeCoverDisplayed:Boolean get()=::resizeCover.isInitialized && resizeCover.isDisplayed
 var tabId=""
  set(value) {
   if(field!=value) {
    resizeCover.clear(); coverGesture.invalidate()
    if(::pullToRefresh.isInitialized) pullToRefresh.reset()
   }
   field=value
  }
 var initialUrl="about:blank"
  set(value) {
   field=value
   if(::pullToRefresh.isInitialized) pullToRefresh.updateUrl(value)
  }
 private val layoutRegion=Region()
 private val screenPosition=IntArray(2)
 private val screenMatrix=Matrix()
 private val surfaceMatrix=Matrix()
 private val screenOrigin=FloatArray(2)
 private val surfaceOrigin=FloatArray(2)
 private var positionedSession:GeckoSession?=null
 private var positionedX=0
 private var positionedY=0
 private val layoutListener=ViewTreeObserver.OnPreDrawListener {
  syncScreenOrigin()
  true
 }
 private fun syncScreenOrigin() {
  val session=gecko.session ?: return
  gecko.getLocationOnScreen(screenPosition)
  val x=screenPosition[0]
  val y=screenPosition[1]
  if(positionedSession===session && positionedX==x && positionedY==y) return
  // Fabric can lay out the TextureView without a root global-layout event.
  // Publish its final position before drawing, including initial surface creation.
  layoutRegion.setEmpty()
  gecko.gatherTransparentRegion(layoutRegion)
  session.getClientToScreenMatrix(screenMatrix)
  session.getClientToSurfaceMatrix(surfaceMatrix)
  screenOrigin.fill(0f)
  surfaceOrigin.fill(0f)
  screenMatrix.mapPoints(screenOrigin)
  surfaceMatrix.mapPoints(surfaceOrigin)
  // A not-yet-acquired display ignores the notification. Retry on later draws
  // instead of caching a position that Gecko has not received.
  if(screenOrigin[0]-surfaceOrigin[0]==x.toFloat() && screenOrigin[1]-surfaceOrigin[1]==y.toFloat()) {
   positionedSession=session
   positionedX=x
   positionedY=y
  }
 }
 init {
  resizeCover=GeckoResizeCover(this,gecko as StableGeckoView)
  pullToRefresh=PullToRefreshHelper(this) {
   if(tabId.isNotEmpty()) {
    send("topRefresh",Arguments.createMap().apply{putString("tabId",tabId)})
    GeckoSessionRegistry.navigate(reactContext,tabId,"reload")
   }
  }
  (gecko as? StableGeckoView)?.touchDetailObserver=touchDetailObserver
  addView(gecko,LayoutParams(LayoutParams.MATCH_PARENT,LayoutParams.MATCH_PARENT))
 }
 fun setPullToRefreshDisabled(disabled:Boolean) {
  if(::pullToRefresh.isInitialized) pullToRefresh.setDisabled(disabled)
 }
 fun setRefreshColors(accent:String?, surface:String?) {
  if(::pullToRefresh.isInitialized) pullToRefresh.setColors(accent, surface)
 }
 internal fun updateUrl(url:String) {
  if(::pullToRefresh.isInitialized) pullToRefresh.updateUrl(url)
 }
 internal fun updateScrollY(scrollY:Int) {
  if(::pullToRefresh.isInitialized) pullToRefresh.updateScrollY(scrollY)
 }
 internal fun updateLoading(loading:Boolean) {
  if(::pullToRefresh.isInitialized) pullToRefresh.updateLoading(loading)
 }
 fun bind() { if(tabId.isNotEmpty()) GeckoSessionRegistry.attach(this,tabId,initialUrl) }
 fun release() {
  resizeCover.clear(); coverGesture.invalidate()
  if(::pullToRefresh.isInitialized) pullToRefresh.reset()
  GeckoSessionRegistry.detach(this)
 }
 internal fun mediaPlaybackChanged(session:GeckoSession,playing:Boolean) {
  // Media may start after a resize captured its old picture. Retire that still
  // immediately and apply the latest child bounds, keeping gesture ownership.
  if(playing && gecko.session===session) resizeCover.clear()
 }
 override fun onSizeChanged(w:Int,h:Int,oldw:Int,oldh:Int) {
  super.onSizeChanged(w,h,oldw,oldh)
  resizeCover.resize(w,h,oldw,oldh)
 }
 override fun onLayout(changed:Boolean,left:Int,top:Int,right:Int,bottom:Int) {
  cancelChildLayoutTask()
  hostLayoutDepth++
  try {
   val token=childLayout.request(right-left,bottom-top,SystemClock.uptimeMillis(),resizeCover.isDisplayed)
   if(token!=null) {
    val task=object:Runnable {
     override fun run() {
      if(childLayoutTask!==this) return
      childLayoutTask=null
      if(!resizeCover.isDisplayed || !isAttachedToWindow || !isShown || gecko.parent!==this@BrowserSurfaceView) {
       resizeCover.clear()
       return
      }
      childLayout.settle(token,SystemClock.uptimeMillis())
     }
    }
    childLayoutTask=task
    postDelayed(task,ResizeLayoutCoalescer.SETTLE_MS)
   }
  } finally {
   hostLayoutDepth--
  }
 }
 private fun layoutGecko(width:Int,height:Int) {
  if(gecko.parent!==this) return
  Trace.beginSection("Yeoyu.GeckoChild.layout")
  try {
   // Parent measurement may already describe a later size. Outside traversal,
   // measure against the current host bounds before applying the final layout.
   if(hostLayoutDepth==0) super.onMeasure(
    MeasureSpec.makeMeasureSpec(width,MeasureSpec.EXACTLY),
    MeasureSpec.makeMeasureSpec(height,MeasureSpec.EXACTLY),
   )
   super.onLayout(true,0,0,width,height)
  } finally {
   Trace.endSection()
  }
 }
 private fun cancelChildLayoutTask() {
  childLayoutTask?.let(::removeCallbacks)
  childLayoutTask=null
 }
 internal fun flushPendingGeckoLayout() {
  cancelChildLayoutTask()
  if(isAttachedToWindow && gecko.parent===this) childLayout.flush(width,height)
  else childLayout.discard()
 }
 internal fun takeTransferredGeckoView():GeckoView = exchangeGeckoView(StableGeckoView(reactContext))
 internal fun adoptTransferredGeckoView(view:GeckoView) {
  if(gecko===view) {
   if(view.parent==null) addView(view,LayoutParams(LayoutParams.MATCH_PARENT,LayoutParams.MATCH_PARENT))
   return
  }
  val empty=exchangeGeckoView(view)
  empty.releaseSession()
 }
 private fun exchangeGeckoView(replacement:GeckoView):GeckoView {
  require(replacement.parent==null)
  resizeCover.clear()
  coverGesture.invalidate()
  if(::pullToRefresh.isInitialized) pullToRefresh.reset()
  val previous=gecko
  (previous as? StableGeckoView)?.touchDetailObserver=null
  if(previous.parent===this) removeView(previous)
  gecko=replacement
  (replacement as? StableGeckoView)?.touchDetailObserver=touchDetailObserver
  resizeCover=GeckoResizeCover(this,replacement as StableGeckoView)
  positionedSession=null
  addView(replacement,LayoutParams(LayoutParams.MATCH_PARENT,LayoutParams.MATCH_PARENT))
  requestLayout()
  return previous
 }
 override fun onVisibilityChanged(changedView:View,visibility:Int) {
  super.onVisibilityChanged(changedView,visibility)
  // Android can call this while the View constructor is still running.
  if(::resizeCover.isInitialized && !isShown) resizeCover.clear()
  if(::pullToRefresh.isInitialized && !isShown) pullToRefresh.reset()
 }
 override fun onViewRemoved(child:View) {
  if(child===gecko) { resizeCover.clear(); coverGesture.invalidate() }
  super.onViewRemoved(child)
 }
 override fun onAttachedToWindow() {
  super.onAttachedToWindow()
  positionedSession=null
  viewTreeObserver.addOnPreDrawListener(layoutListener)
  bind()
 }
 override fun onDetachedFromWindow() {
  if(viewTreeObserver.isAlive) viewTreeObserver.removeOnPreDrawListener(layoutListener)
  positionedSession=null
  release()
  super.onDetachedFromWindow()
 }
 override fun verifyDrawable(who:Drawable):Boolean =
  super.verifyDrawable(who) || (::pullToRefresh.isInitialized && pullToRefresh.ownsDrawable(who))
 override fun invalidateDrawable(drawable:Drawable) {
  if(::pullToRefresh.isInitialized && pullToRefresh.ownsDrawable(drawable)) invalidate()
  else super.invalidateDrawable(drawable)
 }
 override fun dispatchDraw(canvas:Canvas) {
  super.dispatchDraw(canvas)
  if(::pullToRefresh.isInitialized) pullToRefresh.draw(canvas)
 }
 override fun dispatchTouchEvent(event:MotionEvent):Boolean {
  val action=event.actionMasked
  if(coverGesture.consume(
   action==MotionEvent.ACTION_DOWN,
   action==MotionEvent.ACTION_UP || action==MotionEvent.ACTION_CANCEL,
   resizeCover.isDisplayed,
   gecko.session,
  )) {
   if(::pullToRefresh.isInitialized) pullToRefresh.reset()
   return true
  }
  return super.dispatchTouchEvent(event)
 }
 override fun onInterceptTouchEvent(event:MotionEvent):Boolean {
  if(event.actionMasked==MotionEvent.ACTION_DOWN) {
   send("topFocused",Arguments.createMap().apply{putString("tabId",tabId)})
   gecko.requestFocus()
  }
  if(::pullToRefresh.isInitialized && pullToRefresh.onInterceptTouchEvent(event)) return true
  return super.onInterceptTouchEvent(event)
 }
 override fun onTouchEvent(event:MotionEvent):Boolean {
  if(::pullToRefresh.isInitialized && pullToRefresh.onTouchEvent(event)) return true
  return super.onTouchEvent(event)
 }
 fun navigation(payload:WritableMap) { send("topNavigation",payload) }
 private fun send(name:String,payload:WritableMap) {
  UIManagerHelper.getEventDispatcherForReactTag(reactContext,id)?.dispatchEvent(
   BrowserEvent(UIManagerHelper.getSurfaceId(reactContext),id,name,payload))
 }
 private class BrowserEvent(surface:Int,view:Int,val name:String,val payload:WritableMap):Event<BrowserEvent>(surface,view) {
  override fun getEventName()=name
  override fun getEventData()=payload
  override fun canCoalesce()=false
 }
}
