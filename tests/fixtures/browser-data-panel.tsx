import { mock } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { BrowserController } from "../../src/BrowserController";
import { defaultUiPreferences } from "../../src/uiPreferences";
import { portablePresentation } from "../../src/workArchive";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let alertButtons: {text:string; onPress?:()=>void}[] = [];
let file = JSON.stringify({format:"yeoyu-work",version:1,spaces:[{name:"한글"}],keyBindings:[{key:"N",ctrl:true,command:"tab.new"}]});
mock.module("react-native", () => ({
  Alert: {alert(_title:string,_body:string,buttons: typeof alertButtons) { alertButtons = buttons; }},
  View: "View", Text: "Text", Pressable: "Pressable", Switch: "Switch",
  StyleSheet: {create: (value:unknown)=>value},
  NativeModules: {BrowserData: {chooseImport: async()=>file, chooseExport: async()=>"saved"}},
}));
const { BrowserDataPanel } = await import("../../src/components/BrowserDataPanel");
const imports: unknown[] = [], errors: string[] = [], notices: string[] = [];
const presentation = portablePresentation({...defaultUiPreferences,appearance:"warm"});
let exportSignal: AbortSignal | undefined;
const controller = {
  previewArchive: async (json:string) => {
    if (JSON.parse(json).format !== "yeoyu-work") throw Error("Unsupported archive");
    return {spaces:1,tabs:2,bookmarks:3,folders:1,favorites:1,duplicateUrls:1,hasKeyBindings:true,presentation};
  },
  importArchive: async (...options:unknown[]) => { imports.push(options); },
  exportArchive: (_presentation:string|null, signal?:AbortSignal) => {
    exportSignal = signal;
    return new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () =>
        reject(Object.assign(new Error('invoke("workArchiveExport") aborted'), {code:"cancelled"})));
    });
  },
} as unknown as BrowserController;
let renderer: ReactTestRenderer;
await act(async()=>{ renderer=create(<BrowserDataPanel controller={controller} ui={defaultUiPreferences} hydrated onPresentation={async()=>{throw Error("disk failed");}} onError={(error)=>errors.push(error)} onNotice={(notice)=>notices.push(notice)} />); });
const press = async(label:string)=>act(async()=>{renderer.root.findByProps({accessibilityLabel:label}).props.onPress();});
await press("Import bookmarks or work archive");
assert.equal(renderer!.root.findByProps({accessibilityLabel:"Replace keyboard shortcuts"}).props.value,false);
assert.equal(renderer!.root.findByProps({accessibilityLabel:"Apply imported appearance"}).props.value,false);
await act(async()=>{renderer!.root.findByProps({accessibilityLabel:"Apply imported appearance"}).props.onValueChange(true);});
await press("Add imported data");
assert.equal(imports.length,0,"confirmation must precede data mutation");
await act(async()=>{const action=alertButtons.find(b=>b.text==="Import")!.onPress!; action(); action();});
assert.equal(imports.length,1,"double confirmation cannot duplicate the append");
assert.deepEqual((imports[0] as unknown[]).slice(1,3),[true,false]);
assert.ok((imports[0] as unknown[]).at(-1) instanceof AbortSignal);
assert.equal(errors.length,1);
assert.match(errors[0],/data was imported/i);
// A late abort after commit must not mask a post-commit appearance failure.
errors.length = 0;
notices.length = 0;
controller.importArchive = (async (...options: unknown[]) => {
  imports.push(options);
  return {version:1,revision:0,workspaces:[],tabs:[],activeWorkspaceId:"w",activeTabId:null,keyBindings:[]};
}) as BrowserController["importArchive"];
await act(async()=>{
  renderer!.update(
    <BrowserDataPanel controller={controller} ui={defaultUiPreferences} hydrated
      onPresentation={async()=>{await new Promise((r)=>setTimeout(r,200)); throw Error("disk failed");}}
      onError={(error)=>errors.push(error)} onNotice={(notice)=>notices.push(notice)} />);
});
file = JSON.stringify({format:"yeoyu-work",version:1,spaces:[{name:"한글"}],keyBindings:[{key:"N",ctrl:true,command:"tab.new"}]});
await press("Import bookmarks or work archive");
await act(async()=>{renderer!.root.findByProps({accessibilityLabel:"Apply imported appearance"}).props.onValueChange(true);});
await press("Add imported data");
await act(async()=>{alertButtons.find(b=>b.text==="Import")!.onPress!();});
await act(async()=>{
  await new Promise((r)=>setTimeout(r,10));
  const cancel = renderer!.root.findAllByProps({accessibilityLabel:"Cancel data operation"});
  assert.ok(cancel.length,"cancel should stay visible through post-commit presentation");
  cancel[0]!.props.onPress();
  await new Promise((r)=>setTimeout(r,220));
});
assert.equal(errors.length,1,"post-commit failures stay errors after abort");
assert.match(errors[0],/data was imported/i);
assert.equal(notices.some((notice)=>/cancelled/i.test(notice)),false);
assert.equal(renderer!.root.findAllByProps({accessibilityLabel:"Add imported data"}).length,0,"appearance failure cannot leave an import retry button");
file = '{"format":"wrong"}';
await press("Import bookmarks or work archive");
assert.equal(imports.length,2);
assert.equal(renderer!.root.findAllByProps({accessibilityLabel:"Add imported data"}).length,0);
// Cancelling an in-flight archive invoke frees the panel without an error dialog.
const errorsBeforeCancel = errors.length;
await press("Export work archive");
await act(async()=>{alertButtons.find(b=>b.text==="Choose destination")!.onPress!();});
assert.ok(exportSignal instanceof AbortSignal,"the panel must thread its AbortSignal into the invoke");
const cancel = renderer!.root.findByProps({accessibilityLabel:"Cancel data operation"});
await act(async()=>{cancel.props.onPress();});
assert.equal(exportSignal.aborted,true);
assert.equal(errors.length,errorsBeforeCancel,"cancellation is a notice, not an error");
assert.match(notices.at(-1)!,/cancelled/i);
assert.equal(renderer!.root.findAllByProps({accessibilityLabel:"Cancel data operation"}).length,0,"busy clears after cancellation");
assert.equal(renderer!.root.findByProps({accessibilityLabel:"Export work archive"}).props.disabled,false);
// Recovery-required failures must not be masked as a cancellation notice.
notices.length = 0;
errors.length = 0;
controller.importArchive = (async (...options: unknown[]) => {
  imports.push(options);
  const signal = options.at(-1) as AbortSignal | undefined;
  return new Promise<void>((_resolve, reject) => {
    const fail = () =>
      reject(
        new Error(
          "Import recovery needs an app restart. Further changes are paused to protect saved data.",
        ),
      );
    signal?.addEventListener("abort", () => void fail());
    if (signal?.aborted) fail();
  });
}) as BrowserController["importArchive"];
await act(async()=>{
  renderer!.update(
    <BrowserDataPanel controller={controller} ui={defaultUiPreferences} hydrated
      onPresentation={async()=>{}}
      onError={(error)=>errors.push(error)} onNotice={(notice)=>notices.push(notice)} />);
});
file = JSON.stringify({format:"yeoyu-work",version:1,spaces:[{name:"한글"}],keyBindings:[{key:"N",ctrl:true,command:"tab.new"}]});
await press("Import bookmarks or work archive");
await press("Add imported data");
await act(async()=>{alertButtons.find(b=>b.text==="Import")!.onPress!();});
await act(async()=>{
  const cancelImport = renderer!.root.findByProps({accessibilityLabel:"Cancel data operation"});
  cancelImport.props.onPress();
  await new Promise((r)=>setTimeout(r,50));
});
assert.equal(errors.length,1,"import recovery stays an error after user cancel");
assert.match(errors[0],/recovery needs an app restart/i);
assert.equal(notices.some((notice)=>/cancelled/i.test(notice)),false);
await act(async()=>renderer!.unmount());
console.log("Portable data preview, default-off settings, confirmation, failure and cancellation handling passed.");
