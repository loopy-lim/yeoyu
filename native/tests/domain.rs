use yeoyu_core::{
    browser_package,
    domain::{BrowserState, KeyBinding},
};

#[test]
fn saved_tab_close_preserves_destination_and_resumes_the_same_identity() {
    for favorite in [false, true] {
        let mut state = BrowserState::default();
        let id = state
            .create_tab("workspace-1", "https://example.com/home")
            .unwrap()
            .active_tab_id
            .unwrap();
        state
            .navigate_tab(&id, "https://example.com/home", "Home")
            .unwrap();
        if favorite {
            state.set_tab_favorite(&id, true).unwrap();
        } else {
            state.set_tab_pinned(&id, true).unwrap();
        }
        state
            .navigate_tab(&id, "https://example.com/away", "Away")
            .unwrap();
        let closed = serde_json::to_value(state.close_tab(&id).unwrap()).unwrap();
        let saved = closed["tabs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tab| tab["id"] == id);
        assert!(
            saved.is_some(),
            "closing a saved tab must retain its identity"
        );
        let saved = saved.unwrap();
        assert_eq!(saved["url"], "https://example.com/home");
        assert_eq!(saved["title"], "Home");
        assert_eq!(saved["suspended"], true);
        assert_eq!(saved["homeUrl"], "https://example.com/home");
        state.restore(&closed.to_string()).unwrap();
        let before = state.snapshot();
        assert!(
            state
                .navigate_tab(&id, "https://late.example", "Late")
                .is_err()
        );
        assert_eq!(state.snapshot(), before);
        let resumed = serde_json::to_value(state.activate_tab(&id).unwrap()).unwrap();
        assert_eq!(resumed["activeTabId"], id);
        assert_eq!(
            resumed["tabs"]
                .as_array()
                .unwrap()
                .iter()
                .find(|tab| tab["id"] == id)
                .unwrap()["suspended"],
            false
        );
    }
}

#[test]
fn global_favorite_activation_keeps_the_selected_space_and_remembers_it() {
    let mut state = BrowserState::default();
    let id = state
        .create_tab("workspace-1", "https://example.com")
        .unwrap()
        .active_tab_id
        .unwrap();
    state.set_tab_favorite(&id, true).unwrap();
    state.create_workspace("Other").unwrap();
    let selected = state.activate_tab(&id).unwrap();
    assert_eq!(selected.active_workspace_id, "workspace-2");
    assert_eq!(
        selected.workspaces[1].last_active_tab_id.as_deref(),
        Some(id.as_str())
    );
    state.activate_workspace("workspace-1").unwrap();
    let restored = state.activate_workspace("workspace-2").unwrap();
    assert_eq!(restored.active_tab_id.as_deref(), Some(id.as_str()));
    let closed = state.close_tab(&id).unwrap();
    assert_eq!(closed.active_workspace_id, "workspace-2");
    assert_ne!(closed.active_tab_id.as_deref(), Some(id.as_str()));
    state
        .restore(&serde_json::to_string(&closed).unwrap())
        .unwrap();
}

#[test]
fn pinning_a_global_favorite_moves_it_to_the_current_space_without_losing_home() {
    let mut state = BrowserState::default();
    let id = state
        .create_tab("workspace-1", "https://example.com/home")
        .unwrap()
        .active_tab_id
        .unwrap();
    state.set_tab_favorite(&id, true).unwrap();
    state
        .navigate_tab(&id, "https://example.com/away", "Away")
        .unwrap();
    state.create_workspace("Other").unwrap();
    state.activate_tab(&id).unwrap();
    let pinned = serde_json::to_value(state.set_tab_pinned(&id, true).unwrap()).unwrap();
    let tab = pinned["tabs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|tab| tab["id"] == id)
        .unwrap();
    assert_eq!(tab["favorite"], false);
    assert_eq!(tab["pinned"], true);
    assert_eq!(tab["workspaceId"], "workspace-2");
    assert_eq!(tab["homeUrl"], "https://example.com/home");
}

#[test]
fn legacy_saved_tabs_gain_home_metadata_and_only_legacy_pin_shortcuts_migrate() {
    let mut state = BrowserState::default();
    let mut legacy = serde_json::to_value(
        state
            .create_tab("workspace-1", "https://example.com")
            .unwrap(),
    )
    .unwrap();
    legacy.as_object_mut().unwrap().remove("keymapVersion");
    legacy["tabs"][0]["favorite"] = serde_json::json!(true);
    legacy["tabs"][0]["pinned"] = serde_json::json!(true);
    legacy["keyBindings"] = serde_json::json!([
        {"key":"d","meta":true,"ctrl":false,"alt":false,"shift":false,"command":"favorites.toggle"},
        {"key":"d","meta":false,"ctrl":true,"alt":false,"shift":false,"command":"custom.keep"},
        {"key":"d","meta":true,"ctrl":false,"alt":false,"shift":true,"command":"favorites.toggle"}
    ]);
    let restored = serde_json::to_value(state.restore(&legacy.to_string()).unwrap()).unwrap();
    assert_eq!(restored["tabs"][0]["homeUrl"], "https://example.com");
    assert_eq!(restored["tabs"][0]["favorite"], true);
    assert_eq!(restored["tabs"][0]["pinned"], false);
    assert_eq!(restored["keyBindings"][0]["command"], "pins.toggle");
    assert_eq!(restored["keyBindings"][1]["command"], "custom.keep");
    assert_eq!(restored["keyBindings"][2]["command"], "favorites.toggle");
    let defaults = BrowserState::default().snapshot();
    assert!(
        defaults
            .key_bindings
            .iter()
            .filter(|b| b.key == "d" && !b.shift)
            .all(|b| b.command == "pins.toggle")
    );
}

#[test]
fn an_explicit_custom_favorite_shortcut_survives_future_restores() {
    let mut state = BrowserState::default();
    state
        .set_keymap(vec![KeyBinding::command(
            "d",
            true,
            false,
            false,
            false,
            "favorites.toggle",
        )])
        .unwrap();
    let saved = serde_json::to_string(&state.snapshot()).unwrap();
    let restored = state.restore(&saved).unwrap();
    assert_eq!(restored.key_bindings[0].command, "favorites.toggle");
}

#[test]
fn removing_a_closed_pin_returns_an_ordinary_open_tab() {
    let mut state = BrowserState::default();
    let id = state
        .create_tab("workspace-1", "https://example.com")
        .unwrap()
        .active_tab_id
        .unwrap();
    state.set_tab_pinned(&id, true).unwrap();
    state.close_tab(&id).unwrap();
    let unpinned = state.set_tab_pinned(&id, false).unwrap();
    let tab = unpinned.tabs.iter().find(|tab| tab.id == id).unwrap();
    assert!(!tab.suspended);
    assert!(!tab.pinned);
    assert!(tab.home_url.is_empty());
    assert_eq!(tab.url, "https://example.com");
    state
        .restore(&serde_json::to_string(&unpinned).unwrap())
        .unwrap();
}

#[test]
fn moving_a_global_favorite_converts_it_to_a_pin_and_clears_other_space_memories() {
    let mut state = BrowserState::default();
    let id = state
        .create_tab("workspace-1", "https://example.com")
        .unwrap()
        .active_tab_id
        .unwrap();
    state.set_tab_favorite(&id, true).unwrap();
    state.create_workspace("Other").unwrap();
    state.activate_tab(&id).unwrap();
    state.create_workspace("Third").unwrap();
    state.activate_tab(&id).unwrap();
    let moved = state.set_tab_workspace(&id, "workspace-2").unwrap();
    assert_eq!(moved.active_workspace_id, "workspace-2");
    let tab = moved.tabs.iter().find(|tab| tab.id == id).unwrap();
    assert!(tab.pinned);
    assert!(!tab.favorite);
    assert_eq!(tab.home_url, "https://example.com");
    assert!(
        moved
            .workspaces
            .iter()
            .filter(|space| space.id != "workspace-2")
            .all(|space| space.last_active_tab_id.as_deref() != Some(id.as_str()))
    );
    state
        .restore(&serde_json::to_string(&moved).unwrap())
        .unwrap();
}

#[test]
fn closing_active_tab_falls_forward_then_backward() {
    let mut state = BrowserState::default();
    let workspace = state.snapshot().active_workspace_id.clone();
    let a = state
        .create_tab(&workspace, "https://a.example")
        .unwrap()
        .active_tab_id
        .unwrap();
    let b = state
        .create_tab(&workspace, "https://b.example")
        .unwrap()
        .active_tab_id
        .unwrap();

    state.activate_tab(&a).unwrap();
    let snapshot = state.close_tab(&a).unwrap();
    assert_eq!(snapshot.active_tab_id.as_deref(), Some(b.as_str()));
    assert_eq!(snapshot.tabs.len(), 1);

    // Closing the active space's last tab seeds a fresh blank tab in the
    // SAME commit — the window is never tabless.
    let snapshot = state.close_tab(&b).unwrap();
    let seeded = snapshot.active_tab_id.as_deref().unwrap();
    let tab = snapshot.tabs.iter().find(|tab| tab.id == seeded).unwrap();
    assert_eq!(tab.url, "about:blank");
    assert_eq!(tab.workspace_id, workspace);
    assert_eq!(snapshot.tabs.len(), 1);
}

#[test]
fn switching_spaces_reopens_the_last_used_tab() {
    let mut state = BrowserState::default();
    let workspace = state.snapshot().active_workspace_id.clone();
    let a = state
        .create_tab(&workspace, "https://a.example")
        .unwrap()
        .active_tab_id
        .unwrap();
    let b = state
        .create_tab(&workspace, "https://b.example")
        .unwrap()
        .active_tab_id
        .unwrap();
    state.activate_tab(&a).unwrap();
    let side = state.create_workspace("Side").unwrap();
    let side_workspace = side.active_workspace_id.clone();
    state.activate_workspace(&workspace).unwrap();
    state.activate_tab(&b).unwrap();

    state.activate_workspace(&side_workspace).unwrap();
    let back = state.activate_workspace(&workspace).unwrap();
    // The space reopens where the user left off: b (last used), not a.
    assert_eq!(back.active_tab_id.as_deref(), Some(b.as_str()));
}

#[test]
fn moving_the_active_tab_carries_the_active_space() {
    let mut state = BrowserState::default();
    let workspace = state.snapshot().active_workspace_id.clone();
    let a = state
        .create_tab(&workspace, "https://a.example")
        .unwrap()
        .active_tab_id
        .unwrap();
    let side = state.create_workspace("Side").unwrap();
    let side_workspace = side.active_workspace_id.clone();
    state.activate_workspace(&workspace).unwrap();

    let moved = state.set_tab_workspace(&a, &side_workspace).unwrap();
    assert_eq!(moved.active_workspace_id, side_workspace);
    assert_eq!(moved.active_tab_id.as_deref(), Some(a.as_str()));
    let tab = moved.tabs.iter().find(|tab| tab.id == a).unwrap();
    assert_eq!(tab.workspace_id, side_workspace);
}

#[test]
fn moving_an_inactive_tab_leaves_active_pointers_untouched() {
    let mut state = BrowserState::default();
    let workspace = state.snapshot().active_workspace_id.clone();
    let a = state
        .create_tab(&workspace, "https://a.example")
        .unwrap()
        .active_tab_id
        .unwrap();
    let b = state
        .create_tab(&workspace, "https://b.example")
        .unwrap()
        .active_tab_id
        .unwrap();
    let side = state.create_workspace("Side").unwrap();
    let side_workspace = side.active_workspace_id.clone();
    state.activate_workspace(&workspace).unwrap();

    let moved = state.set_tab_workspace(&a, &side_workspace).unwrap();
    assert_eq!(moved.active_workspace_id, workspace);
    assert_eq!(moved.active_tab_id.as_deref(), Some(b.as_str()));
}

#[test]
fn create_workspace_at_the_revision_boundary_is_atomic() {
    let mut state = BrowserState::default();
    let max_minus = u32::MAX - 1;
    let imported = format!(
        r#"{{"version":1,"revision":{max_minus},"workspaces":[{{"id":"workspace-1","name":"Default"}}],"tabs":[],"activeWorkspaceId":"workspace-1","activeTabId":null,"keyBindings":[]}}"#
    );
    state.restore(&imported).unwrap();
    let before = state.snapshot();

    // The workspace must not outlive its seed tab when the revision
    // overflows mid-create.
    assert!(state.create_workspace("Edge").is_err());
    assert_eq!(state.snapshot(), before);
}

#[test]
fn restore_rejects_a_dangling_space_last_active_pointer() {
    let mut state = BrowserState::default();
    let before = state.snapshot();
    let invalid = r#"{"version":1,"revision":9,"workspaces":[{"id":"workspace-1","name":"Default","lastActiveTabId":"tab-9"}],"tabs":[],"activeWorkspaceId":"workspace-1","activeTabId":null,"keyBindings":[]}"#;

    assert!(state.restore(invalid).is_err());
    assert_eq!(state.snapshot(), before);
}

#[test]
fn snapshots_from_before_space_last_active_restore_without_the_field() {
    let mut state = BrowserState::default();
    let imported = r#"{"version":1,"revision":5,"workspaces":[{"id":"workspace-1","name":"Default"}],"tabs":[{"id":"tab-1","workspaceId":"workspace-1","url":"https://example.com","title":""}],"activeWorkspaceId":"workspace-1","activeTabId":"tab-1","keyBindings":[]}"#;

    let restored = state.restore(imported).unwrap();
    assert_eq!(restored.workspaces[0].last_active_tab_id, None);
    assert_eq!(restored.active_tab_id.as_deref(), Some("tab-1"));
}

#[test]
fn entering_an_empty_space_opens_a_fresh_new_tab() {
    let mut state = BrowserState::default();
    let workspace = state.snapshot().active_workspace_id.clone();
    let a = state
        .create_tab(&workspace, "https://a.example")
        .unwrap()
        .active_tab_id
        .unwrap();

    // Creating a space activates it seeded with a new tab, never empty.
    let created = state.create_workspace("Side").unwrap();
    assert_eq!(created.active_workspace_id, "workspace-2");
    let seeded = created.active_tab_id.as_deref().unwrap();
    let tab = created.tabs.iter().find(|tab| tab.id == seeded).unwrap();
    assert_eq!(tab.workspace_id, "workspace-2");
    assert_eq!(tab.url, "about:blank");

    let back = state.activate_workspace(&workspace).unwrap();
    assert_eq!(back.active_tab_id.as_deref(), Some(a.as_str()));

    // A space whose tabs are all closed seeds again on re-entry.
    let seeded_id = seeded.to_string();
    state.close_tab(&seeded_id).unwrap();
    let reentered = state.activate_workspace("workspace-2").unwrap();
    let active = reentered.active_tab_id.unwrap();
    let tab = reentered.tabs.iter().find(|tab| tab.id == active).unwrap();
    assert_eq!(tab.workspace_id, "workspace-2");
    assert_eq!(tab.url, "about:blank");
}

#[test]
fn create_tab_rejects_unknown_workspace_without_mutating_state() {
    let mut state = BrowserState::default();
    let before = state.snapshot();
    assert!(
        state
            .create_tab("workspace-404", "https://example.com")
            .is_err()
    );
    assert_eq!(state.snapshot(), before);
}

#[test]
fn navigation_event_after_close_is_rejected_without_mutation() {
    let mut state = BrowserState::default();
    let workspace = state.snapshot().active_workspace_id.clone();
    let tab = state
        .create_tab(&workspace, "https://before.example")
        .unwrap()
        .active_tab_id
        .unwrap();
    state.close_tab(&tab).unwrap();
    let before = state.snapshot();

    assert!(
        state
            .navigate_tab(&tab, "https://late.example", "Late")
            .is_err()
    );
    assert_eq!(state.snapshot(), before);
}

#[test]
fn restore_rejects_dangling_tab_and_preserves_current_state() {
    let mut state = BrowserState::default();
    let before = state.snapshot();
    let invalid = r#"{"version":1,"revision":9,"workspaces":[{"id":"workspace-1","name":"Default"}],"tabs":[{"id":"tab-1","workspaceId":"missing","url":"https://example.com","title":""}],"activeWorkspaceId":"workspace-1","activeTabId":"tab-1","keyBindings":[]}"#;

    assert!(state.restore(invalid).is_err());
    assert_eq!(state.snapshot(), before);
}

#[test]
fn restore_round_trips_and_future_ids_do_not_collide() {
    let mut state = BrowserState::default();
    let workspace = state.snapshot().active_workspace_id.clone();
    state.create_tab(&workspace, "https://one.example").unwrap();
    let saved = serde_json::to_string(&state.snapshot()).unwrap();

    let restored = state.restore(&saved).unwrap();
    assert_eq!(restored.revision, 2);
    let next = state.create_tab(&workspace, "https://two.example").unwrap();
    assert_eq!(next.active_tab_id.as_deref(), Some("tab-2"));
}

#[test]
fn restore_increments_current_revision_instead_of_trusting_imported_revision() {
    let mut state = BrowserState::default();
    let workspace = state.snapshot().active_workspace_id.clone();
    state
        .create_tab(&workspace, "https://current.example")
        .unwrap();
    state
        .navigate_tab("tab-1", "https://current.example/updated", "Current")
        .unwrap();
    let imported = r#"{"version":1,"revision":0,"workspaces":[{"id":"workspace-1","name":"Default"}],"tabs":[],"activeWorkspaceId":"workspace-1","activeTabId":null,"keyBindings":[]}"#;

    let restored = state.restore(imported).unwrap();
    assert_eq!(restored.revision, 3);
}

#[test]
fn restore_preserves_a_newer_imported_revision_before_incrementing() {
    let mut state = BrowserState::default();
    let imported = r#"{"version":1,"revision":41,"workspaces":[{"id":"workspace-1","name":"Default"}],"tabs":[],"activeWorkspaceId":"workspace-1","activeTabId":null,"keyBindings":[]}"#;

    let restored = state.restore(imported).unwrap();
    assert_eq!(restored.revision, 42);
}

#[test]
fn restore_rejects_numeric_ids_that_cannot_have_a_successor() {
    let mut state = BrowserState::default();
    let max = u64::MAX;
    let imported = format!(
        r#"{{"version":1,"revision":0,"workspaces":[{{"id":"workspace-{max}","name":"Default"}}],"tabs":[{{"id":"tab-{max}","workspaceId":"workspace-{max}","url":"https://example.com","title":""}}],"activeWorkspaceId":"workspace-{max}","activeTabId":"tab-{max}","keyBindings":[]}}"#
    );
    let before = state.snapshot();

    assert!(state.restore(&imported).is_err());
    assert_eq!(state.snapshot(), before);
}

#[test]
fn keymap_rejects_duplicate_chords_atomically() {
    let mut state = BrowserState::default();
    let duplicate = vec![
        KeyBinding::command("t", true, false, false, false, "tab.new"),
        KeyBinding::command("T", true, false, false, false, "other.command"),
    ];
    let before = state.snapshot();

    assert!(state.set_keymap(duplicate).is_err());
    assert_eq!(state.snapshot(), before);
}

fn observed_legacy_default_keymap() -> Vec<KeyBinding> {
    serde_json::from_str(include_str!("fixtures/legacy-keymap.json")).unwrap()
}

#[test]
fn legacy_default_keymap_restores_current_shortcuts_from_the_observed_profile() {
    for version in [None, Some(1)] {
        let mut state = BrowserState::default();
        let snapshot = state
            .create_tab("workspace-1", "https://example.com/keep")
            .unwrap();
        let mut saved = serde_json::to_value(&snapshot).unwrap();
        saved["keyBindings"] = serde_json::to_value(observed_legacy_default_keymap()).unwrap();
        if let Some(version) = version {
            saved["keymapVersion"] = serde_json::json!(version);
        } else {
            saved.as_object_mut().unwrap().remove("keymapVersion");
        }
        let restored = state.restore(&saved.to_string()).unwrap();
        assert_eq!(
            restored.key_bindings,
            BrowserState::default().snapshot().key_bindings
        );
        assert!(
            restored
                .key_bindings
                .iter()
                .any(|binding| binding.key == "s"
                    && binding.ctrl
                    && !binding.meta
                    && binding.command == "sidebar.toggle")
        );
        assert_eq!(restored.tabs, snapshot.tabs);
        assert_eq!(restored.active_tab_id, snapshot.active_tab_id);
    }
}

#[test]
fn legacy_default_keymap_migration_preserves_custom_removed_added_and_empty_profiles() {
    let original = observed_legacy_default_keymap();
    let mut command = original.clone();
    command[0].command = "custom.keep".into();
    let mut changed_key = original.clone();
    changed_key[0].key = "T".into();
    let mut modifier = original.clone();
    modifier[0].alt = true;
    let mut removed = original.clone();
    removed.remove(0);
    let mut added = original.clone();
    added.push(KeyBinding::command(
        "F12",
        false,
        true,
        false,
        false,
        "custom.keep",
    ));
    let mut reordered = original.clone();
    reordered.reverse();
    for bindings in [
        command,
        changed_key,
        modifier,
        removed,
        added,
        reordered,
        original[..15].to_vec(),
        vec![],
    ] {
        let mut state = BrowserState::default();
        state.set_keymap(bindings.clone()).unwrap();
        let saved = serde_json::to_string(&state.snapshot()).unwrap();
        assert_eq!(state.restore(&saved).unwrap().key_bindings, bindings);
    }
}

#[test]
fn legacy_default_keymap_migration_is_idempotent_and_later_customization_stays_custom() {
    let mut state = BrowserState::default();
    let mut saved = serde_json::to_value(state.snapshot()).unwrap();
    saved["keyBindings"] = serde_json::to_value(observed_legacy_default_keymap()).unwrap();
    let migrated = state.restore(&saved.to_string()).unwrap();
    let again = state
        .restore(&serde_json::to_string(&migrated).unwrap())
        .unwrap();
    assert_eq!(again.key_bindings, migrated.key_bindings);
    let mut customized = again.key_bindings;
    customized.retain(|binding| !(binding.key == "s" && binding.ctrl));
    state.set_keymap(customized.clone()).unwrap();
    let saved = serde_json::to_string(&state.snapshot()).unwrap();
    assert_eq!(state.restore(&saved).unwrap().key_bindings, customized);
}

#[test]
fn defaults_cover_browser_commands_and_tab_slots() {
    let snapshot = BrowserState::default().snapshot();
    // 54 base chords + 4 Tab-cycling bindings (Cmd/Ctrl+Tab, +Shift twins).
    assert_eq!(snapshot.key_bindings.len(), 58);
    for command in [
        "tab.new",
        "tab.close",
        "location.focus",
        "commandPalette.open",
        "browser.back",
        "browser.forward",
    ] {
        assert!(
            snapshot
                .key_bindings
                .iter()
                .any(|binding| binding.command == command)
        );
    }
    for slot in 1..=9 {
        assert!(
            snapshot
                .key_bindings
                .iter()
                .any(|binding| binding.command == format!("tab.activate.{slot}"))
        );
    }
}

#[test]
fn defaults_ship_ctrl_twins_for_every_meta_binding() {
    let snapshot = BrowserState::default().snapshot();
    for binding in &snapshot.key_bindings {
        if !binding.meta {
            continue;
        }
        assert!(
            snapshot.key_bindings.iter().any(|candidate| {
                candidate.ctrl
                    && !candidate.meta
                    && candidate.key == binding.key
                    && candidate.command == binding.command
            }),
            "missing Ctrl twin for Meta+{} ({})",
            binding.key,
            binding.command
        );
    }
}

#[test]
fn package_invokes_the_serialized_browser_command_boundary() {
    let package = browser_package();
    let baseline = BrowserState::default().snapshot();
    let restored = package
        .invoke_json(
            "snapshotRestore",
            serde_json::json!({"json": serde_json::to_string(&baseline).unwrap()}),
        )
        .unwrap();
    assert_eq!(restored["revision"], 1);
    let bookmark = package
        .invoke_json(
            "bookmarkCreate",
            serde_json::json!({"title": "Rust", "url": "https://rust-lang.org", "folderId": ""}),
        )
        .unwrap();
    assert_eq!(bookmark["bookmarks"][3]["id"], "bookmark-4");
    let bookmark = package
        .invoke_json(
            "bookmarkUpdate",
            serde_json::json!({"bookmarkId": "bookmark-4", "title": "Rust Docs", "url": "https://doc.rust-lang.org"}),
        )
        .unwrap();
    assert_eq!(bookmark["bookmarks"][3]["title"], "Rust Docs");
    let bookmark = package
        .invoke_json(
            "bookmarkMove",
            serde_json::json!({"bookmarkId": "bookmark-4", "index": 0}),
        )
        .unwrap();
    assert_eq!(bookmark["bookmarks"][0]["id"], "bookmark-4");
    let bookmark = package
        .invoke_json(
            "bookmarkRemove",
            serde_json::json!({"bookmarkId": "bookmark-4"}),
        )
        .unwrap();
    assert_eq!(bookmark["bookmarks"].as_array().unwrap().len(), 3);

    let workspace = package
        .invoke_json("workspaceCreate", serde_json::json!({"name": "Research"}))
        .unwrap();
    assert_eq!(workspace["activeWorkspaceId"], "workspace-2");
    // An empty space opens on a seeded new tab instead of an empty canvas.
    assert_eq!(workspace["activeTabId"], "tab-1");
    let created = package
        .invoke_json(
            "tabCreate",
            serde_json::json!({"workspaceId": "workspace-2", "url": "https://example.com"}),
        )
        .unwrap();
    assert_eq!(created["activeTabId"], "tab-2");
    let navigated = package
        .invoke_json(
            "tabNavigated",
            serde_json::json!({"tabId": "tab-2", "url": "https://example.com/docs", "title": "Docs"}),
        )
        .unwrap();
    assert_eq!(navigated["tabs"][1]["title"], "Docs");
    package
        .invoke_json(
            "tabSetPinned",
            serde_json::json!({"tabId":"tab-2","pinned":true}),
        )
        .unwrap();
    package
        .invoke_json(
            "tabNavigated",
            serde_json::json!({"tabId":"tab-2","url":"https://example.com/away","title":"Away"}),
        )
        .unwrap();
    let reset = package
        .invoke_json("tabReset", serde_json::json!({"tabId":"tab-2"}))
        .unwrap();
    assert_eq!(reset["tabs"][1]["url"], "https://example.com/docs");
    assert_eq!(reset["tabs"][1]["title"], "Docs");
    assert_eq!(reset["activeTabId"], "tab-2");
    assert_eq!(reset["tabs"][1]["suspended"], false);
    package
        .invoke_json(
            "tabSetPinned",
            serde_json::json!({"tabId":"tab-2","pinned":false}),
        )
        .unwrap();
    let activated = package
        .invoke_json("tabActivate", serde_json::json!({"tabId": "tab-2"}))
        .unwrap();
    assert_eq!(activated["activeTabId"], "tab-2");
    let keymapped = package
        .invoke_json("keymapSet", serde_json::json!({"bindings": []}))
        .unwrap();
    assert_eq!(keymapped["keyBindings"], serde_json::json!([]));
    let closed = package
        .invoke_json("tabClose", serde_json::json!({"tabId": "tab-2"}))
        .unwrap();
    // The space keeps its seeded tab; the window is never tabless.
    assert_eq!(closed["activeTabId"], "tab-1");
    let snapshot = package
        .invoke_json("browserSnapshot", serde_json::json!({}))
        .unwrap();
    assert_eq!(snapshot, closed);
}

#[test]
fn bookmarks_can_be_created_edited_reordered_and_removed() {
    let mut state = BrowserState::default();
    let created = state
        .create_bookmark("Rust", "https://www.rust-lang.org", "")
        .unwrap();
    assert_eq!(created.bookmarks[3].id, "bookmark-4");

    let edited = state
        .update_bookmark("bookmark-4", "Rust Language", "https://rust-lang.org/learn")
        .unwrap();
    assert_eq!(edited.bookmarks[3].title, "Rust Language");
    let moved = state.move_bookmark("bookmark-4", 0).unwrap();
    assert_eq!(moved.bookmarks[0].id, "bookmark-4");
    let removed = state.remove_bookmark("bookmark-4").unwrap();
    assert_eq!(
        removed
            .bookmarks
            .iter()
            .map(|bookmark| bookmark.id.as_str())
            .collect::<Vec<_>>(),
        vec!["bookmark-1", "bookmark-2", "bookmark-3"]
    );
}

#[test]
fn old_snapshot_without_bookmarks_restores_defaults_and_advances_ids() {
    let mut state = BrowserState::default();
    let old = r#"{"version":1,"revision":7,"workspaces":[{"id":"workspace-1","name":"Default"}],"tabs":[],"activeWorkspaceId":"workspace-1","activeTabId":null,"keyBindings":[]}"#;

    let restored = state.restore(old).unwrap();
    assert_eq!(restored.bookmarks.len(), 3);
    let created = state
        .create_bookmark("New", "https://new.example", "")
        .unwrap();
    assert_eq!(created.bookmarks.last().unwrap().id, "bookmark-4");
}

#[test]
fn old_snapshot_without_bookmarks_seeds_its_first_space_when_default_is_absent() {
    let mut state = BrowserState::default();
    let old = r#"{"version":1,"revision":7,"workspaces":[{"id":"custom","name":"First"},{"id":"other","name":"Other"}],"tabs":[],"activeWorkspaceId":"other","activeTabId":null,"keyBindings":[]}"#;
    let restored = serde_json::to_value(state.restore(old).unwrap()).unwrap();
    assert_eq!(restored["bookmarks"].as_array().unwrap().len(), 3);
    assert!(
        restored["bookmarks"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["workspaceId"] == "custom")
    );
}

#[test]
fn invalid_bookmark_ids_and_reorder_bounds_are_atomic() {
    let mut state = BrowserState::default();
    let before = state.snapshot();

    assert!(
        state
            .update_bookmark("bookmark-404", "Missing", "https://example.com")
            .is_err()
    );
    assert_eq!(state.snapshot(), before);
    assert!(state.remove_bookmark("bookmark-404").is_err());
    assert_eq!(state.snapshot(), before);
    assert!(state.move_bookmark("bookmark-1", 3).is_err());
    assert_eq!(state.snapshot(), before);
}

#[test]
fn bookmark_fields_and_restored_ids_are_validated() {
    let mut state = BrowserState::default();
    let before = state.snapshot();
    assert!(
        state
            .create_bookmark(" ", "https://example.com", "")
            .is_err()
    );
    assert!(state.create_bookmark("Example", " ", "").is_err());
    assert_eq!(state.snapshot(), before);

    let mut duplicate = before.clone();
    duplicate.bookmarks[1].id = "bookmark-1".into();
    assert!(
        state
            .restore(&serde_json::to_string(&duplicate).unwrap())
            .is_err()
    );
    assert_eq!(state.snapshot(), before);
}

#[test]
fn created_spaces_take_palette_tints_while_default_stays_appearance_hued() {
    let mut state = BrowserState::default();
    let default = state.snapshot();
    assert_eq!(
        default
            .workspaces
            .iter()
            .find(|workspace| workspace.id == "workspace-1")
            .unwrap()
            .color,
        ""
    );

    let first = state
        .create_workspace("Work")
        .unwrap()
        .workspaces
        .iter()
        .find(|workspace| workspace.name == "Work")
        .unwrap()
        .color
        .clone();
    let second = state
        .create_workspace("Life")
        .unwrap()
        .workspaces
        .iter()
        .find(|workspace| workspace.name == "Life")
        .unwrap()
        .color
        .clone();
    assert_ne!(first, second);
    assert!(first.starts_with('#') && first.len() == 7);
    assert!(second.starts_with('#') && second.len() == 7);
}

#[test]
fn snapshots_from_before_space_colors_restore_without_the_field() {
    let mut state = BrowserState::default();
    let restored = state
        .restore(
            r#"{"version":1,"revision":1,
                "workspaces":[{"id":"workspace-1","name":"Default"}],
                "tabs":[],"bookmarks":[],
                "activeWorkspaceId":"workspace-1","activeTabId":null,
                "keyBindings":[]}"#,
        )
        .unwrap();
    assert_eq!(restored.workspaces[0].color, "");
}

#[test]
fn malformed_space_colors_are_rejected_on_restore() {
    let mut state = BrowserState::default();
    let error = state
        .restore(
            r#"{"version":1,"revision":1,
                "workspaces":[{"id":"workspace-1","name":"Default","color":"purple"}],
                "tabs":[],"bookmarks":[],
                "activeWorkspaceId":"workspace-1","activeTabId":null,
                "keyBindings":[]}"#,
        )
        .unwrap_err();
    assert!(error.to_string().contains("workspace color"));
}

