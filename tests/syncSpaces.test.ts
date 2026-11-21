// Receive-only Zen Spaces engine unit tests: wire-cleartext parsing and
// sidebar tree assembly (space order, folders, splits, essentials, cycles).

import { describe, expect, test } from "bun:test";
import {
  buildSyncedSpacesTree,
  countSyncedSpaceTabs,
  parseSpacesCleartext,
  SPACES_LAYOUT_RECORD_ID,
  SPACES_RECORD_KINDS,
} from "../src/sync/spaces";

function wire(
  id: string,
  kind: string,
  data: Record<string, unknown>
): string {
  return JSON.stringify({ id, kind, data });
}

describe("parseSpacesCleartext", () => {
  test("accepts a space record and falls back to the BSO id", () => {
    const parsed = parseSpacesCleartext(
      "space-1",
      JSON.stringify({
        kind: SPACES_RECORD_KINDS.SPACE,
        data: { uuid: "space-1", name: "Work", children: [] },
      })
    );
    expect(parsed?.id).toBe("space-1");
    expect(parsed?.kind).toBe("space");
    expect(parsed?.data.name).toBe("Work");
  });

  test("tombstones and junk parse to null", () => {
    expect(
      parseSpacesCleartext("x", JSON.stringify({ id: "x", deleted: true }))
    ).toBeNull();
    expect(parseSpacesCleartext("x", "notjson")).toBeNull();
    expect(parseSpacesCleartext("x", "42")).toBeNull();
    expect(
      parseSpacesCleartext("x", JSON.stringify({ id: "x", kind: "tab" }))
    ).toBeNull();
  });
});

describe("buildSyncedSpacesTree", () => {
  test("orders spaces from layout and nests folder/tab/split children", () => {
    const records = [
      parseSpacesCleartext(
        SPACES_LAYOUT_RECORD_ID,
        wire(SPACES_LAYOUT_RECORD_ID, SPACES_RECORD_KINDS.LAYOUT, {
          spaces: ["space-b", "space-a"],
          essentials: { default: ["tab-essential"] },
        })
      )!,
      parseSpacesCleartext(
        "space-a",
        wire("space-a", SPACES_RECORD_KINDS.SPACE, {
          uuid: "space-a",
          name: "A",
          children: ["folder-1", "tab-a"],
        })
      )!,
      parseSpacesCleartext(
        "space-b",
        wire("space-b", SPACES_RECORD_KINDS.SPACE, {
          uuid: "space-b",
          name: "B",
          children: ["split-1"],
        })
      )!,
      parseSpacesCleartext(
        "folder-1",
        wire("folder-1", SPACES_RECORD_KINDS.FOLDER, {
          folderId: "folder-1",
          name: "Reading",
          children: ["tab-in-folder"],
        })
      )!,
      parseSpacesCleartext(
        "tab-a",
        wire("tab-a", SPACES_RECORD_KINDS.TAB, {
          tabId: "tab-a",
          url: "https://a.example",
          title: "A tab",
          pinned: true,
        })
      )!,
      parseSpacesCleartext(
        "tab-in-folder",
        wire("tab-in-folder", SPACES_RECORD_KINDS.TAB, {
          tabId: "tab-in-folder",
          url: "https://folder.example",
          title: "Folder tab",
        })
      )!,
      parseSpacesCleartext(
        "tab-essential",
        wire("tab-essential", SPACES_RECORD_KINDS.TAB, {
          tabId: "tab-essential",
          url: "https://essential.example",
          title: "Essential",
          essential: true,
          pinned: true,
        })
      )!,
      parseSpacesCleartext(
        "split-1",
        wire("split-1", SPACES_RECORD_KINDS.SPLIT, {
          splitId: "split-1",
          tabs: ["tab-split-a", "tab-split-b"],
        })
      )!,
      parseSpacesCleartext(
        "tab-split-a",
        wire("tab-split-a", SPACES_RECORD_KINDS.TAB, {
          tabId: "tab-split-a",
          url: "https://split-a.example",
          title: "Split A",
        })
      )!,
      parseSpacesCleartext(
        "tab-split-b",
        wire("tab-split-b", SPACES_RECORD_KINDS.TAB, {
          tabId: "tab-split-b",
          url: "https://split-b.example",
          title: "Split B",
        })
      )!,
      // Containers are ignored for display.
      parseSpacesCleartext(
        "c-1",
        wire("c-1", SPACES_RECORD_KINDS.CONTAINER, {
          guid: "c-1",
          name: "Personal",
        })
      )!,
    ];

    const tree = buildSyncedSpacesTree(records);
    expect(tree.spaces.map((space) => space.name)).toEqual(["B", "A"]);
    expect(tree.essentials).toHaveLength(1);
    expect(tree.essentials[0]?.url).toBe("https://essential.example");

    const spaceB = tree.spaces[0]!;
    expect(spaceB.children).toHaveLength(1);
    expect(spaceB.children[0]?.kind).toBe("split");
    if (spaceB.children[0]?.kind === "split") {
      expect(spaceB.children[0].tabs.map((tab) => tab.url)).toEqual([
        "https://split-a.example",
        "https://split-b.example",
      ]);
    }

    const spaceA = tree.spaces[1]!;
    expect(spaceA.children.map((item) => item.kind)).toEqual(["folder", "tab"]);
    if (spaceA.children[0]?.kind === "folder") {
      expect(spaceA.children[0].name).toBe("Reading");
      expect(spaceA.children[0].children[0]?.kind).toBe("tab");
    }

    expect(countSyncedSpaceTabs(tree)).toBe(5);
  });

  test("cuts folder child cycles and drops tabs without a url", () => {
    const records = [
      parseSpacesCleartext(
        "space-1",
        wire("space-1", SPACES_RECORD_KINDS.SPACE, {
          uuid: "space-1",
          name: "Loop",
          children: ["folder-a"],
        })
      )!,
      parseSpacesCleartext(
        "folder-a",
        wire("folder-a", SPACES_RECORD_KINDS.FOLDER, {
          folderId: "folder-a",
          name: "A",
          children: ["folder-b", "bad-tab"],
        })
      )!,
      parseSpacesCleartext(
        "folder-b",
        wire("folder-b", SPACES_RECORD_KINDS.FOLDER, {
          folderId: "folder-b",
          name: "B",
          children: ["folder-a", "good-tab"],
        })
      )!,
      parseSpacesCleartext(
        "bad-tab",
        wire("bad-tab", SPACES_RECORD_KINDS.TAB, {
          tabId: "bad-tab",
          title: "No url",
        })
      )!,
      parseSpacesCleartext(
        "good-tab",
        wire("good-tab", SPACES_RECORD_KINDS.TAB, {
          tabId: "good-tab",
          url: "https://good.example",
          title: "Good",
        })
      )!,
    ];
    const tree = buildSyncedSpacesTree(records);
    expect(tree.spaces).toHaveLength(1);
    const folderA = tree.spaces[0]?.children[0];
    expect(folderA?.kind).toBe("folder");
    if (folderA?.kind === "folder") {
      const folderB = folderA.children.find((child) => child.kind === "folder");
      expect(folderB?.kind).toBe("folder");
      if (folderB?.kind === "folder") {
        // Cycle back to folder-a is cut; good-tab remains.
        expect(folderB.children.map((child) => child.kind)).toEqual(["tab"]);
      }
    }
    expect(countSyncedSpaceTabs(tree)).toBe(1);
  });
});
