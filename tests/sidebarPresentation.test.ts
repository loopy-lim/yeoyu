import { expect, test } from "bun:test";
import type { Bookmark, BookmarkFolder, Tab } from "../generated/types";
import { sidebarPresentation } from "../src/sidebarPresentation";

const tab = (id: string, extra: Partial<Tab> = {}): Tab => ({
  id,
  title: id,
  url: `https://${id}.example`,
  workspaceId: "work",
  ...extra,
});
const bookmarks: Bookmark[] = [
  {
    id: "doc",
    title: "Docs",
    url: "https://docs.example",
    workspaceId: "work",
    folderId: "docs",
  },
  {
    id: "saved",
    title: "Saved",
    url: "https://saved.example",
    workspaceId: "work",
    folderId: "docs",
  },
  {
    id: "loose",
    title: "Loose",
    url: "https://loose.example",
    workspaceId: "work",
  },
  {
    id: "personal",
    title: "Personal",
    url: "https://personal.example",
    workspaceId: "personal",
    folderId: "personal",
  },
];
const folders: BookmarkFolder[] = [
  { id: "docs", title: "Documents", workspaceId: "work" },
  { id: "empty", title: "Empty", workspaceId: "work" },
  { id: "personal", title: "Personal", workspaceId: "personal" },
];
const tabs = [
  tab("favorite", { favorite: true, workspaceId: "personal" }),
  tab("doc-tab", { bookmarkId: "doc", pinned: true }),
  tab("ordinary"),
  tab("legacy-pin", { pinned: true }),
  tab("private", { private: true }),
  tab("other", { workspaceId: "personal" }),
];
const base = {
  tabs,
  bookmarks,
  folders,
  workspaceId: "work",
  focusedId: "doc-tab",
  split: null,
};

test("a split has one presentation across favorites, folders, and tab rows without changing saved roles", () => {
  const before = JSON.stringify({ tabs, bookmarks, folders });
  const view = sidebarPresentation({
    ...base,
    split: {
      first: "favorite",
      second: "doc-tab",
      orientation: "horizontal",
      ratio: 0.5,
    },
  });
  expect(view.split?.pages.map((t) => t.id)).toEqual(["favorite", "doc-tab"]);
  expect(view.split?.focusedId).toBe("doc-tab");
  expect(view.favorites).toEqual([]);
  expect(view.folders[0]!.visibleBookmarks.map((b) => b.id)).toEqual(["saved"]);
  expect(view.folders[0]!.bookmarks.map((b) => b.id)).toEqual(["doc", "saved"]);
  expect(view.railTabs.map((t) => t.id)).toEqual(["ordinary", "legacy-pin"]);
  expect(JSON.stringify({ tabs, bookmarks, folders })).toBe(before);
  const restored = sidebarPresentation(base);
  expect(restored.favorites.map((t) => t.id)).toEqual(["favorite"]);
  expect(restored.folders[0]!.visibleBookmarks.map((b) => b.id)).toEqual([
    "doc",
    "saved",
  ]);
});

test("rail folders compress their pinned owners but do not absorb promoted favorites or unpinned tabs", () => {
  const view = sidebarPresentation({
    ...base,
    tabs: [...tabs, tab("unpinned", { bookmarkId: "saved" })],
  });
  expect(view.folders.map((f) => f.folder.id)).toEqual(["docs", "empty"]);
  expect(view.folders[0]!.containsFocused).toBe(true);
  expect(view.folders[0]!.visibleBookmarks.map((b) => b.id)).toEqual(["doc"]);
  expect(view.railTabs.map((t) => t.id)).toEqual([
    "ordinary",
    "legacy-pin",
    "unpinned",
  ]);
  expect(view.looseBookmarks.map((b) => b.id)).toEqual(["loose"]);
  expect(view.privateTabs.map((t) => t.id)).toEqual(["private"]);
});

test("invalid, suspended, cross-space, mixed-mode and duplicate splits never hide individual rows", () => {
  for (const [first, second] of [
    ["missing", "doc-tab"],
    ["ordinary", "other"],
    ["ordinary", "private"],
    ["ordinary", "ordinary"],
    ["sleep", "ordinary"],
  ]) {
    const view = sidebarPresentation({
      ...base,
      tabs: [...tabs, tab("sleep", { suspended: true })],
      split: {
        first: first!,
        second: second!,
        orientation: "vertical",
        ratio: 0.5,
      },
    });
    expect(view.split).toBeNull();
    expect(view.ordinaryTabs.map((t) => t.id)).toContain("ordinary");
  }
});

test("private pairs retain their privacy flags and only remove their own rows", () => {
  const view = sidebarPresentation({
    ...base,
    focusedId: "missing",
    tabs: [...tabs, tab("private-2", { private: true })],
    split: {
      first: "private",
      second: "private-2",
      orientation: "vertical",
      ratio: 0.5,
    },
  });
  expect(view.split?.pages.map((t) => t.private)).toEqual([true, true]);
  expect(view.split?.focusedId).toBe("private");
  expect(view.privateTabs).toEqual([]);
  expect(view.ordinaryTabs.map((t) => t.id)).toEqual(["ordinary"]);
});

test("folder membership follows bookmark ownership after live navigation and does not borrow another Space's owner", () => {
  const view = sidebarPresentation({
    ...base,
    tabs: [
      tab("doc-tab", {
        bookmarkId: "doc",
        pinned: true,
        url: "https://away.example",
      }),
      tab("foreign", {
        bookmarkId: "saved",
        workspaceId: "personal",
        favorite: true,
      }),
    ],
  });
  expect(view.folders[0]!.containsFocused).toBe(true);
  expect(view.folders[0]!.visibleBookmarks.map((b) => b.id)).toEqual([
    "doc",
    "saved",
  ]);
  expect(view.railTabs).toEqual([]);
});