#[test]
fn bookmark_folders_organize_and_clean_up() {
    let mut state = BrowserState::default();
    let snapshot = state.create_bookmark_folder("News").unwrap();
    let folder_id = snapshot.bookmark_folders[0].id.clone();

    let snapshot = state
        .create_bookmark("Site", "https://site.example", &folder_id)
        .unwrap();
    assert_eq!(snapshot.bookmarks.last().unwrap().folder_id, folder_id);
    assert_eq!(snapshot.bookmark_folders[0].title, "News");

    state.rename_bookmark_folder(&folder_id, "Daily").unwrap();
    assert_eq!(
        state.snapshot().bookmark_folders[0].title,
        "Daily",
        "rename is visible in the snapshot"
    );

    // Unknown folders are rejected for both moves and creations.
    assert!(
        state
            .set_bookmark_folder(&snapshot.bookmarks[0].id, "folder-99")
            .is_err()
    );
    assert!(
        state
            .create_bookmark("X", "https://x.example", "folder-99")
            .is_err()
    );
    assert!(state.create_bookmark_folder("   ").is_err());

    // Deleting a folder promotes its bookmarks to the root instead of
    // dropping them.
    let snapshot = state.remove_bookmark_folder(&folder_id).unwrap();
    assert!(snapshot.bookmark_folders.is_empty());
    assert_eq!(snapshot.bookmarks.last().unwrap().folder_id, "");
    assert_eq!(snapshot.bookmarks.last().unwrap().title, "Site");

    // An old snapshot without folders restores cleanly.
    let mut legacy = serde_json::to_value(state.snapshot()).unwrap();
    legacy.as_object_mut().unwrap().remove("bookmarkFolders");
    let legacy_json = serde_json::to_string(&legacy).unwrap();
    let restored = state.restore(&legacy_json).unwrap();
    assert!(restored.bookmark_folders.is_empty());
    assert_eq!(restored.bookmarks.len(), snapshot.bookmarks.len());
}

