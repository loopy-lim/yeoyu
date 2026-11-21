// Materialize a received Zen Spaces tree into yeoyu's local Snapshot model
// (workspaces / favorites / pinned tabs / bookmark folders). Receive-only:
// outbound Spaces upload is intentionally out of scope.

import type { Snapshot } from "@generated/types";
import type {
  SyncedSpace,
  SyncedSpaceFolderItem,
  SyncedSpaceItem,
  SyncedSpaceTabItem,
  SyncedSpacesTree,
} from "./model";

/** Stable remote→local id bindings for Spaces materialization. Persisted in
 *  the outbound channel so relaunches converge on the same workspaces. */
export interface SpacesBindings {
  workspaceByRemote: Record<string, string>;
  folderByRemote: Record<string, string>;
  tabByRemote: Record<string, string>;
  bookmarkByRemote: Record<string, string>;
}

export function emptySpacesBindings(): SpacesBindings {
  return {
    workspaceByRemote: {},
    folderByRemote: {},
    tabByRemote: {},
    bookmarkByRemote: {},
  };
}

export function parseSpacesBindings(value: unknown): SpacesBindings {
  const empty = emptySpacesBindings();
  if (typeof value !== "object" || value === null) return empty;
  const raw = value as Partial<SpacesBindings>;
  return {
    workspaceByRemote: stringMap(raw.workspaceByRemote),
    folderByRemote: stringMap(raw.folderByRemote),
    tabByRemote: stringMap(raw.tabByRemote),
    bookmarkByRemote: stringMap(raw.bookmarkByRemote),
  };
}

function stringMap(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string" && entry.length > 0) out[key] = entry;
  }
  return out;
}

/** Pick a workspace name that does not collide with existing ones (create
 *  and rename both require uniqueness in domain.rs). `allowName` is the
 *  current name of the workspace being renamed (it may keep that name). */
