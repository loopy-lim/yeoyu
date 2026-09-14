use yeoyu_core::domain::BrowserState;

#[test]
fn external_link_replay_after_restore_does_not_open_a_second_tab() {
    let mut browser = BrowserState::default();
    let first = browser
        .open_external("request-one", "https://example.com/a")
        .unwrap();
    let mut restarted = BrowserState::default();
    restarted
        .restore(&serde_json::to_string(&first).unwrap())
        .unwrap();
    let before = restarted.snapshot();
    let replay = restarted
        .open_external("request-one", "https://example.com/a")
        .unwrap();
    assert_eq!(replay, before);
    assert_eq!(replay.tabs.len(), 1);
    let second = restarted
        .open_external("request-two", "https://example.com/a")
        .unwrap();
    assert_eq!(second.tabs.len(), 2);
}

#[test]
fn failed_external_link_does_not_consume_the_request() {
    let mut browser = BrowserState::default();
    let before = browser.snapshot();
    assert!(
        browser
            .open_external("request-one", "javascript:alert(1)")
            .is_err()
    );
    assert_eq!(browser.snapshot(), before);
    let valid = browser
        .open_external("request-one", "https://example.com/a")
        .unwrap();
    assert_eq!(valid.tabs.len(), 1);
}

#[test]
fn closing_a_delivered_tab_does_not_reopen_it_on_acknowledgement_retry() {
    let mut browser = BrowserState::default();
    let first = browser
        .open_external("request-one", "https://example.com/a")
        .unwrap();
    browser
        .close_tab(first.active_tab_id.as_ref().unwrap())
        .unwrap();
    let before = browser.snapshot();
    assert_eq!(
        browser
            .open_external("request-one", "https://example.com/a")
            .unwrap(),
        before
    );
}