#[test]
fn sidebar_item_retains_one_tab_through_navigation_close_and_restore() {
    let mut state = BrowserState::default();
    let bookmark = state.snapshot().bookmarks[0].clone();
    let opened = state.open_bookmark(&bookmark.id, "").unwrap();
    let id = opened.active_tab_id.clone().unwrap();
    let tab = opened.tabs.iter().find(|tab| tab.id == id).unwrap();
    assert!(tab.pinned);
    assert_eq!(tab.bookmark_id, bookmark.id);
    assert_eq!(tab.home_url, bookmark.url);
    state
        .navigate_tab(&id, "https://redirect.example/away", "Away")
        .unwrap();
    let reopened = state.open_bookmark(&bookmark.id, "").unwrap();
    assert_eq!(reopened.active_tab_id.as_deref(), Some(id.as_str()));
    assert_eq!(reopened.tabs.len(), 1);
    assert_eq!(reopened.tabs[0].url, "https://redirect.example/away");
    let closed = state.close_tab(&id).unwrap();
    assert!(
        closed
            .tabs
            .iter()
            .find(|tab| tab.id == id)
            .unwrap()
            .suspended
    );
    let mut restored = BrowserState::default();
    restored
        .restore(&serde_json::to_string(&closed).unwrap())
        .unwrap();
    let resumed = restored.open_bookmark(&bookmark.id, "").unwrap();
    assert_eq!(resumed.tabs.len(), closed.tabs.len());
    assert_eq!(resumed.active_tab_id.as_deref(), Some(id.as_str()));
    let tab = resumed.tabs.iter().find(|tab| tab.id == id).unwrap();
    assert!(!tab.suspended);
    assert_eq!(tab.url, bookmark.url);
}

