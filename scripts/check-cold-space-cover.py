#!/usr/bin/env python3
"""Actual coordinator/Registry method adapter. Requires the cached project Kotlin/JUnit toolchain.

Android rendering/PixelCopy are controlled effects, not physical paint evidence.
The optional baseline adapter only forwards to existing warm preparation.
"""
from pathlib import Path
import argparse,os,subprocess,sys,re,tempfile
repo=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser(description="Execute production cold-Space callbacks with deterministic Android scheduling/view adapters; no device or Gradle.")
parser.add_argument('--source-root',type=Path,default=repo)
parser.add_argument('--output',type=Path)
parser.add_argument('--baseline',action='store_true',help='Forward the absent cold API to original warm prepare only for a before-fix regression run')
args=parser.parse_args()
root=args.source_root
out=args.output or Path(tempfile.mkdtemp(prefix='yeoyu-cold-space-adapter-'))
out.mkdir(parents=True,exist_ok=True)
registry=(root/'android/app/src/main/java/dev/browser/GeckoSessionRegistry.kt').read_text()
cover=(root/'android/app/src/main/java/dev/browser/SpaceTransitionCover.kt').read_text()
def block(s,marker):
 start=s.index(marker)
 if marker=='private fun validCold(': return s[start:s.index('    private fun detachCold(',start)]
 begin=s.index('{',start);n=1;i=begin+1
 while n:
  if s[i]=='{':n+=1
  elif s[i]=='}':n-=1
  i+=1
 return s[start:i]
def body(s,marker):
 a=block(s,marker);return a[a.index('{')+1:-1]
classes=block(cover,'private class Pending(')+'\n'+(block(cover,'private class ColdPreparation(') if 'private class ColdPreparation(' in cover else 'private class ColdPreparation')
methods=['fun prepare(','fun attached(','fun textureUpdated(','fun touch(','fun scrollInput(','fun keyInput(','fun activityStopped(','private fun valid(','private fun clear(']
methodtext='\n'.join(block(cover,m) for m in methods)
new=['fun prepareCold(','fun initialNavigationReady(','fun coldDocumentChanged(','fun coldEntryRetired(','private fun validCold(','private fun detachCold(','private fun clearCold(']
if 'fun prepareCold(' in cover:methodtext+='\n'+'\n'.join(block(cover,m) for m in new)
elif args.baseline:
 # No cold API exists in the original source. The forward adapter calls the existing
 # two-argument preparation without adding any eligibility/cold state implementation.
 methodtext+='\nfun prepareCold(activity:Activity?,from:String,to:String,url:String,reply:()->Unit){prepare(activity,from,to,reply)}\nfun initialNavigationReady(id:String,e:GeckoSessionRegistry.Entry){}'
else: raise RuntimeError('Cold prepare API missing; use --baseline only for the original-source control')
regmethods=block(registry,'internal fun spaceTransitionPair(')
if 'internal fun coldSpaceSource(' in registry:regmethods+='\n'+block(registry,'internal fun coldSpaceSource(')+'\n'+block(registry,'internal fun prepareColdSpaceTarget(')
page=body(registry,'override fun onPageStart(')
page=page[page.index('e.documentGeneration += 1'):page.index('SpaceTransitionCover.returnDocumentChanged(id)')]
retire=body(registry,'private fun retireEntry(')
retire=retire[:retire.index('SpaceTransitionCover.returnDocumentChanged(id)')].strip()+'\nreturn true'
contents=(repo/'tests/fixtures/cold-space-cover-adapter.kt').read_text()
replace={'CLASSES':classes,'COVER_METHODS':methodtext,'REGISTRY_METHODS':regmethods,'LOCATION_BODY':body(registry,'override fun onLocationChange('),'FCP_BODY':body(registry,'override fun onFirstContentfulPaint('),'RESET_BODY':body(registry,'override fun onPaintStatusReset(') if 'override fun onPaintStatusReset(' in registry else '', 'PAGE_PREFIX':page,'RETIRE_PREFIX':retire}
for key,value in replace.items():contents=contents.replace('// @'+key+'@',value)
contents=re.sub(r'^(object |class |open class |typealias )',r'internal \1',contents,flags=re.M)
sandbox=out;(sandbox/'Adapter.kt').write_text(contents)
cache=Path(os.environ.get('GRADLE_USER_HOME',Path.home()/'.gradle'))/'caches/modules-2/files-2.1'
def jar(g,n,v):return str(next((cache/g/n/v).glob('*/*.jar')))
stdlib=jar('org.jetbrains.kotlin','kotlin-stdlib','2.4.10');annotations=jar('org.jetbrains','annotations','23.0.0')
compiler=':'.join([jar('org.jetbrains.kotlin','kotlin-compiler-embeddable','2.4.10'),stdlib,annotations,jar('org.jetbrains.kotlinx','kotlinx-coroutines-core-jvm','1.10.2'),jar('org.jetbrains.kotlin','kotlin-reflect','2.0.21')])
cp=':'.join([stdlib,annotations,jar('junit','junit','4.13.2'),jar('org.hamcrest','hamcrest-core','1.3')])
sources=[sandbox/'Adapter.kt']+[root/'android/app/src/main/java/dev/browser'/f'{n}.kt' for n in ['InitialNavigationAdmission','SpaceTransitionPolicy','ReturnCoverPolicy','SessionLifecyclePolicy']]
r=subprocess.run(['java','-cp',compiler,'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler','-no-stdlib','-no-reflect','-classpath',cp,'-d',str(sandbox/'classes'),*map(str,sources)],capture_output=True,text=True)
(sandbox/'compile.log').write_text(r.stdout+r.stderr)
if r.returncode:print(r.stdout+r.stderr);sys.exit(r.returncode)
r=subprocess.run(['java','-cp',str(sandbox/'classes')+':'+cp,'org.junit.runner.JUnitCore','dev.browser.ColdSpaceAdapterTest'])
sys.exit(r.returncode)
