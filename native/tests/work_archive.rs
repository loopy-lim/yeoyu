use serde_json::{Value, json};
use yeoyu_core::domain::BrowserState;

fn archive() -> Value {
    json!({"format":"yeoyu-work","version":1,"spaces":[{"name":"Default","color":"#abcdef","folders":[{"title":"한글 폴더"}],"bookmarks":[{"title":"문서","url":"https://example.com","folderIndex":0}],"tabs":[
        {"url":"https://example.com/deep","title":"현재","favorite":false,"pinned":true,"homeUrl":"https://example.com","homeTitle":"문서","bookmarkIndex":0},
        {"url":"https://favorite.test","title":"즐겨찾기","favorite":true,"pinned":false,"homeUrl":"https://favorite.test","homeTitle":"즐겨찾기","bookmarkIndex":null},
        {"url":"about:blank","title":"새 탭","favorite":false,"pinned":false,"homeUrl":"","homeTitle":"","bookmarkIndex":null}
    ]}],"keyBindings":[{"key":"k","meta":true,"ctrl":false,"alt":false,"shift":false,"command":"palette"}],"presentation":"{\"theme\":\"dark\"}"})
}
#[test]
fn prepare_is_repeatable_and_commit_preserves_existing_private_state() {
    let mut state = BrowserState::default();
    state
        .open_external("delivery-1", "https://existing.test")
        .unwrap();
    state
        .create_private_tab("workspace-1", "https://private.test")
        .unwrap();
    let before = state.snapshot();
    let json = archive().to_string();
    let prepared = state.work_archive_prepare(&json, true, true).unwrap();
    assert_eq!(state.snapshot(), before);
    assert_eq!(
        prepared,
        state.work_archive_prepare(&json, true, true).unwrap()
    );
    let imported = state
        .work_archive_import(&json, true, true, before.revision)
        .unwrap();
    assert_eq!(imported, prepared);
    assert_eq!(imported.active_tab_id, before.active_tab_id);
    assert_eq!(imported.active_workspace_id, before.active_workspace_id);
    assert_eq!(
        imported.last_external_request_id,
        before.last_external_request_id
    );
    assert_eq!(&imported.tabs[..before.tabs.len()], &before.tabs);
    assert_eq!(
        imported.workspaces.last().unwrap().name,
        "Default (Imported)"
    );
    let tab = &imported.tabs[before.tabs.len()];
    assert!(tab.suspended && tab.pinned);
    assert_eq!(tab.url, "https://example.com");
    let bookmark = imported
        .bookmarks
        .iter()
        .find(|b| b.id == tab.bookmark_id)
        .unwrap();
    assert_eq!(bookmark.title, "문서");
    assert_eq!(
        bookmark.folder_id,
        imported.bookmark_folders.last().unwrap().id
    );
    assert!(!imported.tabs.last().unwrap().suspended);
    assert_eq!(imported.key_bindings[0].command, "palette");
    let again = state
        .work_archive_import(&json, false, false, imported.revision)
        .unwrap();
    assert_eq!(
        again.workspaces.last().unwrap().name,
        "Default (Imported 2)"
    );
    assert_eq!(again.tabs.len(), imported.tabs.len() + 2);
    let ids: std::collections::HashSet<_> = again.tabs.iter().map(|t| &t.id).collect();
    assert_eq!(ids.len(), again.tabs.len());
}
#[test]
fn export_is_portable_and_includes_suspended_destinations_only() {
    let mut state = BrowserState::default();
    let opened = state.open_bookmark("bookmark-1", "").unwrap();
    let id = opened.active_tab_id.unwrap();
    state
        .navigate_tab(&id, "https://session-only.test", "live")
        .unwrap();
    state.close_tab(&id).unwrap();
    state
        .create_private_tab("workspace-1", "https://secret.test")
        .unwrap();
    let exported = state.work_archive_export(None).unwrap();
    assert!(!exported.contains("secret.test"));
    assert!(!exported.contains("session-only.test"));
    assert!(!exported.contains("workspace-1"));
    assert!(!exported.contains("bookmark-1"));
    let value: Value = serde_json::from_str(&exported).unwrap();
    assert!(value["presentation"].is_null());
    assert_eq!(value["spaces"][0]["tabs"].as_array().unwrap().len(), 2);
    assert_eq!(
        value["spaces"][0]["tabs"][0]["url"],
        "https://news.ycombinator.com"
    );
    assert!(state.work_archive_prepare(&exported, true, false).is_ok());
}
#[test]
fn preview_counts_duplicates_and_optional_data() {
    let mut state = BrowserState::default();
    state
        .create_tab("workspace-1", "https://example.com")
        .unwrap();
    let mut a = archive();
    a["spaces"][0]["tabs"][0]["url"] = json!("https://example.com");
    let preview = state.work_archive_preview(&a.to_string()).unwrap();
    assert_eq!(
        (
            preview.spaces,
            preview.tabs,
            preview.bookmarks,
            preview.folders,
            preview.favorites,
            preview.duplicate_urls
        ),
        (1, 3, 1, 1, 1, 2)
    );
    assert!(preview.has_key_bindings);
    assert_eq!(preview.presentation, Some("{\"theme\":\"dark\"}".into()));
    let before = state.snapshot();
    let candidate = state
        .work_archive_prepare(&a.to_string(), false, false)
        .unwrap();
    assert_eq!(candidate.key_bindings, before.key_bindings);
    assert_eq!(candidate.tabs.len(), before.tabs.len() + 2);
}
#[test]
fn corruption_limits_and_conflicts_are_atomic_and_do_not_consume_ids() {
    let mut state = BrowserState::default();
    let before = state.snapshot();
    let valid = archive().to_string();
    let expected = state.work_archive_prepare(&valid, true, true).unwrap();
    let mut cases = Vec::new();
    for (pointer, value) in [
        ("/version", json!(2)),
        ("/format", json!("snapshot")),
        ("/spaces/0/color", json!("red")),
        ("/spaces/0/name", json!("x".repeat(257))),
        ("/spaces/0/tabs/0/title", json!("x".repeat(4097))),
        ("/spaces/0/tabs/0/url", json!("file:///secret")),
        ("/spaces/0/tabs/0/homeUrl", json!("javascript:alert(1)")),
        ("/spaces/0/tabs/0/bookmarkIndex", json!(100)),
        ("/spaces/0/bookmarks/0/folderIndex", json!(-1)),
        ("/spaces/0/tabs/0/favorite", json!(true)),
        ("/keyBindings/0/key", json!("")),
        ("/presentation", json!("not json")),
    ] {
        let mut a = archive();
        *a.pointer_mut(pointer).unwrap() = value;
        cases.push(a.to_string());
    }
    let mut many = archive();
    many["spaces"] = json!(vec![many["spaces"][0].clone(); 257]);
    cases.push(many.to_string());
    let mut many = archive();
    many["spaces"][0]["folders"] = json!(vec![json!({"title":"folder"}); 10_001]);
    cases.push(many.to_string());
    let mut duplicate = archive();
    duplicate["keyBindings"] = json!(vec![duplicate["keyBindings"][0].clone(); 2]);
    cases.push(duplicate.to_string());
    cases.push(" ".repeat(8 * 1024 * 1024 + 1));
    cases.push("{".into());
    for bad in cases {
        assert!(state.work_archive_preview(&bad).is_err());
        assert!(
            state
                .work_archive_import(&bad, true, true, before.revision)
                .is_err()
        );
        assert_eq!(state.snapshot(), before);
    }
    assert_eq!(
        expected,
        state.work_archive_prepare(&valid, true, true).unwrap()
    );
    state.create_tab("workspace-1", "about:blank").unwrap();
    let changed = state.snapshot();
    assert!(
        state
            .work_archive_import(&valid, true, true, before.revision)
            .is_err()
    );
    assert_eq!(state.snapshot(), changed);
}
#[test]
fn unknown_fields_are_discarded_and_missing_presentation_is_null() {
    let mut a = archive();
    a.as_object_mut().unwrap().remove("presentation");
    a["history"] = json!(["secret"]);
    a["spaces"][0]["tabs"][2]["private"] = json!(true);
    a["spaces"][0]["tabs"][2]["id"] = json!("attacker-id");
    let state = BrowserState::default();
    assert!(
        state
            .work_archive_preview(&a.to_string())
            .unwrap()
            .presentation
            .is_none()
    );
    let imported = state
        .work_archive_prepare(&a.to_string(), true, false)
        .unwrap();
    assert!(!imported.tabs.last().unwrap().private);
    assert_ne!(imported.tabs.last().unwrap().id, "attacker-id");
}