export function uniqueWorkspaceName(
  desired: string,
  taken: ReadonlySet<string>,
  allowName?: string
): string {
  const base = desired.trim() || "Space";
  if (!taken.has(base) || base === allowName) return base;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base} ${suffix}`;
    if (!taken.has(candidate) || candidate === allowName) return candidate;
  }
  return `${base} ${Date.now()}`;
}

export interface SpacesApplyHost {
  getSnapshot(): Snapshot | null;
  createWorkspace(name: string): Promise<Snapshot>;
  renameWorkspace(workspaceId: string, name: string): Promise<Snapshot>;
  removeWorkspace(workspaceId: string): Promise<Snapshot>;
  moveWorkspace(workspaceId: string, index: number): Promise<Snapshot>;
  activateWorkspace(workspaceId: string): Promise<Snapshot>;
  createTab(url: string, workspaceId: string): Promise<Snapshot>;
  closeTab(tabId: string): Promise<Snapshot>;
  renameTab(tabId: string, title: string): Promise<Snapshot>;
  setFavorite(tabId: string, favorite: boolean): Promise<Snapshot>;
  setPinned(tabId: string, pinned: boolean): Promise<Snapshot>;
  bookmarkFolderCreate(title: string, parentFolderId?: string): Promise<Snapshot>;
  bookmarkFolderRename(folderId: string, title: string): Promise<Snapshot>;
  bookmarkFolderSetParent(
    folderId: string,
    parentFolderId: string
  ): Promise<Snapshot>;
  bookmarkFolderRemove(folderId: string): Promise<Snapshot>;
  bookmarkCreate(title: string, url: string, folderId: string): Promise<Snapshot>;
  bookmarkUpdate(bookmarkId: string, title: string, url: string): Promise<Snapshot>;
  bookmarkRemove(bookmarkId: string): Promise<Snapshot>;
  /** Mark a local id so bookmark change-detection ignores the echo. */
  skipLocalId(localId: string): void;
}

const SEED_URLS = new Set(["about:blank", "about:home", ""]);

/**
 * Apply a SyncedSpacesTree into the live Snapshot. Zen wins for mapped
 * entities; unmapped local-only workspaces are left alone. Nested Zen
 * folders keep parentFolderId. Splits flatten to their member tabs.
 */
export async function applySyncedSpacesTree(
  tree: SyncedSpacesTree,
  host: SpacesApplyHost,
  bindingsIn: SpacesBindings
): Promise<SpacesBindings> {
  const bindings: SpacesBindings = {
    workspaceByRemote: { ...bindingsIn.workspaceByRemote },
    folderByRemote: { ...bindingsIn.folderByRemote },
    tabByRemote: { ...bindingsIn.tabByRemote },
    bookmarkByRemote: { ...bindingsIn.bookmarkByRemote },
  };

  const initial = host.getSnapshot();
  if (!initial) return bindings;
  const restoreWorkspaceId = initial.activeWorkspaceId;
  const restoreTabId = initial.activeTabId ?? null;

  // -- workspaces -----------------------------------------------------------
  const remoteSpaceIds = new Set(tree.spaces.map((space) => space.uuid));
  for (const space of tree.spaces) {
    await ensureWorkspace(space, host, bindings);
  }
  // Drop mapped workspaces Zen deleted (never remove the last local space).
  for (const [remoteId, localId] of Object.entries({
    ...bindings.workspaceByRemote,
  })) {
    if (remoteSpaceIds.has(remoteId)) continue;
    const snap = host.getSnapshot();
    if (!snap || snap.workspaces.length <= 1) continue;
    if (!snap.workspaces.some((workspace) => workspace.id === localId)) {
      delete bindings.workspaceByRemote[remoteId];
      continue;
    }
    await host.removeWorkspace(localId);
    delete bindings.workspaceByRemote[remoteId];
    // Folders/tabs bound under this space will be cleaned below / as orphans.
  }

  // Drop "Name 2" leftovers from earlier collision suffixes.
  await cleanupNumberedWorkspaceDuplicates(tree.spaces, host, bindings);

  // Order local workspaces to match layout (local-only spaces keep their
  // relative positions after the synced block).
  await reorderSyncedWorkspaces(tree.spaces, host, bindings);

  // -- essentials (global favorites) ----------------------------------------
  const essentialIds = new Set(tree.essentials.map((tab) => tab.id));
  for (const tab of tree.essentials) {
    await ensureFavoriteTab(tab, host, bindings);
  }
  for (const [remoteId, localId] of Object.entries({ ...bindings.tabByRemote })) {
    if (essentialIds.has(remoteId)) continue;
    // tabByRemote also holds per-space pinned tabs; only clear favorites
    // that were essentials and vanished — pinned cleanup is per-space.
    const snap = host.getSnapshot();
    const local = snap?.tabs.find((tab) => tab.id === localId);
    if (!local?.favorite) continue;
    // Still referenced as a pinned tab under some space? keep.
    if (remoteIdInSpaceTree(tree, remoteId)) continue;
    await removeFavoriteTab(localId, host);
    delete bindings.tabByRemote[remoteId];
  }
  // Favorites navigate away from the essential home URL; without site-level
  // matching each sync spawned another YouTube tile. Drop those leftovers
  // while keeping unrelated local favorites.
  await dedupeEssentialFavorites(tree.essentials, host, bindings);

  // -- per-space folders + pinned tabs --------------------------------------
  for (const space of tree.spaces) {
    const workspaceId = bindings.workspaceByRemote[space.uuid];
    if (!workspaceId) continue;
    await host.activateWorkspace(workspaceId);
    await applySpaceContents(space, workspaceId, host, bindings);
    await closeSeedTabs(workspaceId, host);
  }

  // Restore the user's space (and tab when still present).
  const after = host.getSnapshot();
  if (
    after &&
    after.workspaces.some((workspace) => workspace.id === restoreWorkspaceId)
  ) {
    await host.activateWorkspace(restoreWorkspaceId);
    if (
      restoreTabId &&
      after.tabs.some((tab) => tab.id === restoreTabId && !tab.suspended)
    ) {
      // activateWorkspace already picks lastActive; explicit tab restore is
      // best-effort via creating no further navigation here.
    }
  }

  return bindings;
}

function remoteIdInSpaceTree(tree: SyncedSpacesTree, remoteId: string): boolean {
  const walk = (items: SyncedSpaceItem[]): boolean => {
    for (const item of items) {
      if (item.kind === "tab" && item.id === remoteId) return true;
      if (item.kind === "split" && item.tabs.some((tab) => tab.id === remoteId))
        return true;
      if (item.kind === "folder" && walk(item.children)) return true;
    }
    return false;
  };
  return tree.spaces.some((space) => walk(space.children));
}

/** True when `name` looks like a collision suffix of `base` ("Work 2"). */
export function isNumberedNameVariant(name: string, base: string): boolean {
  if (!base || name === base) return false;
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped} \\d+$`).test(name);
}

