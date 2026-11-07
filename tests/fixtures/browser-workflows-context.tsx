// Runs in its own Bun process so native module mocks cannot affect other tests.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const listeners = new Map<string, Set<(event: Record<string, unknown>) => void>>();
const emit = (name: string, message: Record<string, unknown>) =>
  listeners.get(name)?.forEach((listener) => listener(message));
mock.module("react-native", () => ({
  DeviceEventEmitter: {
    addListener(name: string, listener: (event: Record<string, unknown>) => void) {
      const group = listeners.get(name) ?? new Set();
      listeners.set(name, group);
      group.add(listener);
      return { remove: () => group.delete(listener) };
    },
  },
  AppState: { addEventListener: () => ({ remove() {} }) },
}));
const config = { schema: 1, restoreSessions: true, trackingProtection: "engine-default", textScale: 1, sites: [] };
const downloads: Array<{ tabId: string; url: string }> = [];
const created: Array<{ url: string; workspaceId: string; options?: { private?: boolean } }> = [];
mock.module("../../src/platform", () => ({ platform: {
  initializeBrowserTools: async () => JSON.stringify(config),
  pendingExternalLinks: async () => "[]",
  consumeContentContext: async () => "https://example.com/file.bin",
  downloadUrl: async (tabId: string, url: string) => { downloads.push({ tabId, url }); },
  shareUrl: async () => {},
  copyToClipboard() {},
}}));
mock.module("../../src/controllerRuntime", () => ({ controller: {
  snapshot: { tabs: [{ id: "t1", workspaceId: "w1", private: false, suspended: false }] },
  subscribe: () => () => {},
  createTab: async (url: string, workspaceId: string, options?: { private?: boolean }) => {
    created.push({ url, workspaceId, options });
    return "t2";
  },
}}));

const { useBrowserWorkflows } = await import("../../src/hooks/useBrowserWorkflows");
const opened: string[] = [];
let api: ReturnType<typeof useBrowserWorkflows> | undefined;
function Harness() {
  api = useBrowserWorkflows({
    onError: (error) => { throw Error("unexpected hook error: " + error); },
    onNotice() {},
    onExternalTab: (snapshot) => opened.push(String(snapshot)),
    onCommand() {},
  });
  return null;
}
await act(async () => { create(<Harness />); });
assert.equal(api?.ready, true, "initialization must settle before context actions");

// Content-menu privateOpen: a normal-tab link opens as a private tab.
await act(async () => {
  emit("BrowserContentContextMenu", { requestId: "r1", tabId: "t1", linkUri: "https://example.com/file.bin" });
});
assert.equal(api?.context?.requestId, "r1");
await act(async () => { await api!.selectContext("r1", "link", "privateOpen"); });
assert.deepEqual(created, [
  { url: "https://example.com/file.bin", workspaceId: "w1", options: { private: true } },
]);
assert.deepEqual(opened, ["t2"]);

// Content-menu download: the consumed URL is handed to the native download bridge.
await act(async () => {
  emit("BrowserContentContextMenu", { requestId: "r2", tabId: "t1", imageUri: "https://example.com/file.bin" });
});
await act(async () => { await api!.selectContext("r2", "image", "download"); });
assert.deepEqual(downloads, [{ tabId: "t1", url: "https://example.com/file.bin" }]);
assert.equal(created.length, 1, "download must not open a tab");

process.stdout.write(JSON.stringify({ contextActionsVerified: true }) + "\n");
