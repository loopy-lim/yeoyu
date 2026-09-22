// ── rustra generated ────────────────────────────────────────
// File:   commands.ts
// Source: schema.json (single source of truth for this file)
// Regen:  rustra codegen --config rustra.json
// Stage:  rust-probe schema → ts renderer
// DO NOT EDIT — changes will be overwritten and fail codegen --check.
// ────────────────────────────────────────────────────────────

import type { BookmarkCreateInput, BookmarkFolderCreateInput, BookmarkFolderIdInput, BookmarkFolderRenameInput, BookmarkIdInput, BookmarkMoveInput, BookmarkOpenInput, BookmarkSetFolderInput, BookmarkUpdateInput, BrowserSnapshotInput, KeymapSetInput, Snapshot, SnapshotRestoreInput, String, TabCreateInput, TabFavoriteInput, TabIdInput, TabMoveInput, TabNavigatedInput, TabOpenExternalInput, TabPinnedInput, TabWorkspaceInput, WorkArchiveExportInput, WorkArchiveImportInput, WorkArchivePrepareInput, WorkArchivePreview, WorkArchivePreviewInput, WorkspaceCreateInput, WorkspaceIdInput } from './types.js';
import { createGeneratedFields2, invokeGenerated, invokeGeneratedFields1, invokeGeneratedFields3 } from '@rustra/types';
import type { InvokeOptions } from '@rustra/types';

export function bookmarkCreate(input: BookmarkCreateInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGeneratedFields3<Snapshot>(20, 'bookmarkCreate', input, input["title"], input["url"], input["folderId"], options);
}
bookmarkCreate.commandId = 'bookmarkCreate';

export function bookmarkFolderCreate(input: BookmarkFolderCreateInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGeneratedFields1<Snapshot>(24, 'bookmarkFolderCreate', input, input["title"], options);
}
bookmarkFolderCreate.commandId = 'bookmarkFolderCreate';

export function bookmarkFolderRemove(input: BookmarkFolderIdInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGeneratedFields1<Snapshot>(26, 'bookmarkFolderRemove', input, input["folderId"], options);
}
bookmarkFolderRemove.commandId = 'bookmarkFolderRemove';

export const bookmarkFolderRename = createGeneratedFields2<BookmarkFolderRenameInput, Snapshot>(25, 'bookmarkFolderRename', "folderId", "title", 'bookmarkFolderRename');

export const bookmarkMove = createGeneratedFields2<BookmarkMoveInput, Snapshot>(23, 'bookmarkMove', "bookmarkId", "index", 'bookmarkMove');

export function bookmarkOpen(input: BookmarkOpenInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGeneratedFields3<Snapshot>(29, 'bookmarkOpen', input, input["bookmarkId"], input["reuseTabId"], input["private"], options);
}
bookmarkOpen.commandId = 'bookmarkOpen';

export function bookmarkRemove(input: BookmarkIdInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGeneratedFields1<Snapshot>(22, 'bookmarkRemove', input, input["bookmarkId"], options);
}
bookmarkRemove.commandId = 'bookmarkRemove';

export const bookmarkSetFolder = createGeneratedFields2<BookmarkSetFolderInput, Snapshot>(27, 'bookmarkSetFolder', "bookmarkId", "folderId", 'bookmarkSetFolder');

export function bookmarkUpdate(input: BookmarkUpdateInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGeneratedFields3<Snapshot>(21, 'bookmarkUpdate', input, input["bookmarkId"], input["title"], input["url"], options);
}
bookmarkUpdate.commandId = 'bookmarkUpdate';

export function browserSnapshot(input: BrowserSnapshotInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGenerated<Snapshot>(1, 'browserSnapshot', input, options);
}
browserSnapshot.commandId = 'browserSnapshot';

