// Outbound (send) state layer for Firefox Sync bookmarks — pure logic, no
// network. Owns:
//   - local id ↔ sync GUID mapping
//   - dirty tracking (the upload backlog) + pending tombstones
//   - the last received cleartext per GUID (unknown-field preservation and
//     LWW material)
//   - upload record assembly (cleartext only — encryption is T-1/T-3's job)
// Wire semantics follow research-upload.md §2 (schema) and §5 (GUIDs) and
// PLAN.md D1–D5/D10; resolveValueConflict implements PLAN.md §2 (the AC-5
// yardstick). Persistence flows through the sync-outbound-v1.json channel
// (platform loadOutbound/saveOutbound/clearOutbound), wired by T-3/T-4.

import { decodeBase64Url, encodeBase64Url } from "./base64";
import {
  LocalBookmark,
  LocalBookmarkFolder,
  LocalBookmarkSnapshot,
  ROOT_GUIDS,
  SyncNode,
  SyncTree,
  UNRESOLVED_PARENT_GUID,
} from "./model";

// ---------------------------------------------------------------------------
// Constants

/** Wire ids that must never be issued as a record GUID: the places root
 *  (uploading it makes Firefox/Zen delete it server-side), the four
 *  user-content root short ids, other special engine ids, and the 12-char
 *  Places root GUIDs a random draw could theoretically alias. */
export const RESERVED_GUIDS: ReadonlySet<string> = new Set([
  "places",
  "menu",
  "toolbar",
  "unfiled",
  "mobile",
  "pinned",
  "readinglist",
  "root________",
  ROOT_GUIDS.menu,
  ROOT_GUIDS.toolbar,
  ROOT_GUIDS.unfiled,
  ROOT_GUIDS.mobile,
]);

/** Earliest sane bookmark dateAdded: Date.UTC(1993, 0, 23). */
export const EARLIEST_DATE_ADDED_MS = 727747200000;

/** Wire short id of the root our uploads live under (PLAN D1). */
export const MOBILE_ROOT_ID = "mobile";
/** Conceptual parent of every user-content root, as uploaded by a-s/Firefox. */
export const PLACES_PARENT_ID = "places";

export const FOLDER_SORTINDEX = 1000000;
export const BOOKMARK_SORTINDEX = 0;

const GUID_BYTES = 9;
const GUID_CHARS = 12;
/** secureRandomB64 hard max; 1024 bytes ≈ 113 GUIDs per refill. */
const POOL_REFILL_BYTES = 1024;

// ---------------------------------------------------------------------------
// State + persistence shape

export interface RemoteRawEntry {
  /** Received cleartext verbatim (unknown fields preserved for re-upload). */
  cleartext: Record<string, unknown>;
  /** Server modified (ms) of the record the cleartext came from. */
  modifiedMs: number;
}

export interface OutboundState {
  version: 1;
  guidByLocalId: Record<string, string>;
  localIdByGuid: Record<string, string>;
  dirty: Record<string, { changedAtMs: number }>;
  pendingDeletes: Record<string, { guid: string; changedAtMs: number }>;
  remoteRaw: Record<string, RemoteRawEntry>;
}

export function emptyOutboundState(): OutboundState {
  return {
    version: 1,
    guidByLocalId: {},
    localIdByGuid: {},
    dirty: {},
    pendingDeletes: {},
    remoteRaw: {},
  };
}

export function serializeOutbound(state: OutboundState): string {
  return JSON.stringify(state);
}

/** Defensive reader in the readPersistedTree tradition: junk never crashes
 *  the store, a structurally invalid payload is discarded wholesale (null),
 *  individually malformed entries are dropped so one bad key cannot wipe the
 *  whole upload backlog. */
