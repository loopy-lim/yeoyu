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

export const ROOT_ORDER: readonly string[] = [
  ROOT_GUIDS.menu,
  ROOT_GUIDS.toolbar,
  ROOT_GUIDS.unfiled,
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

export type SyncErrorKind = "network" | "auth" | "server" | "protocol";

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
