// ── rustra generated ────────────────────────────────────────
// File:   commands.ts
// Source: schema.json (single source of truth for this file)
// Regen:  rustra codegen --config rustra.json
// Stage:  rust-probe schema → ts renderer
// DO NOT EDIT — changes will be overwritten and fail codegen --check.
// ────────────────────────────────────────────────────────────

import type { BookmarkCreateInput, BookmarkFolderCreateInput, BookmarkFolderIdInput, BookmarkFolderRenameInput, BookmarkIdInput, BookmarkMoveInput, BookmarkOpenInput, BookmarkSetFolderInput, BookmarkUpdateInput, BrowserSnapshotInput, KeymapSetInput, Snapshot, SnapshotRestoreInput, SplitGroupIdInput, SplitGroupSaveInput, TabCreateInput, TabFavoriteInput, TabIdInput, TabMoveInput, TabNavigatedInput, TabOpenExternalInput, TabPinnedInput, TabRenameInput, TabWorkspaceInput, WorkArchiveExportInput, WorkArchiveImportInput, WorkArchivePrepareInput, WorkArchivePreview, WorkArchivePreviewInput, WorkspaceCreateInput, WorkspaceIdInput, WorkspaceMoveInput, WorkspaceRenameInput } from './types.js';
import { createGeneratedFields1, createGeneratedFields2, invokeGenerated, invokeGeneratedFields3 } from '@rustra/types';
import type { InvokeOptions as CoreInvokeOptions } from '@rustra/types';

/**
 * 이 패키지 생성 명령의 호출 옵션 — 모든 생성 함수의 마지막 파라미터.
 *
 * ⚠️ **얕은 취소**: `signal` 이 실행 중에 abort 되면 **JS 프라미스만 거부되고**
 * (shallow cancellation) Rust 명령은 끝까지 실행되거나 이미 완료됐을 수 있습니다.
 * 취소/타임아웃은 "명령이 실행되지 않았음"을 보장하지 않습니다.
 *
 * ⚠️ **`retryable: true` ≠ 재실행 안전**: `transport.timeout`·`cancelled` 등
 * retryable 오류는 재시도 시 실패 유형이 사라질 수 있음을 뜻할 뿐, 명령을 다시
 * 실행해도 안전하다는 뜻이 아닙니다. 비멱등 명령의 재시도는 상태를 재조회해 이전
 * 시도가 반영되지 않았음을 확인한 뒤에만 하세요.
 *
 * 전체 의미론은 docs/compatibility-matrix.md "Signal semantics in detail" 및
 * 원본 타입(`InvokeOptions`(@rustra/types)) 문서를 참고하세요.
 */
export type InvokeOptions = CoreInvokeOptions;

export function bookmarkCreate(input: BookmarkCreateInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGeneratedFields3<Snapshot>(23, 'bookmarkCreate', input, input["title"], input["url"], input["folderId"], options);
}
bookmarkCreate.commandId = 'bookmarkCreate';

export const bookmarkFolderCreate = createGeneratedFields1<BookmarkFolderCreateInput, Snapshot>(27, 'bookmarkFolderCreate', "title", 'bookmarkFolderCreate');

export const bookmarkFolderRemove = createGeneratedFields1<BookmarkFolderIdInput, Snapshot>(29, 'bookmarkFolderRemove', "folderId", 'bookmarkFolderRemove');

export const bookmarkFolderRename = createGeneratedFields2<BookmarkFolderRenameInput, Snapshot>(28, 'bookmarkFolderRename', "folderId", "title", 'bookmarkFolderRename');

export const bookmarkMove = createGeneratedFields2<BookmarkMoveInput, Snapshot>(26, 'bookmarkMove', "bookmarkId", "index", 'bookmarkMove');

export function bookmarkOpen(input: BookmarkOpenInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGeneratedFields3<Snapshot>(32, 'bookmarkOpen', input, input["bookmarkId"], input["reuseTabId"], input["private"], options);
}
bookmarkOpen.commandId = 'bookmarkOpen';

export const bookmarkRemove = createGeneratedFields1<BookmarkIdInput, Snapshot>(25, 'bookmarkRemove', "bookmarkId", 'bookmarkRemove');

