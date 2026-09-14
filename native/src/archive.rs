//! Portable work data. This is deliberately distinct from the persistence snapshot.
use std::collections::HashSet;

use rustra::{Result, RustraError};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::domain::{
    Bookmark, BookmarkFolder, BrowserState, KeyBinding, Snapshot, Tab, Workspace,
    valid_space_color, validate_snapshot,
};

const MAX_BYTES: usize = 8 * 1024 * 1024;
const MAX_ITEMS: usize = 10_000;
const MAX_TITLE: usize = 4096;
const MAX_URL: usize = 8192;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Archive {
    format: String,
    version: u32,
    spaces: Vec<Space>,
    key_bindings: Vec<KeyBinding>,
    #[serde(default)]
    presentation: Option<String>,
}
#[derive(Debug, Serialize, Deserialize)]
struct Space {
    name: String,
    color: String,
    tabs: Vec<PortableTab>,
    bookmarks: Vec<PortableBookmark>,
    folders: Vec<Folder>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PortableTab {
    url: String,
    title: String,
    favorite: bool,
    pinned: bool,
    home_url: String,
    home_title: String,
    bookmark_index: Option<usize>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PortableBookmark {
    title: String,
    url: String,
    folder_index: Option<usize>,
}
#[derive(Debug, Serialize, Deserialize)]
struct Folder {
    title: String,
}
#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkArchivePreview {
    pub spaces: u32,
    pub tabs: u32,
    pub bookmarks: u32,
    pub folders: u32,
    pub favorites: u32,
    pub duplicate_urls: u32,
    pub has_key_bindings: bool,
    pub presentation: Option<String>,
}
fn invalid() -> RustraError {
    RustraError::custom(
        "browser.invalid_work_archive",
        "invalid or unsupported work archive",
    )
}
fn check(condition: bool) -> Result<()> {
    if condition { Ok(()) } else { Err(invalid()) }
}
fn string(value: &str, max: usize, nonempty: bool) -> Result<()> {
    check(value.len() <= max && (!nonempty || !value.trim().is_empty()) && !value.contains('\0'))
}
fn url(value: &str, tab: bool) -> Result<()> {
    string(value, MAX_URL, true)?;
    if tab && value == "about:blank" {
        return Ok(());
    }
    check(!value.chars().any(|c| c.is_whitespace() || c.is_control()) && !value.contains('\\'))?;
    let parsed = url::Url::parse(value).map_err(|_| invalid())?;
    check(
        matches!(parsed.scheme(), "http" | "https")
            && parsed.host_str().is_some_and(|host| !host.is_empty())
            && parsed.username().is_empty()
            && parsed.password().is_none(),
    )
}
impl Archive {
    fn parse(json: &str) -> Result<Self> {
        check(json.len() <= MAX_BYTES)?;
        let archive: Self = serde_json::from_str(json).map_err(|_| invalid())?;
        archive.validate()?;
        Ok(archive)
    }
    fn validate(&self) -> Result<()> {
        check(self.format == "yeoyu-work" && self.version == 1 && self.spaces.len() <= 256)?;
        let total = self.spaces.len()
            + self.key_bindings.len()
            + self
                .spaces
                .iter()
                .map(|s| s.tabs.len() + s.bookmarks.len() + s.folders.len())
                .sum::<usize>();
        check(total <= MAX_ITEMS)?;
        if let Some(presentation) = &self.presentation {
            string(presentation, 64 * 1024, false)?;
            let _: serde_json::Value = serde_json::from_str(presentation).map_err(|_| invalid())?;
        }
        let mut chords = HashSet::new();
        for binding in &self.key_bindings {
            string(&binding.key, 128, true)?;
            string(&binding.command, 256, true)?;
            check(chords.insert((
                binding.key.to_lowercase(),
                binding.meta,
                binding.ctrl,
                binding.alt,
                binding.shift,
            )))?;
        }
        for space in &self.spaces {
            string(&space.name, 256, true)?;
            check(valid_space_color(&space.color))?;
            for folder in &space.folders {
                string(&folder.title, MAX_TITLE, true)?;
            }
            for bookmark in &space.bookmarks {
                string(&bookmark.title, MAX_TITLE, true)?;
                url(&bookmark.url, false)?;
                check(
                    bookmark
                        .folder_index
                        .is_none_or(|i| i < space.folders.len()),
                )?;
            }
            let mut owners = HashSet::new();
            for tab in &space.tabs {
                url(&tab.url, true)?;
                string(&tab.title, MAX_TITLE, false)?;
                string(&tab.home_title, MAX_TITLE, false)?;
                check(!(tab.favorite && tab.pinned))?;
                if tab.favorite || tab.pinned {
                    url(&tab.home_url, true)?;
                } else {
                    check(tab.home_url.is_empty() && tab.home_title.is_empty())?;
                }
                if let Some(i) = tab.bookmark_index {
                    check(i < space.bookmarks.len() && owners.insert(i))?;
                }
            }
        }
        Ok(())
    }
}
fn allocate(counter: &mut u64, prefix: &str) -> Result<String> {
    let id = format!("{prefix}-{}", *counter);
    *counter = counter.checked_add(1).ok_or_else(invalid)?;
    Ok(id)
}
impl BrowserState {
    pub fn work_archive_export(&self, presentation: Option<String>) -> Result<String> {
        let s = &self.snapshot;
        let spaces = s
            .workspaces
            .iter()
            .map(|w| {
                let folders: Vec<_> = s
                    .bookmark_folders
                    .iter()
                    .filter(|f| f.workspace_id == w.id)
                    .collect();
                let bookmarks: Vec<_> = s
                    .bookmarks
                    .iter()
                    .filter(|b| b.workspace_id == w.id)
                    .collect();
                Space {
                    name: w.name.clone(),
                    color: w.color.clone(),
                    folders: folders
                        .iter()
                        .map(|f| Folder {
                            title: f.title.clone(),
                        })
                        .collect(),
                    bookmarks: bookmarks
                        .iter()
                        .map(|b| PortableBookmark {
                            title: b.title.clone(),
                            url: b.url.clone(),
                            folder_index: folders.iter().position(|f| f.id == b.folder_id),
                        })
                        .collect(),
                    tabs: s
                        .tabs
                        .iter()
                        .filter(|t| t.workspace_id == w.id && !t.private)
                        .map(|t| {
                            let saved = t.favorite || t.pinned;
                            PortableTab {
                                url: if saved {
                                    t.home_url.clone()
                                } else {
                                    t.url.clone()
                                },
                                title: if saved {
                                    t.home_title.clone()
                                } else {
                                    t.title.clone()
                                },
                                favorite: t.favorite,
                                pinned: t.pinned,
                                home_url: t.home_url.clone(),
                                home_title: t.home_title.clone(),
                                bookmark_index: bookmarks
                                    .iter()
                                    .position(|b| b.id == t.bookmark_id),
                            }
                        })
                        .collect(),
                }
            })
            .collect();
        let archive = Archive {
            format: "yeoyu-work".into(),
            version: 1,
            spaces,
            key_bindings: s.key_bindings.clone(),
            presentation,
        };
        archive.validate()?;
        let json = serde_json::to_string(&archive).map_err(|_| invalid())?;
        check(json.len() <= MAX_BYTES)?;
        Ok(json)
    }
    pub fn work_archive_preview(&self, json: &str) -> Result<WorkArchivePreview> {
        let archive = Archive::parse(json)?;
        let mut seen: HashSet<&str> = self
            .snapshot
            .tabs
            .iter()
            .filter(|t| !t.private)
            .map(|t| {
                if t.favorite || t.pinned {
                    t.home_url.as_str()
                } else {
                    t.url.as_str()
                }
            })
            .chain(self.snapshot.bookmarks.iter().map(|b| b.url.as_str()))
            .collect();
        let mut preview = WorkArchivePreview {
            spaces: archive.spaces.len() as u32,
            tabs: 0,
            bookmarks: 0,
            folders: 0,
            favorites: 0,
            duplicate_urls: 0,
            has_key_bindings: !archive.key_bindings.is_empty(),
            presentation: archive.presentation.clone(),
        };
        for s in &archive.spaces {
            preview.tabs += s.tabs.len() as u32;
            preview.bookmarks += s.bookmarks.len() as u32;
            preview.folders += s.folders.len() as u32;
            preview.favorites += s.tabs.iter().filter(|t| t.favorite).count() as u32;
            for u in s
                .tabs
                .iter()
                .map(|t| {
                    if t.favorite || t.pinned {
                        t.home_url.as_str()
                    } else {
                        t.url.as_str()
                    }
                })
                .chain(s.bookmarks.iter().map(|b| b.url.as_str()))
            {
                if !seen.insert(u) {
                    preview.duplicate_urls += 1;
                }
            }
        }
        Ok(preview)
    }
    fn archive_candidate(
        &self,
        json: &str,
        include_favorites: bool,
        restore_keymap: bool,
    ) -> Result<Self> {
        let archive = Archive::parse(json)?;
        let mut candidate = self.clone();
        for s in archive.spaces {
            let workspace_id = allocate(&mut candidate.next_workspace_id, "workspace")?;
            let mut name = s.name.clone();
            let mut suffix = 1;
            while candidate.snapshot.workspaces.iter().any(|w| w.name == name) {
                let label = if suffix == 1 {
                    " (Imported)".to_owned()
                } else {
                    format!(" (Imported {suffix})")
                };
                let mut end = s.name.len().min(256 - label.len());
                while !s.name.is_char_boundary(end) {
                    end -= 1;
                }
                name = format!("{}{label}", &s.name[..end]);
                suffix += 1;
            }
            candidate.snapshot.workspaces.push(Workspace {
                id: workspace_id.clone(),
                name,
                color: s.color,
                last_active_tab_id: None,
            });
            let mut folder_ids = Vec::new();
            for f in s.folders {
                let id = allocate(&mut candidate.next_bookmark_folder_id, "folder")?;
                folder_ids.push(id.clone());
                candidate.snapshot.bookmark_folders.push(BookmarkFolder {
                    id,
                    workspace_id: workspace_id.clone(),
                    title: f.title,
                });
            }
            let mut bookmark_ids = Vec::new();
            for b in s.bookmarks {
                let id = allocate(&mut candidate.next_bookmark_id, "bookmark")?;
                bookmark_ids.push(id.clone());
                candidate.snapshot.bookmarks.push(Bookmark {
                    id,
                    workspace_id: workspace_id.clone(),
                    title: b.title,
                    url: b.url,
                    folder_id: b
                        .folder_index
                        .map(|i| folder_ids[i].clone())
                        .unwrap_or_default(),
                });
            }
            for t in s
                .tabs
                .into_iter()
                .filter(|t| include_favorites || !t.favorite)
            {
                let saved = t.favorite || t.pinned;
                candidate.snapshot.tabs.push(Tab {
                    id: allocate(&mut candidate.next_tab_id, "tab")?,
                    workspace_id: workspace_id.clone(),
                    url: if saved { t.home_url.clone() } else { t.url },
                    title: if saved { t.home_title.clone() } else { t.title },
                    favorite: t.favorite,
                    pinned: t.pinned,
                    private: false,
                    bookmark_id: t
                        .bookmark_index
                        .map(|i| bookmark_ids[i].clone())
                        .unwrap_or_default(),
                    home_url: t.home_url,
                    home_title: t.home_title,
                    suspended: saved,
                    updated_at: 0,
                });
            }
        }
        if restore_keymap {
            candidate.snapshot.key_bindings = archive.key_bindings;
            candidate.snapshot.keymap_version = 1;
        }
        validate_snapshot(&candidate.snapshot).map_err(|_| invalid())?;
        candidate.snapshot.revision = self.snapshot.revision.checked_add(1).ok_or_else(invalid)?;
        Ok(candidate)
    }
    pub fn work_archive_prepare(
        &self,
        json: &str,
        include_favorites: bool,
        restore_keymap: bool,
    ) -> Result<Snapshot> {
        Ok(self
            .archive_candidate(json, include_favorites, restore_keymap)?
            .snapshot)
    }
    pub fn work_archive_import(
        &mut self,
        json: &str,
        include_favorites: bool,
        restore_keymap: bool,
        expected_revision: u32,
    ) -> Result<Snapshot> {
        if self.snapshot.revision != expected_revision {
            return Err(RustraError::custom(
                "browser.work_archive_conflict",
                "browser state changed; prepare the import again",
            ));
        }
        let candidate = self.archive_candidate(json, include_favorites, restore_keymap)?;
        *self = candidate;
        Ok(self.snapshot())
    }
}
