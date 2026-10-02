import { mock } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { defaultUiPreferences } from "../../src/uiPreferences";
import "../uniwindTestHarness";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const listeners = new Map<string, Set<(event: any) => void>>();
const loaded: Array<[string, string]> = [];
const decisions: Array<[number, boolean, boolean]> = [];
const androidRequests: string[] = [];
const saves: string[] = [];
const initialization: string[] = [];
const ownerCalls: Array<[string, ...string[]]> = [];
let creates = 0;
let binds = 0;
const restored = {
  tabs: [{ id: "detached", url: "https://example.com/", title: "Example" }],
  activeTabId: "detached",
  activeWorkspaceId: "space",
};
let snapshot: typeof restored | null =
  process.argv[2] === "cold-start" ? null : restored;
let preferenceReadFails = process.argv[2] === "preferences-failed";
const runtime = {
  windowMission: async () => {
    ownerCalls.push(["legacy-mission"]);
    return "detached";
  },
  windowMissionFor: async (owner: string) => {
    ownerCalls.push(["mission", owner]);
    return "";
  },
  bindWindowTab: async (tab: string) => {
    ownerCalls.push(["legacy-bind", tab]);
  },
  bindWindowTabFor: async (owner: string, tab: string) => {
    ownerCalls.push(["bind", owner, tab]);
    if (process.argv[2] === "owner-retry" && ++binds === 1)
      throw new Error("native binding temporarily unavailable");
  },
  closeWindow: async () => {
    ownerCalls.push(["legacy-close"]);
  },
  closeWindowFor: async (owner: string) => {
    ownerCalls.push(["close", owner]);
  },
  getInputViewport: async (scope: string) =>
    JSON.stringify({
      scope,
      keyboardInset: scope === "detached" ? 180 : 0,
      visibleHeight: scope === "detached" ? 520 : 700,
    }),
  readUiPreferences: async () => {
    if (preferenceReadFails) throw new Error("storage unavailable");
    return JSON.stringify({
      ...defaultUiPreferences,
      language: "en",
      searchEngine: "duckduckgo",
    });
  },
  loadTabUrl: (id: string, url: string) => loaded.push([id, url]),
  readSitePermissions: async () => {
    initialization.push("read-rules");
    return JSON.stringify({
      originFormat: 2,
      rules: [
        {
          origin: "https://camera.example:8443",
          kind: "camera",
          decision: "block",
          at: 1,
        },
      ],
    });
  },
  saveSitePermissions: async (json: string) => {
    saves.push(json);
  },
  setSitePermissionRules: (json: string) => {
    if (process.argv[2] === "cold-start")
      assert.deepEqual(JSON.parse(json), [
        { origin: "https://camera.example:8443", kind: "camera", allow: false },
      ]);
    initialization.push("apply-rules");
  },
  requestAndroidPermission: async (kind: string) => {
    androidRequests.push(kind);
    return true;
  },
  resolvePermission: (id: number, allow: boolean, remember: boolean) =>
    decisions.push([id, allow, remember]),
};
mock.module("react-native", () => ({
  AppState: { addEventListener: () => ({ remove() {} }) },
  DeviceEventEmitter: {
    addListener: (name: string, callback: (event: any) => void) => {
      const group = listeners.get(name) ?? new Set();
      group.add(callback);
      listeners.set(name, group);
      return { remove: () => group.delete(callback) };
    },
  },
  NativeModules: { BrowserRuntime: runtime },
  Pressable: "Pressable",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
  Image: "Image",
  Modal: "Modal",
  FlatList: "FlatList",
  ScrollView: "ScrollView",
  Switch: "Switch",
  useWindowDimensions: () => ({ width: 960, height: 700 }),
  StyleSheet: {
    hairlineWidth: 1,
    absoluteFill: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
  },
  useColorScheme: () => "light",
}));
mock.module("react-native-safe-area-context", () => ({
  SafeAreaView: "SafeAreaView",
  SafeAreaProvider: "SafeAreaProvider",
}));
mock.module("react-native-svg", () => ({ default: "Svg", Path: "Path" }));
mock.module("../../src/chrome/SidebarInteraction", () => ({
  SidebarPressable: "Pressable",
}));
mock.module(
  "../../modules/browser-surface/src/BrowserSurfaceNativeComponent",
  () => ({ default: "Surface", Commands: {} })
);
mock.module("../../src/controllerRuntime", () => ({
  controller: {
    get snapshot() {
      return snapshot;
    },
    initialize: async () => {
      initialization.push("restore-tabs");
      snapshot = restored;
    },
    subscribe: () => () => {},
    createTab: async () => {
      creates++;
      snapshot = {
        ...restored,
        activeTabId: "fresh-a",
        tabs: [
          ...restored.tabs,
          { id: "fresh-a", url: "about:blank", title: "" },
        ],
      };
      return snapshot;
    },
    activate: async () => {},
  },
}));
const { default: Window } = await import("../../src/YeoyuWindow");
const originalError = console.error;
console.error = (...args: unknown[]) => {
  if (!String(args[0]).includes("react-test-renderer is deprecated"))
    originalError(...args);
};
let tree!: ReactTestRenderer;
try {
  await act(async () => {
    tree = create(
      process.argv[2]?.startsWith("owner") ? (
        <>
          <Window windowId="owner-a" />
          <Window windowId="owner-b" tabId="detached" />
        </>
      ) : (
        <Window tabId="detached" />
      )
    );
  });
  if (process.argv[2]?.startsWith("owner")) {
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 220)));
    if (process.argv[2] === "owner-retry") {
      await act(() =>
        tree.root.findByProps({ accessibilityLabel: "Retry" }).props.onPress()
      );
      await act(() => new Promise<void>((resolve) => setTimeout(resolve, 220)));
      assert.equal(
        creates,
        1,
        "retry reuses the first created tab instead of leaving duplicate tabs"
      );
      assert.deepEqual(ownerCalls.splice(0, 2), [
        ["mission", "owner-a"],
        ["bind", "owner-a", "fresh-a"],
      ]);
    }
    assert.deepEqual(
      ownerCalls,
      [
        ["mission", "owner-a"],
        ["bind", "owner-a", "fresh-a"],
      ],
      "a fresh root queries/binds its launch owner while another window is resumed"
    );
    const windows = tree.root.findAllByType(Window);
    const first = windows.find((node) => node.props.windowId === "owner-a")!;
    assert.equal(
      first.findByType("Surface" as React.ElementType).props.tabId,
      "fresh-a"
    );
    assert.equal(
      windows
        .find((node) => node.props.windowId === "owner-b")!
        .findByType("Surface" as React.ElementType).props.tabId,
      "detached"
    );
    await act(async () =>
      first.findByProps({ accessibilityLabel: "Close" }).props.onPress()
    );
    assert.deepEqual(
      ownerCalls.at(-1),
      ["close", "owner-a"],
      "closing a background root targets its own native window"
    );
  } else if (process.argv[2] === "cold-start") {
    assert.deepEqual(
      initialization.slice(0, 3),
      ["read-rules", "apply-rules", "restore-tabs"],
      "cold window applies durable rules before engine restoration"
    );
    assert.equal(
      tree.root.findByType("Surface" as React.ElementType).props.initialUrl,
      "https://example.com/",
      "restored URL is never replaced by about:blank"
    );
  } else if (process.argv[2] === "preferences-failed") {
    const retry = tree.root
      .findAllByType("Pressable" as React.ElementType)
      .find((node) => node.props.accessibilityLabel === "Retry");
    assert(
      retry,
      "failed settings read offers a retry instead of an empty window"
    );
    preferenceReadFails = false;
    await act(async () => retry.props.onPress());
    assert.equal(
      tree.root.findAllByType("TextInput" as React.ElementType).length,
      1,
      "retry restores window with saved preferences"
    );
    assert.equal(saves.length, 0, "recovery never replaces stored settings");
  } else if (process.argv[2] === "permissions") {
    await act(async () => {
      tree.update(
        <>
          <Window tabId="detached" />
          <Window tabId="other" />
        </>
      );
    });
    const emit = (name: string, event: unknown) =>
      listeners.get(name)?.forEach((listener) => listener(event));
    await act(() =>
      emit("BrowserPermissionRequest", {
        requestId: 99,
        tabId: "main-tab",
        origin: "https://background.example",
        kind: "camera",
      })
    );
    await act(() =>
      emit("BrowserPermissionRequest", {
        requestId: 1,
        tabId: "detached",
        origin: "https://camera.example:8443",
        kind: "camera",
      })
    );
    const activeModals = () =>
      tree.root.findAllByProps({ accessibilityViewIsModal: true });
    const promptInset = () => {
      for (let node = activeModals()[0].parent; node; node = node.parent) {
        if (node.props.className?.includes("z-40"))
          return node.props.style?.bottom;
      }
      throw new Error(
        "permission UI must remain inside its own window geometry"
      );
    };
    assert.equal(
      activeModals().length,
      1,
      "permission dialog belongs to exactly one window"
    );
    assert.equal(
      promptInset(),
      180,
      "an already-open IME adjusts this window's permission card"
    );
    assert(
      activeModals()[0]
        .findAllByType("Text" as React.ElementType)
        .some((node) => node.props.children === "https://camera.example:8443")
    );
    assert.equal(
      androidRequests.length,
      0,
      "showing the site prompt never grants device permission"
    );
    await act(async () =>
      activeModals()[0]
        .findAllByType("Pressable" as React.ElementType)
        .find(
          (node) => node.props.accessibilityLabel === "Allow for this site"
        )!
        .props.onPress()
    );
    assert.deepEqual(androidRequests, ["camera"]);
    assert.deepEqual(decisions, [[1, true, false]]);
    assert.equal(saves.length, 1, "site choice is persisted once across roots");
    assert.equal(activeModals().length, 0);
    await act(() =>
      emit("BrowserPermissionRequest", {
        requestId: 2,
        tabId: "other",
        origin: "https://other.example",
        kind: "geolocation",
      })
    );
    assert.equal(activeModals().length, 1);
    assert.equal(
      promptInset(),
      0,
      "another window does not borrow the first window's IME inset"
    );
    await act(async () =>
      emit("BrowserWindowPermissionDismiss", { tabId: "other" })
    );
    assert.deepEqual(
      decisions.at(-1),
      [2, false, false],
      "Android Back dismisses only the displayed request"
    );
    await act(() =>
      emit("BrowserPermissionRequest", {
        requestId: 3,
        tabId: "other",
        origin: "https://other.example",
        kind: "camera",
      })
    );
    await act(() => emit("BrowserPermissionCancelled", { requestId: 3 }));
    assert.equal(
      activeModals().length,
      0,
      "navigation cancels the window prompt"
    );
    assert(
      !decisions.some(([id]) => id === 99),
      "another host's queued request is preserved"
    );
  } else {
    for (const [typed, expected] of [
      ["tablet work", "https://duckduckgo.com/?q=tablet%20work"],
      ["example.com:8443/path", "https://example.com:8443/path"],
      ["mailto:hello@example.com", "mailto:hello@example.com"],
      ["http://localhost:8080/path", "http://localhost:8080/path"],
    ]) {
      const input = () =>
        tree.root.findByType("TextInput" as React.ElementType);
      await act(() => input().props.onChangeText(typed));
      await act(() => input().props.onSubmitEditing());
      assert.deepEqual(
        loaded.at(-1),
        ["detached", expected],
        `window submission: ${typed}`
      );
    }
    const before = loaded.length;
    await act(() =>
      tree.root
        .findByType("TextInput" as React.ElementType)
        .props.onChangeText("  ")
    );
    await act(() =>
      tree.root
        .findByType("TextInput" as React.ElementType)
        .props.onSubmitEditing()
    );
    assert.equal(loaded.length, before, "empty input does not navigate");
  }
} finally {
  if (tree) await act(() => tree.unmount());
  console.error = originalError;
}