async function ensureWorkspace(
  space: SyncedSpace,
  host: SpacesApplyHost,
  bindings: SpacesBindings
): Promise<void> {
  const snap = host.getSnapshot();
  if (!snap) return;
  const desired = (space.name || "Space").trim() || "Space";
  const existingId = bindings.workspaceByRemote[space.uuid];
  const bound = existingId
    ? snap.workspaces.find((workspace) => workspace.id === existingId)
    : undefined;
  // Prefer an exact-name workspace so re-sync after a lost binding does not
  // spawn "Name 2" while the original "Name" is still around.
  const byName = snap.workspaces.find((workspace) => workspace.name === desired);
  if (byName) {
    bindings.workspaceByRemote[space.uuid] = byName.id;
    if (
      bound &&
      bound.id !== byName.id &&
      isNumberedNameVariant(bound.name, desired) &&
      snap.workspaces.length > 1
    ) {
      await discardWorkspace(bound.id, host, bindings);
    }
    return;
  }
  if (bound) {
    const taken = new Set(snap.workspaces.map((workspace) => workspace.name));
    const name = uniqueWorkspaceName(desired, taken, bound.name);
    if (bound.name !== name) await host.renameWorkspace(bound.id, name);
    bindings.workspaceByRemote[space.uuid] = bound.id;
    return;
  }
  const taken = new Set(snap.workspaces.map((workspace) => workspace.name));
  const name = uniqueWorkspaceName(desired, taken);
  const before = new Set(snap.workspaces.map((workspace) => workspace.id));
  const after = await host.createWorkspace(name);
  const created = after.workspaces.find((workspace) => !before.has(workspace.id));
  if (created) bindings.workspaceByRemote[space.uuid] = created.id;
}

/**
 * removeWorkspace reassigns tabs/folders/bookmarks to a neighbor. Numbered
 * collision duplicates ("base 2") are full copies — purging first prevents
 * dumping a second tree into the canonical space.
 */
async function discardWorkspace(
  workspaceId: string,
  host: SpacesApplyHost,
  bindings: SpacesBindings
): Promise<void> {
  const initial = host.getSnapshot();
  if (!initial || initial.workspaces.length <= 1) return;
  if (!initial.workspaces.some((workspace) => workspace.id === workspaceId))
    return;

  await host.activateWorkspace(workspaceId);

  let snap = host.getSnapshot();
  for (const bookmark of [...(snap?.bookmarks ?? [])]) {
    if (bookmark.workspaceId !== workspaceId) continue;
    host.skipLocalId(bookmark.id);
    await host.bookmarkRemove(bookmark.id);
    for (const [remoteId, localId] of Object.entries(bindings.bookmarkByRemote)) {
      if (localId === bookmark.id) delete bindings.bookmarkByRemote[remoteId];
    }
  }

  snap = host.getSnapshot();
  for (const folder of [...(snap?.bookmarkFolders ?? [])]) {
    if (folder.workspaceId !== workspaceId) continue;
    host.skipLocalId(folder.id);
    await host.bookmarkFolderRemove(folder.id);
    for (const [remoteId, localId] of Object.entries(bindings.folderByRemote)) {
      if (localId === folder.id) delete bindings.folderByRemote[remoteId];
    }
  }

  snap = host.getSnapshot();
  for (const tab of [...(snap?.tabs ?? [])]) {
    if (tab.workspaceId !== workspaceId || tab.favorite) continue;
    await removeSpaceTab(tab.id, host);
    for (const [remoteId, localId] of Object.entries(bindings.tabByRemote)) {
      if (localId === tab.id) delete bindings.tabByRemote[remoteId];
    }
  }

  const after = host.getSnapshot();
  if (!after || after.workspaces.length <= 1) return;
  if (!after.workspaces.some((workspace) => workspace.id === workspaceId))
    return;
  await host.removeWorkspace(workspaceId);
}

