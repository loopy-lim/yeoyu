use std::collections::{HashMap, HashSet};

use rustra::{Result, RustraError};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const SNAPSHOT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    /// Space tint as #rrggbb. Empty means "follow the appearance hue" — the
    /// default space stays appearance-colored so existing snapshots keep
    /// their look; created spaces pick from the palette round-robin.
    #[serde(default)]
    pub color: String,
    /// The space's most recently used tab; activate_workspace reopens the
    /// space where the user left off (Arc's working-set behavior). Dangling
    /// values are rejected on restore like the other active pointers.
    #[serde(default)]
    pub last_active_tab_id: Option<String>,
}

/// Space tints assigned to newly created workspaces, in order.
pub const WORKSPACE_PALETTE: [&str; 6] = [
    "#7d94d4", "#68b3ae", "#82b478", "#d0a86c", "#cf8a70", "#c47fa4",
];

pub(crate) fn valid_space_color(color: &str) -> bool {
    color.is_empty()
        || (color.len() == 7
            && color.starts_with('#')
            && color[1..].chars().all(|c| c.is_ascii_hexdigit()))
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    pub id: String,
    pub workspace_id: String,
    pub url: String,
    pub title: String,
    /// Favorites appear in every space without changing the selected space.
    /// Older snapshots restore without the field as non-favorites.
    #[serde(default)]
    pub favorite: bool,
    /// Pinned tabs keep their own section under favorites, per space.
    #[serde(default)]
    pub pinned: bool,
    /// Private tabs run engine-private sessions and never persist: the
    /// controller strips them from saved copies and restore drops them.
    #[serde(default)]
    pub private: bool,
    /// The persistent sidebar item owning this tab, independent of its live URL.
    #[serde(default)]
    pub bookmark_id: String,
    /// Saved destination, independent of navigation in the live session.
    #[serde(default)]
    pub home_url: String,
    #[serde(default)]
    pub home_title: String,
    /// The saved row remains while its browser session is closed.
    #[serde(default)]
    pub suspended: bool,
    /// Last touch in epoch ms; drives the Today/Earlier split (12h archive).
    #[serde(default)]
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: String,
    /// Empty only in legacy snapshots, assigned to a Space during restore.
    #[serde(default)]
    pub workspace_id: String,
    pub title: String,
    pub url: String,
    // "" is the root; otherwise a bookmark_folders ID. Old snapshots
    // without the field restore as root bookmarks.
    #[serde(default)]
    pub folder_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkFolder {
    pub id: String,
    #[serde(default)]
    pub workspace_id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KeyBinding {
    pub key: String,
    pub meta: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub command: String,
}

impl KeyBinding {
    pub fn command(
        key: &str,
        meta: bool,
        ctrl: bool,
        alt: bool,
        shift: bool,
        command: &str,
    ) -> Self {
        Self {
            key: key.to_owned(),
            meta,
            ctrl,
            alt,
            shift,
            command: command.to_owned(),
        }
    }

    fn chord(&self) -> (String, bool, bool, bool, bool) {
        (
            self.key.to_lowercase(),
            self.meta,
            self.ctrl,
            self.alt,
            self.shift,
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub version: u32,
    pub revision: u32,
    /// The native incoming-link queue acknowledges FIFO deliveries only after
    /// this snapshot is durable. Its head may replay across a bridge restart.
    #[serde(default)]
    pub last_external_request_id: String,
    pub workspaces: Vec<Workspace>,
    pub tabs: Vec<Tab>,
    #[serde(default = "legacy_default_bookmarks")]
    pub bookmarks: Vec<Bookmark>,
    #[serde(default)]
    pub bookmark_folders: Vec<BookmarkFolder>,
    pub active_workspace_id: String,
    pub active_tab_id: Option<String>,
    pub key_bindings: Vec<KeyBinding>,
    /// Once migrated, explicitly customized shortcuts are never remapped.
    #[serde(default)]
    pub keymap_version: u32,
}

#[derive(Debug, Clone)]
pub struct BrowserState {
    pub(crate) snapshot: Snapshot,
    pub(crate) next_workspace_id: u64,
    pub(crate) next_tab_id: u64,
    pub(crate) next_bookmark_id: u64,
    pub(crate) next_bookmark_folder_id: u64,
}

impl Default for BrowserState {
    fn default() -> Self {
        Self {
            snapshot: Snapshot {
                version: SNAPSHOT_VERSION,
                revision: 0,
                last_external_request_id: String::new(),
                workspaces: vec![Workspace {
                    id: "workspace-1".into(),
                    name: "Default".into(),
                    color: String::new(),
                    last_active_tab_id: None,
                }],
                tabs: Vec::new(),
                bookmarks: default_bookmarks(),
                bookmark_folders: Vec::new(),
                active_workspace_id: "workspace-1".into(),
                active_tab_id: None,
                key_bindings: default_key_bindings(),
                keymap_version: 1,
            },
            next_workspace_id: 2,
            next_tab_id: 1,
            next_bookmark_id: 4,
            next_bookmark_folder_id: 1,
        }
    }
}

impl BrowserState {
    pub fn snapshot(&self) -> Snapshot {
        self.snapshot.clone()
    }

    pub fn create_workspace(&mut self, name: &str) -> Result<Snapshot> {
        let name = name.trim();
        if name.is_empty() {
            return Err(domain_error("workspace name must not be empty"));
        }
        if self
            .snapshot
            .workspaces
            .iter()
            .any(|workspace| workspace.name == name)
        {
            return Err(domain_error("workspace name must be unique"));
        }
        let id = format!("workspace-{}", self.next_workspace_id);
        let tab_id = format!("tab-{}", self.next_tab_id);
        let next_workspace_id = self
            .next_workspace_id
            .checked_add(1)
            .ok_or_else(|| domain_error("workspace ID space exhausted"))?;
        let next_tab_id = self
            .next_tab_id
            .checked_add(1)
            .ok_or_else(|| domain_error("tab ID space exhausted"))?;
        // The default space keeps the appearance hue; every created space
        // takes the next palette tint (skipping the default's slot).
        let color = WORKSPACE_PALETTE
            [(self.snapshot.workspaces.len().saturating_sub(1)) % WORKSPACE_PALETTE.len()]
        .to_owned();
        // Space + seed tab land as ONE candidate: a revision-boundary error
        // must never leave a half-created space behind.
        let mut candidate = self.snapshot.clone();
        candidate.workspaces.push(Workspace {
            id: id.clone(),
            name: name.into(),
            color,
            last_active_tab_id: Some(tab_id.clone()),
        });
        candidate.tabs.push(Tab {
            id: tab_id.clone(),
            workspace_id: id.clone(),
            url: "about:blank".into(),
            title: String::new(),
            favorite: false,
            pinned: false,
            private: false,
            bookmark_id: String::new(),
            home_url: String::new(),
            home_title: String::new(),
            suspended: false,
            updated_at: now_ms(),
        });
        candidate.active_workspace_id = id.clone();
        candidate.active_tab_id = Some(tab_id);
        self.commit(candidate)?;
        self.next_workspace_id = next_workspace_id;
        self.next_tab_id = next_tab_id;
        Ok(self.snapshot())
    }

    pub fn create_tab(&mut self, workspace_id: &str, url: &str) -> Result<Snapshot> {
        self.create_tab_with_request(workspace_id, url, None, false)
    }

    /// Private tabs live in the domain like ordinary ones but carry a flag the
    /// controller strips before every save; the engine session is private too.
    pub fn create_private_tab(&mut self, workspace_id: &str, url: &str) -> Result<Snapshot> {
        self.create_tab_with_request(workspace_id, url, None, true)
    }

    pub fn open_external(&mut self, request_id: &str, url: &str) -> Result<Snapshot> {
        if request_id.is_empty()
            || request_id.len() > 128
            || !request_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        {
            return Err(domain_error("invalid external request ID"));
        }
        let authority = url
            .strip_prefix("https://")
            .or_else(|| url.strip_prefix("http://"))
            .and_then(|rest| rest.split(['/', '?', '#']).next());
        if authority.is_none_or(|host| host.is_empty() || host.contains('@'))
            || url.chars().any(|c| c.is_whitespace() || c.is_control())
        {
            return Err(domain_error(
                "external link must be an HTTP or HTTPS address",
            ));
        }
        if self.snapshot.last_external_request_id == request_id {
            return Ok(self.snapshot());
        }
        let workspace_id = self.snapshot.active_workspace_id.clone();
        self.create_tab_with_request(&workspace_id, url, Some(request_id), false)
    }

    fn create_tab_with_request(
        &mut self,
        workspace_id: &str,
        url: &str,
        request_id: Option<&str>,
        private: bool,
    ) -> Result<Snapshot> {
        if !self
            .snapshot
            .workspaces
            .iter()
            .any(|workspace| workspace.id == workspace_id)
        {
            return Err(domain_error("tab workspace does not exist"));
        }
        if url.trim().is_empty() {
            return Err(domain_error("tab URL must not be empty"));
        }
        let id = format!("tab-{}", self.next_tab_id);
        let mut candidate = self.snapshot.clone();
        if let Some(request_id) = request_id {
            candidate.last_external_request_id = request_id.into();
        }
        candidate.tabs.push(Tab {
            id: id.clone(),
            workspace_id: workspace_id.into(),
            url: url.into(),
            title: String::new(),
            favorite: false,
            pinned: false,
            private,
            bookmark_id: String::new(),
            home_url: String::new(),
            home_title: String::new(),
            suspended: false,
            updated_at: now_ms(),
        });
        candidate.active_workspace_id = workspace_id.into();
        candidate.active_tab_id = Some(id.clone());
        set_last_active(&mut candidate, workspace_id, Some(&id));
        let next_tab_id = self
            .next_tab_id
            .checked_add(1)
            .ok_or_else(|| domain_error("tab ID space exhausted"))?;
        self.commit(candidate)?;
        self.next_tab_id = next_tab_id;
        Ok(self.snapshot())
    }

    pub fn activate_tab(&mut self, tab_id: &str) -> Result<Snapshot> {
        let tab = self
            .snapshot
            .tabs
            .iter()
            .find(|tab| tab.id == tab_id)
            .ok_or_else(|| domain_error("tab does not exist"))?;
        let workspace_id = if tab.favorite {
            self.snapshot.active_workspace_id.clone()
        } else {
            tab.workspace_id.clone()
        };
        let mut candidate = self.snapshot.clone();
        candidate.active_workspace_id = workspace_id.clone();
        candidate.active_tab_id = Some(tab.id.clone());
        if let Some(active) = candidate.tabs.iter_mut().find(|tab| tab.id == tab_id) {
            active.updated_at = now_ms();
            active.suspended = false;
        }
        set_last_active(&mut candidate, &workspace_id, Some(tab_id));
        self.commit(candidate)
    }

    pub fn activate_workspace(&mut self, workspace_id: &str) -> Result<Snapshot> {
        if !self
            .snapshot
            .workspaces
            .iter()
            .any(|workspace| workspace.id == workspace_id)
        {
            return Err(domain_error("workspace does not exist"));
        }
        let mut candidate = self.snapshot.clone();
        let changed_space = candidate.active_workspace_id != workspace_id;
        candidate.active_workspace_id = workspace_id.into();
        let stale_active = candidate
            .active_tab_id
            .as_deref()
            .and_then(|id| candidate.tabs.iter().find(|tab| tab.id == id))
            .map(|tab| !tab_available_in(tab, workspace_id))
            .unwrap_or(true);
        if changed_space || stale_active {
            // Arc reopens a space where the user left off: prefer the space's
            // remembered tab, then its first tab; a tabless space seeds a
            // fresh new tab (never an empty canvas).
            let remembered = candidate
                .workspaces
                .iter()
                .find(|workspace| workspace.id == workspace_id)
                .and_then(|workspace| workspace.last_active_tab_id.as_deref())
                .and_then(|id| {
                    candidate
                        .tabs
                        .iter()
                        .find(|tab| tab.id == id && tab_available_in(tab, workspace_id))
                })
                .map(|tab| tab.id.clone());
            let fallback = candidate
                .tabs
                .iter()
                .find(|tab| tab.workspace_id == workspace_id && !tab.suspended)
                .map(|tab| tab.id.clone());
            match remembered.or(fallback) {
                Some(id) => {
                    set_last_active(&mut candidate, workspace_id, Some(&id));
                    candidate.active_tab_id = Some(id);
                }
                None => return self.create_tab(workspace_id, "about:blank"),
            }
        }
        self.commit(candidate)
    }

    pub fn set_tab_favorite(&mut self, tab_id: &str, favorite: bool) -> Result<Snapshot> {
        let index = self
            .snapshot
            .tabs
            .iter()
            .position(|tab| tab.id == tab_id)
            .ok_or_else(|| domain_error("tab does not exist"))?;
        if self.snapshot.tabs[index].private {
            return Err(domain_error("a private tab cannot become a favorite"));
        }
        let mut candidate = self.snapshot.clone();
        if favorite {
            save_destination(&mut candidate.tabs[index]);
            candidate.tabs[index].pinned = false;
        } else if candidate.tabs[index].favorite {
            candidate.tabs[index].workspace_id = candidate.active_workspace_id.clone();
            transfer_bookmark_to_tab_space(&mut candidate, index);
            candidate.tabs[index].suspended = false;
            candidate.tabs[index].home_url.clear();
            candidate.tabs[index].home_title.clear();
        }
        candidate.tabs[index].favorite = favorite;
        candidate.tabs[index].updated_at = now_ms();
        repair_last_active(&mut candidate);
        self.commit(candidate)
    }

    pub fn set_tab_pinned(&mut self, tab_id: &str, pinned: bool) -> Result<Snapshot> {
        let index = self
            .snapshot
            .tabs
            .iter()
            .position(|tab| tab.id == tab_id)
            .ok_or_else(|| domain_error("tab does not exist"))?;
        if self.snapshot.tabs[index].private {
            return Err(domain_error("a private tab cannot be pinned"));
        }
        let mut candidate = self.snapshot.clone();
        if pinned {
            save_destination(&mut candidate.tabs[index]);
            if candidate.tabs[index].favorite {
                candidate.tabs[index].workspace_id = candidate.active_workspace_id.clone();
                transfer_bookmark_to_tab_space(&mut candidate, index);
            }
            candidate.tabs[index].favorite = false;
        } else if candidate.tabs[index].pinned {
            candidate.tabs[index].suspended = false;
            candidate.tabs[index].home_url.clear();
            candidate.tabs[index].home_title.clear();
        }
        candidate.tabs[index].pinned = pinned;
        candidate.tabs[index].updated_at = now_ms();
        repair_last_active(&mut candidate);
        self.commit(candidate)
    }

    pub fn move_tab(&mut self, tab_id: &str, index: usize) -> Result<Snapshot> {
        let current = self
            .snapshot
            .tabs
            .iter()
            .position(|tab| tab.id == tab_id)
            .ok_or_else(|| domain_error("tab does not exist"))?;
        if index >= self.snapshot.tabs.len() {
            return Err(domain_error("tab index out of range"));
        }
        let mut candidate = self.snapshot.clone();
        let tab = candidate.tabs.remove(current);
        candidate.tabs.insert(index, tab);
        self.commit(candidate)
    }

    /// Arc semantics: moving a tab keeps the user on their working set —
    /// moving the ACTIVE tab carries the active space with it, so the state
    /// invariant ("active tab lives in the active space") holds by
    /// construction instead of rejecting the move.
    pub fn set_tab_workspace(&mut self, tab_id: &str, workspace_id: &str) -> Result<Snapshot> {
        if !self
            .snapshot
            .workspaces
            .iter()
            .any(|workspace| workspace.id == workspace_id)
        {
            return Err(domain_error("workspace does not exist"));
        }
        let index = self
            .snapshot
            .tabs
            .iter()
            .position(|tab| tab.id == tab_id)
            .ok_or_else(|| domain_error("tab does not exist"))?;
        let was_active = self.snapshot.active_tab_id.as_deref() == Some(tab_id);
        let source_workspace_id = self.snapshot.tabs[index].workspace_id.clone();
        let source_last_active = self
            .snapshot
            .workspaces
            .iter()
            .find(|workspace| workspace.id == source_workspace_id)
            .and_then(|workspace| workspace.last_active_tab_id.as_deref())
            == Some(tab_id);
        let mut candidate = self.snapshot.clone();
        candidate.tabs[index].workspace_id = workspace_id.into();
        transfer_bookmark_to_tab_space(&mut candidate, index);
        if candidate.tabs[index].favorite {
            candidate.tabs[index].favorite = false;
            candidate.tabs[index].pinned = true;
        }
        if was_active {
            candidate.active_workspace_id = workspace_id.into();
            set_last_active(&mut candidate, workspace_id, Some(tab_id));
        }
        if source_workspace_id != workspace_id && (source_last_active || was_active) {
            // The remembered tab left the source space; a later visit falls
            // back to its first tab.
            set_last_active(&mut candidate, &source_workspace_id, None);
        }
        repair_last_active(&mut candidate);
        self.commit(candidate)
    }

    pub fn close_tab(&mut self, tab_id: &str) -> Result<Snapshot> {
        let index = self
            .snapshot
            .tabs
            .iter()
            .position(|tab| tab.id == tab_id)
            .ok_or_else(|| domain_error("tab does not exist"))?;
        let closing = &self.snapshot.tabs[index];
        let was_active = self.snapshot.active_tab_id.as_deref() == Some(tab_id);
        let workspace_id = self.snapshot.active_workspace_id.clone();
        let position = self.snapshot.tabs[..index]
            .iter()
            .filter(|tab| tab_available_in(tab, &workspace_id))
            .count();
        let mut candidate = self.snapshot.clone();
        if closing.favorite || closing.pinned {
            let tab = &mut candidate.tabs[index];
            tab.url = tab.home_url.clone();
            tab.title = tab.home_title.clone();
            tab.suspended = true;
        } else {
            candidate.tabs.remove(index);
        }
        repair_last_active(&mut candidate);
        if was_active {
            let remaining: Vec<&Tab> = candidate
                .tabs
                .iter()
                .filter(|tab| tab_available_in(tab, &workspace_id))
                .collect();
            let survivor = remaining
                .get(position)
                .or_else(|| remaining.last())
                .map(|tab| tab.id.clone());
            candidate.active_tab_id = survivor.clone();
            set_last_active(&mut candidate, &workspace_id, survivor.as_deref());
            if survivor.is_none() {
                let replacement = format!("tab-{}", self.next_tab_id);
                let next_tab_id = self
                    .next_tab_id
                    .checked_add(1)
                    .ok_or_else(|| domain_error("tab ID space exhausted"))?;
                candidate.tabs.push(Tab {
                    id: replacement.clone(),
                    workspace_id: workspace_id.clone(),
                    url: "about:blank".into(),
                    title: String::new(),
                    favorite: false,
                    pinned: false,
                    private: false,
                    bookmark_id: String::new(),
                    home_url: String::new(),
                    home_title: String::new(),
                    suspended: false,
                    updated_at: now_ms(),
                });
                candidate.active_tab_id = Some(replacement.clone());
                set_last_active(&mut candidate, &workspace_id, Some(&replacement));
                self.commit(candidate)?;
                self.next_tab_id = next_tab_id;
                return Ok(self.snapshot());
            }
        }
        self.commit(candidate)
    }

    pub fn reset_tab(&mut self, tab_id: &str) -> Result<Snapshot> {
        let mut candidate = self.snapshot.clone();
        let tab = candidate
            .tabs
            .iter_mut()
            .find(|tab| tab.id == tab_id)
            .ok_or_else(|| domain_error("tab does not exist"))?;
        if !(tab.favorite || tab.pinned) {
            return Err(domain_error("only saved tabs have a home destination"));
        }
        tab.url = tab.home_url.clone();
        tab.title = tab.home_title.clone();
        tab.updated_at = now_ms();
        self.commit(candidate)
    }

    pub fn navigate_tab(&mut self, tab_id: &str, url: &str, title: &str) -> Result<Snapshot> {
        if url.trim().is_empty() {
            return Err(domain_error("tab URL must not be empty"));
        }
        let mut candidate = self.snapshot.clone();
        let now = now_ms();
        let tab = candidate
            .tabs
            .iter_mut()
            .find(|tab| tab.id == tab_id)
            .ok_or_else(|| domain_error("tab does not exist"))?;
        if tab.suspended {
            return Err(domain_error("tab session is closed"));
        }
        tab.url = url.into();
        tab.title = title.into();
        tab.updated_at = now;
        self.commit(candidate)
    }

    pub fn restore(&mut self, json: &str) -> Result<Snapshot> {
        let mut candidate: Snapshot = serde_json::from_str(json)
            .map_err(|error| domain_error(&format!("invalid snapshot JSON: {error}")))?;
        migrate_bookmark_spaces(&mut candidate)?;
        migrate_saved_tabs(&mut candidate);
        strip_private_tabs(&mut candidate);
        if candidate.keymap_version == 0 {
            migrate_legacy_pin_shortcuts(&mut candidate.key_bindings);
            candidate.keymap_version = 1;
        }
        migrate_legacy_default_keymap(&mut candidate.key_bindings);
        validate_snapshot(&candidate)?;
        candidate.revision = candidate
            .revision
            .max(self.snapshot.revision)
            .checked_add(1)
            .ok_or_else(|| domain_error("snapshot revision overflow"))?;
        let next_workspace_id = next_id(
            &candidate
                .workspaces
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            "workspace-",
        )?;
        let next_tab_id = next_id(
            &candidate
                .tabs
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            "tab-",
        )?;
        let next_bookmark_id = next_id(
            &candidate
                .bookmarks
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            "bookmark-",
        )?;
        let next_bookmark_folder_id = next_id(
            &candidate
                .bookmark_folders
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            "folder-",
        )?;
        self.snapshot = candidate;
        self.next_workspace_id = next_workspace_id;
        self.next_tab_id = next_tab_id;
        self.next_bookmark_id = next_bookmark_id;
        self.next_bookmark_folder_id = next_bookmark_folder_id;
        Ok(self.snapshot())
    }

    pub fn set_keymap(&mut self, bindings: Vec<KeyBinding>) -> Result<Snapshot> {
        let mut candidate = self.snapshot.clone();
        candidate.key_bindings = bindings;
        self.commit(candidate)
    }

    /// Open a sidebar item atomically: one owner ID per Space, even after redirects.
    /// reuse_tab_id is an optional existing unbound tab selected by URL in the controller.
    pub fn open_bookmark(&mut self, bookmark_id: &str, reuse_tab_id: &str) -> Result<Snapshot> {
        self.open_bookmark_with_mode(bookmark_id, reuse_tab_id, false)
    }

    /// Private mode never reuses an ordinary live session: the bookmark opens
    /// as a plain private tab without a saved role or owner binding.
    pub fn open_bookmark_in_private(&mut self, bookmark_id: &str) -> Result<Snapshot> {
        self.open_bookmark_with_mode(bookmark_id, "", true)
    }

    fn open_bookmark_with_mode(
        &mut self,
        bookmark_id: &str,
        reuse_tab_id: &str,
        private: bool,
    ) -> Result<Snapshot> {
        let bookmark = self
            .snapshot
            .bookmarks
            .iter()
            .find(|item| {
                item.id == bookmark_id && item.workspace_id == self.snapshot.active_workspace_id
            })
            .ok_or_else(|| domain_error("bookmark does not exist"))?
            .clone();
        let workspace_id = self.snapshot.active_workspace_id.clone();
        let owned = if private {
            None
        } else {
            self.snapshot
                .tabs
                .iter()
                .find(|tab| tab.bookmark_id == bookmark_id && tab.workspace_id == workspace_id)
                .or_else(|| {
                    self.snapshot
                        .tabs
                        .iter()
                        .find(|tab| tab.bookmark_id == bookmark_id && tab.favorite)
                })
        };
        if let Some(tab) = owned {
            return self.activate_tab(&tab.id.clone());
        }
        let reuse = if private {
            None
        } else {
            self.snapshot.tabs.iter().position(|tab| {
                tab.id == reuse_tab_id
                    && tab.workspace_id == workspace_id
                    && !tab.favorite
                    && tab.bookmark_id.is_empty()
            })
        };
        let mut candidate = self.snapshot.clone();
        let mut next_tab_id = self.next_tab_id;
        let index = if let Some(index) = reuse {
            index
        } else {
            let id = format!("tab-{}", next_tab_id);
            next_tab_id = next_tab_id
                .checked_add(1)
                .ok_or_else(|| domain_error("tab ID space exhausted"))?;
            candidate.tabs.push(Tab {
                id,
                workspace_id: workspace_id.clone(),
                url: bookmark.url.clone(),
                title: bookmark.title.clone(),
                favorite: false,
                // A private tab carries no saved role: persistence strips it,
                // and the domain forbids saved fields on private tabs.
                pinned: !private,
                private,
                bookmark_id: if private {
                    String::new()
                } else {
                    bookmark.id.clone()
                },
                home_url: if private {
                    String::new()
                } else {
                    bookmark.url.clone()
                },
                home_title: if private {
                    String::new()
                } else {
                    bookmark.title.clone()
                },
                suspended: false,
                updated_at: now_ms(),
            });
            candidate.tabs.len() - 1
        };
        let tab = &mut candidate.tabs[index];
        if !private {
            tab.bookmark_id = bookmark.id.clone();
            tab.home_url = bookmark.url.clone();
            tab.home_title = bookmark.title.clone();
            tab.pinned = true;
        }
        tab.suspended = false;
        tab.updated_at = now_ms();
        let id = tab.id.clone();
        candidate.active_tab_id = Some(id.clone());
        set_last_active(&mut candidate, &workspace_id, Some(&id));
        self.commit(candidate)?;
        self.next_tab_id = next_tab_id;
        Ok(self.snapshot())
    }

    pub fn create_bookmark(&mut self, title: &str, url: &str, folder_id: &str) -> Result<Snapshot> {
        validate_bookmark_fields(title, url)?;
        if !folder_id.is_empty()
            && !self.snapshot.bookmark_folders.iter().any(|folder| {
                folder.id == folder_id && folder.workspace_id == self.snapshot.active_workspace_id
            })
        {
            return Err(domain_error("bookmark folder does not exist"));
        }
        let id = format!("bookmark-{}", self.next_bookmark_id);
        let next_bookmark_id = self
            .next_bookmark_id
            .checked_add(1)
            .ok_or_else(|| domain_error("bookmark ID space exhausted"))?;
        let mut candidate = self.snapshot.clone();
        candidate.bookmarks.push(Bookmark {
            id,
            workspace_id: candidate.active_workspace_id.clone(),
            title: title.trim().into(),
            url: url.trim().into(),
            folder_id: folder_id.into(),
        });
        self.commit(candidate)?;
        self.next_bookmark_id = next_bookmark_id;
        Ok(self.snapshot())
    }

    pub fn create_bookmark_folder(&mut self, title: &str) -> Result<Snapshot> {
        let title = title.trim();
        if title.is_empty() {
            return Err(domain_error("bookmark folder name must not be empty"));
        }
        let id = format!("folder-{}", self.next_bookmark_folder_id);
        let next_bookmark_folder_id = self
            .next_bookmark_folder_id
            .checked_add(1)
            .ok_or_else(|| domain_error("bookmark folder ID space exhausted"))?;
        let mut candidate = self.snapshot.clone();
        candidate.bookmark_folders.push(BookmarkFolder {
            id,
            workspace_id: candidate.active_workspace_id.clone(),
            title: title.into(),
        });
        self.commit(candidate)?;
        self.next_bookmark_folder_id = next_bookmark_folder_id;
        Ok(self.snapshot())
    }

    pub fn rename_bookmark_folder(&mut self, folder_id: &str, title: &str) -> Result<Snapshot> {
        let title = title.trim();
        if title.is_empty() {
            return Err(domain_error("bookmark folder name must not be empty"));
        }
        let mut candidate = self.snapshot.clone();
        let folder = candidate
            .bookmark_folders
            .iter_mut()
            .find(|folder| {
                folder.id == folder_id && folder.workspace_id == candidate.active_workspace_id
            })
            .ok_or_else(|| domain_error("bookmark folder does not exist"))?;
        folder.title = title.into();
        self.commit(candidate)
    }

    /// Removing a folder promotes its bookmarks back to the root — never
    /// drops bookmarks implicitly.
    pub fn remove_bookmark_folder(&mut self, folder_id: &str) -> Result<Snapshot> {
        let mut candidate = self.snapshot.clone();
        let index = candidate
            .bookmark_folders
            .iter()
            .position(|folder| {
                folder.id == folder_id && folder.workspace_id == candidate.active_workspace_id
            })
            .ok_or_else(|| domain_error("bookmark folder does not exist"))?;
        candidate.bookmark_folders.remove(index);
        for bookmark in &mut candidate.bookmarks {
            if bookmark.folder_id == folder_id {
                bookmark.folder_id.clear();
            }
        }
        self.commit(candidate)
    }

    pub fn set_bookmark_folder(&mut self, bookmark_id: &str, folder_id: &str) -> Result<Snapshot> {
        let mut candidate = self.snapshot.clone();
        if !folder_id.is_empty()
            && !candidate.bookmark_folders.iter().any(|folder| {
                folder.id == folder_id && folder.workspace_id == candidate.active_workspace_id
            })
        {
            return Err(domain_error("bookmark folder does not exist"));
        }
        let bookmark = candidate
            .bookmarks
            .iter_mut()
            .find(|bookmark| {
                bookmark.id == bookmark_id && bookmark.workspace_id == candidate.active_workspace_id
            })
            .ok_or_else(|| domain_error("bookmark does not exist"))?;
        bookmark.folder_id = folder_id.into();
        self.commit(candidate)
    }

    pub fn update_bookmark(
        &mut self,
        bookmark_id: &str,
        title: &str,
        url: &str,
    ) -> Result<Snapshot> {
        validate_bookmark_fields(title, url)?;
        let mut candidate = self.snapshot.clone();
        let bookmark = candidate
            .bookmarks
            .iter_mut()
            .find(|bookmark| {
                bookmark.id == bookmark_id && bookmark.workspace_id == candidate.active_workspace_id
            })
            .ok_or_else(|| domain_error("bookmark does not exist"))?;
        bookmark.title = title.trim().into();
        bookmark.url = url.trim().into();
        for tab in &mut candidate.tabs {
            if tab.bookmark_id == bookmark_id && (tab.pinned || tab.favorite) {
                tab.home_url = url.trim().into();
                tab.home_title = title.trim().into();
                if tab.suspended {
                    tab.url = tab.home_url.clone();
                    tab.title = tab.home_title.clone();
                }
            }
        }
        self.commit(candidate)
    }

    pub fn remove_bookmark(&mut self, bookmark_id: &str) -> Result<Snapshot> {
        let mut candidate = self.snapshot.clone();
        let index = candidate
            .bookmarks
            .iter()
            .position(|bookmark| {
                bookmark.id == bookmark_id && bookmark.workspace_id == candidate.active_workspace_id
            })
            .ok_or_else(|| domain_error("bookmark does not exist"))?;
        candidate.bookmarks.remove(index);
        // Removing a pin leaves its open page as an ordinary tab. Already closed
        // sessions disappear without being recreated just to remove their owner.
        candidate
            .tabs
            .retain(|tab| tab.bookmark_id != bookmark_id || !tab.suspended || tab.favorite);
        for tab in &mut candidate.tabs {
            if tab.bookmark_id == bookmark_id {
                tab.bookmark_id.clear();
                if tab.pinned {
                    tab.pinned = false;
                    tab.home_url.clear();
                    tab.home_title.clear();
                }
            }
        }
        repair_last_active(&mut candidate);
        self.commit(candidate)
    }

    pub fn move_bookmark(&mut self, bookmark_id: &str, index: u32) -> Result<Snapshot> {
        let mut candidate = self.snapshot.clone();
        let from = candidate
            .bookmarks
            .iter()
            .position(|bookmark| {
                bookmark.id == bookmark_id && bookmark.workspace_id == candidate.active_workspace_id
            })
            .ok_or_else(|| domain_error("bookmark does not exist"))?;
        let index =
            usize::try_from(index).map_err(|_| domain_error("bookmark index is out of bounds"))?;
        if index >= candidate.bookmarks.len() {
            return Err(domain_error("bookmark index is out of bounds"));
        }
        let bookmark = candidate.bookmarks.remove(from);
        candidate.bookmarks.insert(index, bookmark);
        self.commit(candidate)
    }

    fn commit(&mut self, mut candidate: Snapshot) -> Result<Snapshot> {
        validate_snapshot(&candidate)?;
        candidate.revision = self
            .snapshot
            .revision
            .checked_add(1)
            .ok_or_else(|| domain_error("snapshot revision overflow"))?;
        self.snapshot = candidate;
        Ok(self.snapshot())
    }
}

pub(crate) fn validate_snapshot(snapshot: &Snapshot) -> Result<()> {
    if snapshot.version != SNAPSHOT_VERSION {
        return Err(domain_error("unsupported snapshot version"));
    }
    if snapshot.last_external_request_id.len() > 128
        || !snapshot
            .last_external_request_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err(domain_error("invalid external request ID in snapshot"));
    }
    if snapshot.workspaces.is_empty() {
        return Err(domain_error("snapshot must contain a workspace"));
    }
    let mut workspace_ids = HashSet::new();
    let mut workspace_names = HashSet::new();
    for workspace in &snapshot.workspaces {
        if !valid_space_color(&workspace.color) {
            return Err(domain_error(
                "workspace color must be empty or a #rrggbb hex string",
            ));
        }
        if workspace.id.trim().is_empty()
            || workspace.name.trim().is_empty()
            || !workspace_ids.insert(workspace.id.as_str())
            || !workspace_names.insert(workspace.name.as_str())
        {
            return Err(domain_error(
                "workspace IDs and names must be non-empty and unique",
            ));
        }
    }
    if !workspace_ids.contains(snapshot.active_workspace_id.as_str()) {
        return Err(domain_error("active workspace does not exist"));
    }
    let mut tab_ids = HashSet::new();
    for tab in &snapshot.tabs {
        if tab.id.trim().is_empty() || tab.url.trim().is_empty() || !tab_ids.insert(tab.id.as_str())
        {
            return Err(domain_error(
                "tab IDs and URLs must be non-empty and IDs unique",
            ));
        }
        if !workspace_ids.contains(tab.workspace_id.as_str()) {
            return Err(domain_error("tab references an unknown workspace"));
        }
        if tab.favorite && tab.pinned {
            return Err(domain_error("a tab cannot be both a favorite and a pin"));
        }
        if (tab.favorite || tab.pinned) && tab.home_url.trim().is_empty() {
            return Err(domain_error("saved tab destination must not be empty"));
        }
        if tab.suspended && !(tab.favorite || tab.pinned) {
            return Err(domain_error("only saved tabs may have a closed session"));
        }
        if tab.private
            && (tab.favorite
                || tab.pinned
                || tab.suspended
                || !tab.bookmark_id.is_empty()
                || !tab.home_url.is_empty()
                || !tab.home_title.is_empty())
        {
            return Err(domain_error(
                "a private tab cannot be saved, pinned, or suspended",
            ));
        }
    }
    let mut bookmark_spaces = HashMap::new();
    for bookmark in &snapshot.bookmarks {
        validate_bookmark_fields(&bookmark.title, &bookmark.url)?;
        if bookmark.id.trim().is_empty()
            || bookmark_spaces
                .insert(bookmark.id.as_str(), bookmark.workspace_id.as_str())
                .is_some()
        {
            return Err(domain_error("bookmark IDs must be non-empty and unique"));
        }
        if !workspace_ids.contains(bookmark.workspace_id.as_str()) {
            return Err(domain_error("bookmark references an unknown workspace"));
        }
    }
    let mut bookmark_sessions = HashSet::new();
    for tab in &snapshot.tabs {
        if !tab.bookmark_id.is_empty()
            && (bookmark_spaces.get(tab.bookmark_id.as_str()) != Some(&tab.workspace_id.as_str())
                || !bookmark_sessions.insert((tab.workspace_id.as_str(), tab.bookmark_id.as_str())))
        {
            return Err(domain_error(
                "bookmark tab owner must exist and be unique within its space",
            ));
        }
    }
    let mut bookmark_folder_spaces = HashMap::new();
    for folder in &snapshot.bookmark_folders {
        if folder.id.trim().is_empty()
            || folder.title.trim().is_empty()
            || bookmark_folder_spaces
                .insert(folder.id.as_str(), folder.workspace_id.as_str())
                .is_some()
        {
            return Err(domain_error(
                "bookmark folder IDs must be non-empty and unique",
            ));
        }
        if !workspace_ids.contains(folder.workspace_id.as_str()) {
            return Err(domain_error(
                "bookmark folder references an unknown workspace",
            ));
        }
    }
    for bookmark in &snapshot.bookmarks {
        if !bookmark.folder_id.is_empty()
            && bookmark_folder_spaces.get(bookmark.folder_id.as_str())
                != Some(&bookmark.workspace_id.as_str())
        {
            return Err(domain_error("bookmark folder must exist in its workspace"));
        }
    }
    if let Some(active_tab_id) = &snapshot.active_tab_id {
        let active = snapshot
            .tabs
            .iter()
            .find(|tab| &tab.id == active_tab_id)
            .ok_or_else(|| domain_error("active tab does not exist"))?;
        if !tab_available_in(active, &snapshot.active_workspace_id) {
            return Err(domain_error("active tab is outside active workspace"));
        }
    }
    for workspace in &snapshot.workspaces {
        if let Some(last_active) = &workspace.last_active_tab_id {
            let valid = snapshot
                .tabs
                .iter()
                .any(|tab| &tab.id == last_active && tab_available_in(tab, &workspace.id));
            if !valid {
                return Err(domain_error(
                    "workspace last-active tab does not exist in the space",
                ));
            }
        }
    }
    let mut chords = HashSet::new();
    for binding in &snapshot.key_bindings {
        if binding.key.trim().is_empty() || binding.command.trim().is_empty() {
            return Err(domain_error(
                "key binding key and command must not be empty",
            ));
        }
        if !chords.insert(binding.chord()) {
            return Err(domain_error("duplicate key binding chord"));
        }
    }
    Ok(())
}

fn next_id(ids: &[&str], prefix: &str) -> Result<u64> {
    ids.iter()
        .filter_map(|id| id.strip_prefix(prefix)?.parse::<u64>().ok())
        .max()
        .unwrap_or(0)
        .checked_add(1)
        .ok_or_else(|| domain_error("numeric ID space exhausted"))
}

fn domain_error(message: &str) -> RustraError {
    RustraError::custom("browser.invalid_state", message)
}

fn set_last_active(candidate: &mut Snapshot, workspace_id: &str, tab_id: Option<&str>) {
    if let Some(workspace) = candidate
        .workspaces
        .iter_mut()
        .find(|workspace| workspace.id == workspace_id)
    {
        workspace.last_active_tab_id = tab_id.map(str::to_owned);
    }
}

fn tab_available_in(tab: &Tab, workspace_id: &str) -> bool {
    !tab.suspended && (tab.favorite || tab.workspace_id == workspace_id)
}

/// Private tabs never survive persistence: restoring a snapshot that carried
/// them (an older build or a future bug) drops the tabs and repairs the
/// active pointers instead of exposing private URLs as ordinary state.
fn strip_private_tabs(candidate: &mut Snapshot) {
    if !candidate.tabs.iter().any(|tab| tab.private) {
        return;
    }
    candidate.tabs.retain(|tab| !tab.private);
    if candidate
        .active_tab_id
        .as_deref()
        .is_some_and(|id| !candidate.tabs.iter().any(|tab| tab.id == id))
    {
        candidate.active_tab_id = None;
    }
    repair_last_active(candidate);
}

fn repair_last_active(candidate: &mut Snapshot) {
    for workspace in &mut candidate.workspaces {
        if workspace.last_active_tab_id.as_deref().is_some_and(|id| {
            !candidate
                .tabs
                .iter()
                .any(|tab| tab.id == id && tab_available_in(tab, &workspace.id))
        }) {
            workspace.last_active_tab_id = None;
        }
    }
}

fn save_destination(tab: &mut Tab) {
    if !(tab.favorite || tab.pinned) || tab.home_url.is_empty() {
        tab.home_url = tab.url.clone();
        tab.home_title = tab.title.clone();
    }
}

fn transfer_bookmark_to_tab_space(candidate: &mut Snapshot, tab_index: usize) {
    let tab = &candidate.tabs[tab_index];
    let Some(bookmark) = candidate
        .bookmarks
        .iter_mut()
        .find(|bookmark| bookmark.id == tab.bookmark_id)
    else {
        return;
    };
    bookmark.workspace_id = tab.workspace_id.clone();
    if !candidate.bookmark_folders.iter().any(|folder| {
        folder.id == bookmark.folder_id && folder.workspace_id == bookmark.workspace_id
    }) {
        bookmark.folder_id.clear();
    }
}

/// The legacy library was global, but each bound tab already identifies where
/// its item was used. Preserve those uses without populating untouched Spaces.
/// Explicit scopes are never repaired; validation rejects invalid ownership.
fn migrate_bookmark_spaces(candidate: &mut Snapshot) -> Result<()> {
    let default_space = candidate
        .workspaces
        .iter()
        .find(|workspace| workspace.id == "workspace-1")
        .or_else(|| candidate.workspaces.first())
        .ok_or_else(|| domain_error("snapshot must contain a workspace"))?
        .id
        .clone();
    let mut next_bookmark_id = next_id(
        &candidate
            .bookmarks
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        "bookmark-",
    )?;
    for index in 0..candidate.bookmarks.len() {
        if !candidate.bookmarks[index].workspace_id.is_empty() {
            continue;
        }
        let original = candidate.bookmarks[index].clone();
        let mut spaces = Vec::new();
        for tab in &candidate.tabs {
            if tab.bookmark_id == original.id && !spaces.contains(&tab.workspace_id) {
                spaces.push(tab.workspace_id.clone());
            }
        }
        if spaces.is_empty() {
            spaces.push(default_space.clone());
        }
        candidate.bookmarks[index].workspace_id = spaces[0].clone();
        for workspace_id in spaces.into_iter().skip(1) {
            let mut bookmark = original.clone();
            bookmark.id = format!("bookmark-{next_bookmark_id}");
            next_bookmark_id = next_bookmark_id
                .checked_add(1)
                .ok_or_else(|| domain_error("bookmark ID space exhausted"))?;
            bookmark.workspace_id = workspace_id;
            for tab in &mut candidate.tabs {
                if tab.bookmark_id == original.id && tab.workspace_id == bookmark.workspace_id {
                    tab.bookmark_id = bookmark.id.clone();
                }
            }
            candidate.bookmarks.push(bookmark);
        }
    }
    let mut next_folder_id = next_id(
        &candidate
            .bookmark_folders
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        "folder-",
    )?;
    for index in 0..candidate.bookmark_folders.len() {
        if !candidate.bookmark_folders[index].workspace_id.is_empty() {
            continue;
        }
        let original = candidate.bookmark_folders[index].clone();
        let mut spaces = Vec::new();
        for bookmark in &candidate.bookmarks {
            if bookmark.folder_id == original.id && !spaces.contains(&bookmark.workspace_id) {
                spaces.push(bookmark.workspace_id.clone());
            }
        }
        if spaces.is_empty() {
            spaces.push(default_space.clone());
        }
        candidate.bookmark_folders[index].workspace_id = spaces[0].clone();
        for workspace_id in spaces.into_iter().skip(1) {
            let mut folder = original.clone();
            folder.id = format!("folder-{next_folder_id}");
            next_folder_id = next_folder_id
                .checked_add(1)
                .ok_or_else(|| domain_error("bookmark folder ID space exhausted"))?;
            folder.workspace_id = workspace_id;
            for bookmark in &mut candidate.bookmarks {
                if bookmark.folder_id == original.id && bookmark.workspace_id == folder.workspace_id
                {
                    bookmark.folder_id = folder.id.clone();
                }
            }
            candidate.bookmark_folders.push(folder);
        }
    }
    Ok(())
}

fn migrate_saved_tabs(candidate: &mut Snapshot) {
    for tab in &mut candidate.tabs {
        if tab.favorite || tab.pinned {
            save_destination(tab);
            // Old favorites were hidden from the pinned section anyway.
            if tab.favorite {
                tab.pinned = false;
            }
        }
    }
}

fn migrate_legacy_pin_shortcuts(bindings: &mut [KeyBinding]) {
    for binding in bindings {
        if binding.key.eq_ignore_ascii_case("d")
            && binding.meta != binding.ctrl
            && !binding.alt
            && !binding.shift
            && binding.command == "favorites.toggle"
        {
            binding.command = "pins.toggle".into();
        }
    }
}

fn migrate_legacy_default_keymap(bindings: &mut Vec<KeyBinding>) {
    if bindings.len() != 19 {
        return;
    }
    // d0a0910's original defaults plus eb01bf6's four App-added Tab chords.
    // Match every field and the stored order: edited and empty profiles belong
    // to the user and must never receive automatic shortcut additions.
    let legacy = vec![
        KeyBinding::command("t", true, false, false, false, "tab.new"),
        KeyBinding::command("w", true, false, false, false, "tab.close"),
        KeyBinding::command("l", true, false, false, false, "location.focus"),
        KeyBinding::command("k", true, false, false, false, "commandPalette.open"),
        KeyBinding::command("1", true, false, false, false, "tab.activate.1"),
        KeyBinding::command("2", true, false, false, false, "tab.activate.2"),
        KeyBinding::command("3", true, false, false, false, "tab.activate.3"),
        KeyBinding::command("4", true, false, false, false, "tab.activate.4"),
        KeyBinding::command("5", true, false, false, false, "tab.activate.5"),
        KeyBinding::command("6", true, false, false, false, "tab.activate.6"),
        KeyBinding::command("7", true, false, false, false, "tab.activate.7"),
        KeyBinding::command("8", true, false, false, false, "tab.activate.8"),
        KeyBinding::command("9", true, false, false, false, "tab.activate.9"),
        KeyBinding::command("[", true, false, false, false, "browser.back"),
        KeyBinding::command("]", true, false, false, false, "browser.forward"),
        KeyBinding::command("TAB", true, false, false, false, "tab.next"),
        KeyBinding::command("TAB", true, false, false, true, "tab.prev"),
        KeyBinding::command("TAB", false, true, false, false, "tab.next"),
        KeyBinding::command("TAB", false, true, false, true, "tab.prev"),
    ];
    if *bindings == legacy {
        *bindings = default_key_bindings();
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn validate_bookmark_fields(title: &str, url: &str) -> Result<()> {
    if title.trim().is_empty() || url.trim().is_empty() {
        return Err(domain_error("bookmark title and URL must not be empty"));
    }
    Ok(())
}

fn default_bookmarks() -> Vec<Bookmark> {
    vec![
        Bookmark {
            id: "bookmark-1".into(),
            workspace_id: "workspace-1".into(),
            title: "News".into(),
            url: "https://news.ycombinator.com".into(),
            folder_id: String::new(),
        },
        Bookmark {
            id: "bookmark-2".into(),
            workspace_id: "workspace-1".into(),
            title: "GitHub".into(),
            url: "https://github.com".into(),
            folder_id: String::new(),
        },
        Bookmark {
            id: "bookmark-3".into(),
            workspace_id: "workspace-1".into(),
            title: "Docs".into(),
            url: "https://developer.mozilla.org".into(),
            folder_id: String::new(),
        },
    ]
}

fn legacy_default_bookmarks() -> Vec<Bookmark> {
    let mut bookmarks = default_bookmarks();
    for bookmark in &mut bookmarks {
        bookmark.workspace_id.clear();
    }
    bookmarks
}

pub fn default_key_bindings() -> Vec<KeyBinding> {
    // Meta/Command chords follow Arc's macOS set; Android delivers shortcuts
    // through Ctrl while the OS reserves Meta combinations (e.g. Meta+L locks
    // the device), so every Meta binding ships with a Ctrl twin.
    let mut meta_bindings = vec![
        KeyBinding::command("t", true, false, false, false, "tab.new"),
        KeyBinding::command("w", true, false, false, false, "tab.close"),
        KeyBinding::command("l", true, false, false, false, "location.focus"),
        KeyBinding::command("k", true, false, false, false, "commandPalette.open"),
        KeyBinding::command("r", true, false, false, false, "browser.reload"),
        // Pin/unpin belongs to the current space; favorites are separate.
        KeyBinding::command("d", true, false, false, false, "pins.toggle"),
        KeyBinding::command("s", true, false, false, false, "sidebar.toggle"),
        KeyBinding::command("f", true, false, false, false, "find.open"),
        KeyBinding::command("y", true, false, false, false, "history.open"),
        // Shifted twins of the base keys: reopen and copy-URL chords. Zoom
        // stays unbound: GeckoView 155 exposes no programmatic zoom API.
        KeyBinding::command("t", true, false, false, true, "tab.reopen"),
        KeyBinding::command("c", true, false, false, true, "browser.copyUrl"),
        // Tab-key cycling: Cmd/Ctrl+Tab next, +Shift previous (stepTab wraps).
        // Android may reserve Meta+Tab for app switching, so the generated
        // Ctrl twins below are the reliable path on keyboard devices.
        KeyBinding::command("TAB", true, false, false, false, "tab.next"),
        KeyBinding::command("TAB", true, false, false, true, "tab.prev"),
        // OS windows: Cmd/Ctrl+Shift+N mirrors desktop browsers' new window.
        // The Ctrl twin is generated below with the other Meta bindings.
        KeyBinding::command("n", true, false, false, true, "window.new"),
    ];
    // TB710FU-class devices swallow Ctrl/Cmd+Shift+T before the app; Alt+Shift+T
    // is the device-friendly reopen chord (verified via InputRouter events). It
    // is appended after twin generation to avoid duplicating ctrl+shift+t.
    meta_bindings.extend((1..=9).map(|slot| {
        KeyBinding::command(
            &slot.to_string(),
            true,
            false,
            false,
            false,
            &format!("tab.activate.{slot}"),
        )
    }));
    meta_bindings.push(KeyBinding::command(
        "[",
        true,
        false,
        false,
        false,
        "browser.back",
    ));
    meta_bindings.push(KeyBinding::command(
        "]",
        true,
        false,
        false,
        false,
        "browser.forward",
    ));
    let mut bindings = meta_bindings.clone();
    bindings.extend(meta_bindings.iter().map(|binding| KeyBinding {
        key: binding.key.clone(),
        meta: false,
        ctrl: true,
        alt: false,
        shift: binding.shift,
        command: binding.command.clone(),
    }));
    // Arc defines these chords identically on macOS and Windows.
    bindings.push(KeyBinding::command(
        "DPAD_UP", false, true, true, false, "tab.prev",
    ));
    // TB710FU-class devices swallow Ctrl/Cmd+Shift+N before the app;
    // Alt+Shift+N is the device-friendly new-window chord (kept out of the
    // Meta list above so twin generation cannot duplicate it).
    bindings.push(KeyBinding::command(
        "n",
        false,
        false,
        true,
        true,
        "window.new",
    ));
    bindings.push(KeyBinding::command(
        "DPAD_DOWN",
        false,
        true,
        true,
        false,
        "tab.next",
    ));
    bindings.push(KeyBinding::command(
        "DPAD_LEFT",
        false,
        false,
        true,
        false,
        "browser.back",
    ));
    bindings.push(KeyBinding::command(
        "DPAD_RIGHT",
        false,
        false,
        true,
        false,
        "browser.forward",
    ));
    // Plus is shifted to EQUALS on most Android keyboards; bind both chords.
    bindings.push(KeyBinding::command(
        "PLUS",
        false,
        true,
        false,
        true,
        "browser.split",
    ));
    bindings.push(KeyBinding::command(
        "EQUALS",
        false,
        true,
        false,
        true,
        "browser.split",
    ));
    bindings.push(KeyBinding::command(
        "MINUS",
        false,
        true,
        false,
        true,
        "browser.split.close",
    ));
    bindings.push(KeyBinding::command(
        "1",
        false,
        true,
        false,
        true,
        "browser.focusPane.1",
    ));
    bindings.push(KeyBinding::command(
        "2",
        false,
        true,
        false,
        true,
        "browser.focusPane.2",
    ));
    bindings.push(KeyBinding::command(
        "t",
        false,
        false,
        true,
        true,
        "tab.reopen",
    ));
    bindings
}