#[test]
fn sidebar_item_adopts_an_existing_tab_without_an_extra_commit_or_row() {
    let mut state = BrowserState::default();
    let bookmark = state.snapshot().bookmarks[0].clone();
    let before = state.create_tab("workspace-1", &bookmark.url).unwrap();
    let id = before.active_tab_id.clone().unwrap();
    let opened = state.open_bookmark(&bookmark.id, &id).unwrap();
    assert_eq!(opened.revision, before.revision + 1);
    assert_eq!(opened.tabs.len(), before.tabs.len());
    assert_eq!(opened.active_tab_id.as_deref(), Some(id.as_str()));
    assert!(opened.tabs[0].pinned);
    assert_eq!(opened.tabs[0].bookmark_id, bookmark.id);
    assert_eq!(
        state
            .open_bookmark(&bookmark.id, "missing")
            .unwrap()
            .active_tab_id
            .as_deref(),
        Some(id.as_str())
    );
}

#[test]
fn sidebar_item_sessions_are_space_owned_and_reject_dangling_restore() {
    let mut state = BrowserState::default();
    let bookmark = state.snapshot().bookmarks[0].clone();
    let first = state
        .open_bookmark(&bookmark.id, "")
        .unwrap()
        .active_tab_id
        .unwrap();
    state.create_workspace("Second").unwrap();
    let before_foreign_open = state.snapshot();
    assert!(state.open_bookmark(&bookmark.id, &first).is_err());
    assert_eq!(state.snapshot(), before_foreign_open);
    let local_bookmark = state
        .create_bookmark("Second", "https://second.example", "")
        .unwrap()
        .bookmarks
        .last()
        .unwrap()
        .id
        .clone();
    let second = state
        .open_bookmark(&local_bookmark, &first)
        .unwrap()
        .active_tab_id
        .unwrap();
    assert_ne!(first, second);
    let before = state.snapshot();
    let mut invalid = before.clone();
    invalid
        .tabs
        .iter_mut()
        .find(|tab| tab.id == second)
        .unwrap()
        .bookmark_id = "missing".into();
    assert!(
        state
            .restore(&serde_json::to_string(&invalid).unwrap())
            .is_err()
    );
    assert_eq!(state.snapshot(), before);
    let mut duplicate = before.clone();
    let source = duplicate
        .tabs
        .iter()
        .find(|tab| tab.id == second)
        .unwrap()
        .clone();
    duplicate.tabs.push(yeoyu_core::domain::Tab {
        id: "duplicate".into(),
        ..source
    });
    assert!(
        state
            .restore(&serde_json::to_string(&duplicate).unwrap())
            .is_err()
    );
    assert_eq!(state.snapshot(), before);
    // Explicit moves carry the original owner and preserve both live pages.
    let moved = state.set_tab_workspace(&first, "workspace-2").unwrap();
    assert_eq!(
        state
            .snapshot()
            .tabs
            .iter()
            .find(|tab| tab.id == first)
            .unwrap()
            .bookmark_id,
        bookmark.id
    );
    assert_eq!(moved.tabs.len(), before.tabs.len());
}