/** Drop leftover "Name 2" workspaces once the canonical synced name is bound. */
async function cleanupNumberedWorkspaceDuplicates(
  spaces: SyncedSpace[],
  host: SpacesApplyHost,
  bindings: SpacesBindings
): Promise<void> {
  for (const space of spaces) {
    const desired = (space.name || "Space").trim() || "Space";
    const canonicalId = bindings.workspaceByRemote[space.uuid];
    if (!canonicalId) continue;
    const snap = host.getSnapshot();
    if (!snap || snap.workspaces.length <= 1) continue;
    for (const workspace of [...snap.workspaces]) {
      if (workspace.id === canonicalId) continue;
      if (!isNumberedNameVariant(workspace.name, desired)) continue;
      if ((host.getSnapshot()?.workspaces.length ?? 0) <= 1) break;
      await discardWorkspace(workspace.id, host, bindings);
    }
  }
}

async function reorderSyncedWorkspaces(
  spaces: SyncedSpace[],
  host: SpacesApplyHost,
  bindings: SpacesBindings
): Promise<void> {
  for (let index = 0; index < spaces.length; index += 1) {
    const localId = bindings.workspaceByRemote[spaces[index]!.uuid];
    if (!localId) continue;
    const snap = host.getSnapshot();
    if (!snap) return;
    const current = snap.workspaces.findIndex(
      (workspace) => workspace.id === localId
    );
    if (current === -1 || current === index) continue;
    await host.moveWorkspace(localId, index);
  }
}

async function ensureFavoriteTab(
  tab: SyncedSpaceTabItem,
  host: SpacesApplyHost,
  bindings: SpacesBindings
): Promise<void> {
  const snap = host.getSnapshot();
  if (!snap) return;
  const mapped = bindings.tabByRemote[tab.id];
  // Multiple Zen essential records often share one site (YouTube × N).
  // Always reuse the first matching favorite tile — never spawn another.
  const existing =
    (mapped
      ? snap.tabs.find((item) => item.id === mapped)
      : undefined) ??
    snap.tabs.find(
      (item) => item.favorite && sameFavoriteSite(item.url, tab.url)
    );
  if (existing) {
    bindings.tabByRemote[tab.id] = existing.id;
    if (!existing.favorite) await host.setFavorite(existing.id, true);
    if (tab.title && existing.title !== tab.title && !existing.customTitle)
      await host.renameTab(existing.id, tab.title);
    return;
  }
  const workspaceId = snap.activeWorkspaceId;
  const before = new Set(snap.tabs.map((item) => item.id));
  const after = await host.createTab(tab.url, workspaceId);
  const created = after.tabs.find((item) => !before.has(item.id));
  if (!created) return;
  bindings.tabByRemote[tab.id] = created.id;
  await host.setFavorite(created.id, true);
  if (tab.title) await host.renameTab(created.id, tab.title);
}

