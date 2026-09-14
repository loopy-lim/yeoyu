import { afterEach, expect, mock, spyOn, test } from "bun:test";
import React, { Profiler } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { resolve } from "node:path";
const { transformSync } = require("@babel/core");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
mock.module("react-native", () => ({
  Pressable: "Pressable",
  Image: "Image",
  Text: "Text",
  Animated: { View: "View" },
}));
const repo = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const product = repo;
const native = await import("react-native");
const { Pressable } = require(repo + "/tests/fixtures/loadNativePressable.cjs");
mock.module("react-native", () => ({
  ...native,
  Pressable,
  Image: "Image",
  Text: "Text",
}));
const { SidebarLayer, SidebarPressable } = await import(
  repo + "/src/chrome/SidebarInteraction"
);
const { ContextPressable } = await import(
  repo + "/src/chrome/ContextPressable"
);
const { Favicon } = await import(product + "/src/components/Favicon");
const { favicons, FaviconCache } = await import(product + "/src/favicons");
const ICON = "data:image/png;base64,ZmFrZS1vZmZsaW5lLWltYWdl";
const clears = mock(() => {});
const reads = mock(async (host: string) => ICON + host);
favicons.attach({ read: reads, clear: clears });
const trees = new Set<ReactTestRenderer>();
afterEach(async () => {
  await act(async () => {
    trees.forEach((tree) => tree.unmount());
    trees.clear();
  });
  mock.restore();
});
const hosts = (tree: ReactTestRenderer, type: string) =>
  tree.root.findAll(
    (node) => typeof node.type === "string" && node.type === type
  );
const imageUris = (tree: ReactTestRenderer) =>
  hosts(tree, "Image").map((node) => node.props.source.uri);
const fallbackCount = (tree: ReactTestRenderer) =>
  hosts(tree, "Text").filter((node) => node.props.children === "◌").length;
async function mount(node: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(node);
  });
  trees.add(tree);
  return tree;
}
const icon = (url: string) => (
  <Favicon url={url} fallback="◌" size={16} radius={3} />
);
const prime = async (url: string) => await favicons.forUrl(url);
function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function exactBookmarkRows(
  bookmarks: Array<{ id: string; title: string; url: string }>
) {
  const filename = repo + "/src/App.tsx";
  const app = readFileSync(filename, "utf8");
  const start = app.indexOf("  const bookmarkTreeRow =");
  const end = app.indexOf("\n  const splitCandidate =", start);
  if (start < 0 || end < 0)
    throw new Error("Current App bookmarkTreeRow seam changed");
  const code = transformSync(app.slice(start, end), {
    filename,
    babelrc: false,
    configFile: false,
    presets: [require.resolve("@react-native/babel-preset")],
  })!.code!;
  const bindings = {
    View: "View",
    Text: "Text",
    ContextPressable,
    SidebarPressable,
    Favicon,
    ChromeIcon: () => null,
    bookmarkTabs: new Map(),
    splitPaneIds: [],
    s: {},
    playing: [],
    sidebarMenu: null,
    validSplit: null,
    theme: {},
    switchTab() {},
    openBookmark() {},
    setSidebarMenu() {},
    closeTab() {},
  };
  const row = new Function(
    "require",
    ...Object.keys(bindings),
    code + "\nreturn bookmarkTreeRow;"
  )(require, ...Object.values(bindings));
  return bookmarks.map((bookmark) => row(bookmark, false));
}

test("actual App bookmark rows retain warm icons in every outgoing collapse commit while native Pressable resets", async () => {
  const bookmarks = ["News", "GitHub", "Docs"].map((title, i) => ({
    id: String(i),
    title,
    url: `https://warm-${i}.example.test/page`,
  }));
  const expected = await Promise.all(bookmarks.map((b) => prime(b.url)));
  const body = exactBookmarkRows(bookmarks);
  const commits: Array<{ images: unknown[]; fallbacks: number }> = [];
  let tree: ReactTestRenderer | undefined;
  let record = false;
  const render = (active: boolean) => (
    <Profiler
      id="actual-bookmark-tree"
      onRender={() => {
        if (record && tree)
          commits.push({
            images: imageUris(tree),
            fallbacks: fallbackCount(tree),
          });
      }}
    >
      <SidebarLayer visible active={active}>
        {body}
      </SidebarLayer>
    </Profiler>
  );
  tree = await mount(render(true));
  expect(imageUris(tree)).toEqual(expected);
  const oldNativeRow = hosts(tree, "View").find(
    (n) => n.props.accessibilityLabel === "Pinned tab News"
  );
  record = true;
  await act(async () => tree!.update(render(false)));
  const newNativeRow = hosts(tree, "View").find(
    (n) => n.props.accessibilityLabel === "Pinned tab News"
  );
  expect(newNativeRow).not.toBe(oldNativeRow);
  console.log("collapse-commits", JSON.stringify(commits));
  expect(commits.length).toBeGreaterThan(0);
  expect(
    commits.every(
      (commit) =>
        commit.fallbacks === 0 &&
        JSON.stringify(commit.images) === JSON.stringify(expected)
    )
  ).toBe(true);
  const sameInactiveRow = newNativeRow;
  await act(async () => tree!.update(render(true)));
  expect(
    hosts(tree, "View").find(
      (n) => n.props.accessibilityLabel === "Pinned tab News"
    )
  ).toBe(sameInactiveRow);
});