export function deserializeOutbound(json: string | null): OutboundState | null {
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const raw = parsed as Partial<OutboundState>;
  if (raw.version !== 1) return null;

  const state = emptyOutboundState();
  const guidByLocalId = stringMap(raw.guidByLocalId);
  if (guidByLocalId === null) return null;
  const localIdByGuid = stringMap(raw.localIdByGuid);
  if (localIdByGuid === null) return null;

  if (raw.dirty !== undefined) {
    if (typeof raw.dirty !== "object" || raw.dirty === null) return null;
    for (const [localId, entry] of Object.entries(raw.dirty)) {
      const changedAtMs = (entry as { changedAtMs?: unknown } | null)?.changedAtMs;
      if (typeof changedAtMs === "number" && Number.isFinite(changedAtMs)) {
        state.dirty[localId] = { changedAtMs };
      }
    }
  }
  if (raw.pendingDeletes !== undefined) {
    if (typeof raw.pendingDeletes !== "object" || raw.pendingDeletes === null) return null;
    for (const [localId, entry] of Object.entries(raw.pendingDeletes)) {
      const guid = (entry as { guid?: unknown } | null)?.guid;
      const changedAtMs = (entry as { changedAtMs?: unknown } | null)?.changedAtMs;
      if (typeof guid === "string" && typeof changedAtMs === "number" && Number.isFinite(changedAtMs)) {
        state.pendingDeletes[localId] = { guid, changedAtMs };
      }
    }
  }
  if (raw.remoteRaw !== undefined) {
    if (typeof raw.remoteRaw !== "object" || raw.remoteRaw === null) return null;
    for (const [guid, entry] of Object.entries(raw.remoteRaw)) {
      const cleartext = (entry as { cleartext?: unknown } | null)?.cleartext;
      const modifiedMs = (entry as { modifiedMs?: unknown } | null)?.modifiedMs;
      if (
        typeof cleartext === "object" && cleartext !== null &&
        typeof modifiedMs === "number" && Number.isFinite(modifiedMs)
      ) {
        state.remoteRaw[guid] = { cleartext: cleartext as Record<string, unknown>, modifiedMs };
      }
    }
  }
  state.guidByLocalId = guidByLocalId;
  state.localIdByGuid = localIdByGuid;
  return state;
}

function stringMap(value: unknown): Record<string, string> | null {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null) return null;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

// ---------------------------------------------------------------------------
// GUID issuance (PLAN D3)

export interface RandomSource {
  /** URL-safe unpadded base64 of `count` secure-random bytes (1..1024). */
  randomB64(count: number): Promise<string>;
}

/** Adapts the platform bridge (platform.secureRandomB64) into a RandomSource. */
export function platformRandomSource(
  secureRandomB64: (count: number) => Promise<string>
): RandomSource {
  return { randomB64: secureRandomB64 };
}

/** Draws 12-char base64url GUIDs (9 random bytes) from refillable byte pools.
 *  A draw that lands on a reserved id is discarded and retried; an exhausted
 *  pool triggers one refill request per iteration (the re-request loop). */
export class GuidPool {
  private bytes: Uint8Array = new Uint8Array(0);
  private cursor = 0;

  constructor(private readonly source: RandomSource) {}

  async nextGuid(): Promise<string> {
    for (;;) {
      if (this.cursor + GUID_BYTES > this.bytes.length) {
        const poolB64 = await this.source.randomB64(POOL_REFILL_BYTES);
        // decodeBase64Url throws on garbage — the caller classifies it.
        this.bytes = decodeBase64Url(poolB64);
        this.cursor = 0;
        if (this.bytes.length < GUID_BYTES) {
          throw new Error("sync random source returned fewer than 9 bytes");
        }
        continue;
      }
      const slice = this.bytes.subarray(this.cursor, this.cursor + GUID_BYTES);
      this.cursor += GUID_BYTES;
      const guid = encodeBase64Url(slice);
      if (guid.length === GUID_CHARS && !RESERVED_GUIDS.has(guid)) return guid;
      // Reserved draw — burn it and draw again.
    }
  }
}

// ---------------------------------------------------------------------------
// Dirty tracking (PLAN D4/D10)

