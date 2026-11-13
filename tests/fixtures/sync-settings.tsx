// Firefox Sync UI fixtures: every §3 settings state and the sidebar region's
// fold/open behavior, rendered with the plain react-native string mocks (the
// sidebar-collections pattern). Assertions ride Text contents and
// accessibility props only — no style resolution involved.
import { afterEach, expect, mock, test } from "bun:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import "../uniwindTestHarness";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

class AnimatedValue {
  value: number;
  constructor(initial: number) {
    this.value = initial;
  }
  setValue(next: number) {
    this.value = next;
  }
  interpolate(config: unknown) {
    return config;
  }
}
type AlertButton = {
  text: string;
  style?: string;
  onPress?: () => void;
};
const alerts: Array<{ title: string; buttons: AlertButton[] }> = [];
mock.module("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  Image: "Image",
  Animated: {
    View: "View",
    Value: AnimatedValue,
    timing: (value: AnimatedValue, config: { toValue: number }) => ({
      start(done?: (result: { finished: boolean }) => void) {
        value.setValue(config.toValue);
        done?.({ finished: true });
      },
      stop() {},
    }),
  },
  Easing: { bezier: () => "bezier" },
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(false),
    addEventListener: () => ({ remove: () => {} }),
  },
  Alert: {
    alert: (title: string, _message: string, buttons: AlertButton[]) =>
      alerts.push({ title, buttons }),
  },
  StyleSheet: { create: (styles: unknown) => styles },
}));
mock.module("react-native-svg", () => ({ default: "Svg", Path: "Path" }));

const { SyncSettingsSection } = await import(
  "../../src/components/SyncSettingsSection"
);
const { SidebarSyncRegion } = await import(
  "../../src/components/SidebarSyncRegion"
);

const trees: ReactTestRenderer[] = [];
async function mount(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  trees.push(tree);
  return tree;
}
afterEach(async () => {
  await act(() => trees.splice(0).forEach((tree) => tree.unmount()));
  alerts.length = 0;
});

const texts = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType("Text" as React.ElementType)
    .map((node) =>
      typeof node.props.children === "number"
        ? String(node.props.children)
        : node.props.children
    )
    .filter((child): child is string => typeof child === "string");
const button = (tree: ReactTestRenderer, label: string) =>
  tree.root
    .findAllByType("Pressable" as React.ElementType)
    .find((node) =>
      node
        .findAllByType("Text" as React.ElementType)
        .some((text) => text.props.children === label)
    )!;
const state = (overrides: Record<string, unknown>) =>
  ({
    connection: "connected",
    syncing: false,
    email: "reader@example.com",
    tree: null,
    lastSyncAtMs: Date.now() - 5 * 60 * 1000,
    lastResult: null,
    pendingUploads: 0,
    ...overrides,
  }) as never;

test("unavailable host shows the bridge notice and no connect chip", async () => {
  const tree = await mount(
    <SyncSettingsSection
      state={state({ connection: "disconnected" })}
      platformAvailable={false}
      onConnect={() => {}}
      onCancelConnect={() => {}}
      onSyncNow={() => {}}
      onDisconnect={() => {}}
    />
  );
  expect(texts(tree)).toContain("Firefox Sync");
  expect(texts(tree)).toContain("Firefox Sync is unavailable on this device.");
  expect(button(tree, "Connect")).toBeUndefined();
});

test("disconnected offers connect; connecting swaps it for cancel", async () => {
  let connect = 0;
  let cancel = 0;
  let tree = await mount(
    <SyncSettingsSection
      state={state({ connection: "disconnected" })}
      platformAvailable
      onConnect={() => (connect += 1)}
      onCancelConnect={() => (cancel += 1)}
      onSyncNow={() => {}}
      onDisconnect={() => {}}
    />
  );
  expect(button(tree, "Connect")!.props.disabled).toBe(false);
  await act(() => button(tree, "Connect")!.props.onPress());
  expect(connect).toBe(1);

  tree = await mount(
    <SyncSettingsSection
      state={state({ connection: "connecting" })}
      platformAvailable
      onConnect={() => {}}
      onCancelConnect={() => (cancel += 1)}
      onSyncNow={() => {}}
      onDisconnect={() => {}}
    />
  );
  expect(button(tree, "Connect")).toBeUndefined();
  await act(() => button(tree, "Cancel")!.props.onPress());
  expect(cancel).toBe(1);
});