#[test]
fn editing_and_removing_sidebar_items_keeps_live_pages_and_does_not_revive_closed_ones() {
    let mut state = BrowserState::default();
    let bookmark = state.snapshot().bookmarks[0].clone();
    let first = state
        .open_bookmark(&bookmark.id, "")
        .unwrap()
        .active_tab_id
        .unwrap();
    state.close_tab(&first).unwrap();
    state
        .update_bookmark(&bookmark.id, "Renamed", "https://new.example/home")
        .unwrap();
    let closed = state
        .snapshot()
        .tabs
        .into_iter()
        .find(|tab| tab.id == first)
        .unwrap();
    assert_eq!(closed.url, "https://new.example/home");
    assert_eq!(closed.home_title, "Renamed");
    let other_bookmark = state
        .create_bookmark("Live", "https://live.example", "")
        .unwrap()
        .bookmarks
        .last()
        .unwrap()
        .id
        .clone();
    let live = state
        .open_bookmark(&other_bookmark, "")
        .unwrap()
        .active_tab_id
        .unwrap();
    let removed = state.remove_bookmark(&bookmark.id).unwrap();
    assert!(!removed.tabs.iter().any(|tab| tab.id == first));
    let removed = state.remove_bookmark(&other_bookmark).unwrap();
    let tab = removed.tabs.iter().find(|tab| tab.id == live).unwrap();
    assert!(!tab.pinned);
    assert!(tab.bookmark_id.is_empty());
    assert_eq!(removed.active_tab_id.as_deref(), Some(live.as_str()));
    assert!(state.open_bookmark(&bookmark.id, "").is_err());
}

