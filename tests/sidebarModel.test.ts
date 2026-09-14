import { expect, test } from "bun:test";
import {
  bookmarkTabsForSpace,
  libraryItemsForSpace,
  favoriteDropIndex,
  favoriteMoveIndex,
  sidebarAddressLabel,
  sidebarTabMoveIndex,
  sidebarDropChange,
  liveSplitLayout,
} from "../src/sidebarModel";

test("a retained saved tab cannot survive in a frozen split after its live page closes", () => {
  const layout = { first: "saved", second: "ordinary", ratio: 0.5 };
  expect(liveSplitLayout(layout, [{ id: "saved" }, { id: "ordinary" }])).toBe(
    layout
  );
  expect(
    liveSplitLayout(layout, [
      { id: "saved", suspended: true },
      { id: "ordinary" },
    ])
  ).toBeNull();
  expect(liveSplitLayout(layout, [{ id: "ordinary" }])).toBeNull();
});

test("tab reordering follows measured rows and keeps unrelated tabs in place", () => {
  const tabs = [{ id: "a" }, { id: "other-space" }, { id: "b" }, { id: "c" }];
  const rows = [
    { id: "a", y: 100, height: 34 },
    { id: "b", y: 140, height: 34 },
    { id: "c", y: 180, height: 34 },
  ];
  expect(sidebarTabMoveIndex(tabs, "a", 210, rows)).toBe(3);
  expect(sidebarTabMoveIndex(tabs, "c", 90, rows)).toBe(0);
  expect(sidebarTabMoveIndex(tabs, "b", 157, rows)).toBe(2);
  expect(sidebarTabMoveIndex(tabs, "a", 150, rows)).toBe(1);
  expect(sidebarTabMoveIndex(tabs, "a", 160, rows)).toBe(2);
  expect(sidebarTabMoveIndex(tabs, "a", 100, [])).toBeNull();
});

test("only crossing sidebar regions changes the saved-tab role", () => {
  expect(sidebarDropChange({ pinned: true }, "pinned")).toBeNull();
  expect(sidebarDropChange({ favorite: true }, "favorites")).toBeNull();
  expect(sidebarDropChange({ favorite: true }, "pinned")).toBe("pin");
  expect(sidebarDropChange({ pinned: true }, "ordinary")).toBe("unpin");
  expect(sidebarDropChange({ favorite: true }, "ordinary")).toBe("unfavorite");
  expect(sidebarDropChange({}, "pinned")).toBe("pin");
  expect(sidebarDropChange({ pinned: true }, "favorites")).toBe("favorite");
});

test("dropping an ordinary tab between favorites uses the existing favorite grid", () => {
  const tabs = [
    { id: "a", favorite: true },
    { id: "new" },
    { id: "b", favorite: true },
  ];
  expect(favoriteMoveIndex(tabs, "new", 0)).toBe(0);
  expect(favoriteMoveIndex(tabs, "new", 1)).toBe(1);
  expect(favoriteMoveIndex(tabs, "new", 2)).toBe(2);
});

test("favorite drop follows measured wrapped tiles rather than a fixed stride", () => {
  const tiles = [
    { x: 0, y: 0, width: 70, height: 40 },
    { x: 76, y: 0, width: 70, height: 40 },
    { x: 152, y: 0, width: 70, height: 40 },
    { x: 0, y: 46, width: 70, height: 40 },
  ];
  expect(favoriteDropIndex(90, 20, tiles)).toBe(1);
  expect(favoriteDropIndex(220, 20, tiles)).toBe(3);
  expect(favoriteDropIndex(10, 65, tiles)).toBe(3);
  expect(favoriteDropIndex(90, 65, tiles)).toBe(4);
  expect(favoriteDropIndex(20, 20, [])).toBe(0);
});

test("moving a favorite translates insertion slots after removing its old position", () => {
  const tabs = [
    { id: "a", favorite: true },
    { id: "ordinary", favorite: false },
    { id: "b", favorite: true },
    { id: "c", favorite: true },
  ];
  expect(favoriteMoveIndex(tabs, "a", 3)).toBe(3);
  expect(favoriteMoveIndex(tabs, "c", 0)).toBe(0);
  expect(favoriteMoveIndex(tabs, "a", 1)).toBe(0);
  expect(favoriteMoveIndex(tabs, "b", 3)).toBe(3);
  expect(favoriteMoveIndex(tabs, "missing", 0)).toBeNull();
});

test("sidebar address exposes the domain while retaining non-web destinations", () => {
  expect(sidebarAddressLabel("https://www.example.com/path?q=private")).toBe(
    "example.com"
  );
  expect(sidebarAddressLabel("http://localhost:8080/page")).toBe(
    "localhost:8080"
  );
  expect(sidebarAddressLabel("about:blank")).toBe("");
  expect(sidebarAddressLabel("file:///storage/document.pdf")).toBe(
    "document.pdf"
  );
});

test("sidebar item ownership is stable after navigation and belongs to the selected Space", () => {
  const tabs = [
    {
      id: "a",
      bookmarkId: "docs-first",
      workspaceId: "first",
      url: "https://docs.example/away",
    },
    {
      id: "b",
      bookmarkId: "docs-second",
      workspaceId: "second",
      url: "https://docs.example/home",
    },
    { id: "global", bookmarkId: "news", workspaceId: "second", favorite: true },
  ];
  expect(bookmarkTabsForSpace(tabs, "first").get("docs-first")?.id).toBe("a");
  expect(bookmarkTabsForSpace(tabs, "second").get("docs-second")?.id).toBe("b");
  expect(bookmarkTabsForSpace(tabs, "first").has("docs-second")).toBe(false);
  expect(bookmarkTabsForSpace(tabs, "first").has("news")).toBe(false);
  expect(bookmarkTabsForSpace(tabs, "second").get("news")?.id).toBe("global");
  expect(bookmarkTabsForSpace(tabs, "third").size).toBe(0);
});

test("Space libraries isolate bookmarks and folders, including empty and unknown Spaces", () => {
  const bookmarks = [
    { id: "personal", workspaceId: "personal", folderId: "personal-folder" },
    { id: "work", workspaceId: "work", folderId: "work-folder" },
    { id: "unmigrated" },
  ];
  const folders = [
    { id: "work-folder", workspaceId: "work" },
    { id: "personal-folder", workspaceId: "personal" },
  ];
  expect(
    libraryItemsForSpace(bookmarks, "work").map((item) => item.id)
  ).toEqual(["work"]);
  expect(libraryItemsForSpace(folders, "work").map((item) => item.id)).toEqual([
    "work-folder",
  ]);
  expect(
    libraryItemsForSpace(bookmarks, "personal").map((item) => item.id)
  ).toEqual(["personal"]);
  expect(libraryItemsForSpace(bookmarks, "new-space")).toEqual([]);
  expect(libraryItemsForSpace(folders, "new-space")).toEqual([]);
  expect(libraryItemsForSpace([], "work")).toEqual([]);
});
