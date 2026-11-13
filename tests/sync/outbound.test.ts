// Outbound state layer tests: record schema fidelity (research-upload §2),
// children merge, tombstones, unknown-field preservation, LWW matrix
// (PLAN §2), GUID pool mechanics, ack bookkeeping, and serialization.
// Pure functions throughout — no network, deterministic random source.

import { describe, expect, test } from "bun:test";
import { encodeBase64Url } from "../../src/sync/base64";
import {
  ackSuccess,
  assignGuidMapping,
  buildUploadSet,
  deserializeOutbound,
  emptyOutboundState,
  forgetGuid,
  GuidPool,
  markAllDirty,
  markDeleted,
  markDirty,
  noteRemoteRecord,
  RandomSource,
  resolveValueConflict,
  serializeOutbound,
  UploadRecord,
} from "../../src/sync/outbound";
import { LocalBookmarkSnapshot, SyncTree } from "../../src/sync/model";

// ---------------------------------------------------------------------------
// Helpers

/** Deterministic random source serving one fixed pool of `guidCount` 9-byte
 *  blocks (distinct per block); a second request fails the test. */
function fixedPoolSource(guidCount: number): { source: RandomSource; calls: number[] } {
  const bytes = new Uint8Array(guidCount * 9);
  for (let g = 0; g < guidCount; g += 1) {
    let n = g + 1;
    for (let b = 0; b < 4; b += 1) {
      bytes[g * 9 + b] = n % 256;
      n = Math.floor(n / 256);
    }
    bytes[g * 9 + 4] = 0xff;
  }
  const calls: number[] = [];
  let served = false;
  return {
    calls,
    source: {
      randomB64: async (count: number) => {
        calls.push(count);
        if (served) throw new Error("test random source exhausted");
        served = true;
        return encodeBase64Url(bytes);
      },
    },
  };
}

function poolOf(source: RandomSource): GuidPool {
  return new GuidPool(source);
}

function snap(
  bookmarks: { id: string; title: string; url: string; folderId?: string }[],
  bookmarkFolders: { id: string; title: string }[] = []
): LocalBookmarkSnapshot {
  return { bookmarks, bookmarkFolders };
}

function menuTreeWith(childGuid: string): SyncTree {
  return {
    roots: [
      {
        guid: "menu________",
        type: "folder",
        title: "menu",
        children: [{ guid: childGuid, type: "bookmark", title: "from menu" }],
      },
    ],
    fetchedAt: 0,
    bookmarksModified: null,
  };
}

function guidOfLocal(records: UploadRecord[], localId: string): UploadRecord {
  const record = records.find((r) => r.localId === localId);
  if (!record) throw new Error(`no record for ${localId}`);
  return record;
}

// ---------------------------------------------------------------------------
// Record assembly

