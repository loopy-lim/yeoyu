// ── rustra generated ────────────────────────────────────────
// File:   frame-registry.ts
// Source: schema.json (single source of truth for this file)
// Regen:  rustra codegen --config rustra.json
// Stage:  schema → ts codec renderer
// DO NOT EDIT — changes will be overwritten and fail codegen --check.
// ────────────────────────────────────────────────────────────

import { bookmarkCreateCodec, bookmarkFolderCreateCodec, bookmarkFolderRemoveCodec, bookmarkFolderRenameCodec, bookmarkMoveCodec, bookmarkOpenCodec, bookmarkRemoveCodec, bookmarkSetFolderCodec, bookmarkUpdateCodec, browserSnapshotCodec, keymapDefaultsCodec, keymapSetCodec, snapshotRestoreCodec, tabActivateCodec, tabCloseCodec, tabCreateCodec, tabMoveCodec, tabNavigatedCodec, tabOpenExternalCodec, tabResetCodec, tabSetFavoriteCodec, tabSetPinnedCodec, tabSetWorkspaceCodec, workArchiveExportCodec, workArchiveImportCodec, workArchivePrepareCodec, workArchivePreviewCodec, workspaceActivateCodec, workspaceCreateCodec } from './frame-codecs.js';

export const frameRegistry = new Map<string, import('@rustra/types').FrameCodec<any, any>>([
  // route: postcard
  ['bookmarkCreate', bookmarkCreateCodec],
  // route: postcard
  ['bookmarkFolderCreate', bookmarkFolderCreateCodec],
  // route: postcard
  ['bookmarkFolderRemove', bookmarkFolderRemoveCodec],
  // route: postcard
  ['bookmarkFolderRename', bookmarkFolderRenameCodec],
  // route: postcard
  ['bookmarkMove', bookmarkMoveCodec],
  // route: postcard
  ['bookmarkOpen', bookmarkOpenCodec],
  // route: postcard
  ['bookmarkRemove', bookmarkRemoveCodec],
  // route: postcard
  ['bookmarkSetFolder', bookmarkSetFolderCodec],
  // route: postcard
  ['bookmarkUpdate', bookmarkUpdateCodec],
  // route: postcard
  ['browserSnapshot', browserSnapshotCodec],
  // route: postcard
  ['keymapDefaults', keymapDefaultsCodec],
  // route: postcard
  ['keymapSet', keymapSetCodec],
  // route: postcard
  ['snapshotRestore', snapshotRestoreCodec],
  // route: postcard
  ['tabActivate', tabActivateCodec],
  // route: postcard
  ['tabClose', tabCloseCodec],
  // route: postcard
  ['tabCreate', tabCreateCodec],
  // route: postcard
  ['tabMove', tabMoveCodec],
  // route: postcard
  ['tabNavigated', tabNavigatedCodec],
  // route: postcard
  ['tabOpenExternal', tabOpenExternalCodec],
  // route: postcard
  ['tabReset', tabResetCodec],
  // route: postcard
  ['tabSetFavorite', tabSetFavoriteCodec],
  // route: postcard
  ['tabSetPinned', tabSetPinnedCodec],
  // route: postcard
  ['tabSetWorkspace', tabSetWorkspaceCodec],
  // route: postcard
  ['workArchiveExport', workArchiveExportCodec],
  // route: postcard
  ['workArchiveImport', workArchiveImportCodec],
  // route: postcard
  ['workArchivePrepare', workArchivePrepareCodec],
  // route: postcard
  ['workArchivePreview', workArchivePreviewCodec],
  // route: postcard
  ['workspaceActivate', workspaceActivateCodec],
  // route: postcard
  ['workspaceCreate', workspaceCreateCodec],
]);