test("URL change never displays the previous host while a new host is unresolved", async () => {
  const a = "https://old-host.example.test/a",
    b = "https://new-host.example.test/b";
  await prime(a);
  const tree = await mount(icon(a));
  const pending = defer<string | null>();
  const original = favicons.forUrl.bind(favicons);
  spyOn(favicons, "forUrl").mockImplementation((url: string) =>
    url === b ? pending.promise : original(url)
  );
  await act(async () => tree.update(icon(b)));
  expect(imageUris(tree)).toEqual([]);
  expect(fallbackCount(tree)).toBe(1);
  await act(async () => pending.resolve(ICON + "new-host"));
  expect(imageUris(tree)).toEqual([ICON + "new-host"]);
});

test("old unresolved Promise cannot replace a newer host icon", async () => {
  const a = "https://pending-old.example.test/a",
    b = "https://ready-new.example.test/b";
  const expected = await prime(b),
    pending = defer<string | null>();
  const original = favicons.forUrl.bind(favicons);
  spyOn(favicons, "forUrl").mockImplementation((url: string) =>
    url === a ? pending.promise : original(url)
  );
  const tree = await mount(icon(a));
  await act(async () => tree.update(icon(b)));
  await act(async () => pending.resolve(ICON + "obsolete"));
  expect(imageUris(tree)).toEqual([expected]);
});

test("old Image.onError cannot invalidate a newer host or blank its image", async () => {
  const a = "https://error-old.example.test/a",
    b = "https://error-new.example.test/b";
  const expectedA = await prime(a),
    expectedB = await prime(b);
  const tree = await mount(icon(a));
  const oldImage = hosts(tree, "Image")[0]!;
  const oldError = oldImage.props.onError;
  await act(async () => tree.update(icon(b)));
  expect(hosts(tree, "Image")[0]!).not.toBe(oldImage);
  await act(async () => oldError());
  expect(imageUris(tree)).toEqual([expectedB]);
  expect(await favicons.forUrl(a)).toBe(expectedA);
  expect(await favicons.forUrl(b)).toBe(expectedB);
});

test("old Image.onError is fenced after A to B to A and after unmount", async () => {
  const a = "https://aba-a.example.test/a",
    b = "https://aba-b.example.test/b";
  const expectedA = await prime(a);
  await prime(b);
  const tree = await mount(icon(a));
  const oldError = hosts(tree, "Image")[0]!.props.onError;
  await act(async () => tree.update(icon(b)));
  await act(async () => tree.update(icon(a)));
  await act(async () => oldError());
  expect(imageUris(tree)).toEqual([expectedA]);
  expect(await favicons.forUrl(a)).toBe(expectedA);
  const errorAfterUnmount = hosts(tree, "Image")[0]!.props.onError;
  await act(async () => tree.unmount());
  trees.delete(tree);
  await act(async () => errorAfterUnmount());
  expect(await favicons.forUrl(a)).toBe(expectedA);
});

test("current image decode failure clears its cache, shows fallback, and stays invalid on remount", async () => {
  const a = "https://actually-broken.example.test/a";
  await prime(a);
  const tree = await mount(icon(a));
  await act(async () => hosts(tree, "Image")[0]!.props.onError());
  expect(imageUris(tree)).toEqual([]);
  expect(fallbackCount(tree)).toBe(1);
  expect(await favicons.forUrl(a)).toBeNull();
  await act(async () => tree.unmount());
  trees.delete(tree);
  const remount = await mount(icon(a));
  expect(imageUris(remount)).toEqual([]);
  expect(fallbackCount(remount)).toBe(1);
});

test("synchronous peek neither fetches nor changes the bounded memory LRU or negative invalidation", async () => {
  const read = mock(async (host: string) => ICON + host);
  const cache = new FaviconCache({ read });
  expect(cache.peekForUrl("https://missing.example.test/x")).toBeNull();
  expect(cache.peekForUrl("about:blank")).toBeNull();
  expect(read).not.toHaveBeenCalled();
  for (let i = 0; i < 96; i++)
    await cache.forUrl(`https://lru-${i}.example.test/`);
  const count = read.mock.calls.length;
  for (let i = 0; i < 20; i++)
    expect(cache.peekForUrl("https://lru-0.example.test/a")).toBe(
      ICON + "lru-0.example.test"
    );
  expect(read.mock.calls.length).toBe(count);
  await cache.forUrl("https://lru-96.example.test/");
  expect(cache.peekForUrl("https://lru-0.example.test/")).toBeNull();
  expect(cache.peekForUrl("https://lru-95.example.test/")).toBe(
    ICON + "lru-95.example.test"
  );
  cache.reportBroken("https://lru-95.example.test/");
  expect(cache.peekForUrl("https://lru-95.example.test/")).toBeNull();
});

test("current decode failure cannot be undone by an already pending cached lookup", async () => {
  const a = "https://decode-pending.example.test/a";
  const expected = await prime(a),
    pending = defer<string | null>();
  const original = favicons.forUrl.bind(favicons);
  spyOn(favicons, "forUrl").mockImplementation((url: string) =>
    url === a ? pending.promise : original(url)
  );
  const tree = await mount(icon(a));
  expect(imageUris(tree)).toEqual([expected]);
  await act(async () => hosts(tree, "Image")[0]!.props.onError());
  await act(async () => pending.resolve(expected));
  expect(imageUris(tree)).toEqual([]);
  expect(fallbackCount(tree)).toBe(1);
  expect(favicons.peekForUrl(a)).toBeNull();
});

test("StrictMode effect replay preserves current warm image and current failure invalidation", async () => {
  const a = "https://strict-mode.example.test/a";
  const expected = await prime(a);
  const tree = await mount(<React.StrictMode>{icon(a)}</React.StrictMode>);
  expect(imageUris(tree)).toEqual([expected]);
  await act(async () => hosts(tree, "Image")[0]!.props.onError());
  expect(imageUris(tree)).toEqual([]);
  expect(await favicons.forUrl(a)).toBeNull();
});
