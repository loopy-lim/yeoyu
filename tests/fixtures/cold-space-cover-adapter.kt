package dev.browser
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

// Android scheduling, window pixels and views are controlled here. Coordinator/Registry
// method bodies are inserted verbatim from the selected production source by adapter.py.
object SystemClock { var now=0L; fun uptimeMillis()=now }
object Build { object VERSION { const val SDK_INT=37 } }
object android { object R { object id { const val content=1 } } }
object Log { fun i(tag:String,value:String) {} }
open class View {
 var width=100;var height=100;var isAttachedToWindow=true;var isShown=true
 var bounds=SpaceCoverRect(0,0,100,100);var parent:Any?=null;var stable=true
 val viewTreeObserver=ViewTreeObserver(); val listeners=mutableListOf<OnAttachStateChangeListener>()
 interface OnAttachStateChangeListener { fun onViewAttachedToWindow(view:View);fun onViewDetachedFromWindow(view:View) }
 interface OnLayoutChangeListener
 fun addOnAttachStateChangeListener(listener:OnAttachStateChangeListener?) { if(listener!=null)listeners.add(listener) }
 fun removeOnAttachStateChangeListener(listener:OnAttachStateChangeListener) { listeners.remove(listener) }
 fun removeOnLayoutChangeListener(listener:OnLayoutChangeListener) {}
 fun detach(){isAttachedToWindow=false;listeners.toList().forEach{it.onViewDetachedFromWindow(this)}}
}
class ViewTreeObserver { var isAlive=true;val listeners=mutableListOf<OnPreDrawListener>()
 fun interface OnPreDrawListener { fun onPreDraw():Boolean }
 fun addOnPreDrawListener(listener:OnPreDrawListener?){if(listener!=null)listeners.add(listener)}
 fun removeOnPreDrawListener(listener:OnPreDrawListener){listeners.remove(listener)}
 fun draw(){listeners.toList().forEach{it.onPreDraw()}}
}
class ViewGroup:View(){val overlay=Overlay()}
class Overlay {fun remove(drawable:Drawable){}}
class Drawable
class Handler {val pending=mutableListOf<Pair<Long,Runnable>>()
 fun postDelayed(r:Runnable,delay:Long){pending.add(SystemClock.now+delay to r)}
 fun removeCallbacks(r:Runnable){pending.removeAll{it.second===r}}
 fun advance(now:Long){SystemClock.now=now;pending.filter{it.first<=now}.toList().forEach{pending.remove(it);it.second.run()}}
}
open class Activity {var isInPictureInPictureMode=false;var focused=true;var isFinishing=false;var isDestroyed=false
 val root=ViewGroup();val packageName="test";fun hasWindowFocus()=focused
 @Suppress("UNCHECKED_CAST") fun <T> findViewById(id:Int):T?=root as? T
}
class Lifecycle {enum class State{STARTED,RESUMED};var currentState=State.RESUMED}
class MainActivity:Activity(){val lifecycle=Lifecycle();val browserPip=BrowserPip()}
class BrowserPip {var hasDisplayTransfer=false}
typealias Context=Activity
class GeckoSession {var isOpen=true;object PermissionDelegate{class ContentPermission}}
class StableGeckoView(var session:GeckoSession):View()
class BrowserSurfaceView(val gecko:StableGeckoView,val root:ViewGroup):View(){init{gecko.parent=this}}
class Security {fun optString(key:String):String?=null}
object ExternalPictureInPicture {var held:GeckoSession?=null;fun holdsSession(session:GeckoSession)=held===session}
object InputRouter {val engine=Engine();class Engine {var chromeModalActive=false;var addressInputActive=false}}
class MotionEvent(val actionMasked:Int,val rawX:Float=0f,val rawY:Float=0f){companion object{const val ACTION_DOWN=0;const val ACTION_UP=1;const val ACTION_CANCEL=3}}
class LifecycleEventObserver
object GeckoSessionRegistry {
 class Entry(val session:GeckoSession,val initialUrl:String,var documentGeneration:Long=0){
  var url=initialUrl;var activityVersion=0L;var security:Security?=null
  var owner:BrowserSurfaceView?=null;var playing=false;var fullscreen=false
  var lastContentfulPaintDocument=-1L
  val initialNavigation=InitialNavigationAdmission(initialUrl,true){true}
  val initialNavigationLocationAccepted get()=initialNavigation.locationAccepted
 }
 val entries=mutableMapOf<String,Entry>();var activeIds:Set<String>?=setOf("a","b");val suspended=mutableMapOf<String,String>()
 val isolation=SessionIsolationBarrier();var ensureCalls=0;var blocked=false
 var onEnsure:((Entry)->Unit)?=null;val publications=mutableListOf<String>()
 fun entry(id:String)=entries[id]
 fun isPictureInPictureBlocked(id:String)=blocked
 fun ensure(context:Context,id:String,url:String):Entry {ensureCalls++;return entries.getOrPut(id){Entry(GeckoSession(),url)}.also{onEnsure?.invoke(it)}}
 fun canonicalBrowserOrigin(url:String)=url.takeIf{it.startsWith("https://")||it.startsWith("http://")}
 fun navigationTargetUrl(url:String?,old:String)=url?:old
 fun traceBootstrap(event:String,url:String?=null){}
 fun changed(id:String){publications.add(entries.getValue(id).url)}
 // @REGISTRY_METHODS@
 fun location(id:String,e:Entry,url:String?,hasUserGesture:Boolean=false){
  fun current()=entries[id]===e
  // @LOCATION_BODY@
 }
 fun firstPaint(id:String,e:Entry){fun current()=entries[id]===e
  // @FCP_BODY@
 }
 fun resetPaint(id:String,e:Entry){fun current()=entries[id]===e
  // @RESET_BODY@
 }
 fun pageStart(id:String,e:Entry,url:String){
  if(entries[id]!==e || !e.initialNavigation.acceptPageStart(url))return
  // @PAGE_PREFIX@
 }
 fun retire(id:String):Boolean{
  // @RETIRE_PREFIX@
 }
}
class ReturnCapture {val ticket=ReturnCoverPolicy.Ticket(1,1,0);var mayInstall:(()->Boolean)?=null;val destinations=emptyList<Destination>()}
class Destination {var owner:BrowserSurfaceView?=null;var gecko:StableGeckoView?=null;var texture:View?=null;var layout:Any?=null;var listener:View.OnLayoutChangeListener?=null;val identity=Identity();class Identity{val tab=""}}
object SpaceTransitionCover {
 val policy=SpaceTransitionPolicy();val returnPolicy=ReturnCoverPolicy();val main=Handler()
 private var active:Pending?=null;private var coldPending:ColdPreparation?=null
 var copyInFlight=false;private var gestureActivity:Activity?=null;var captures=0;var returnCalls=0
 private var captured:Pending?=null
 // @CLASSES@
 private fun identity(id:String,entry:GeckoSessionRegistry.Entry)=SpaceSurfaceIdentity(id,entry.session,entry.documentGeneration)
 private fun isBelow(owner:BrowserSurfaceView,root:ViewGroup)=owner.root===root
 private fun screenBounds(view:View)=view.bounds
 private fun fullyVisible(view:View)=view.isShown&&view.isAttachedToWindow
 private fun stableSource(view:View,root:ViewGroup)=view.stable
 private fun trace(p:Pending,event:String){}
 private fun stopWaitingForReturnResume(p:Pending){}
 private fun complete(p:Pending){p.publication.complete()}
 private fun capture(p:Pending){captures++;active=p;captured=p}
 fun completeCopy(){val p=captured?:return;if(active===p&&valid(p,true)&&policy.captured(p.ticket,SystemClock.now)){p.drawable=Drawable();p.publication.complete()}}
 fun ticket()=policy.current
 fun waiting()=coldPending!=null
 fun showing()=active?.drawable!=null
 private fun validReturn(p:Pending,beforeCopy:Boolean,allowStarted:Boolean)=true
 private fun attachReturn(p:Pending,id:String,entry:GeckoSessionRegistry.Entry,owner:BrowserSurfaceView){returnCalls++}
 private fun returnTextureUpdated(p:Pending,view:StableGeckoView){returnCalls++}
 // @COVER_METHODS@
 fun reset(){clear();captures=0;captured=null;copyInFlight=false;main.pending.clear();gestureActivity=null;policy.touch(false,true,false);returnCalls=0}
}
class ColdSpaceAdapterTest {
 lateinit var activity:MainActivity;lateinit var source:GeckoSessionRegistry.Entry;var replies=0
 @Before fun reset(){SpaceTransitionCover.reset();SystemClock.now=0;GeckoSessionRegistry.entries.clear();GeckoSessionRegistry.suspended.clear();GeckoSessionRegistry.activeIds=setOf("a","b");GeckoSessionRegistry.isolation.reconcile(emptySet());GeckoSessionRegistry.isolation.end();GeckoSessionRegistry.ensureCalls=0;GeckoSessionRegistry.onEnsure=null;GeckoSessionRegistry.blocked=false;GeckoSessionRegistry.publications.clear();ExternalPictureInPicture.held=null;InputRouter.engine.chromeModalActive=false;InputRouter.engine.addressInputActive=false;activity=MainActivity();source=GeckoSessionRegistry.Entry(GeckoSession(),"https://a.test",9);source.owner=BrowserSurfaceView(StableGeckoView(source.session),activity.root);GeckoSessionRegistry.entries["a"]=source;replies=0}
 fun prepare(){SpaceTransitionCover.prepareCold(activity,"a","b","https://b.test"){replies++}}
 fun target()=GeckoSessionRegistry.entries.getValue("b")
 fun ready(e:GeckoSessionRegistry.Entry=target(),document:Long=17){e.documentGeneration=document;GeckoSessionRegistry.location("b",e,"https://b.test")}
 fun attach(e:GeckoSessionRegistry.Entry=target()):BrowserSurfaceView {source.owner=null;val owner=BrowserSurfaceView(StableGeckoView(e.session),activity.root);e.owner=owner;SpaceTransitionCover.attached("b",e,owner);return owner}
 @Test fun `actual callback admits missing target before publication and seeds real document once`(){prepare();assertEquals(1,GeckoSessionRegistry.ensureCalls);assertEquals(0,replies);assertTrue(SpaceTransitionCover.waiting());assertEquals(0,SpaceTransitionCover.captures);GeckoSessionRegistry.pageStart("b",target(),"about:blank");GeckoSessionRegistry.location("b",target(),"about:blank");assertEquals(0,SpaceTransitionCover.captures);SystemClock.now=80;ready();assertEquals(1,SpaceTransitionCover.captures);assertEquals(17L,SpaceTransitionCover.ticket()!!.target.document);assertEquals(0L,SpaceTransitionCover.ticket()!!.started);assertEquals(0,replies);SpaceTransitionCover.completeCopy();assertEquals(1,replies);assertEquals("https://b.test",GeckoSessionRegistry.publications.last());SpaceTransitionCover.initialNavigationReady("b",target());assertEquals(1,SpaceTransitionCover.captures)}
 @Test fun `synchronous ready during ensure is observed without a listener gap`(){GeckoSessionRegistry.onEnsure={e->e.documentGeneration=23;GeckoSessionRegistry.location("b",e,"https://b.test")};prepare();assertEquals(1,SpaceTransitionCover.captures);assertEquals(23L,SpaceTransitionCover.ticket()!!.target.document)}
 @Test fun `source and native admission eligibility precede session creation`(){for(invalid in listOf<()->Unit>({source.playing=true},{activity.focused=false},{source.owner!!.gecko.stable=false},{GeckoSessionRegistry.activeIds=setOf("a")},{GeckoSessionRegistry.isolation.pause("b")},{GeckoSessionRegistry.suspended["b"]="memory"})){reset();invalid();prepare();assertEquals(0,GeckoSessionRegistry.ensureCalls);assertEquals(1,replies)}}
 @Test fun `initial wait timeout releases once and old readiness cannot start copy`(){prepare();val old=target();SpaceTransitionCover.main.advance(500);assertEquals(1,replies);ready(old);assertEquals(0,SpaceTransitionCover.captures);assertEquals(1,replies);assertTrue(activity.root.viewTreeObserver.listeners.isEmpty());assertTrue(activity.root.listeners.isEmpty())}
 @Test fun `source navigation retire and same id replacement cannot transfer pending identity`(){for(cancel in listOf<()->Unit>({GeckoSessionRegistry.pageStart("a",source,"https://a.test/next")},{GeckoSessionRegistry.retire("b")},{GeckoSessionRegistry.entries["b"]=GeckoSessionRegistry.Entry(GeckoSession(),"https://b.test")})){reset();prepare();val old=target();cancel();activity.root.viewTreeObserver.draw();ready(old);assertEquals(0,SpaceTransitionCover.captures);assertEquals(1,replies)}}
 @Test fun `input stop and detach unblock a wait and do not consume truthful source input`(){for(cancel in listOf<()->Unit>({assertFalse(SpaceTransitionCover.touch(activity,MotionEvent(0)))},{SpaceTransitionCover.scrollInput(activity)},{SpaceTransitionCover.keyInput()},{SpaceTransitionCover.activityStopped(activity)},{activity.root.detach()},{activity.root.bounds=SpaceCoverRect(0,0,90,100);activity.root.viewTreeObserver.draw()})){reset();prepare();val old=target();cancel();ready(old);assertEquals(1,replies);assertEquals(0,SpaceTransitionCover.captures)}}
 @Test fun `cold texture needs current document FCP and a subsequent callback after paint reset`(){prepare();ready();SpaceTransitionCover.completeCopy();val owner=attach();SpaceTransitionCover.textureUpdated(owner.gecko);assertTrue(SpaceTransitionCover.showing());GeckoSessionRegistry.firstPaint("b",target());GeckoSessionRegistry.resetPaint("b",target());SpaceTransitionCover.textureUpdated(owner.gecko);assertTrue(SpaceTransitionCover.showing());GeckoSessionRegistry.firstPaint("b",target());assertTrue(SpaceTransitionCover.showing());SpaceTransitionCover.textureUpdated(owner.gecko);assertFalse(SpaceTransitionCover.showing());assertEquals(1,replies)}
 @Test fun `cold ticket cancels on later document without repainting its identity`(){prepare();ready();SpaceTransitionCover.completeCopy();val owner=attach();GeckoSessionRegistry.pageStart("b",target(),"https://b.test/new");assertFalse(SpaceTransitionCover.showing());GeckoSessionRegistry.firstPaint("b",target());SpaceTransitionCover.textureUpdated(owner.gecko);assertEquals(1,replies);assertEquals(1,SpaceTransitionCover.captures)}
 @Test fun `Registry retirement completes the wait before a future UI frame`(){prepare();GeckoSessionRegistry.retire("b");assertEquals(1,replies);assertFalse(SpaceTransitionCover.waiting());assertTrue(activity.root.listeners.isEmpty())}
 @Test fun `warm cover still releases its first valid texture without FCP`(){val e=GeckoSessionRegistry.Entry(GeckoSession(),"https://b.test",8);GeckoSessionRegistry.entries["b"]=e;GeckoSessionRegistry.location("b",e,"https://b.test");prepare();assertEquals(0,GeckoSessionRegistry.ensureCalls);SpaceTransitionCover.completeCopy();val owner=attach(e);SpaceTransitionCover.textureUpdated(owner.gecko);assertFalse(SpaceTransitionCover.showing());assertEquals(1,replies)}
 @Test fun `readiness after most of budget leaves no fresh five hundred milliseconds`(){prepare();SystemClock.now=490;ready();assertEquals(0L,SpaceTransitionCover.ticket()!!.started);SystemClock.now=501;SpaceTransitionCover.completeCopy();assertFalse(SpaceTransitionCover.showing());SpaceTransitionCover.keyInput();assertEquals(1,replies)}
}
