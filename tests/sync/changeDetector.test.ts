import { describe, expect, test } from "bun:test";
import { diffBookmarks } from "../../src/sync/changeDetector";
import type { LocalBookmarkSnapshot } from "../../src/sync/model";

const empty: LocalBookmarkSnapshot = { bookmarks: [], bookmarkFolders: [] };

function snap(
  bookmarks: LocalBookmarkSnapshot["bookmarks"] = [],
  bookmarkFolders: LocalBookmarkSnapshot["bookmarkFolders"] = []
): LocalBookmarkSnapshot {
  return { bookmarks, bookmarkFolders };
}

describe("diffBookmarks", () => {
  test("empty snapshots", () => {
    expect(diffBookmarks(empty, empty)).toEqual({
      created: [],
      updated: [],
      deleted: [],
      foldersCreated: [],
      foldersRenamed: [],
      foldersDeleted: [],
    });
  });

  test("bookmark create", () => {
    const prev = snap();
    const next = snap([{ id: "b1", title: "A", url: "https://a" }]);
    expect(diffBookmarks(prev, next).created).toEqual(["b1"]);
  });

  test("bookmark delete", () => {
    const prev = snap([{ id: "b1", title: "A", url: "https://a" }]);
    const next = snap();
    expect(diffBookmarks(prev, next).deleted).toEqual(["b1"]);
  });

  test("bookmark title/url/folder update", () => {
    const base = { id: "b1", title: "A", url: "https://a", folderId: "" };
    expect(diffBookmarks(snap([base]), snap([{ ...base, title: "B" }])).updated).toEqual([
      "b1",
    ]);
    expect(diffBookmarks(snap([base]), snap([{ ...base, url: "https://b" }])).updated).toEqual([
      "b1",
    ]);
    expect(
      diffBookmarks(snap([base]), snap([{ ...base, folderId: "f1" }])).updated
    ).toEqual(["b1"]);
    expect(
      diffBookmarks(snap([base]), snap([{ ...base, folderId: undefined }])).updated
    ).toEqual([]);
  });

  test("folder create, rename, delete", () => {
    const prev = snap([], [{ id: "f1", title: "Work" }]);
    const next = snap(
      [],
      [
        { id: "f1", title: "Research" },
        { id: "f2", title: "Personal" },
      ]
    );
    const diff = diffBookmarks(prev, next);
    expect(diff.foldersRenamed).toEqual(["f1"]);
    expect(diff.foldersCreated).toEqual(["f2"]);

    const gone = snap([], []);
    expect(diffBookmarks(prev, gone).foldersDeleted).toEqual(["f1"]);
  });
});
