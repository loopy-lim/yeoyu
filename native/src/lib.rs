pub mod archive;
pub mod domain;

use std::sync::{Mutex, OnceLock};

use domain::{BrowserState, KeyBinding, Snapshot};
use rustra::ffi::FfiFormat;
use rustra::prelude::*;

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct BrowserSnapshotInput {}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCreateInput {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TabCreateInput {
    pub workspace_id: String,
    pub url: String,
    /// Older clients omit the field; absent means an ordinary tab.
    #[serde(default)]
    pub private: bool,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TabOpenExternalInput {
    pub request_id: String,
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TabIdInput {
    pub tab_id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TabNavigatedInput {
    pub tab_id: String,
    pub url: String,
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TabFavoriteInput {
    pub tab_id: String,
    pub favorite: bool,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TabPinnedInput {
    pub tab_id: String,
    pub pinned: bool,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TabMoveInput {
    pub tab_id: String,
    pub index: u32,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TabWorkspaceInput {
    pub tab_id: String,
    pub workspace_id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIdInput {
    pub workspace_id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct SnapshotRestoreInput {
    pub json: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct KeymapSetInput {
    pub bindings: Vec<KeyBinding>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkCreateInput {
    pub title: String,
    pub url: String,
    // "" = root; an existing bookmark folder ID otherwise.
    pub folder_id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkUpdateInput {
    pub bookmark_id: String,
    pub title: String,
    pub url: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkIdInput {
    pub bookmark_id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkMoveInput {
    pub bookmark_id: String,
    pub index: u32,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkFolderCreateInput {
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkFolderRenameInput {
    pub folder_id: String,
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkFolderIdInput {
    pub folder_id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkSetFolderInput {
    pub bookmark_id: String,
    pub folder_id: String,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkOpenInput {
    pub bookmark_id: String,
    pub reuse_tab_id: String,
    /// Older clients omit the field; absent means an ordinary open.
    #[serde(default)]
    pub private: bool,
}

#[command]
pub fn bookmark_open(input: BookmarkOpenInput) -> Result<Snapshot> {
    if input.private {
        lock_state()?.open_bookmark_in_private(&input.bookmark_id)
    } else {
        lock_state()?.open_bookmark(&input.bookmark_id, &input.reuse_tab_id)
    }
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkArchiveExportInput {
    pub presentation: Option<String>,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct WorkArchivePreviewInput {
    pub json: String,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkArchivePrepareInput {
    pub json: String,
    pub include_favorites: bool,
    pub restore_keymap: bool,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkArchiveImportInput {
    pub json: String,
    pub include_favorites: bool,
    pub restore_keymap: bool,
    pub expected_revision: u32,
}
#[command]
pub fn work_archive_export(input: WorkArchiveExportInput) -> Result<String> {
    lock_state()?.work_archive_export(input.presentation)
}
#[command]
pub fn work_archive_preview(input: WorkArchivePreviewInput) -> Result<archive::WorkArchivePreview> {
    lock_state()?.work_archive_preview(&input.json)
}
#[command]
pub fn work_archive_prepare(input: WorkArchivePrepareInput) -> Result<Snapshot> {
    lock_state()?.work_archive_prepare(&input.json, input.include_favorites, input.restore_keymap)
}
#[command]
pub fn work_archive_import(input: WorkArchiveImportInput) -> Result<Snapshot> {
    lock_state()?.work_archive_import(
        &input.json,
        input.include_favorites,
        input.restore_keymap,
        input.expected_revision,
    )
}

static STATE: OnceLock<Mutex<BrowserState>> = OnceLock::new();
fn state() -> &'static Mutex<BrowserState> {
    STATE.get_or_init(|| Mutex::new(BrowserState::default()))
}
fn lock_state() -> Result<std::sync::MutexGuard<'static, BrowserState>> {
    state().lock().map_err(|_| {
        RustraError::custom(
            "browser.state_unavailable",
            "browser state lock is poisoned",
        )
    })
}

#[command]
pub fn browser_snapshot(_: BrowserSnapshotInput) -> Result<Snapshot> {
    Ok(lock_state()?.snapshot())
}
#[command]
pub fn workspace_create(input: WorkspaceCreateInput) -> Result<Snapshot> {
    lock_state()?.create_workspace(&input.name)
}
#[command]
pub fn tab_create(input: TabCreateInput) -> Result<Snapshot> {
    if input.private {
        lock_state()?.create_private_tab(&input.workspace_id, &input.url)
    } else {
        lock_state()?.create_tab(&input.workspace_id, &input.url)
    }
}
#[command]
pub fn tab_open_external(input: TabOpenExternalInput) -> Result<Snapshot> {
    lock_state()?.open_external(&input.request_id, &input.url)
}
#[command]
pub fn tab_activate(input: TabIdInput) -> Result<Snapshot> {
    lock_state()?.activate_tab(&input.tab_id)
}
#[command]
pub fn tab_close(input: TabIdInput) -> Result<Snapshot> {
    lock_state()?.close_tab(&input.tab_id)
}
#[command]
pub fn tab_reset(input: TabIdInput) -> Result<Snapshot> {
    lock_state()?.reset_tab(&input.tab_id)
}
#[command]
pub fn tab_navigated(input: TabNavigatedInput) -> Result<Snapshot> {
    lock_state()?.navigate_tab(&input.tab_id, &input.url, &input.title)
}
#[command]
pub fn tab_set_favorite(input: TabFavoriteInput) -> Result<Snapshot> {
    lock_state()?.set_tab_favorite(&input.tab_id, input.favorite)
}
#[command]
pub fn tab_set_pinned(input: TabPinnedInput) -> Result<Snapshot> {
    lock_state()?.set_tab_pinned(&input.tab_id, input.pinned)
}
#[command]
pub fn tab_move(input: TabMoveInput) -> Result<Snapshot> {
    lock_state()?.move_tab(&input.tab_id, input.index as usize)
}
#[command]
pub fn tab_set_workspace(input: TabWorkspaceInput) -> Result<Snapshot> {
    lock_state()?.set_tab_workspace(&input.tab_id, &input.workspace_id)
}
#[command]
pub fn workspace_activate(input: WorkspaceIdInput) -> Result<Snapshot> {
    lock_state()?.activate_workspace(&input.workspace_id)
}
#[command]
pub fn snapshot_restore(input: SnapshotRestoreInput) -> Result<Snapshot> {
    lock_state()?.restore(&input.json)
}
#[command]
pub fn keymap_set(input: KeymapSetInput) -> Result<Snapshot> {
    lock_state()?.set_keymap(input.bindings)
}
#[command]
pub fn bookmark_create(input: BookmarkCreateInput) -> Result<Snapshot> {
    lock_state()?.create_bookmark(&input.title, &input.url, &input.folder_id)
}
#[command]
pub fn bookmark_update(input: BookmarkUpdateInput) -> Result<Snapshot> {
    lock_state()?.update_bookmark(&input.bookmark_id, &input.title, &input.url)
}
#[command]
pub fn bookmark_remove(input: BookmarkIdInput) -> Result<Snapshot> {
    lock_state()?.remove_bookmark(&input.bookmark_id)
}
#[command]
pub fn bookmark_move(input: BookmarkMoveInput) -> Result<Snapshot> {
    lock_state()?.move_bookmark(&input.bookmark_id, input.index)
}
#[command]
pub fn bookmark_folder_create(input: BookmarkFolderCreateInput) -> Result<Snapshot> {
    lock_state()?.create_bookmark_folder(&input.title)
}
#[command]
pub fn bookmark_folder_rename(input: BookmarkFolderRenameInput) -> Result<Snapshot> {
    lock_state()?.rename_bookmark_folder(&input.folder_id, &input.title)
}
#[command]
pub fn bookmark_folder_remove(input: BookmarkFolderIdInput) -> Result<Snapshot> {
    lock_state()?.remove_bookmark_folder(&input.folder_id)
}
#[command]
pub fn bookmark_set_folder(input: BookmarkSetFolderInput) -> Result<Snapshot> {
    lock_state()?.set_bookmark_folder(&input.bookmark_id, &input.folder_id)
}

static PACKAGE: OnceLock<Package> = OnceLock::new();
pub fn browser_package() -> Package {
    PACKAGE
        .get_or_init(|| {
            let package = register!(
                Package::builder("workspace.browser"),
                browser_snapshot,
                work_archive_export,
                work_archive_preview,
                work_archive_prepare,
                work_archive_import,
                workspace_create,
                tab_create,
                tab_open_external,
                tab_activate,
                tab_close,
                tab_navigated,
                tab_set_favorite,
                tab_set_pinned,
                tab_move,
                tab_set_workspace,
                workspace_activate,
                snapshot_restore,
                keymap_set,
                bookmark_create,
                bookmark_update,
                bookmark_remove,
                bookmark_move,
                bookmark_folder_create,
                bookmark_folder_rename,
                bookmark_folder_remove,
                bookmark_set_folder,
                tab_reset,
                bookmark_open
            )
            .build();
            package.register_ffi_with_default(FfiFormat::Json);
            package
        })
        .clone()
}

rustra::native_entry!(browser_package);