test("connected shows identity, age, and manual actions", async () => {
  let syncNow = 0;
  const tree = await mount(
    <SyncSettingsSection
      state={state({})}
      platformAvailable
      onConnect={() => {}}
      onCancelConnect={() => {}}
      onSyncNow={() => (syncNow += 1)}
      onDisconnect={() => {}}
    />
  );
  expect(texts(tree)).toContain("reader@example.com");
  expect(texts(tree)).toContain("Last synced 5m ago");
  await act(() => button(tree, "Sync now")!.props.onPress());
  expect(syncNow).toBe(1);
});

test("an in-flight sync disables the row and relabels it", async () => {
  const tree = await mount(
    <SyncSettingsSection
      state={state({ syncing: true })}
      platformAvailable
      onConnect={() => {}}
      onCancelConnect={() => {}}
      onSyncNow={() => {}}
      onDisconnect={() => {}}
    />
  );
  const sync = button(tree, "Syncing…")!;
  expect(sync.props.disabled).toBe(true);
  expect(button(tree, "Disconnect")!.props.disabled).toBe(true);
});

test("pending uploads ride the syncing label", async () => {
  const tree = await mount(
    <SyncSettingsSection
      state={state({ syncing: true, pendingUploads: 3 })}
      platformAvailable
      onConnect={() => {}}
      onCancelConnect={() => {}}
      onSyncNow={() => {}}
      onDisconnect={() => {}}
    />
  );
  expect(texts(tree)).toContain("Syncing… · Uploading 3");
});

test("an ok result appends its counts to the last-sync line", async () => {
  const tree = await mount(
    <SyncSettingsSection
      state={state({
        lastResult: { kind: "ok", atMs: Date.now(), received: 3, uploaded: 2 },
      })}
      platformAvailable
      onConnect={() => {}}
      onCancelConnect={() => {}}
      onSyncNow={() => {}}
      onDisconnect={() => {}}
    />
  );
  expect(texts(tree)).toContain("Last synced 5m ago · Received 3 · Sent 2");
});

test("zero or absent counts keep the plain status lines", async () => {
  let tree = await mount(
    <SyncSettingsSection
      state={state({ syncing: true, pendingUploads: 0 })}
      platformAvailable
      onConnect={() => {}}
      onCancelConnect={() => {}}
      onSyncNow={() => {}}
      onDisconnect={() => {}}
    />
  );
  expect(texts(tree)).toContain("Syncing…");
  expect(texts(tree).some((text) => text.includes("Uploading"))).toBe(false);

  tree = await mount(
    <SyncSettingsSection
      state={state({
        lastResult: { kind: "ok", atMs: Date.now(), received: 0, uploaded: 0 },
      })}
      platformAvailable
      onConnect={() => {}}
      onCancelConnect={() => {}}
      onSyncNow={() => {}}
      onDisconnect={() => {}}
    />
  );
  expect(texts(tree)).toContain("Last synced 5m ago");
  expect(texts(tree).some((text) => text.includes("Received"))).toBe(false);

  // Pre-T-3 ok shape (no count fields yet) renders the plain line unchanged.
  tree = await mount(
    <SyncSettingsSection
      state={state({ lastResult: { kind: "ok", atMs: Date.now(), received: 0, uploaded: 0 } })}
      platformAvailable
      onConnect={() => {}}
      onCancelConnect={() => {}}
      onSyncNow={() => {}}
      onDisconnect={() => {}}
    />
  );
  expect(texts(tree)).toContain("Last synced 5m ago");
});

test("classified errors surface with backoff seconds", async () => {
  const tree = await mount(
    <SyncSettingsSection
      state={state({
        lastResult: { kind: "server", atMs: Date.now(), retryAfterSeconds: 30 },
      })}
      platformAvailable
      onConnect={() => {}}
      onCancelConnect={() => {}}
      onSyncNow={() => {}}
      onDisconnect={() => {}}
    />
  );
  const joined = texts(tree).join(" ");
  expect(joined).toContain("Firefox Sync servers asked us to wait.");
  expect(joined).toContain("Try again in 30s.");
});