#[test]
fn demoted_bookmark_session_keeps_its_association_in_the_archive() {
    let mut state = BrowserState::default();
    let opened = state.open_bookmark("bookmark-1", "").unwrap();
    state
        .set_tab_pinned(&opened.active_tab_id.unwrap(), false)
        .unwrap();
    let json = state.work_archive_export(None).unwrap();
    let candidate = state.work_archive_prepare(&json, true, false).unwrap();
    let imported = candidate.tabs.last().unwrap();
    assert!(!imported.pinned && !imported.suspended);
    assert!(!imported.bookmark_id.is_empty());
}

#[test]
fn preview_duplicates_use_the_saved_destination_that_will_be_imported() {
    let state = BrowserState::default();
    let preview = state.work_archive_preview(&archive().to_string()).unwrap();
    // Saved tab's transient /deep URL becomes its home URL on import, matching its bookmark.
    assert_eq!(preview.duplicate_urls, 1);
}

#[test]
fn collision_suffixes_keep_utf8_names_within_the_portable_byte_limit() {
    let mut state = BrowserState::default();
    let name = format!("{}a", "한".repeat(85));
    assert_eq!(name.len(), 256);
    state.create_workspace(&name).unwrap();
    let mut a = archive();
    a["spaces"][0]["name"] = json!(name);
    for _ in 0..3 {
        let revision = state.snapshot().revision;
        let imported = state
            .work_archive_import(&a.to_string(), true, false, revision)
            .unwrap();
        let imported_name = &imported.workspaces.last().unwrap().name;
        assert!(imported_name.len() <= 256);
        assert!(imported_name.contains(" (Imported"));
        assert!(state.work_archive_export(None).is_ok());
    }
}