/** Record a local change for upload. changedAtMs is kept monotonic per item. */
export function markDirty(state: OutboundState, localId: string, changedAtMs: number): void {
  // A pending tombstone means this local id was deleted and has come back
  // (re-created): the tombstone for the old GUID must still go out, and the
  // new incarnation needs a fresh GUID — markDeleted already released the
  // old mapping, so assembly will issue a new one. Defensive cleanup in case
  // a mapping snuck back in.
  const pending = state.pendingDeletes[localId];
  if (pending) {
    delete state.guidByLocalId[localId];
    delete state.localIdByGuid[pending.guid];
  }
  const existing = state.dirty[localId];
  state.dirty[localId] = { changedAtMs: Math.max(existing?.changedAtMs ?? 0, changedAtMs) };
}

/** Record a local deletion. Items that were never uploaded have no server
 *  presence, so there is nothing to tombstone — the dirty entry is simply
 *  dropped. */
export function markDeleted(state: OutboundState, localId: string, changedAtMs: number): void {
  delete state.dirty[localId];
  const guid = state.guidByLocalId[localId];
  if (!guid) return;
  delete state.guidByLocalId[localId];
  delete state.localIdByGuid[guid];
  state.pendingDeletes[localId] = { guid, changedAtMs };
}

/** First-connect full upload (PLAN D10): every local item becomes dirty. */
export function markAllDirty(
  state: OutboundState,
  snapshot: LocalBookmarkSnapshot,
  changedAtMs: number
): void {
  for (const bookmark of snapshot.bookmarks) markDirty(state, bookmark.id, changedAtMs);
  for (const folder of snapshot.bookmarkFolders) markDirty(state, folder.id, changedAtMs);
}

/** After a receive primed remoteRaw, reuse server GUIDs for local bookmarks
 *  that match by URL (and folders by title under mobile). Prevents D10 from
 *  minting fresh GUIDs for items we already uploaded in a prior session
 *  (disconnect cleared outbound — G3 Security P1 reconnect duplicates).
 *  Only the mobile subtree is considered — menu/toolbar/unfiled are
 *  receive-only and must never claim local upload ids (D1). */
export function reconcileLocalToRemote(
  state: OutboundState,
  snapshot: LocalBookmarkSnapshot
): void {
  const bookmarkByUrl = new Map<string, string>();
  const folderByTitle = new Map<string, string>();
  const mobileFolderGuids = new Set<string>([MOBILE_ROOT_ID]);
  for (const [guid, entry] of Object.entries(state.remoteRaw)) {
    const cleartext = entry.cleartext;
    if (
      cleartext.type === "folder" &&
      cleartext.parentid === MOBILE_ROOT_ID &&
      guid !== MOBILE_ROOT_ID
    ) {
      mobileFolderGuids.add(guid);
    }
  }
  for (const [guid, entry] of Object.entries(state.remoteRaw)) {
    if (state.localIdByGuid[guid]) continue;
    const cleartext = entry.cleartext;
    const type = cleartext.type;
    const parentid = cleartext.parentid;
    if (
      type === "bookmark" &&
      typeof cleartext.bmkUri === "string" &&
      typeof parentid === "string" &&
      mobileFolderGuids.has(parentid)
    ) {
      if (!bookmarkByUrl.has(cleartext.bmkUri)) bookmarkByUrl.set(cleartext.bmkUri, guid);
    } else if (
      type === "folder" &&
      parentid === MOBILE_ROOT_ID &&
      typeof cleartext.title === "string" &&
      guid !== MOBILE_ROOT_ID
    ) {
      if (!folderByTitle.has(cleartext.title)) folderByTitle.set(cleartext.title, guid);
    }
  }
  for (const folder of snapshot.bookmarkFolders) {
    if (state.guidByLocalId[folder.id]) continue;
    const guid = folderByTitle.get(folder.title);
    if (!guid || state.localIdByGuid[guid]) continue;
    assignGuidMapping(state, folder.id, guid);
    const remote = state.remoteRaw[guid]?.cleartext;
    if (remote && remote.title === folder.title) delete state.dirty[folder.id];
  }
  for (const bookmark of snapshot.bookmarks) {
    if (state.guidByLocalId[bookmark.id]) continue;
    const guid = bookmarkByUrl.get(bookmark.url);
    if (!guid || state.localIdByGuid[guid]) continue;
    assignGuidMapping(state, bookmark.id, guid);
    const remote = state.remoteRaw[guid]?.cleartext;
    if (
      remote &&
      remote.title === bookmark.title &&
      remote.bmkUri === bookmark.url
    ) {
      delete state.dirty[bookmark.id];
    }
  }
}