test("disconnect asks for confirmation before acting", async () => {
  let disconnects = 0;
  const tree = await mount(
    <SyncSettingsSection
      state={state({})}
      platformAvailable
      onConnect={() => {}}
      onCancelConnect={() => {}}
      onSyncNow={() => {}}
      onDisconnect={() => (disconnects += 1)}
    />
  );
  await act(() => button(tree, "Disconnect")!.props.onPress());
  expect(disconnects).toBe(0);
  expect(alerts).toHaveLength(1);
  const [cancel, confirm] = alerts[0].buttons;
  expect(cancel.style).toBe("cancel");
  expect(confirm.style).toBe("destructive");
  expect(disconnects).toBe(0);
  await act(() => confirm.onPress!());
  expect(disconnects).toBe(1);
});

// ---------------------------------------------------------------------------
// Sidebar region

const menuTree = () => ({
  roots: [
    {
      guid: "menu________",
      type: "folder" as const,
      title: "menu",
      children: [
        {
          guid: "folder1",
          type: "folder" as const,
          title: "Reading",
          children: [
            {
              guid: "bm1",
              type: "bookmark" as const,
              title: "Example",
              url: "https://example.com/",
            },
          ],
        },
      ],
    },
  ],
  fetchedAt: Date.now(),
  bookmarksModified: null,
});

test("no tree renders nothing; a tree starts collapsed", async () => {
  let tree = await mount(
    <SidebarSyncRegion
      tree={null}
      syncing={false}
      errorKind={null}
      retryAfterSeconds={null}
      onOpenUrl={() => {}}
    />
  );
  expect(tree.root.children).toHaveLength(0);

  tree = await mount(
    <SidebarSyncRegion
      tree={menuTree()}
      syncing={false}
      errorKind={null}
      retryAfterSeconds={null}
      onOpenUrl={() => {}}
    />
  );
  expect(texts(tree)).toContain("Firefox");
  expect(texts(tree)).toContain("1"); // bookmark count, not folder count
  expect(button(tree, "Bookmark Example")).toBeUndefined();
});

test("expanding reveals folders and bookmarks open urls", async () => {
  const opened: string[] = [];
  const tree = await mount(
    <SidebarSyncRegion
      tree={menuTree()}
      syncing={false}
      errorKind={null}
      retryAfterSeconds={null}
      onOpenUrl={(url) => opened.push(url)}
    />
  );
  const header = tree.root.findByProps({ accessibilityRole: "button" });
  expect(header.props.accessibilityState.expanded).toBe(false);
  await act(() => header.props.onPress());
  const bookmark = tree.root.findByProps({
    accessibilityLabel: "Bookmark Example",
  });
  await act(() => bookmark.props.onPress());
  expect(opened).toEqual(["https://example.com/"]);
});

test("syncing and error states show a status line", async () => {
  let tree = await mount(
    <SidebarSyncRegion
      tree={menuTree()}
      syncing
      errorKind={null}
      retryAfterSeconds={null}
      onOpenUrl={() => {}}
    />
  );
  expect(texts(tree)).toContain("Syncing…");

  tree = await mount(
    <SidebarSyncRegion
      tree={menuTree()}
      syncing={false}
      errorKind="server"
      retryAfterSeconds={30}
      onOpenUrl={() => {}}
    />
  );
  const joined = texts(tree).join(" ");
  expect(joined).toContain("Firefox Sync servers asked us to wait.");
  expect(joined).toContain("Try again in 30s.");
});

test("an empty tree says so", async () => {
  const tree = await mount(
    <SidebarSyncRegion
      tree={{
        roots: [
          { guid: "menu________", type: "folder", title: "menu", children: [] },
        ],
        fetchedAt: Date.now(),
        bookmarksModified: null,
      }}
      syncing={false}
      errorKind={null}
      retryAfterSeconds={null}
      onOpenUrl={() => {}}
    />
  );
  expect(texts(tree)).toContain("No synced bookmarks");
});