#[test]
fn failed_sidebar_open_is_atomic_and_old_snapshots_need_no_owner_field() {
    let mut state = BrowserState::default();
    let bookmark = state.snapshot().bookmarks[0].id.clone();
    let mut value =
        serde_json::to_value(state.create_tab("workspace-1", "about:blank").unwrap()).unwrap();
    value["tabs"][0]
        .as_object_mut()
        .unwrap()
        .remove("bookmarkId");
    state.restore(&value.to_string()).unwrap();
    assert!(state.snapshot().tabs[0].bookmark_id.is_empty());
    value = serde_json::to_value(state.snapshot()).unwrap();
    value["revision"] = serde_json::json!(u32::MAX - 1);
    state.restore(&value.to_string()).unwrap();
    let before = state.snapshot();
    assert!(state.open_bookmark(&bookmark, "").is_err());
    assert_eq!(state.snapshot(), before);
}

#[test]
fn bookmarks_and_folders_belong_to_the_space_where_they_are_created() {
    let mut state = BrowserState::default();
    let fresh = serde_json::to_value(state.create_workspace("Second").unwrap()).unwrap();
    assert!(
        fresh["bookmarks"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["workspaceId"] == "workspace-1")
    );
    assert!(fresh["bookmarkFolders"].as_array().unwrap().is_empty());
    state.create_bookmark_folder("Research").unwrap();
    let created = serde_json::to_value(
        state
            .create_bookmark("Local", "https://local.example", "folder-1")
            .unwrap(),
    )
    .unwrap();
    assert_eq!(created["bookmarks"][3]["workspaceId"], "workspace-2");
    assert_eq!(created["bookmarkFolders"][0]["workspaceId"], "workspace-2");
    state.open_bookmark("bookmark-4", "").unwrap();
    let switched = state.activate_workspace("workspace-1").unwrap();
    assert!(state.open_bookmark("bookmark-4", "").is_err());
    assert_eq!(state.snapshot(), switched);
    state.open_bookmark("bookmark-1", "").unwrap();
}

