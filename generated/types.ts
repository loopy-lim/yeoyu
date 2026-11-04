// ── rustra generated ────────────────────────────────────────
// File:   types.ts
// Source: schema.json (single source of truth for this file)
// Regen:  rustra codegen --config rustra.json
// Stage:  rust-probe schema → ts renderer
// DO NOT EDIT — changes will be overwritten and fail codegen --check.
// ────────────────────────────────────────────────────────────

export type { EngineClient, RustraError } from '@rustra/types';
export { RustraCommandError } from '@rustra/types';

export type Workspace = {
  id: string;
  name: string;
  /** Space tint as #rrggbb. Empty means "follow the appearance hue" — the default space stays appearance-colored so existing snapshots keep their look; created spaces pick from the palette round-robin. */
  color?: string;
  /** The space's most recently used tab; activate_workspace reopens the space where the user left off (Arc's working-set behavior). Dangling values are rejected on restore like the other active pointers. */
  lastActiveTabId?: string | null;
};

export type Tab = {
  id: string;
  workspaceId: string;
  url: string;
  title: string;
  /** Favorites appear in every space without changing the selected space. Older snapshots restore without the field as non-favorites. */
  favorite?: boolean;
  /** Pinned tabs keep their own section under favorites, per space. */
  pinned?: boolean;
  /** Private tabs run engine-private sessions and never persist: the controller strips them from saved copies and restore drops them. */
  private?: boolean;
  /** The persistent sidebar item owning this tab, independent of its live URL. */
  bookmarkId?: string;
  /** Saved destination, independent of navigation in the live session. */
  homeUrl?: string;
  homeTitle?: string;
  /** The saved row remains while its browser session is closed. */
  suspended?: boolean;
  /** Last touch in epoch ms; drives the Today/Earlier split (12h archive). */
  updatedAt?: number | bigint;
};

export type Bookmark = {
  id: string;
  /** Empty only in legacy snapshots, assigned to a Space during restore. */
  workspaceId?: string;
  title: string;
  url: string;
  folderId?: string;
};

export type BookmarkFolder = {
  id: string;
  workspaceId?: string;
  title: string;
};

/**
 * A saved two-pane arrangement. Panes are stored as home URLs, never tab IDs — tabs churn across restarts and private tabs are stripped from snapshots. Restoring creates fresh tabs and re-applies the layout.
 */
export type SplitGroup = {
  id: string;
  workspaceId?: string;
  name: string;
  /** "horizontal" (side by side) or "vertical" (stacked). */
  orientation: string;
  /** Share of the first pane in thousandths, always 250..=750 so the value matches the runtime clamp in the address bar UI. */
  ratioMilli: number;
  firstTitle: string;
  firstUrl: string;
  secondTitle: string;
  secondUrl: string;
};

export type KeyBinding = {
  key: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  command: string;
};

export type BookmarkCreateInput = {
  title: string;
  url: string;
  folderId: string;
};

export type Snapshot = {
  version: number;
  revision: number;
  /** The native incoming-link queue acknowledges FIFO deliveries only after this snapshot is durable. Its head may replay across a bridge restart. */
  lastExternalRequestId?: string;
  workspaces: Workspace[];
  tabs: Tab[];
  bookmarks?: Bookmark[];
  bookmarkFolders?: BookmarkFolder[];
  splitGroups?: SplitGroup[];
  activeWorkspaceId: string;
  activeTabId?: string | null;
  keyBindings: KeyBinding[];
  /** Once migrated, explicitly customized shortcuts are never remapped. */
  keymapVersion?: number;
};

export type BookmarkFolderCreateInput = {
  title: string;
};

export type BookmarkFolderIdInput = {
  folderId: string;
};

export type BookmarkFolderRenameInput = {
  folderId: string;
  title: string;
};

export type BookmarkMoveInput = {
  bookmarkId: string;
  index: number;
};

export type BookmarkOpenInput = {
  bookmarkId: string;
  reuseTabId: string;
  /** Older clients omit the field; absent means an ordinary open. */
  private?: boolean;
};

export type BookmarkIdInput = {
  bookmarkId: string;
};

export type BookmarkSetFolderInput = {
  bookmarkId: string;
  folderId: string;
};

export type BookmarkUpdateInput = {
  bookmarkId: string;
  title: string;
  url: string;
};

export type BrowserSnapshotInput = Record<string, unknown>;

export type KeymapSetInput = {
  bindings: KeyBinding[];
};

export type SnapshotRestoreInput = {
  json: string;
};

export type SplitGroupIdInput = {
  splitGroupId: string;
};

export type SplitGroupSaveInput = {
  splitGroupId?: string | null;
  name: string;
  orientation: string;
  ratioMilli: number;
  firstTitle: string;
  firstUrl: string;
  secondTitle: string;
  secondUrl: string;
};

export type TabIdInput = {
  tabId: string;
};

export type TabCreateInput = {
  workspaceId: string;
  url: string;
  /** Older clients omit the field; absent means an ordinary tab. */
  private?: boolean;
};

export type TabMoveInput = {
  tabId: string;
  index: number;
};

export type TabNavigatedInput = {
  tabId: string;
  url: string;
  title: string;
};

export type TabOpenExternalInput = {
  requestId: string;
  url: string;
};

export type TabFavoriteInput = {
  tabId: string;
  favorite: boolean;
};

export type TabPinnedInput = {
  tabId: string;
  pinned: boolean;
};

export type TabWorkspaceInput = {
  tabId: string;
  workspaceId: string;
};

export type WorkArchiveExportInput = {
  presentation?: string | null;
};

/**
 * @deprecated Rust 내부 타입명(`String`)이 그대로 노출된 레거시 별칭입니다. 이 이름은 JS 내장 타입과 충돌하므로 특히 직접 import 하지 마세요.
 * 새 코드는 인라인 타입을 사용하세요 — 생성 명령 시그니처는 이미 정화됐고,
 * 이 별칭은 기존 코드 호환을 위해 유지됩니다.
 */
export type String = string;

export type WorkArchiveImportInput = {
  json: string;
  includeFavorites: boolean;
  restoreKeymap: boolean;
  expectedRevision: number;
};

export type WorkArchivePrepareInput = {
  json: string;
  includeFavorites: boolean;
  restoreKeymap: boolean;
};

export type WorkArchivePreviewInput = {
  json: string;
};

export type WorkArchivePreview = {
  spaces: number;
  tabs: number;
  bookmarks: number;
  folders: number;
  favorites: number;
  duplicateUrls: number;
  hasKeyBindings: boolean;
  presentation?: string | null;
};

export type WorkspaceIdInput = {
  workspaceId: string;
};

export type WorkspaceCreateInput = {
  name: string;
};
