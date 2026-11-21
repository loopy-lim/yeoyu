// Data model for the read-only Firefox Sync integration. The synced tree is
// deliberately kept outside the core BrowserState (G0 constraint: the core
// bookmark model stays untouched) and persisted through its own store.

export type SyncNodeType = "folder" | "bookmark" | "query" | "livemark" | "separator";

export interface SyncNode {
  guid: string;
  type: SyncNodeType;
  title?: string;
  url?: string;
  dateAdded?: string;
  children?: SyncNode[];
}

export interface SyncTree {
  /** Fixed root order: menu, toolbar, unfiled, mobile (+ unresolved if any). */
  roots: SyncNode[];
  fetchedAt: number;
  bookmarksModified: number | null;
}

/** Places root GUIDs (12 chars, fixed padding). */
export const ROOT_GUIDS = {
  menu: "menu________",
  toolbar: "toolbar_____",
  unfiled: "unfiled_____",
  mobile: "mobile______",
} as const;

/** Sync 1.5 wire short root IDs (canonical on Firefox/Zen Sync servers). */
export const WIRE_ROOT_GUIDS = {
  menu: "menu",
  toolbar: "toolbar",
  unfiled: "unfiled",
  mobile: "mobile",
} as const;

/** Meta-root wrapper GUIDs that contain the four user roots and must not land in unresolved. */
export const META_ROOT_GUIDS: ReadonlySet<string> = new Set([
  "places",
  "root________",
]);

export const ROOT_ORDER: readonly string[] = [
  WIRE_ROOT_GUIDS.menu,
  ROOT_GUIDS.menu,
  WIRE_ROOT_GUIDS.toolbar,
  ROOT_GUIDS.toolbar,
  WIRE_ROOT_GUIDS.unfiled,
  ROOT_GUIDS.unfiled,
  WIRE_ROOT_GUIDS.mobile,
  ROOT_GUIDS.mobile,
];

/** Pseudo-folder that collects records whose parent cannot be resolved. */
export const UNRESOLVED_PARENT_GUID = "yeoyu-unresolved";

export interface SyncCredentials {
  refreshToken: string;
  /** base64url, 64 bytes: enc key (0..32) + mac key (32..64). */
  kSync: string;
  kid: string;
}

// ---------------------------------------------------------------------------
// Synced tabs (receive-only): one tabs-collection BSO per device, sealed
// with the default bundle. `urlHistory` is the tab's session history with
// the CURRENT url last (desktop/a-s convention); `lastUsed` is epoch ms.

export interface SyncedTab {
  title: string;
  /** Current url (last urlHistory entry). */
  url: string;
  /** Back-history, oldest first, excluding the current url (capped). */
  urlHistory: string[];
  lastUsedMs: number | null;
  /** Favicon url when the writer sent one. */
  icon?: string;
}

export interface SyncedDeviceTabs {
  /** tabs-collection BSO id — the writer's client/device id. */
  clientId: string;
  clientName: string;
  tabs: SyncedTab[];
  /** Collection modified of this device's record (seconds). */
  modifiedSeconds: number;
}

// ---------------------------------------------------------------------------
// Synced Spaces (receive→local): Zen's "spaces" Sync 1.5 collection. Records
// are CryptoWrapper cleartexts `{ id, kind, data }` (or tombstones). After
// fetch, spacesApply materializes them into Snapshot workspaces / favorites /
// pinned tabs / bookmark folders (outbound Spaces upload is separate).

export type SyncedSpaceItem =
  | SyncedSpaceTabItem
  | SyncedSpaceFolderItem
  | SyncedSpaceSplitItem;

export interface SyncedSpaceTabItem {
  kind: "tab";
  id: string;
  title: string;
  url: string;
  icon?: string;
  pinned: boolean;
  essential: boolean;
}

export interface SyncedSpaceFolderItem {
  kind: "folder";
  id: string;
  name: string;
  icon?: string;
  /** Zen parent folder id when nested; null/absent = space root. yeoyu's
   *  BookmarkFolder model is flat today, so apply currently promotes nested
   *  folders to siblings until parentFolderId lands in Snapshot. */
  parentFolderId?: string | null;
  children: SyncedSpaceItem[];
}

export interface SyncedSpaceSplitItem {
  kind: "split";
  id: string;
  tabs: SyncedSpaceTabItem[];
}

export interface SyncedSpace {
  uuid: string;
  name: string;
  icon?: string;
  children: SyncedSpaceItem[];
}

export interface SyncedSpacesTree {
  /** Space order from the layout record when present; otherwise discovery order. */
  spaces: SyncedSpace[];
  /** Cross-space essentials (Zen essentials strip), openable like tabs. */
  essentials: SyncedSpaceTabItem[];
}

export interface TokenserverInfo {
  id: string;
  key: string;
  apiEndpoint: string;
  uid: number;
  hashedFxaUid: string;
  /** Server clock from X-Timestamp, the time source for Hawk requests. */
  serverTimestampSeconds: number;
  fetchedAtMs: number;
  /** Token lifetime in seconds; refresh before this elapses. */
  durationSeconds: number;
}

export type SyncErrorKind = "network" | "auth" | "server" | "protocol" | "quota";

export interface SyncHttpError extends Error {
  kind: SyncErrorKind;
  status?: number;
}

// ---------------------------------------------------------------------------
// Outbound (send) support — local model mirrors. Structurally compatible with
// the generated native types (@generated/types Bookmark / BookmarkFolder) so
// App.tsx can pass controller snapshots straight through; kept as plain
// interfaces here so the sync module has no generated-code dependency.

/** Local bookmark (native domain.rs Bookmark). */
export interface LocalBookmark {
  id: string;
  title: string;
  url: string;
  /** "" (absent in legacy snapshots) = root level; otherwise a folder id. */
  folderId?: string;
}

/** Local bookmark folder (native domain.rs BookmarkFolder) — flat, folders
 *  never nest in the local model (all sit at root level). */
export interface LocalBookmarkFolder {
  id: string;
  title: string;
}

export interface LocalBookmarkSnapshot {
  bookmarks: LocalBookmark[];
  bookmarkFolders: LocalBookmarkFolder[];
}
