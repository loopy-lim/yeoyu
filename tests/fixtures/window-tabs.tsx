import { mock } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { parse } from "@babel/parser";
import { PermissionRequests } from "../../src/permissionRequests";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const scenario = process.argv[2];
const listeners = new Map<string, Set<(event: any) => void>>();
const DeviceEventEmitter = {
  addListener(name: string, listener: (event: any) => void) {
    const group = listeners.get(name) ?? new Set();
    listeners.set(name, group);
    group.add(listener);
    return { remove: () => group.delete(listener) };
  },
};
const AppState = { addEventListener: (_: string, listener: (state: string) => void) => DeviceEventEmitter.addListener("AppState", listener) };
const emit = (name: string, event: unknown) => listeners.get(name)?.forEach((listener) => listener(event));
mock.module("react-native", () => ({ DeviceEventEmitter, AppState }));
const reads: Array<{ resolve(json: string): void; reject(error: Error): void }> = [];
const platform = scenario === "unsupported" ? {} : {
  windowTabs: () => new Promise<string>((resolve, reject) => reads.push({ resolve, reject })),
};
mock.module("../../src/platform", () => ({ platform }));

// Execute App's actual ownership block, including the permission snapshot
// selector. This reaches both the native effect and the routing consumer.
const source = readFileSync(`${import.meta.dir}/../../src/App.tsx`, "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
let start = -1;
let end = -1;
function names(pattern: any): string[] {
  if (!pattern) return [];
  if (pattern.type === "Identifier") return [pattern.name];
  if (pattern.type === "ArrayPattern") return pattern.elements.flatMap(names);
  if (pattern.type === "ObjectPattern") return pattern.properties.flatMap((property: any) => names(property.value));
  return [];
}
function visit(node: unknown) {
  if (!node || typeof node !== "object") return;
  const item = node as Record<string, any>;
  if (item.type === "VariableDeclaration") {
    const declared = item.declarations.flatMap((entry: any) => names(entry.id));
    if (declared.includes("windowedTabs")) start = item.start;
    if (declared.includes("overlayOpen")) end = item.start;
  }
  for (const value of Object.values(item)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") visit(value);
  }
}
visit(ast);
assert(start >= 0 && end > start, "the actual App ownership and permission blocks must be exercised");
const block = source.slice(start, end);
const useWindowTabs = block.includes("useWindowTabs")
  ? (await import("../../src/hooks/useWindowTabs")).useWindowTabs
  : undefined;
const javascript = new Bun.Transpiler({ loader: "tsx" }).transformSync(`function ownership() {
  ${block}
  return { tabs: windowedTabs, ref: windowedTabsRef,
    loaded: typeof windowTabsLoaded === "undefined" ? true : windowTabsLoaded,
    request: permissionRequest };
}`);
const permissionRequests = new PermissionRequests();
permissionRequests.enqueue({ requestId: 1, tabId: "window-b", origin: "https://b.test", kind: "camera" });
permissionRequests.enqueue({ requestId: 2, tabId: "main-a", origin: "https://a.test", kind: "camera" });
const ownership = new Function(
  "useCallback", "useEffect", "useRef", "useState", "useSyncExternalStore", "useWindowTabs", "DeviceEventEmitter", "AppState", "platform", "browser", "permissionRequests",
  `${javascript}; return ownership;`,
)(useCallback, useEffect, useRef, useState, useSyncExternalStore, useWindowTabs, DeviceEventEmitter, AppState, platform, { ready: true }, permissionRequests);
let latest!: { tabs: readonly string[]; ref: { current: readonly string[] }; loaded: boolean; request: { requestId: number } | null };
const request = () => latest.request;
function Scene() { latest = ownership(); return null; }
let renderer!: ReactTestRenderer;
const previousError = console.error;
console.error = (...args: unknown[]) => {
  if (!String(args[0]).includes("react-test-renderer is deprecated")) previousError(...args);
};
try {
  await act(async () => { renderer = create(<Scene />); });
  if (scenario === "pending") {
    assert.equal(latest.request, null, "unknown ownership cannot place another window's request in the main window");
    assert.equal(latest.loaded, false);
  } else if (scenario === "event") {
    await act(() => emit("BrowserWindowTabsChanged", { tabIds: '["window-b"]' }));
    assert.equal(latest.loaded, true);
    assert.deepEqual(latest.ref.current, ["window-b"]);
    await act(async () => reads[0]!.resolve('["window-old"]'));
    assert.deepEqual(latest.tabs, ["window-b"], "a stale initial read cannot overwrite newer ownership");
    assert.deepEqual(latest.ref.current, ["window-b"], "imperative switch/reveal guards see the same fresh ownership");
    assert.equal(request()?.requestId, 2, "another OS window's prompt stays out of the main window");
  } else if (scenario === "event-failure") {
    await act(() => emit("BrowserWindowTabsChanged", { tabIds: '["window-b"]' }));
    await act(async () => reads[0]!.reject(new Error("obsolete native lookup failed")));
    assert.equal(latest.loaded, true, "an obsolete failure cannot revoke accepted ownership");
    assert.equal(request()?.requestId, 2);
  } else if (scenario === "read") {
    await act(async () => reads[0]!.resolve('["window-b"]'));
    assert.equal(latest.loaded, true);
    assert.deepEqual(latest.tabs, ["window-b"]);
    assert.equal(request()?.requestId, 2);
  } else if (scenario === "retry") {
    await act(async () => reads[0]!.reject(new Error("native lookup failed")));
    assert.equal(latest.request, null, "a failed native lookup must keep permission routing blocked");
    assert.equal(latest.loaded, false);
    await act(async () => emit("AppState", "active"));
    assert.equal(reads.length, 2, "activation retries a failed ownership lookup");
    await act(async () => reads[1]!.resolve('["window-b"]'));
    assert.equal(latest.loaded, true);
    assert.equal(request()?.requestId, 2);
  } else if (scenario === "malformed") {
    await act(async () => reads[0]!.resolve('{"tabs":["window-b"]}'));
    assert.equal(latest.request, null, "invalid native data cannot establish ownership");
    assert.equal(latest.loaded, false);
    assert.deepEqual(latest.ref.current, [], "invalid data cannot enter imperative guards");
    await act(() => emit("BrowserWindowTabsChanged", { tabIds: '["window-b"]' }));
    assert.equal(latest.loaded, true);
    assert.equal(request()?.requestId, 2, "a later valid event restores safe routing without waiting for activation");
  } else if (scenario === "unsupported") {
    assert.equal(latest.loaded, true);
    assert.equal(request()?.requestId, 1, "a single-window runtime owns every permission request");
    assert.equal(reads.length, 0);
  } else if (scenario === "cleanup") {
    const ref = latest.ref;
    await act(() => renderer.unmount());
    await act(async () => reads[0]!.resolve('["window-b"]'));
    assert.deepEqual(ref.current, [], "a late native read cannot change retired imperative guards");
    emit("BrowserWindowTabsChanged", { tabIds: '["window-b"]' });
    emit("AppState", "active");
    assert.equal(reads.length, 1, "unmount releases native and lifecycle subscriptions");
  } else throw new Error(`Unknown ownership scenario ${scenario}`);
} finally {
  if (renderer && scenario !== "cleanup") await act(() => renderer.unmount());
  console.error = previousError;
}
