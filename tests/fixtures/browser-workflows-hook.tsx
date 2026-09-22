// Runs in its own Bun process so native module mocks cannot affect other tests.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const listeners = new Map<string, Set<(event: { message: string }) => void>>();
const emit = (name: string, message: string) => listeners.get(name)?.forEach((listener) => listener({ message }));
mock.module("react-native", () => ({
  DeviceEventEmitter: { addListener(name: string, listener: (event: { message: string }) => void) {
    const group = listeners.get(name) ?? new Set();
    listeners.set(name, group); group.add(listener);
    return { remove: () => group.delete(listener) };
  } },
  AppState: { addEventListener: () => ({ remove() {} }) },
}));
const config = { schema: 1, restoreSessions: true, trackingProtection: "engine-default", textScale: 1, sites: [] };
mock.module("../../src/platform", () => ({ platform: {
  initializeBrowserTools: async () => {
    emit("BrowserSessionStorageError", "A saved tab was invalid; its URL was opened instead");
    return JSON.stringify(config);
  },
  pendingExternalLinks: async () => "[]",
} }));
mock.module("../../src/controllerRuntime", () => ({ controller: {
  snapshot: { tabs: [] }, subscribe: () => () => {},
} }));

const { useBrowserWorkflows } = await import("../../src/hooks/useBrowserWorkflows");
const errors: string[] = [], readiness: boolean[] = [];
function Harness() {
  const state = useBrowserWorkflows({ onError: (error) => errors.push(error), onNotice() {}, onExternalTab() {}, onCommand() {} });
  readiness.push(state.ready);
  return null;
}
let renderer: ReactTestRenderer | undefined;
await act(async () => { renderer = create(<Harness />); });
assert.equal(readiness[0], false, "first Surface must wait for initialization");
assert.equal(readiness.at(-1), true, "successful initialization must open the ready gate");
assert.deepEqual(errors, ["A saved tab was invalid; its URL was opened instead"], "initialization warning must reach the UI before ready");
await act(async () => renderer?.unmount());
emit("BrowserSessionStorageError", "late warning after unmount");
assert.equal(errors.length, 1, "unmounted hook must release its warning listener");
process.stdout.write(JSON.stringify({ startupWarningDelivered: true, readyGate: true, listenerReleased: true }) + "\n");
