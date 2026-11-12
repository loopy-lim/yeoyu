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