describe("buildUploadSet", () => {
  test("root bookmark + mobile record carry the exact wire fields", async () => {
    const { source } = fixedPoolSource(2);
    const state = emptyOutboundState();
    markDirty(state, "b1", 2000);
    const records = await buildUploadSet(
      state,
      snap([{ id: "b1", title: "Example", url: "https://example.com", folderId: "" }]),
      { pool: poolOf(source), nowMs: 5000 }
    );

    const b1 = guidOfLocal(records, "b1");
    expect(b1.isTombstone).toBe(false);
    expect(b1.sortindex).toBe(0);
    expect(b1.guid).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(b1.cleartext).toEqual({
      id: b1.guid,
      parentid: "mobile",
      parentName: "mobile",
      type: "bookmark",
      title: "Example",
      bmkUri: "https://example.com",
      // dirty changedAtMs (2000) sits below the 1993 floor → clamped.
      dateAdded: 727747200000,
      hasDupe: true,
    });

    const mobile = records.find((r) => r.localId === null);
    expect(mobile).toBeDefined();
    expect(mobile!.sortindex).toBe(1000000);
    expect(mobile!.cleartext).toMatchObject({
      id: "mobile",
      parentid: "places",
      type: "folder",
      title: "mobile",
      children: [b1.guid],
      hasDupe: true,
    });
  });

  test("folder records nest under mobile with local-order children", async () => {
    const { source } = fixedPoolSource(3);
    const state = emptyOutboundState();
    markDirty(state, "r1", 2000);
    markDirty(state, "f1", 2000);
    markDirty(state, "b1", 2000);
    const records = await buildUploadSet(
      state,
      snap(
        [
          { id: "r1", title: "Root", url: "https://root", folderId: "" },
          { id: "b1", title: "Inside", url: "https://inside", folderId: "f1" },
        ],
        [{ id: "f1", title: "Work" }]
      ),
      { pool: poolOf(source), nowMs: 5000 }
    );

    const folder = guidOfLocal(records, "f1");
    expect(folder.sortindex).toBe(1000000);
    expect(folder.cleartext).toMatchObject({
      type: "folder",
      parentid: "mobile",
      parentName: "mobile",
      title: "Work",
      children: [guidOfLocal(records, "b1").guid],
    });
    const inside = guidOfLocal(records, "b1");
    expect(inside.cleartext).toMatchObject({
      type: "bookmark",
      parentid: folder.guid,
      parentName: "Work",
      title: "Inside",
      bmkUri: "https://inside",
    });
    const mobile = records.find((r) => r.localId === null)!;
    // Root bookmarks first, then folders — appended in local order.
    expect(mobile.cleartext.children).toEqual([
      guidOfLocal(records, "r1").guid,
      folder.guid,
    ]);
  });

  test("dateAdded: preserves remote numbers, normalizes strings, clamps floor", async () => {
    const state = emptyOutboundState();
    assignGuidMapping(state, "b1", "GB1");
    noteRemoteRecord(state, "GB1", {
      id: "GB1",
      type: "bookmark",
      dateAdded: 100000000000, // number below the 1993 floor
    }, 1);
    assignGuidMapping(state, "b2", "GB2");
    noteRemoteRecord(state, "GB2", {
      id: "GB2",
      type: "bookmark",
      dateAdded: "1500000000000", // legacy string date (#1148)
    }, 1);
    markDirty(state, "b1", 2000);
    markDirty(state, "b2", 2000);
    const records = await buildUploadSet(
      state,
      snap([
        { id: "b1", title: "One", url: "https://one", folderId: "" },
        { id: "b2", title: "Two", url: "https://two", folderId: "" },
      ]),
      { pool: poolOf(fixedPoolSource(1).source), nowMs: 5000 }
    );
    expect(guidOfLocal(records, "b1").cleartext.dateAdded).toBe(727747200000);
    expect(guidOfLocal(records, "b2").cleartext.dateAdded).toBe(1500000000000);
  });

  test("pending deletes upload exact {id, deleted:true} tombstones", async () => {
    const state = emptyOutboundState();
    assignGuidMapping(state, "b1", "GB1");
    markDirty(state, "b1", 1000);
    markDeleted(state, "b1", 2000);
    const records = await buildUploadSet(state, snap([]), {
      pool: poolOf(fixedPoolSource(1).source),
      nowMs: 5000,
    });
    expect(records).toHaveLength(1);
    const tombstone = records[0];
    expect(tombstone.isTombstone).toBe(true);
    expect(tombstone.guid).toBe("GB1");
    expect(tombstone.cleartext).toEqual({ id: "GB1", deleted: true });
    expect(Object.keys(tombstone.cleartext).sort()).toEqual(["deleted", "id"]);
  });

  test("re-upload preserves unknown remote fields, overwrites ours", async () => {
    const state = emptyOutboundState();
    assignGuidMapping(state, "b1", "GB1");
    noteRemoteRecord(state, "GB1", {
      id: "GB1",
      parentid: "mobile",
      parentName: "mobile",
      type: "bookmark",
      title: "Old title",
      bmkUri: "https://old",
      tags: ["a", "b"],
      keyword: "kw",
      description: "keep me",
      loadInSidebar: false, // Zen/Firefox extension field
      dateAdded: "1500000000000",
      hasDupe: false,
      queryId: "q",
    }, 100);
    markDirty(state, "b1", 200);
    const records = await buildUploadSet(
      state,
      snap([{ id: "b1", title: "New title", url: "https://new", folderId: "" }]),
      { pool: poolOf(fixedPoolSource(1).source), nowMs: 5000 }
    );
    const cleartext = guidOfLocal(records, "b1").cleartext;
    expect(cleartext.title).toBe("New title");
    expect(cleartext.bmkUri).toBe("https://new");
    expect(cleartext.tags).toEqual(["a", "b"]);
    expect(cleartext.keyword).toBe("kw");
    expect(cleartext.description).toBe("keep me");
    expect(cleartext.loadInSidebar).toBe(false);
    expect(cleartext.queryId).toBe("q");
    expect(cleartext.dateAdded).toBe(1500000000000); // string normalized
    expect(cleartext.hasDupe).toBe(true); // our field, always overwritten
  });

  test("mobile children merge keeps remote order and appends local", async () => {
    const state = emptyOutboundState();
    noteRemoteRecord(state, "mobile", {
      id: "mobile",
      type: "folder",
      parentid: "places",
      title: "mobile",
      children: ["rA", "rB"], // remote-only items yeoyu does not model
    }, 10);
    markDirty(state, "l1", 100);
    markDirty(state, "l2", 100);
    const records = await buildUploadSet(
      state,
      snap([
        { id: "l1", title: "L1", url: "https://l1", folderId: "" },
        { id: "l2", title: "L2", url: "https://l2", folderId: "" },
      ]),
      { pool: poolOf(fixedPoolSource(2).source), nowMs: 5000 }
    );
    const mobile = records.find((r) => r.localId === null)!;
    expect(mobile.cleartext.children).toEqual([
      "rA",
      "rB",
      guidOfLocal(records, "l1").guid,
      guidOfLocal(records, "l2").guid,
    ]);
  });

  test("moved-out item leaves the old parent's children array", async () => {
    const state = emptyOutboundState();
    assignGuidMapping(state, "b1", "GB1");
    assignGuidMapping(state, "f1", "GF1");
    noteRemoteRecord(state, "mobile", {
      id: "mobile",
      type: "folder",
      children: ["GF1"],
    }, 10);
    noteRemoteRecord(state, "GF1", {
      id: "GF1",
      type: "folder",
      title: "Work",
      children: ["GB1"],
    }, 10);
    // b1 moved from f1 to root (folderId change → dirty).
    markDirty(state, "b1", 100);
    const records = await buildUploadSet(
      state,
      snap([{ id: "b1", title: "B1", url: "https://b1", folderId: "" }], [
        { id: "f1", title: "Work" },
      ]),
      { pool: poolOf(fixedPoolSource(1).source), nowMs: 5000 }
    );
    const folder = guidOfLocal(records, "f1");
    expect(folder.cleartext.children).toEqual([]); // b1 no longer a member
    const b1 = guidOfLocal(records, "b1");
    expect(b1.cleartext.parentid).toBe("mobile");
    const mobile = records.find((r) => r.localId === null)!;
    expect(mobile.cleartext.children).toEqual(["GF1", "GB1"]); // moved in, appended
  });

  test("folder delete: parent tombstone + children promoted to mobile root", async () => {
    const state = emptyOutboundState();
    assignGuidMapping(state, "f1", "GF1");
    assignGuidMapping(state, "b1", "GB1");
    noteRemoteRecord(state, "mobile", { id: "mobile", type: "folder", children: ["GF1"] }, 10);
    noteRemoteRecord(state, "GF1", {
      id: "GF1",
      type: "folder",
      title: "Work",
      children: ["GB1"],
    }, 10);
    markDirty(state, "f1", 100);
    markDeleted(state, "f1", 200); // folder gone; children promoted to root
    markDirty(state, "b1", 300);
    const records = await buildUploadSet(
      state,
      snap([{ id: "b1", title: "B1", url: "https://b1", folderId: "" }]),
      { pool: poolOf(fixedPoolSource(1).source), nowMs: 5000 }
    );
    const tombstone = records.find((r) => r.isTombstone)!;
    expect(tombstone.guid).toBe("GF1");
    expect(tombstone.cleartext).toEqual({ id: "GF1", deleted: true });
    const b1 = guidOfLocal(records, "b1");
    expect(b1.cleartext.parentid).toBe("mobile"); // reparented
    const mobile = records.find((r) => r.localId === null)!;
    expect(mobile.cleartext.children).toEqual(["GB1"]); // GF1 dropped, GB1 in
  });

  test("receive-only subtree (menu) is never re-uploaded nor claimed", async () => {
    const state = emptyOutboundState();
    assignGuidMapping(state, "b1", "GB1");
    noteRemoteRecord(state, "GB1", { id: "GB1", type: "bookmark", parentid: "menu" }, 10);
    markDirty(state, "b1", 100); // local edit on a received menu item
    const records = await buildUploadSet(
      state,
      snap([{ id: "b1", title: "Edited", url: "https://e", folderId: "" }]),
      {
        pool: poolOf(fixedPoolSource(1).source),
        remoteTree: menuTreeWith("GB1"),
        nowMs: 5000,
      }
    );
    expect(records).toEqual([]); // no record, not even claimed under mobile
  });

  test("steady state: acked mappings produce no records, guids stay stable", async () => {
    const { source } = fixedPoolSource(2);
    const state = emptyOutboundState();
    markDirty(state, "b1", 2000);
    const snapshot = snap([{ id: "b1", title: "Example", url: "https://example.com", folderId: "" }]);
    const first = await buildUploadSet(state, snapshot, {
      pool: poolOf(source),
      nowMs: 5000,
    });
    expect(first.length).toBe(2);
    const b1Guid = guidOfLocal(first, "b1").guid;
    ackSuccess(state, first.map((r) => r.guid), 6000, first);
    const second = await buildUploadSet(state, snapshot, {
      pool: poolOf(source),
      nowMs: 7000,
    });
    expect(second).toEqual([]);
    expect(state.guidByLocalId["b1"]).toBe(b1Guid);
    expect(state.dirty["b1"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// GUID pool

describe("GuidPool", () => {
  test("refills via the re-request loop when the pool is exhausted", async () => {
    const calls: number[] = [];
    let call = 0;
    const source: RandomSource = {
      randomB64: async (count: number) => {
        calls.push(count);
        call += 1;
        return encodeBase64Url(fixedPoolBytes(1, call));
      },
    };
    const pool = new GuidPool(source);
    const guids = [await pool.nextGuid(), await pool.nextGuid(), await pool.nextGuid()];
    expect(new Set(guids).size).toBe(3);
    // Every draw exhausted its 9-byte pool → one request per GUID.
    expect(calls).toEqual([1024, 1024, 1024]);
    expect(calls.every((count) => count <= 1024)).toBe(true);
  });

  test("re-issues when a draw lands on a reserved root id", async () => {
    const calls: number[] = [];
    const pools = ["menu________", encodeBase64Url(fixedPoolBytes(1))]; // valid 9-byte b64
    let index = 0;
    const source: RandomSource = {
      randomB64: async (count: number) => {
        calls.push(count);
        const next = pools[index];
        index += 1;
        if (next === undefined) throw new Error("test source exhausted");
        return next;
      },
    };
    const guid = await new GuidPool(source).nextGuid();
    expect(guid).not.toBe("menu________");
    expect(guid).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(calls).toEqual([1024, 1024]); // the re-request loop ran
  });
});

function fixedPoolBytes(guidCount: number, firstIndex = 0): Uint8Array {
  const bytes = new Uint8Array(guidCount * 9);
  for (let g = 0; g < guidCount; g += 1) {
    let n = firstIndex + g + 1;
    for (let b = 0; b < 4; b += 1) {
      bytes[g * 9 + b] = n % 256;
      n = Math.floor(n / 256);
    }
    bytes[g * 9 + 4] = 0xff;
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Dirty tracking + ack

describe("dirty bookkeeping", () => {
  test("markDirty keeps changedAtMs monotonic per item", () => {
    const state = emptyOutboundState();
    markDirty(state, "b1", 500);
    markDirty(state, "b1", 200); // stale event must not move the clock back
    expect(state.dirty["b1"]).toEqual({ changedAtMs: 500 });
  });

  test("markDeleted moves an uploaded mapping to pendingDeletes", () => {
    const state = emptyOutboundState();
    assignGuidMapping(state, "b1", "GB1");
    markDirty(state, "b1", 100);
    markDeleted(state, "b1", 200);
    expect(state.guidByLocalId["b1"]).toBeUndefined();
    expect(state.localIdByGuid["GB1"]).toBeUndefined();
    expect(state.dirty["b1"]).toBeUndefined();
    expect(state.pendingDeletes["b1"]).toEqual({ guid: "GB1", changedAtMs: 200 });
  });

  test("markDeleted on a never-uploaded item just drops the dirty entry", () => {
    const state = emptyOutboundState();
    markDirty(state, "b1", 100);
    markDeleted(state, "b1", 200);
    expect(state.dirty["b1"]).toBeUndefined();
    expect(state.pendingDeletes["b1"]).toBeUndefined();
  });

  test("markAllDirty marks every local bookmark and folder", () => {
    const state = emptyOutboundState();
    markAllDirty(
      state,
      snap(
        [
          { id: "b1", title: "B", url: "https://b", folderId: "" },
          { id: "b2", title: "B2", url: "https://b2", folderId: "f1" },
        ],
        [{ id: "f1", title: "Work" }]
      ),
      1234
    );
    expect(Object.keys(state.dirty).sort()).toEqual(["b1", "b2", "f1"]);
    expect(state.dirty["f1"]).toEqual({ changedAtMs: 1234 });
  });

  test("re-created id after delete keeps its tombstone and gets a fresh guid", async () => {
    const state = emptyOutboundState();
    assignGuidMapping(state, "b1", "GB1");
    noteRemoteRecord(state, "GB1", { id: "GB1", type: "bookmark" }, 10);
    markDeleted(state, "b1", 200);
    markDirty(state, "b1", 300); // same local id came back
    const records = await buildUploadSet(
      state,
      snap([{ id: "b1", title: "New", url: "https://new", folderId: "" }]),
      { pool: poolOf(fixedPoolSource(1).source), nowMs: 5000 }
    );
    const tombstone = records.find((r) => r.isTombstone)!;
    expect(tombstone.guid).toBe("GB1");
    const live = guidOfLocal(records, "b1");
    expect(live.guid).not.toBe("GB1");
    expect(state.guidByLocalId["b1"]).toBe(live.guid);
  });

  test("ackSuccess clears only accepted ids (partial success)", () => {
    const state = emptyOutboundState();
    assignGuidMapping(state, "b1", "GB1");
    assignGuidMapping(state, "b2", "GB2");
    assignGuidMapping(state, "d1", "GD1");
    markDirty(state, "b1", 100);
    markDirty(state, "b2", 100);
    markDirty(state, "d1", 100);
    markDeleted(state, "d1", 200);
    noteRemoteRecord(state, "GD1", { id: "GD1", type: "bookmark" }, 10);
    const uploaded: UploadRecord[] = [
      {
        localId: "b1",
        guid: "GB1",
        cleartext: { id: "GB1", type: "bookmark" },
        isTombstone: false,
        sortindex: 0,
      },
    ];
    ackSuccess(state, ["GB1", "GD1"], 999, uploaded);
    expect(state.dirty["b1"]).toBeUndefined(); // accepted
    expect(state.dirty["b2"]).toEqual({ changedAtMs: 100 }); // failed — stays
    expect(state.pendingDeletes["d1"]).toBeUndefined(); // tombstone acked
    expect(state.remoteRaw["GD1"]).toBeUndefined(); // gone from the server
    expect(state.remoteRaw["GB1"]).toEqual({
      cleartext: { id: "GB1", type: "bookmark" },
      modifiedMs: 999,
    });
  });

  test("forgetGuid drops mapping, dirty and pending knowledge of a guid", () => {
    const state = emptyOutboundState();
    assignGuidMapping(state, "b1", "GB1");
    markDirty(state, "b1", 100);
    noteRemoteRecord(state, "GB1", { id: "GB1" }, 10);
    forgetGuid(state, "GB1");
    expect(state.guidByLocalId["b1"]).toBeUndefined();
    expect(state.localIdByGuid["GB1"]).toBeUndefined();
    expect(state.dirty["b1"]).toBeUndefined();
    expect(state.remoteRaw["GB1"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// LWW (PLAN §2 — AC-5 yardstick)

describe("resolveValueConflict", () => {
  test("no remote record → local", () => {
    expect(resolveValueConflict(100, null)).toBe("local");
    expect(resolveValueConflict(100, undefined)).toBe("local");
  });
  test("no local change → remote", () => {
    expect(resolveValueConflict(null, 100)).toBe("remote");
    expect(resolveValueConflict(undefined, 100)).toBe("remote");
  });
  test("local newer → local; remote newer → remote", () => {
    expect(resolveValueConflict(200, 100)).toBe("local");
    expect(resolveValueConflict(100, 200)).toBe("remote");
  });
  test("tie → remote (server clock is authoritative)", () => {
    expect(resolveValueConflict(100, 100)).toBe("remote");
  });
});

// ---------------------------------------------------------------------------
// Serialization

describe("outbound serialization", () => {
  test("round-trips a fully populated state", () => {
    const state = emptyOutboundState();
    assignGuidMapping(state, "b1", "GB1");
    markDirty(state, "b1", 100);
    markDirty(state, "d1", 100);
    state.pendingDeletes["d1"] = { guid: "GD1", changedAtMs: 200 };
    noteRemoteRecord(state, "GB1", { id: "GB1", tags: ["x"] }, 300);
    const restored = deserializeOutbound(serializeOutbound(state));
    expect(restored).toEqual(state);
  });

  test("corrupt payloads are discarded (null)", () => {
    expect(deserializeOutbound(null)).toBeNull();
    expect(deserializeOutbound("")).toBeNull();
    expect(deserializeOutbound("{not json")).toBeNull();
    expect(deserializeOutbound('"a string"')).toBeNull();
    expect(deserializeOutbound(JSON.stringify({ version: 2 }))).toBeNull();
    expect(deserializeOutbound(JSON.stringify({ version: 1, guidByLocalId: "nope" }))).toBeNull();
  });

  test("individually malformed entries are dropped, not fatal", () => {
    const json = JSON.stringify({
      version: 1,
      guidByLocalId: { b1: "GB1", b2: 42 },
      localIdByGuid: { GB1: "b1" },
      dirty: { b1: { changedAtMs: 5 }, b2: { changedAtMs: "x" } },
      pendingDeletes: { d1: { guid: "GD1", changedAtMs: 6 }, d2: { guid: 7 } },
      remoteRaw: { GB1: { cleartext: { id: "GB1" }, modifiedMs: 8 } },
    });
    const restored = deserializeOutbound(json);
    expect(restored).not.toBeNull();
    expect(restored!.guidByLocalId).toEqual({ b1: "GB1" });
    expect(restored!.dirty).toEqual({ b1: { changedAtMs: 5 } });
    expect(restored!.pendingDeletes).toEqual({ d1: { guid: "GD1", changedAtMs: 6 } });
    expect(restored!.remoteRaw).toEqual({ GB1: { cleartext: { id: "GB1" }, modifiedMs: 8 } });
  });
});