export const bookmarkSetFolder = createGeneratedFields2<BookmarkSetFolderInput, Snapshot>(30, 'bookmarkSetFolder', "bookmarkId", "folderId", 'bookmarkSetFolder');

export function bookmarkUpdate(input: BookmarkUpdateInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGeneratedFields3<Snapshot>(24, 'bookmarkUpdate', input, input["bookmarkId"], input["title"], input["url"], options);
}
bookmarkUpdate.commandId = 'bookmarkUpdate';

export function browserSnapshot(input: BrowserSnapshotInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGenerated<Snapshot>(1, 'browserSnapshot', input, options);
}
browserSnapshot.commandId = 'browserSnapshot';

export function keymapDefaults(input: BrowserSnapshotInput, options?: InvokeOptions): Promise<KeymapSetInput> {
  return invokeGenerated<KeymapSetInput>(22, 'keymapDefaults', input, options);
}
keymapDefaults.commandId = 'keymapDefaults';

export function keymapSet(input: KeymapSetInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGenerated<Snapshot>(21, 'keymapSet', input, options);
}
keymapSet.commandId = 'keymapSet';

export const snapshotRestore = createGeneratedFields1<SnapshotRestoreInput, Snapshot>(20, 'snapshotRestore', "json", 'snapshotRestore');

export const splitGroupRemove = createGeneratedFields1<SplitGroupIdInput, Snapshot>(34, 'splitGroupRemove', "splitGroupId", 'splitGroupRemove');

export function splitGroupSave(input: SplitGroupSaveInput, options?: InvokeOptions): Promise<Snapshot> {
  return invokeGenerated<Snapshot>(33, 'splitGroupSave', input, options);
}
splitGroupSave.commandId = 'splitGroupSave';

export const tabActivate = createGeneratedFields1<TabIdInput, Snapshot>(9, 'tabActivate', "tabId", 'tabActivate');

export const tabClose = createGeneratedFields1<TabIdInput, Snapshot>(10, 'tabClose', "tabId", 'tabClose');

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

export const tabRename = createGeneratedFields2<TabRenameInput, Snapshot>(35, 'tabRename', "tabId", "title", 'tabRename');

export const tabReset = createGeneratedFields1<TabIdInput, Snapshot>(31, 'tabReset', "tabId", 'tabReset');

export const tabSetFavorite = createGeneratedFields2<TabFavoriteInput, Snapshot>(12, 'tabSetFavorite', "tabId", "favorite", 'tabSetFavorite');

export const tabSetPinned = createGeneratedFields2<TabPinnedInput, Snapshot>(13, 'tabSetPinned', "tabId", "pinned", 'tabSetPinned');

export const tabSetWorkspace = createGeneratedFields2<TabWorkspaceInput, Snapshot>(15, 'tabSetWorkspace', "tabId", "workspaceId", 'tabSetWorkspace');

export function workArchiveExport(input: WorkArchiveExportInput, options?: InvokeOptions): Promise<string> {
  return invokeGenerated<string>(2, 'workArchiveExport', input, options);
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

export const workArchivePreview = createGeneratedFields1<WorkArchivePreviewInput, WorkArchivePreview>(3, 'workArchivePreview', "json", 'workArchivePreview');

export const workspaceActivate = createGeneratedFields1<WorkspaceIdInput, Snapshot>(16, 'workspaceActivate', "workspaceId", 'workspaceActivate');

export const workspaceCreate = createGeneratedFields1<WorkspaceCreateInput, Snapshot>(6, 'workspaceCreate', "name", 'workspaceCreate');

export const workspaceMove = createGeneratedFields2<WorkspaceMoveInput, Snapshot>(19, 'workspaceMove', "workspaceId", "index", 'workspaceMove');

export const workspaceRemove = createGeneratedFields1<WorkspaceIdInput, Snapshot>(18, 'workspaceRemove', "workspaceId", 'workspaceRemove');

export const workspaceRename = createGeneratedFields2<WorkspaceRenameInput, Snapshot>(17, 'workspaceRename', "workspaceId", "name", 'workspaceRename');