/** Post-POST bookkeeping: only the ids the server accepted are cleared;
 *  failed ids stay dirty (retried next sync). `uploaded`, when provided (the
 *  buildUploadSet output), refreshes remoteRaw for accepted live records so
 *  later LWW comparisons and unknown-field preservation see our own write. */
export function ackSuccess(
  state: OutboundState,
  guids: string[],
  modifiedMs: number,
  uploaded?: UploadRecord[]
): void {
  const success = new Set(guids);
  if (uploaded) {
    for (const record of uploaded) {
      if (record.isTombstone || !success.has(record.guid)) continue;
      state.remoteRaw[record.guid] = { cleartext: record.cleartext, modifiedMs };
    }
  }
  for (const localId of Object.keys(state.dirty)) {
    const guid = state.guidByLocalId[localId];
    if (guid && success.has(guid)) delete state.dirty[localId];
  }
  for (const localId of Object.keys(state.pendingDeletes)) {
    const guid = state.pendingDeletes[localId]?.guid;
    if (guid && success.has(guid)) {
      delete state.pendingDeletes[localId];
      delete state.remoteRaw[guid]; // the record is gone from the server
    }
  }
}

// ---------------------------------------------------------------------------
// Receive-path helpers (used by T-3 when applying incoming records)

/** Bind a local id to a GUID (e.g. a received record applied as a local
 *  bookmark keeps its remote GUID). Replaces any previous binding either
 *  direction. */
export function assignGuidMapping(state: OutboundState, localId: string, guid: string): void {
  const previousGuid = state.guidByLocalId[localId];
  if (previousGuid) delete state.localIdByGuid[previousGuid];
  const previousOwner = state.localIdByGuid[guid];
  if (previousOwner && previousOwner !== localId) delete state.guidByLocalId[previousOwner];
  state.guidByLocalId[localId] = guid;
  state.localIdByGuid[guid] = localId;
}

/** Record the verbatim cleartext + server modified of a received record
 *  (remoteRaw is the unknown-field preservation base and the LWW material). */
export function noteRemoteRecord(
  state: OutboundState,
  guid: string,
  cleartext: Record<string, unknown>,
  modifiedMs: number
): void {
  state.remoteRaw[guid] = { cleartext, modifiedMs };
}

/** Drop all knowledge of a GUID (e.g. a tombstone received from the server:
 *  the record is already gone remotely, so we must never re-upload it). */
export function forgetGuid(state: OutboundState, guid: string): void {
  delete state.remoteRaw[guid];
  const localId = state.localIdByGuid[guid];
  if (localId) {
    delete state.localIdByGuid[guid];
    delete state.guidByLocalId[localId];
    delete state.dirty[localId];
  }
  for (const [localId, entry] of Object.entries(state.pendingDeletes)) {
    if (entry.guid === guid) delete state.pendingDeletes[localId];
  }
}

// ---------------------------------------------------------------------------
// LWW (PLAN §2 — the AC-5 decision rule)

/** Last-writer-wins for item values (and, by the same comparison, folder
 *  structure): the newer side wins; a tie goes to the remote (server clock
 *  is authoritative, and it prevents our own echoes from winning). */
export function resolveValueConflict(
  localChangedAtMs: number | null | undefined,
  remoteModifiedMs: number | null | undefined
): "local" | "remote" {
  if (remoteModifiedMs === null || remoteModifiedMs === undefined) return "local";
  if (localChangedAtMs === null || localChangedAtMs === undefined) return "remote";
  return localChangedAtMs > remoteModifiedMs ? "local" : "remote";
}

// ---------------------------------------------------------------------------
// Local adapter (PLAN D7 — implemented by App.tsx in T-4, consumed by
// syncStore in T-3; outbound itself never touches the controller)