#[test]
fn portable_url_parser_rejects_invalid_authorities_atomically() {
    let mut state = BrowserState::default();
    let before = state.snapshot();
    for address in [
        "https://:",
        "https://@",
        "https://example.com:invalid",
        "https://example.com:65536",
        "https://[::1",
        "https://user@example.com",
        "https://user:pass@example.com",
        "https://:pass@example.com",
        "https://example.com/\u{0085}x",
        "https://example.com/\u{2003}x",
    ] {
        for pointer in [
            "/spaces/0/tabs/0/url",
            "/spaces/0/tabs/0/homeUrl",
            "/spaces/0/bookmarks/0/url",
        ] {
            let mut a = archive();
            *a.pointer_mut(pointer).unwrap() = json!(address);
            assert!(
                state.work_archive_preview(&a.to_string()).is_err(),
                "{address}"
            );
            assert!(
                state
                    .work_archive_import(&a.to_string(), true, false, before.revision)
                    .is_err(),
                "{address}"
            );
            assert_eq!(state.snapshot(), before);
        }
    }
}
#[test]
fn portable_url_parser_preserves_supported_addresses_in_roundtrip() {
    for address in [
        "HTTPS://example.com/",
        "https://한글.example/경로",
        "http://[::1]:8080/a",
        "https://example.com:443/a",
    ] {
        let mut state = BrowserState::default();
        let mut a = archive();
        a["spaces"][0]["bookmarks"][0]["url"] = json!(address);
        a["spaces"][0]["tabs"][0]["url"] = json!(address);
        a["spaces"][0]["tabs"][0]["homeUrl"] = json!(address);
        assert!(
            state.work_archive_preview(&a.to_string()).is_ok(),
            "{address}"
        );
        let revision = state.snapshot().revision;
        state
            .work_archive_import(&a.to_string(), true, false, revision)
            .unwrap();
        let exported = state.work_archive_export(None).unwrap();
        assert!(exported.contains(address));
        assert!(state.work_archive_preview(&exported).is_ok());
    }
}