#[test]
fn foreign_bookmark_and_folder_mutations_fail_atomically() {
    let mut state = BrowserState::default();
    state.create_bookmark_folder("First").unwrap();
    state.create_workspace("Second").unwrap();
    state.create_bookmark_folder("Second").unwrap();
    state
        .create_bookmark("Second", "https://second.example", "folder-2")
        .unwrap();
    let before = state.snapshot();
    assert!(state.open_bookmark("bookmark-1", "").is_err());
    assert_eq!(state.snapshot(), before);
    assert!(
        state
            .update_bookmark("bookmark-1", "Changed", "https://changed.example")
            .is_err()
    );
    assert_eq!(state.snapshot(), before);
    assert!(state.remove_bookmark("bookmark-1").is_err());
    assert_eq!(state.snapshot(), before);
    assert!(state.move_bookmark("bookmark-1", 0).is_err());
    assert_eq!(state.snapshot(), before);
    assert!(state.set_bookmark_folder("bookmark-1", "folder-2").is_err());
    assert_eq!(state.snapshot(), before);
    assert!(state.set_bookmark_folder("bookmark-4", "folder-1").is_err());
    assert_eq!(state.snapshot(), before);
    assert!(
        state
            .create_bookmark("Foreign folder", "https://foreign.example", "folder-1")
            .is_err()
    );
    assert_eq!(state.snapshot(), before);
    assert!(state.rename_bookmark_folder("folder-1", "Changed").is_err());
    assert_eq!(state.snapshot(), before);
    assert!(state.remove_bookmark_folder("folder-1").is_err());
    assert_eq!(state.snapshot(), before);
    assert_eq!(
        state
            .create_bookmark("Next", "https://next.example", "")
            .unwrap()
            .bookmarks
            .last()
            .unwrap()
            .id,
        "bookmark-5"
    );
}