function favoriteHost(url: string): string | null {
  try {
    return new URL(url.trim()).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

/** One favorite tile per essential site; close the rest. */
async function dedupeEssentialFavorites(
  essentials: SyncedSpaceTabItem[],
  host: SpacesApplyHost,
  bindings: SpacesBindings
): Promise<void> {
  if (essentials.length === 0) return;
  const keepByHost = new Map<string, string>();
  for (const essential of essentials) {
    const localId = bindings.tabByRemote[essential.id];
    if (!localId) continue;
    const hostKey = favoriteHost(essential.url) ?? essential.id;
    const kept = keepByHost.get(hostKey);
    if (kept) {
      bindings.tabByRemote[essential.id] = kept;
      continue;
    }
    keepByHost.set(hostKey, localId);
  }
  const keepIds = new Set(keepByHost.values());
  const snap = host.getSnapshot();
  if (!snap) return;
  for (const tab of [...snap.tabs]) {
    if (!tab.favorite || keepIds.has(tab.id)) continue;
    const matchesEssential = essentials.some((essential) =>
      sameFavoriteSite(tab.url, essential.url)
    );
    if (!matchesEssential) continue;
    await removeFavoriteTab(tab.id, host);
    for (const [remoteId, localId] of Object.entries(bindings.tabByRemote)) {
      if (localId === tab.id) delete bindings.tabByRemote[remoteId];
    }
  }
}

/** closeTab only suspends favorites — demote first so the tile actually goes. */
async function removeFavoriteTab(
  tabId: string,
  host: SpacesApplyHost
): Promise<void> {
  await host.setFavorite(tabId, false);
  await host.closeTab(tabId);
}

async function applySpaceContents(
  space: SyncedSpace,
  workspaceId: string,
  host: SpacesApplyHost,
  bindings: SpacesBindings
): Promise<void> {
  const flat = flattenSpaceItems(space.children);
  const remoteFolderIds = new Set(
    flat.folders.map((entry) => entry.folder.id)
  );
  const remoteTabIds = new Set(flat.tabs.map((tab) => tab.id));
  const remoteBookmarkIds = new Set(
    flat.folderTabs.map((entry) => entry.tab.id)
  );

  // Folders first (parents before children — flattenSpaceItems is pre-order).
  for (const entry of flat.folders) {
    await ensureFolder(entry.folder, entry.parentRemoteId, host, bindings);
  }

  // Bookmarks inside folders.
  for (const entry of flat.folderTabs) {
    await ensureFolderBookmark(entry.folderId, entry.tab, host, bindings);
  }

  // Receive-only: Zen owns the folder tree in a synced space. Drop local
  // leftovers (including copies merged in from purged "Name 2" spaces).
  const keepFolderIds = new Set<string>();
  for (const remoteId of remoteFolderIds) {
    const localId = bindings.folderByRemote[remoteId];
    if (localId) keepFolderIds.add(localId);
  }
  const keepBookmarkIds = new Set<string>();
  for (const remoteId of remoteBookmarkIds) {
    const localId = bindings.bookmarkByRemote[remoteId];
    if (localId) keepBookmarkIds.add(localId);
  }
  {
    const snap = host.getSnapshot();
    for (const bookmark of [...(snap?.bookmarks ?? [])]) {
      if (bookmark.workspaceId !== workspaceId) continue;
      if (keepBookmarkIds.has(bookmark.id)) continue;
      host.skipLocalId(bookmark.id);
      await host.bookmarkRemove(bookmark.id);
      for (const [remoteId, localId] of Object.entries(bindings.bookmarkByRemote)) {
        if (localId === bookmark.id) delete bindings.bookmarkByRemote[remoteId];
      }
    }
  }
  {
    const snap = host.getSnapshot();
    for (const folder of [...(snap?.bookmarkFolders ?? [])]) {
      if (folder.workspaceId !== workspaceId) continue;
      if (keepFolderIds.has(folder.id)) continue;
      host.skipLocalId(folder.id);
      try {
        await host.bookmarkFolderRemove(folder.id);
      } catch {
        continue;
      }
      for (const [remoteId, localId] of Object.entries(bindings.folderByRemote)) {
        if (localId === folder.id) delete bindings.folderByRemote[remoteId];
      }
    }
  }
  // Same-title leftovers (e.g. merged "Name 2" copies) — keep the bound
  // folder, else the one that still has bookmarks.
  {
    const snap = host.getSnapshot();
    const folders = (snap?.bookmarkFolders ?? []).filter(
      (folder) => folder.workspaceId === workspaceId
    );
    const bookmarks = snap?.bookmarks ?? [];
    const byTitle = new Map<string, typeof folders>();
    for (const folder of folders) {
      const key = folder.title.trim().toLowerCase();
      const list = byTitle.get(key);
      if (list) list.push(folder);
      else byTitle.set(key, [folder]);
    }
    const bookmarkCount = (folderId: string) =>
      bookmarks.filter((bookmark) => bookmark.folderId === folderId).length;
    for (const group of byTitle.values()) {
      if (group.length <= 1) continue;
      // Prefer the kept binding that still has pages — an empty bound
      // leftover must not win over the populated copy.
      const preferred = [...group].sort((a, b) => {
        const keepDelta =
          (keepFolderIds.has(b.id) ? 1 : 0) - (keepFolderIds.has(a.id) ? 1 : 0);
        if (keepDelta !== 0) return keepDelta;
        return bookmarkCount(b.id) - bookmarkCount(a.id);
      })[0];
      if (!preferred) continue;
      for (const folder of group) {
        if (folder.id === preferred.id) continue;
        host.skipLocalId(folder.id);
        try {
          await host.bookmarkFolderRemove(folder.id);
        } catch {
          continue;
        }
        for (const [remoteId, localId] of Object.entries(bindings.folderByRemote)) {
          if (localId === folder.id) {
            bindings.folderByRemote[remoteId] = preferred.id;
          }
        }
      }
    }
  }

  // Top-level space tabs (not in a folder): Zen pinned → yeoyu pinned,
  // unpinned → ordinary open tabs (normal-tabs sync).
  for (const tab of flat.tabs) {
    await ensureSpaceTab(tab, workspaceId, host, bindings);
  }
  // One local tab per browse target — Zen often lists the same site under
  // several remote ids, and closeTab only suspends pins so leftovers piled up.
  const keepTabByTarget = new Map<string, string>();
  for (const remote of flat.tabs) {
    const localId = bindings.tabByRemote[remote.id];
    if (!localId) continue;
    const key = browseKey(remote.url);
    const kept = keepTabByTarget.get(key);
    if (kept) {
      bindings.tabByRemote[remote.id] = kept;
      continue;
    }
    keepTabByTarget.set(key, localId);
  }
  const keepTabIds = new Set(keepTabByTarget.values());
  {
    const snap = host.getSnapshot();
    for (const tab of [...(snap?.tabs ?? [])]) {
      if (tab.workspaceId !== workspaceId || tab.favorite) continue;
      if (keepTabIds.has(tab.id)) continue;
      const matchesRemote = flat.tabs.some(
        (remote) =>
          sameBrowseTarget(tab.url, remote.url) ||
          (!!tab.homeUrl && sameBrowseTarget(tab.homeUrl, remote.url))
      );
      // Synced spaces: Zen owns the pin strip. Unbound pins are leftovers
      // from "Name 2" merges / suspended closeTab echoes — drop them.
      // Ordinary local tabs that do not match a remote URL are kept.
      if (!matchesRemote && !tab.pinned) continue;
      await removeSpaceTab(tab.id, host);
      for (const [remoteId, localId] of Object.entries(bindings.tabByRemote)) {
        if (localId === tab.id) delete bindings.tabByRemote[remoteId];
      }
    }
  }
  for (const [remoteId, localId] of Object.entries({ ...bindings.tabByRemote })) {
    if (remoteTabIds.has(remoteId) || remoteBookmarkIds.has(remoteId)) continue;
    const snap = host.getSnapshot();
    const local = snap?.tabs.find((item) => item.id === localId);
    if (!local || local.favorite) continue;
    if (local.workspaceId !== workspaceId) continue;
    await removeSpaceTab(localId, host);
    delete bindings.tabByRemote[remoteId];
  }
}

function flattenSpaceItems(items: SyncedSpaceItem[]): {
  folders: Array<{ folder: SyncedSpaceFolderItem; parentRemoteId: string }>;
  tabs: SyncedSpaceTabItem[];
  folderTabs: Array<{ folderId: string; tab: SyncedSpaceTabItem }>;
} {
  const folders: Array<{
    folder: SyncedSpaceFolderItem;
    parentRemoteId: string;
  }> = [];
  const tabs: SyncedSpaceTabItem[] = [];
  const folderTabs: Array<{ folderId: string; tab: SyncedSpaceTabItem }> = [];

  const walkFolder = (
    folder: SyncedSpaceFolderItem,
    parentRemoteId: string
  ) => {
    folders.push({ folder, parentRemoteId });
    for (const child of folder.children) {
      if (child.kind === "tab")
        folderTabs.push({ folderId: folder.id, tab: child });
      else if (child.kind === "split") {
        for (const tab of child.tabs)
          folderTabs.push({ folderId: folder.id, tab });
      } else if (child.kind === "folder") {
        walkFolder(child, folder.id);
      }
    }
  };

  for (const item of items) {
    if (item.kind === "folder") walkFolder(item, "");
    else if (item.kind === "tab") tabs.push(item);
    else if (item.kind === "split") tabs.push(...item.tabs);
  }
  return { folders, tabs, folderTabs };
}

async function ensureFolder(
  folder: SyncedSpaceFolderItem,
  parentRemoteId: string,
  host: SpacesApplyHost,
  bindings: SpacesBindings
): Promise<void> {
  const snap = host.getSnapshot();
  if (!snap) return;
  const parentLocalId = parentRemoteId
    ? bindings.folderByRemote[parentRemoteId] ?? ""
    : "";
  const mapped = bindings.folderByRemote[folder.id];
  const boundLocals = new Set(Object.values(bindings.folderByRemote));
  const title = folder.name || "Folder";
  const existing = mapped
    ? snap.bookmarkFolders?.find((item) => item.id === mapped)
    : snap.bookmarkFolders?.find(
        (item) =>
          item.workspaceId === snap.activeWorkspaceId &&
          item.title === title &&
          !boundLocals.has(item.id)
      );
  if (existing) {
    bindings.folderByRemote[folder.id] = existing.id;
    host.skipLocalId(existing.id);
    if (existing.title !== title)
      await host.bookmarkFolderRename(existing.id, title);
    const currentParent = existing.parentFolderId ?? "";
    if (currentParent !== parentLocalId)
      await host.bookmarkFolderSetParent(existing.id, parentLocalId);
    return;
  }
  const before = new Set((snap.bookmarkFolders ?? []).map((item) => item.id));
  const after = await host.bookmarkFolderCreate(
    folder.name || "Folder",
    parentLocalId
  );
  const created = (after.bookmarkFolders ?? []).find((item) => !before.has(item.id));
  if (!created) return;
  host.skipLocalId(created.id);
  bindings.folderByRemote[folder.id] = created.id;
}

async function ensureFolderBookmark(
  remoteFolderId: string,
  tab: SyncedSpaceTabItem,
  host: SpacesApplyHost,
  bindings: SpacesBindings
): Promise<void> {
  const localFolderId = bindings.folderByRemote[remoteFolderId];
  if (!localFolderId) return;
  const snap = host.getSnapshot();
  if (!snap) return;
  const mapped = bindings.bookmarkByRemote[tab.id];
  const existing = mapped
    ? snap.bookmarks?.find((item) => item.id === mapped)
    : snap.bookmarks?.find(
        (item) =>
          item.folderId === localFolderId && sameUrl(item.url, tab.url)
      );
  if (existing) {
    bindings.bookmarkByRemote[tab.id] = existing.id;
    host.skipLocalId(existing.id);
    if (existing.title !== tab.title || existing.url !== tab.url)
      await host.bookmarkUpdate(existing.id, tab.title || tab.url, tab.url);
    return;
  }
  const before = new Set((snap.bookmarks ?? []).map((item) => item.id));
  const after = await host.bookmarkCreate(
    tab.title || tab.url,
    tab.url,
    localFolderId
  );
  const created = (after.bookmarks ?? []).find((item) => !before.has(item.id));
  if (!created) return;
  host.skipLocalId(created.id);
  bindings.bookmarkByRemote[tab.id] = created.id;
}

async function ensureSpaceTab(
  tab: SyncedSpaceTabItem,
  workspaceId: string,
  host: SpacesApplyHost,
  bindings: SpacesBindings
): Promise<void> {
  const wantPinned = tab.pinned && !tab.essential;
  const snap = host.getSnapshot();
  if (!snap) return;
  const mapped = bindings.tabByRemote[tab.id];
  const matches = (item: { url: string; homeUrl?: string; workspaceId?: string; favorite?: boolean }) =>
    item.workspaceId === workspaceId &&
    !item.favorite &&
    (sameBrowseTarget(item.url, tab.url) ||
      (!!item.homeUrl && sameBrowseTarget(item.homeUrl, tab.url)));
  // Reuse any matching tab (including already-bound) so N remote ids for one
  // Slack channel share a single local pin.
  const existing =
    (mapped ? snap.tabs.find((item) => item.id === mapped) : undefined) ??
    snap.tabs.find(matches);
  if (existing) {
    bindings.tabByRemote[tab.id] = existing.id;
    if (existing.workspaceId !== workspaceId) return;
    if (!!existing.pinned !== wantPinned)
      await host.setPinned(existing.id, wantPinned);
    if (tab.title && existing.title !== tab.title && !existing.customTitle)
      await host.renameTab(existing.id, tab.title);
    return;
  }
  const before = new Set(snap.tabs.map((item) => item.id));
  const after = await host.createTab(tab.url, workspaceId);
  const created = after.tabs.find((item) => !before.has(item.id));
  if (!created) return;
  bindings.tabByRemote[tab.id] = created.id;
  if (wantPinned) await host.setPinned(created.id, true);
  if (tab.title) await host.renameTab(created.id, tab.title);
}

/** closeTab only suspends pins — demote first so duplicates actually go away. */
async function removeSpaceTab(
  tabId: string,
  host: SpacesApplyHost
): Promise<void> {
  const snap = host.getSnapshot();
  const tab = snap?.tabs.find((item) => item.id === tabId);
  if (!tab || tab.favorite) return;
  if (tab.pinned) await host.setPinned(tabId, false);
  await host.closeTab(tabId);
}

async function closeSeedTabs(
  workspaceId: string,
  host: SpacesApplyHost
): Promise<void> {
  const snap = host.getSnapshot();
  if (!snap) return;
  const seeds = snap.tabs.filter(
    (tab) =>
      tab.workspaceId === workspaceId &&
      !tab.favorite &&
      !tab.pinned &&
      !tab.bookmarkId &&
      SEED_URLS.has(tab.url)
  );
  const others = snap.tabs.filter(
    (tab) =>
      tab.workspaceId === workspaceId &&
      !seeds.some((seed) => seed.id === tab.id)
  );
  if (others.length === 0) return;
  for (const seed of seeds) {
    await host.closeTab(seed.id);
  }
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    let path = parsed.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    if (path === "/") path = "";
    return `${parsed.protocol}//${host}${path}${parsed.search}`;
  } catch {
    return trimmed;
  }
}

function sameUrl(a: string, b: string): boolean {
  return normalizeUrl(a) === normalizeUrl(b);
}

/** Path identity without query/hash — login redirects share a pin. */
export function sameBrowseTarget(a: string, b: string): boolean {
  if (sameUrl(a, b)) return true;
  try {
    const left = new URL(a.trim());
    const right = new URL(b.trim());
    const lh = left.hostname.replace(/^www\./i, "").toLowerCase();
    const rh = right.hostname.replace(/^www\./i, "").toLowerCase();
    let lp = left.pathname;
    let rp = right.pathname;
    if (lp.length > 1 && lp.endsWith("/")) lp = lp.slice(0, -1);
    if (rp.length > 1 && rp.endsWith("/")) rp = rp.slice(0, -1);
    if (lp === "/") lp = "";
    if (rp === "/") rp = "";
    return lh.length > 0 && lh === rh && lp === rp;
  } catch {
    return false;
  }
}

function browseKey(url: string): string {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    let path = parsed.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    if (path === "/") path = "";
    return `${host}${path}`;
  } catch {
    return url.trim();
  }
}

/** Favorites drift to deep links after use; match essentials by site host. */
export function sameFavoriteSite(a: string, b: string): boolean {
  if (sameUrl(a, b)) return true;
  try {
    const left = new URL(a.trim()).hostname.replace(/^www\./i, "").toLowerCase();
    const right = new URL(b.trim())
      .hostname.replace(/^www\./i, "")
      .toLowerCase();
    return left.length > 0 && left === right;
  } catch {
    return false;
  }
}