export type LocalApplyOp =
  | {
      kind: "upsertBookmark";
      localId: string | null;
      title: string;
      url: string;
      folderId: string;
      /** Present on remote creates so the adapter can bind guid mappings. */
      guid?: string;
    }
  | { kind: "upsertFolder"; localId: string | null; title: string; guid?: string }
  | { kind: "deleteBookmark"; localId: string }
  | { kind: "deleteFolder"; localId: string }
  /** PLAN §2 structure LWW: adopt remote children order into a local folder
   *  (`folderId` "" = root-level bookmarks under mobile). */
  | { kind: "reorderInFolder"; folderId: string; orderedLocalIds: string[] }
  /** Move a mapped bookmark into a folder without a full upsert (structure). */
  | { kind: "setBookmarkFolder"; localId: string; folderId: string };

export interface LocalAdapter {
  getLocalSnapshot(): LocalBookmarkSnapshot;
  applyIncoming(ops: LocalApplyOp[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Upload record assembly (PLAN D5)

export interface UploadRecord {
  /** null for the synthetic mobile root record (id "mobile"). */
  localId: string | null;
  guid: string;
  /** Cleartext payload — encryption into a BSO is T-1/T-3's job. */
  cleartext: Record<string, unknown>;
  isTombstone: boolean;
  /** Recommended envelope sortindex (folder 1000000, bookmark/tombstone 0). */
  sortindex: number;
}

export interface BuildUploadSetOptions {
  pool: GuidPool;
  /** Latest received tree. Items under menu/toolbar/unfiled are receive-only
   *  (D1): they are never re-uploaded and never claimed in children arrays.
   *  null/absent disables the protection. */
  remoteTree?: SyncTree | null;
  /** Timestamp source for dateAdded fallbacks; defaults to Date.now(). */
  nowMs?: number;
}

export async function buildUploadSet(
  state: OutboundState,
  snapshot: LocalBookmarkSnapshot,
  options: BuildUploadSetOptions
): Promise<UploadRecord[]> {
  const nowMs = options.nowMs ?? Date.now();
  const protectedGuids = collectProtectedGuids(options.remoteTree ?? null);
  const isProtected = (localId: string): boolean => {
    const guid = state.guidByLocalId[localId];
    return guid !== undefined && protectedGuids.has(guid);
  };

  // -- index the local model ------------------------------------------------
  const folders = snapshot.bookmarkFolders.filter(
    (folder): folder is LocalBookmarkFolder => typeof folder?.id === "string" && !isProtected(folder.id)
  );
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const rootBookmarks: LocalBookmark[] = [];
  const byFolder = new Map<string, LocalBookmark[]>();
  const tombstonedGuids = new Set(
    Object.values(state.pendingDeletes).map((entry) => entry.guid)
  );
  for (const bookmark of snapshot.bookmarks) {
    if (typeof bookmark?.id !== "string" || isProtected(bookmark.id)) continue;
    const folderId = bookmark.folderId ?? "";
    if (folderId && folderById.has(folderId)) {
      const siblings = byFolder.get(folderId);
      if (siblings) siblings.push(bookmark);
      else byFolder.set(folderId, [bookmark]);
    } else {
      // Root level — also the rescue spot for a bookmark whose folder is
      // gone from the snapshot without a recorded delete (promotion miss).
      rootBookmarks.push(bookmark);
    }
  }

  // -- resolve GUIDs for every upload-visible item --------------------------
  // Unmapped items get a fresh GUID here (issuance point per D3). Anything
  // that just got a GUID must have its record uploaded — a children array
  // referencing a record the server never saw breaks the other clients.
  const guidOf = new Map<string, string>();
  const newlyIssued = new Set<string>();
  for (const item of [...rootBookmarks, ...byFolderAll(byFolder), ...folders]) {
    const existing = state.guidByLocalId[item.id];
    if (existing) {
      guidOf.set(item.id, existing);
      continue;
    }
    const guid = await options.pool.nextGuid();
    assignGuidMapping(state, item.id, guid);
    guidOf.set(item.id, guid);
    newlyIssued.add(item.id);
  }

  // -- assemble children arrays and pick folder/mobile records --------------
  const records: UploadRecord[] = [];

  const mobileRemoteChildren = remoteChildrenOf(state, MOBILE_ROOT_ID);
  const mobileChildren = assembleChildren(state, guidOf, tombstonedGuids, mobileRemoteChildren, [
    ...rootBookmarks,
    ...folders, // root bookmarks first, then folders — deterministic order
  ]);
  const mobileExists = state.remoteRaw[MOBILE_ROOT_ID] !== undefined;
  if (mobileChildren.length > 0 && (!mobileExists || !sameChildren(mobileChildren, mobileRemoteChildren))) {
    const base = remoteCleartextOf(state, MOBILE_ROOT_ID);
    const cleartext: Record<string, unknown> = {
      ...base,
      id: MOBILE_ROOT_ID,
      type: "folder",
      title: "mobile",
      children: mobileChildren,
      dateAdded: resolveDateAdded(base, undefined, nowMs),
      hasDupe: true,
    };
    if (base.parentid === undefined) cleartext.parentid = PLACES_PARENT_ID;
    if (base.parentName === undefined) cleartext.parentName = "";
    records.push({
      localId: null,
      guid: MOBILE_ROOT_ID,
      cleartext,
      isTombstone: false,
      sortindex: FOLDER_SORTINDEX,
    });
  }

  for (const folder of folders) {
    const guid = guidOf.get(folder.id)!;
    const remoteChildren = remoteChildrenOf(state, guid);
    const children = assembleChildren(
      state,
      guidOf,
      tombstonedGuids,
      remoteChildren,
      byFolder.get(folder.id) ?? []
    );
    const include =
      newlyIssued.has(folder.id) ||
      state.remoteRaw[guid] === undefined || // no server record — must upload
      state.dirty[folder.id] !== undefined ||
      !sameChildren(children, remoteChildren);
    if (!include) continue;
    const base = remoteCleartextOf(state, guid);
    records.push({
      localId: folder.id,
      guid,
      cleartext: {
        ...base,
        id: guid,
        parentid: MOBILE_ROOT_ID,
        parentName: "mobile",
        type: "folder",
        title: folder.title,
        children,
        dateAdded: resolveDateAdded(base, state.dirty[folder.id]?.changedAtMs, nowMs),
        hasDupe: true,
      },
      isTombstone: false,
      sortindex: FOLDER_SORTINDEX,
    });
  }

  for (const bookmark of [...rootBookmarks, ...byFolderAll(byFolder)]) {
    const guid = guidOf.get(bookmark.id)!;
    if (
      !state.dirty[bookmark.id] &&
      !newlyIssued.has(bookmark.id) &&
      state.remoteRaw[guid] !== undefined // acked record — nothing to send
    ) {
      continue;
    }
    const folderId = bookmark.folderId ?? "";
    const parentFolder = folderId ? folderById.get(folderId) : undefined;
    const parentid = parentFolder ? guidOf.get(parentFolder.id)! : MOBILE_ROOT_ID;
    const parentName = parentFolder ? parentFolder.title : MOBILE_ROOT_ID;
    const base = remoteCleartextOf(state, guid);
    records.push({
      localId: bookmark.id,
      guid,
      cleartext: {
        ...base,
        id: guid,
        parentid,
        parentName,
        type: "bookmark",
        title: bookmark.title,
        bmkUri: bookmark.url,
        dateAdded: resolveDateAdded(base, state.dirty[bookmark.id]?.changedAtMs, nowMs),
        hasDupe: true,
      },
      isTombstone: false,
      sortindex: BOOKMARK_SORTINDEX,
    });
  }

  // -- pending tombstones ----------------------------------------------------
  // Cleartext is exactly {id, deleted: true} — no base merge (D5).
  for (const [localId, entry] of Object.entries(state.pendingDeletes)) {
    records.push({
      localId,
      guid: entry.guid,
      cleartext: { id: entry.guid, deleted: true },
      isTombstone: true,
      sortindex: BOOKMARK_SORTINDEX,
    });
  }

  return records;
}

function byFolderAll(byFolder: Map<string, LocalBookmark[]>): LocalBookmark[] {
  const out: LocalBookmark[] = [];
  for (const siblings of byFolder.values()) out.push(...siblings);
  return out;
}

/** Children merge (D5): remote order first (minus deleted / moved-out /
 *  protected), then local new / moved-in items appended in local order.
 *  Remote children with no local mapping are preserved verbatim — they are
 *  records yeoyu does not model (queries, livemarks, other clients' items). */
function assembleChildren(
  state: OutboundState,
  guidOf: Map<string, string>,
  tombstonedGuids: Set<string>,
  remoteChildren: string[] | null,
  localItems: { id: string }[]
): string[] {
  const members = new Set(localItems.map((item) => item.id));
  const result: string[] = [];
  const seen = new Set<string>();
  if (remoteChildren) {
    for (const childGuid of remoteChildren) {
      if (seen.has(childGuid)) continue;
      const localId = state.localIdByGuid[childGuid];
      if (localId !== undefined) {
        // Belongs here only if the local item still lives in this container
        // under this GUID; otherwise it was deleted, moved out, or protected.
        if (members.has(localId) && guidOf.get(localId) === childGuid) {
          result.push(childGuid);
          seen.add(childGuid);
        }
      } else if (!tombstonedGuids.has(childGuid)) {
        result.push(childGuid); // remote-only child — preserve
        seen.add(childGuid);
      }
    }
  }
  for (const item of localItems) {
    const guid = guidOf.get(item.id)!;
    if (!seen.has(guid)) {
      result.push(guid);
      seen.add(guid);
    }
  }
  return result;
}

/** Validated children array of a remote folder record, null when absent. */
function remoteChildrenOf(state: OutboundState, guid: string): string[] | null {
  const raw = remoteCleartextOf(state, guid).children;
  if (!Array.isArray(raw)) return null;
  return raw.filter((child): child is string => typeof child === "string");
}

function remoteCleartextOf(state: OutboundState, guid: string): Record<string, unknown> {
  return state.remoteRaw[guid]?.cleartext ?? {};
}

function sameChildren(assembled: string[], remote: string[] | null): boolean {
  if (remote === null) return assembled.length === 0;
  return assembled.length === remote.length && assembled.every((guid, i) => guid === remote[i]);
}

/** dateAdded: preserved remote value (string dates normalized — the wire has
 *  seen them), else the change time, else now; integer ms clamped at the
 *  1993-01-23 floor. */
function resolveDateAdded(
  base: Record<string, unknown>,
  changedAtMs: number | undefined,
  nowMs: number
): number {
  const remote = base.dateAdded;
  let ms: number | null = null;
  if (typeof remote === "number" && Number.isFinite(remote)) ms = remote;
  else if (typeof remote === "string" && remote.trim() !== "" && Number.isFinite(Number(remote))) {
    ms = Number(remote);
  }
  if (ms === null) ms = changedAtMs ?? nowMs;
  return Math.max(EARLIEST_DATE_ADDED_MS, Math.floor(ms));
}

/** GUIDs that live under menu/toolbar/unfiled in the received tree — the
 *  receive-only subtrees (D1). The mobile subtree is ours to upload; the
 *  unresolved pseudo-folder is display-only, not a protected root. */
function collectProtectedGuids(tree: SyncTree | null): Set<string> {
  const protectedGuids = new Set<string>();
  if (!tree) return protectedGuids;
  const protectedRoots = new Set<string>([
    ROOT_GUIDS.menu,
    ROOT_GUIDS.toolbar,
    ROOT_GUIDS.unfiled,
  ]);
  const visit = (node: SyncNode): void => {
    protectedGuids.add(node.guid);
    node.children?.forEach(visit);
  };
  for (const root of tree.roots) {
    if (root.guid === UNRESOLVED_PARENT_GUID) continue;
    if (protectedRoots.has(root.guid)) visit(root);
  }
  return protectedGuids;
}