#[test]
fn moving_a_bound_pin_transfers_its_bookmark_and_clears_the_source_folder() {
    let mut state = BrowserState::default();
    state.create_bookmark_folder("First").unwrap();
    state.set_bookmark_folder("bookmark-1", "folder-1").unwrap();
    let id = state
        .open_bookmark("bookmark-1", "")
        .unwrap()
        .active_tab_id
        .unwrap();
    let home = state.snapshot().tabs[0].home_url.clone();
    state
        .navigate_tab(&id, "https://away.example", "Away")
        .unwrap();
    state.create_workspace("Second").unwrap();
    let moved = serde_json::to_value(state.set_tab_workspace(&id, "workspace-2").unwrap()).unwrap();
    assert_eq!(moved["bookmarks"][0]["workspaceId"], "workspace-2");
    assert_eq!(moved["bookmarks"][0]["folderId"], "");
    assert_eq!(moved["bookmarkFolders"][0]["workspaceId"], "workspace-1");
    let tab = moved["tabs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|tab| tab["id"] == id)
        .unwrap();
    assert_eq!(tab["bookmarkId"], "bookmark-1");
    assert_eq!(tab["url"], "https://away.example");
    assert_eq!(tab["homeUrl"], home);
    assert_eq!(
        state
            .open_bookmark("bookmark-1", "")
            .unwrap()
            .active_tab_id
            .as_deref(),
        Some(id.as_str())
    );
    state.restore(&moved.to_string()).unwrap();
    let removed = state.remove_bookmark("bookmark-1").unwrap();
    let tab = removed.tabs.iter().find(|tab| tab.id == id).unwrap();
    assert!(!tab.pinned);
    assert!(tab.bookmark_id.is_empty());
    assert_eq!(tab.url, "https://away.example");
}

#[test]
fn a_bound_favorite_stays_global_and_transfers_ownership_when_demoted() {
    for demotion in ["pin", "ordinary", "move"] {
        let mut state = BrowserState::default();
        state.create_bookmark_folder("First").unwrap();
        state.set_bookmark_folder("bookmark-1", "folder-1").unwrap();
        let id = state
            .open_bookmark("bookmark-1", "")
            .unwrap()
            .active_tab_id
            .unwrap();
        let home = state.snapshot().tabs[0].home_url.clone();
        state.set_tab_favorite(&id, true).unwrap();
        state
            .navigate_tab(&id, "https://away.example", "Away")
            .unwrap();
        state.create_workspace("Second").unwrap();
        let activated = state.activate_tab(&id).unwrap();
        assert_eq!(activated.active_workspace_id, "workspace-2");
        let before = state.snapshot();
        assert!(state.open_bookmark("bookmark-1", "").is_err());
        assert_eq!(state.snapshot(), before);
        let changed = match demotion {
            "pin" => state.set_tab_pinned(&id, true).unwrap(),
            "ordinary" => state.set_tab_favorite(&id, false).unwrap(),
            _ => state.set_tab_workspace(&id, "workspace-2").unwrap(),
        };
        let changed = serde_json::to_value(changed).unwrap();
        assert_eq!(
            changed["bookmarks"][0]["workspaceId"], "workspace-2",
            "{demotion}"
        );
        assert_eq!(changed["bookmarks"][0]["folderId"], "", "{demotion}");
        let tab = changed["tabs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tab| tab["id"] == id)
            .unwrap();
        assert_eq!(tab["bookmarkId"], "bookmark-1");
        assert_eq!(tab["url"], "https://away.example");
        assert_eq!(tab["workspaceId"], "workspace-2");
        assert_eq!(tab["favorite"], false);
        if demotion != "ordinary" {
            assert_eq!(tab["homeUrl"], home);
        }
        state.restore(&changed.to_string()).unwrap();
    }
}

fn legacy_bookmark_library() -> serde_json::Value {
    let mut state = BrowserState::default();
    state.create_bookmark_folder("Research").unwrap();
    state.set_bookmark_folder("bookmark-1", "folder-1").unwrap();
    state.open_bookmark("bookmark-1", "").unwrap();
    state
        .navigate_tab("tab-1", "https://away.example", "Away")
        .unwrap();
    state.create_workspace("Second").unwrap();
    state.create_workspace("Untouched").unwrap();
    let mut legacy = serde_json::to_value(state.snapshot()).unwrap();
    for key in ["bookmarks", "bookmarkFolders"] {
        for item in legacy[key].as_array_mut().unwrap() {
            item.as_object_mut().unwrap().remove("workspaceId");
        }
    }
    let mut second = legacy["tabs"][0].clone();
    second["id"] = serde_json::json!("tab-100");
    second["workspaceId"] = serde_json::json!("workspace-2");
    legacy["tabs"].as_array_mut().unwrap().push(second);
    legacy
}

#[test]
fn legacy_bookmarks_migrate_only_to_bound_spaces_with_stable_folder_and_tab_ids() {
    let legacy = legacy_bookmark_library();
    let mut state = BrowserState::default();
    let restored = serde_json::to_value(state.restore(&legacy.to_string()).unwrap()).unwrap();
    assert_eq!(restored["activeWorkspaceId"], "workspace-3");
    assert_eq!(restored["bookmarks"].as_array().unwrap().len(), 4);
    assert_eq!(restored["bookmarkFolders"].as_array().unwrap().len(), 2);
    assert_eq!(restored["bookmarks"][0]["workspaceId"], "workspace-1");
    assert_eq!(restored["bookmarks"][1]["workspaceId"], "workspace-1");
    assert_eq!(restored["bookmarks"][2]["workspaceId"], "workspace-1");
    assert_eq!(restored["bookmarks"][3]["id"], "bookmark-4");
    assert_eq!(restored["bookmarks"][3]["workspaceId"], "workspace-2");
    assert_eq!(restored["bookmarks"][3]["folderId"], "folder-2");
    assert_eq!(restored["bookmarkFolders"][0]["workspaceId"], "workspace-1");
    assert_eq!(restored["bookmarkFolders"][1]["workspaceId"], "workspace-2");
    assert_eq!(restored["bookmarkFolders"][1]["title"], "Research");
    assert_eq!(restored["tabs"].as_array().unwrap().len(), 4);
    assert_eq!(restored["tabs"][0], legacy["tabs"][0]);
    assert_eq!(restored["tabs"][3]["id"], "tab-100");
    assert_eq!(restored["tabs"][3]["bookmarkId"], "bookmark-4");
    assert_eq!(restored["tabs"][3]["url"], "https://away.example");
    let mut again = serde_json::to_value(state.restore(&restored.to_string()).unwrap()).unwrap();
    again["revision"] = restored["revision"].clone();
    assert_eq!(again, restored);
    assert_eq!(
        state
            .create_bookmark("Next", "https://next.example", "")
            .unwrap()
            .bookmarks
            .last()
            .unwrap()
            .id,
        "bookmark-5"
    );
    assert_eq!(
        state
            .create_bookmark_folder("Next")
            .unwrap()
            .bookmark_folders
            .last()
            .unwrap()
            .id,
        "folder-3"
    );
}

#[test]
fn unbound_legacy_library_uses_default_or_first_space_regardless_of_active_space() {
    for keep_default in [true, false] {
        let mut legacy = legacy_bookmark_library();
        legacy["tabs"] = serde_json::json!([]);
        legacy["activeTabId"] = serde_json::Value::Null;
        for workspace in legacy["workspaces"].as_array_mut().unwrap() {
            workspace["lastActiveTabId"] = serde_json::Value::Null;
        }
        if !keep_default {
            legacy["workspaces"].as_array_mut().unwrap().remove(0);
        }
        let expected = if keep_default {
            "workspace-1"
        } else {
            "workspace-2"
        };
        let mut state = BrowserState::default();
        let restored = serde_json::to_value(state.restore(&legacy.to_string()).unwrap()).unwrap();
        assert_eq!(restored["bookmarks"].as_array().unwrap().len(), 3);
        assert!(
            restored["bookmarks"]
                .as_array()
                .unwrap()
                .iter()
                .all(|item| item["workspaceId"] == expected)
        );
        assert_eq!(restored["bookmarkFolders"][0]["workspaceId"], expected);
    }
}

#[test]
fn invalid_explicit_bookmark_scope_folder_or_tab_ownership_is_rejected_atomically() {
    let mut state = BrowserState::default();
    state.create_bookmark_folder("First").unwrap();
    state.set_bookmark_folder("bookmark-1", "folder-1").unwrap();
    let id = state
        .open_bookmark("bookmark-1", "")
        .unwrap()
        .active_tab_id
        .unwrap();
    state.create_workspace("Second").unwrap();
    let before = state.snapshot();
    let valid = serde_json::to_value(&before).unwrap();
    for (collection, workspace) in [
        ("bookmarks", "missing"),
        ("bookmarkFolders", "missing"),
        ("bookmarkFolders", "workspace-2"),
        ("bookmarks", "workspace-2"),
    ] {
        let mut invalid = valid.clone();
        invalid[collection][0]["workspaceId"] = serde_json::json!(workspace);
        assert!(
            state.restore(&invalid.to_string()).is_err(),
            "{collection} -> {workspace}"
        );
        assert_eq!(state.snapshot(), before);
    }
    let mut invalid = valid;
    invalid["tabs"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|tab| tab["id"] == id)
        .unwrap()["workspaceId"] = serde_json::json!("workspace-2");
    invalid["workspaces"][0]["lastActiveTabId"] = serde_json::Value::Null;
    assert!(state.restore(&invalid.to_string()).is_err());
    assert_eq!(state.snapshot(), before);
}

#[test]
fn private_tabs_stay_unsaved_and_cannot_become_favorites_or_pins() {
    let mut state = BrowserState::default();
    let id = state
        .create_private_tab("workspace-1", "https://example.com")
        .unwrap()
        .active_tab_id
        .unwrap()
        .clone();
    let tab = state
        .snapshot()
        .tabs
        .into_iter()
        .find(|tab| tab.id == id)
        .unwrap();
    assert!(tab.private, "the requested tab must be private");
    assert!(!tab.favorite && !tab.pinned && tab.bookmark_id.is_empty());
    assert!(state.set_tab_favorite(&id, true).is_err());
    assert!(state.set_tab_pinned(&id, true).is_err());
    // Ordinary creation is untouched by the private entry point.
    let ordinary = state.create_tab("workspace-1", "https://ordinary.example");
    assert!(!ordinary.unwrap().active_tab_id.is_none());
}

#[test]
fn restoring_a_snapshot_drops_private_tabs_and_their_active_pointers() {
    let mut state = BrowserState::default();
    let ordinary = state
        .create_tab("workspace-1", "https://example.com")
        .unwrap()
        .active_tab_id
        .unwrap();
    let private = state
        .create_private_tab("workspace-1", "https://private.example")
        .unwrap()
        .active_tab_id
        .unwrap();
    let saved = serde_json::to_string(&state.snapshot()).unwrap();
    let mut recovery = BrowserState::default();
    let restored = serde_json::to_value(recovery.restore(&saved).unwrap()).unwrap();
    let tabs = restored["tabs"].as_array().unwrap();
    assert!(
        tabs.iter().any(|tab| tab["id"] == ordinary.as_str()),
        "ordinary tabs survive"
    );
    assert!(
        tabs.iter().all(|tab| tab["id"] != private.as_str()),
        "private tabs never restore"
    );
    assert!(tabs.iter().all(|tab| tab["private"] != true));
    assert_ne!(
        restored["activeTabId"].as_str(),
        Some(private.as_str()),
        "the active pointer must not reference a dropped private tab"
    );
}

#[test]
fn bookmark_open_in_private_mode_creates_a_private_tab_without_reuse() {
    let mut state = BrowserState::default();
    let bookmark_id = state
        .create_bookmark("Example", "https://example.com", "")
        .unwrap()
        .bookmarks
        .last()
        .unwrap()
        .id
        .clone();
    let ordinary = state
        .create_tab("workspace-1", "https://example.com")
        .unwrap()
        .active_tab_id
        .unwrap();
    let snapshot = state.open_bookmark_in_private(&bookmark_id).unwrap();
    let active_id = snapshot.active_tab_id.clone().unwrap();
    assert_ne!(
        active_id, ordinary,
        "an ordinary live session is not reused"
    );
    let tab = snapshot
        .tabs
        .iter()
        .find(|tab| tab.id == active_id)
        .unwrap();
    assert!(tab.private);
    assert!(!tab.pinned && !tab.favorite && tab.bookmark_id.is_empty());
    assert_eq!(tab.url, "https://example.com");
    let untouched = snapshot.tabs.iter().find(|tab| tab.id == ordinary).unwrap();
    assert!(untouched.bookmark_id.is_empty());
}
