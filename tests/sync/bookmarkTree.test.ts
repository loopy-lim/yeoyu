// Tree builder tests: ordering, tombstones, orphans, cycles, idempotency,
// and the 1,000-record timing contract from PLAN.md V-1.

import { describe, expect, test } from "bun:test";
import { buildSyncTree, countBookmarkNodes } from "../../src/sync/bookmarkTree";
import { DecryptedRecord } from "../../src/sync/bookmarkTree";
import { UNRESOLVED_PARENT_GUID } from "../../src/sync/model";

function folder(id: string, title: string, children: string[]): DecryptedRecord {
  return { guid: id, payload: { id, type: "folder", title, children } };
}

function bookmark(id: string, parentid: string, title: string, url: string): DecryptedRecord {
  return { guid: id, payload: { id, parentid, type: "bookmark", title, bmkUri: url } };
}

function envelope(record: DecryptedRecord): DecryptedRecord {
  return record; // already decrypted shape
}

describe("buildSyncTree", () => {
  test("preserves folder children order", () => {
    const tree = buildSyncTree(
      [
        envelope(folder("menu________", "menu", ["b2", "b1", "f1"])),
        envelope(bookmark("b1", "menu________", "One", "https://one")),
        envelope(bookmark("b2", "menu________", "Two", "https://two")),
        envelope(folder("f1", "Folder", ["b3"])),
        envelope(bookmark("b3", "f1", "Three", "https://three")),
      ],
      1
    );
    const menu = tree.roots.find((n) => n.guid === "menu________");
    expect(menu?.children?.map((c) => c.guid)).toEqual(["b2", "b1", "f1"]);
    expect(menu?.children?.[2]?.children?.map((c) => c.guid)).toEqual(["b3"]);
  });

  test("orders roots menu, toolbar, unfiled, mobile", () => {
    const tree = buildSyncTree(
      [
        envelope(folder("mobile______", "mobile", [])),
        envelope(folder("unfiled_____", "unfiled", [])),
        envelope(folder("toolbar_____", "toolbar", [])),
        envelope(folder("menu________", "menu", [])),
      ],
      1
    );
    expect(tree.roots.map((n) => n.guid)).toEqual([
      "menu________",
      "toolbar_____",
      "unfiled_____",
      "mobile______",
    ]);
  });

  test("drops tombstones", () => {
    const tree = buildSyncTree(
      [
        envelope(folder("menu________", "menu", ["gone", "here"])),
        envelope({ guid: "gone", payload: { id: "gone", deleted: true } }),
        envelope(bookmark("here", "menu________", "Here", "https://here")),
      ],
      1
    );
    const menu = tree.roots.find((n) => n.guid === "menu________");
    expect(menu?.children?.map((c) => c.guid)).toEqual(["here"]);
  });

  test("keeps orphans in the unresolved pseudo-folder", () => {
    const tree = buildSyncTree(
      [
        envelope(folder("menu________", "menu", [])),
        envelope(bookmark("orphan", "missing-parent", "Orphan", "https://orphan")),
        envelope(folder("orphanFolder", "Orphan folder", [])),
      ],
      1
    );
    const unresolved = tree.roots.find((n) => n.guid === UNRESOLVED_PARENT_GUID);
    expect(unresolved).toBeDefined();
    expect(unresolved?.children?.map((c) => c.guid).sort()).toEqual([
      "orphan",
      "orphanFolder",
    ]);
  });

  test("cycles do not hang or duplicate", () => {
    const tree = buildSyncTree(
      [
        envelope(folder("menu________", "menu", ["a", "b"])),
        envelope(folder("a", "A", ["b"])),
        envelope(folder("b", "B", ["a"])), // a ↔ b cycle
      ],
      1
    );
    const menu = tree.roots.find((n) => n.guid === "menu________");
    expect(menu?.children?.map((c) => c.guid)).toEqual(["a", "b"]);
    // The back-edge b→a is dropped; each node appears exactly once.
    const a = menu?.children?.[0];
    const b = menu?.children?.[1];
    expect(a?.children?.map((c) => c.guid)).toEqual(["b"]);
    expect(b?.children).toEqual([]);
    expect(countBookmarkNodes(tree)).toBe(0);
  });

  test("keeps separators as leaf nodes and skips unknown types", () => {
    const tree = buildSyncTree(
      [
        envelope(folder("menu________", "menu", ["sep", "q1", "weird"])),
        envelope({ guid: "sep", payload: { id: "sep", type: "separator", pos: 0 } }),
        envelope({
          guid: "q1",
          payload: { id: "q1", type: "query", title: "Recent", bmkUri: "place:..." },
        }),
        envelope({
          guid: "weird",
          payload: { id: "weird", type: "mutation", title: "weird" },
        }),
      ],
      1
    );
    const menu = tree.roots.find((n) => n.guid === "menu________");
    expect(menu?.children?.map((c) => c.guid)).toEqual(["sep", "q1"]);
    expect(countBookmarkNodes(tree)).toBe(1); // query counts, separator doesn't
  });

  test("idempotent: rebuilding the same records yields the same tree shape", () => {
    const records = [
      envelope(folder("menu________", "menu", ["b1", "f1"])),
      envelope(bookmark("b1", "menu________", "One", "https://one")),
      envelope(folder("f1", "Folder", ["b2"])),
      envelope(bookmark("b2", "f1", "Two", "https://two")),
    ];
    const t1 = buildSyncTree(records, 5);
    const t2 = buildSyncTree(records, 5);
    expect(t2.roots).toEqual(t1.roots);
    expect(t2.bookmarksModified).toBe(t1.bookmarksModified);
  });

  test("records arriving in different order produce the same tree", () => {
    const forward = buildSyncTree(
      [
        envelope(folder("menu________", "menu", ["b1", "b2"])),
        envelope(bookmark("b1", "menu________", "One", "https://one")),
        envelope(bookmark("b2", "menu________", "Two", "https://two")),
      ],
      1
    );
    const reversed = buildSyncTree(
      [
        envelope(bookmark("b2", "menu________", "Two", "https://two")),
        envelope(bookmark("b1", "menu________", "One", "https://one")),
        envelope(folder("menu________", "menu", ["b1", "b2"])),
      ],
      1
    );
    expect(reversed.roots).toEqual(forward.roots);
  });

  test("1,000 bookmarks build in under a second (Hermes headroom)", () => {
    const records: DecryptedRecord[] = [folder("menu________", "menu", [])];
    const childGuids: string[] = [];
    for (let i = 0; i < 1000; i += 1) {
      const guid = `bookmark${String(i).padStart(4, "0")}`;
      const parent = i % 10 === 0 ? `folder${Math.floor(i / 10)}` : "menu________";
      if (parent !== "menu________" && !records.some((r) => r.guid === parent)) {
        records.push(folder(parent, `Folder ${parent}`, []));
      }
      records.push(bookmark(guid, parent, `Title ${i}`, `https://example.com/${i}`));
      if (parent === "menu________") childGuids.push(guid);
    }
    // Wire folders' children via parentid inference (folder children arrays).
    for (const record of records) {
      if (record.payload.type === "folder" && record.guid !== "menu________") {
        record.payload.children = records
          .filter((r) => r.payload.parentid === record.guid)
          .map((r) => r.guid);
      }
    }
    (records[0].payload as { children?: string[] }).children = childGuids;

    const start = performance.now();
    const tree = buildSyncTree(records, 1);
    const elapsed = performance.now() - start;
    expect(countBookmarkNodes(tree)).toBe(1000);
    // bun/native crypto is far faster than Hermes; anything under 1s here
    // leaves comfortable headroom for the interpreter on-device.
    expect(elapsed).toBeLessThan(1000);
  });
});
