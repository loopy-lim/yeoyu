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
const controller = {
  previewArchive: async (json:string) => {
    if (JSON.parse(json).format !== "yeoyu-work") throw Error("Unsupported archive");
    return {spaces:1,tabs:2,bookmarks:3,folders:1,favorites:1,duplicateUrls:1,hasKeyBindings:true,presentation};
  },
  importArchive: async (...options:unknown[]) => { imports.push(options); },
  exportArchive: async()=>file,
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
assert.deepEqual((imports[0] as unknown[]).slice(1),[true,false]);
assert.equal(errors.length,1);
assert.match(errors[0],/data was imported/i);
assert.equal(renderer!.root.findAllByProps({accessibilityLabel:"Add imported data"}).length,0,"appearance failure cannot leave an import retry button");
file = '{"format":"wrong"}';
await press("Import bookmarks or work archive");
assert.equal(imports.length,1);
assert.equal(renderer!.root.findAllByProps({accessibilityLabel:"Add imported data"}).length,0);
await act(async()=>renderer!.unmount());
console.log("Portable data preview, default-off settings, confirmation and failure handling passed.");