export function keymapDefaults(input: BrowserSnapshotInput, options?: InvokeOptions): Promise<KeymapSetInput> {
  return invokeGenerated<KeymapSetInput>(19, 'keymapDefaults', input, options);
}
keymapDefaults.commandId = 'keymapDefaults';

export function keymapSet(input: KeymapSetInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGenerated<Snapshot>(18, 'keymapSet', input, options);
}
keymapSet.commandId = 'keymapSet';

export function snapshotRestore(input: SnapshotRestoreInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGeneratedFields1<Snapshot>(17, 'snapshotRestore', input, input["json"], options);
}
snapshotRestore.commandId = 'snapshotRestore';

export function tabActivate(input: TabIdInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGeneratedFields1<Snapshot>(9, 'tabActivate', input, input["tabId"], options);
}
tabActivate.commandId = 'tabActivate';

export function tabClose(input: TabIdInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGeneratedFields1<Snapshot>(10, 'tabClose', input, input["tabId"], options);
}
tabClose.commandId = 'tabClose';

export function tabCreate(input: TabCreateInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGeneratedFields3<Snapshot>(7, 'tabCreate', input, input["workspaceId"], input["url"], input["private"], options);
}
tabCreate.commandId = 'tabCreate';

export const tabMove = createGeneratedFields2<TabMoveInput, Snapshot>(14, 'tabMove', "tabId", "index", 'tabMove');

export function tabNavigated(input: TabNavigatedInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGeneratedFields3<Snapshot>(11, 'tabNavigated', input, input["tabId"], input["url"], input["title"], options);
}
tabNavigated.commandId = 'tabNavigated';

export const tabOpenExternal = createGeneratedFields2<TabOpenExternalInput, Snapshot>(8, 'tabOpenExternal', "requestId", "url", 'tabOpenExternal');

export function tabReset(input: TabIdInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGeneratedFields1<Snapshot>(28, 'tabReset', input, input["tabId"], options);
}
tabReset.commandId = 'tabReset';

export const tabSetFavorite = createGeneratedFields2<TabFavoriteInput, Snapshot>(12, 'tabSetFavorite', "tabId", "favorite", 'tabSetFavorite');

export const tabSetPinned = createGeneratedFields2<TabPinnedInput, Snapshot>(13, 'tabSetPinned', "tabId", "pinned", 'tabSetPinned');

export const tabSetWorkspace = createGeneratedFields2<TabWorkspaceInput, Snapshot>(15, 'tabSetWorkspace', "tabId", "workspaceId", 'tabSetWorkspace');

export function workArchiveExport(input: WorkArchiveExportInput, options?: InvokeOptions): Promise<String> {
  return invokeGenerated<String>(2, 'workArchiveExport', input, options);
}
workArchiveExport.commandId = 'workArchiveExport';

export function workArchiveImport(input: WorkArchiveImportInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGenerated<Snapshot>(5, 'workArchiveImport', input, options);
}
workArchiveImport.commandId = 'workArchiveImport';

export function workArchivePrepare(input: WorkArchivePrepareInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGeneratedFields3<Snapshot>(4, 'workArchivePrepare', input, input["json"], input["includeFavorites"], input["restoreKeymap"], options);
}
workArchivePrepare.commandId = 'workArchivePrepare';

export function workArchivePreview(input: WorkArchivePreviewInput, options?: InvokeOptions): Promise<WorkArchivePreview> {
  return invokeGeneratedFields1<WorkArchivePreview>(3, 'workArchivePreview', input, input["json"], options);
}
workArchivePreview.commandId = 'workArchivePreview';

export function workspaceActivate(input: WorkspaceIdInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGeneratedFields1<Snapshot>(16, 'workspaceActivate', input, input["workspaceId"], options);
}
workspaceActivate.commandId = 'workspaceActivate';

export function workspaceCreate(input: WorkspaceCreateInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGeneratedFields1<Snapshot>(6, 'workspaceCreate', input, input["name"], options);
}
workspaceCreate.commandId = 'workspaceCreate';
