[한국어](architecture.ko.md)

# Architecture

## Design goal

Yeoyu keeps the durable browser model independent from the web engine and UI framework. This makes workspace rules testable without Android, while Android remains responsible for engine objects that cannot be serialized or moved into Rust.

## Runtime boundaries

| Layer | Owns | Does not own |
| --- | --- | --- |
| React Native (`src/`) | Browser chrome, overlays, user intent, controller orchestration, visible split layout | Durable domain rules or live Gecko engine objects |
| Browser controller | Typed storage/native ports, command ordering, save retries, reconciliation | UI rendering or Rust state-transition rules |
| Rust (`native/`) | Workspace, tab, bookmark, folder and keymap identities; validation; revisions; import preparation | Android views, `GeckoSession`, network or disk APIs |
| Generated JSI (`generated/`, `modules/rustra-jsi/`) | Typed transport between TypeScript and Rust | Product policy |
| Android (`android/`) | `GeckoSession` registry, browser surfaces, system intents, permissions, files, downloads and media integration | Durable workspace semantics |

## State flow

1. A UI action is translated into a typed browser command.
2. The controller sends domain mutations through generated JSI and engine commands through Android ports.
3. Rust validates the transition and returns a revisioned snapshot.
4. The controller persists the snapshot through its storage port.
5. Android reconciles visible panes and live Gecko sessions with stable tab IDs.

Persistence is ordered and retried. Corrupt snapshots are rejected and quarantined; the controller does not publish a durable import until its prepared state has been saved. Live engine state and serializable domain state are therefore related, but never treated as the same object.

## Browser sessions and views

Each tab has a stable Rust-owned ID. Android maps that ID to a live `GeckoSession`, and a session can move among the main pane, a split pane, and a small media surface without creating a new tab. Detaching a view does not automatically destroy the session.

Split layout is presentational React state. Saved split groups are not part of the durable model. A tab can be protected from release when it is visible, private, playing media, recording, uploading, showing a dialog, handling a permission, or otherwise unsafe to restore.

## Privacy boundary

Private tabs use Gecko private sessions and a separate in-memory collection. They are excluded from normal snapshots and history. Private permissions are one-time; persistent site settings are unavailable from a private page. Explicit actions such as saving a download or bookmark can still create durable data and must be explained in the UI.

Work-archive export intentionally omits private tabs, cookies, credentials, permission grants, history, opaque Gecko state, and device-local IDs. Import is bounded, validated, previewed, and appended using fresh IDs.

## Generated code

Rustra is pinned by commit and bootstrapped into the ignored `.deps/rustra-main` directory. `rustra.json` is the source configuration for generated contracts. Files under `generated/` and generated bridge outputs should not be edited by hand.

```sh
bun run codegen
bun run codegen --check
```

## UI quality gates

Theme roles, spacing, motion, and contrast live in `src/theme.ts`, `src/themeGates.ts`, and `src/chrome/motion.ts`. `scripts/contrast-check.ts`, TypeScript tests, and geometry checks enforce the machine-verifiable subset. Device screenshots can demonstrate a particular build, but they are not a substitute for current source checks.

## Test seams

- Rust domain tests cover validation, identity, migration, archive, and state-transition rules.
- Bun tests cover controllers, browser policies, UI models, hooks, and generated contracts.
- Python checks cover layout and acceptance helpers.
- Android JUnit tests cover native session, storage, permission, media, and activity policies.
- Physical-device acceptance remains a separate gate because unit tests and APK assembly do not prove engine/provider/device behavior.
