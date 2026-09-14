package dev.browser
import org.junit.Assert.*
import org.junit.Test
class SpaceTransitionPolicyTest {
 private val a=SpaceSurfaceIdentity("a",Any(),4)
 private val b=SpaceSurfaceIdentity("b",Any(),7)
 private fun ticket(p:SpaceTransitionPolicy, from:SpaceSurfaceIdentity, to:SpaceSurfaceIdentity, now:Long):SpaceTransitionPolicy.Ticket {
  val result=p.begin(from,to,now);assertNotNull("valid Space transition must reserve a ticket",result);return result!!
 }
 @Test fun `departure cannot remove installed pixels before exact incoming frame`() {
  val p=SpaceTransitionPolicy();val t=ticket(p,a,b,100);val owner=Any()
  assertTrue(p.captured(t,110));assertTrue(p.displayed)
  assertFalse(p.frame(t,b,owner));assertTrue(p.displayed)
  assertTrue(p.attached(t,b,owner));assertTrue(p.displayed)
  assertFalse(p.frame(t,a,owner));assertTrue(p.displayed)
  assertTrue(p.frame(t,b,owner));assertFalse(p.displayed);assertNull(p.current)
 }
 @Test fun `different document session or replacement owner cannot release the cover`() {
  val p=SpaceTransitionPolicy();val t=ticket(p,a,b,0);val owner=Any()
  assertTrue(p.captured(t,1));assertTrue(p.attached(t,b,owner))
  assertFalse(p.frame(t,b.copy(document=8),owner));assertFalse(p.frame(t,b.copy(session=Any()),owner))
  assertFalse(p.frame(t,b,Any()));assertFalse(p.attached(t,b,Any()));assertTrue(p.displayed)
  assertTrue(p.frame(t,b,owner))
 }
 @Test fun `rapid reverse rejects previous capture timeout and frame callbacks`() {
  val p=SpaceTransitionPolicy();val old=ticket(p,a,b,0);assertTrue(p.captured(old,1))
  val latest=ticket(p,b,a,10);val owner=Any();assertTrue(p.captured(latest,11));assertTrue(p.attached(latest,a,owner))
  assertFalse(p.captured(old,12));assertFalse(p.expired(old,501));assertFalse(p.cancel(old))
  assertFalse(p.frame(old,b,owner));assertTrue(p.displayed);assertSame(latest,p.current)
 }
 @Test fun `absolute deadline includes capture and does not restart on incoming attachment`() {
  val p=SpaceTransitionPolicy();val t=ticket(p,a,b,100)
  assertTrue(p.captured(t,550));assertTrue(p.attached(t,b,Any()))
  assertFalse(p.expired(t,599));assertTrue(p.expired(t,600));assertNull(p.current)
  val late=ticket(p,a,b,1000);assertFalse(p.captured(late,1500));assertNull(p.current)
 }
 @Test fun `source or destination invalidation clears once and late capture stays cancelled`() {
  val p=SpaceTransitionPolicy();val t=ticket(p,a,b,0)
  assertTrue(p.cancel(t));assertFalse(p.captured(t,10));assertFalse(p.cancel(t));assertFalse(p.displayed)
 }
 @Test fun `covered down clears pixels and consumes the whole sequence after cover is gone`() {
  val p=SpaceTransitionPolicy();val t=ticket(p,a,b,0);assertTrue(p.captured(t,1))
  assertTrue(p.touch(true,false,true));assertFalse(p.displayed)
  assertTrue(p.touch(false,false,false));assertTrue(p.touch(false,true,false))
  assertFalse(p.touch(true,false,true));assertFalse(p.touch(false,true,true))
 }
 @Test fun `chrome down clears cover and continues through chrome normally`() {
  val p=SpaceTransitionPolicy();val t=ticket(p,a,b,0);assertTrue(p.captured(t,1))
  assertFalse(p.touch(true,false,false));assertFalse(p.displayed);assertNull(p.current)
  assertFalse(p.touch(false,true,true))
 }
 @Test fun `existing drag remains unconsumed when cover appears mid gesture`() {
  val p=SpaceTransitionPolicy();assertFalse(p.touch(true,false,true))
  val t=ticket(p,a,b,0);assertTrue(p.captured(t,1))
  assertFalse(p.touch(false,false,true));assertFalse(p.displayed);assertFalse(p.touch(false,true,true))
 }
 @Test fun `capture memory remains bounded for tablet and extremely narrow dimensions`() {
  for ((width,height) in listOf(2560 to 1950,3200 to 2000,Int.MAX_VALUE to 1)) {
   val size=spaceCoverBitmapSize(width,height);assertNotNull(size)
   assertTrue(size!!.first>0 && size.second>0);assertTrue(size.first.toLong()*size.second<=8_000_000L)
   assertTrue(size.first<=width && size.second<=height)
  }
  assertEquals(320 to 200,spaceCoverBitmapSize(320,200));assertNull(spaceCoverBitmapSize(0,100))
 }
 @Test fun `tablet cover preserves original pixels without resampling`() {
  assertEquals(2560 to 1950,spaceCoverBitmapSize(2560,1950))
  assertEquals(3200 to 2000,spaceCoverBitmapSize(3200,2000))
 }
 @Test fun `larger surfaces still respect the single bitmap memory budget`() {
  assertEquals(4000 to 2000,spaceCoverBitmapSize(8000,4000))
  val extreme=spaceCoverBitmapSize(Int.MAX_VALUE,1)!!
  assertTrue(extreme.first.toLong()*extreme.second<=8_000_000L)
 }
 @Test fun `generic cancellation preserves the tail of a covered touch`() {
  val p=SpaceTransitionPolicy();val t=ticket(p,a,b,0);assertTrue(p.captured(t,1))
  assertTrue(p.touch(true,false,true));assertFalse(p.displayed)
  p.cancel()
  assertTrue(p.touch(false,false,false));assertTrue(p.touch(false,true,false))
  assertFalse(p.touch(true,false,false));assertFalse(p.touch(false,true,false))
 }
 @Test fun `same tab or same session never starts a Space cover`() {
  val p=SpaceTransitionPolicy();assertNull(p.begin(a,a,0));assertNull(p.begin(a,b.copy(session=a.session),0))
 }
 @Test fun `root coordinates use the actual root offset and reject clipping or invalid dimensions`() {
  val root=SpaceCoverRect(100,50,3300,2050)
  assertEquals(SpaceCoverRect(616,26,3176,1976),spaceCoverRootRect(SpaceCoverRect(716,76,3276,2026),root))
  assertNull(spaceCoverRootRect(SpaceCoverRect(90,76,3276,2026),root))
  assertNull(spaceCoverRootRect(SpaceCoverRect(716,76,3400,2026),root))
  assertNull(spaceCoverRootRect(SpaceCoverRect(716,76,716,2026),root))
 }
 @Test fun `Fabric binding before parent attachment preserves the cover until a rooted texture arrives`() {
  val p=SpaceTransitionPolicy();val t=ticket(p,a,b,0);val owner=Any()
  assertTrue(p.captured(t,1))
  assertTrue("props can bind before the incoming native child has a root",spaceCoverCanObserveOwner(false,false))
  assertTrue(p.attached(t,b,owner));assertTrue(p.displayed)
  assertFalse("an attached owner in another root must be rejected",spaceCoverCanObserveOwner(true,false))
  assertTrue(spaceCoverCanObserveOwner(true,true));assertTrue(p.frame(t,b,owner))
 }

 @Test fun `translucency in either alpha channel skips the frozen source pixels`() {
  assertFalse(spaceCoverStableAncestor(0.9f,1f,false,false))
  assertFalse(spaceCoverStableAncestor(1f,0.5f,false,false))
  assertFalse(spaceCoverStableAncestor(Float.NaN,1f,false,false))
  assertTrue(spaceCoverStableAncestor(1f,1f,false,false))
 }
 @Test fun `unknown transition opacity and legacy or layout animations are not safe to snapshot`() {
  assertFalse(spaceCoverStableAncestor(1f,null,false,false))
  assertFalse(spaceCoverStableAncestor(1f,1f,true,false))
  assertFalse(spaceCoverStableAncestor(1f,1f,false,true))
 }

}
