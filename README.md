[한국어](README.ko.md)

<p align="center">
  <img src="assets/brand/yeoyu-icon.png" width="112" alt="Yeoyu icon">
</p>

# Yeoyu (여유)

An experimental Android tablet browser built for spacious, keyboard-friendly browsing. Yeoyu combines a React Native interface, GeckoView rendering, and a Rust domain core behind generated JSI bindings.

[![Host verification](https://github.com/loopy-lim/yeoyu/actions/workflows/check.yml/badge.svg)](https://github.com/loopy-lim/yeoyu/actions/workflows/check.yml)
[![Android verification](https://github.com/loopy-lim/yeoyu/actions/workflows/android.yml/badge.svg)](https://github.com/loopy-lim/yeoyu/actions/workflows/android.yml)

![Yeoyu with an expanded sidebar](docs/images/expanded.png)

> [!WARNING]
> Yeoyu is a proof of concept, not a production-ready or security-audited browser. Check [GitHub Releases](https://github.com/loopy-lim/yeoyu/releases) for downloadable builds and their validation scope. Back up important browsing data before experimenting.

## What it explores

- **Spaces and saved navigation** — cross-Space Favorites, per-Space pinned tabs, folders, bookmarks, history, and quick open.
- **Tablet-first interaction** — an expandable sidebar, horizontal and vertical split views, touch drag and drop, mouse menus, and editable keyboard shortcuts.
- **Android web integration** — GeckoView sessions, site permissions, file pickers, downloads, external links, popups, media sessions, and Android picture-in-picture.
- **Local state ownership** — workspace, tab, bookmark, and keymap rules live in Rust; React Native owns presentation and orchestration.
- **Permissions and appearance** — device access preparation, remembered site choices, quiet autoplay defaults, Korean/English UI, and responsive settings.
- **Android windows and extensions** — separate windows, Mozilla-compatible extension discovery and installation, and background media controls.
- **Privacy experiments** — private tabs, tracking-protection settings, bounded import/export, and conservative tab-release rules.

<p>
  <img src="docs/images/collapsed.png" width="49%" alt="Yeoyu with a collapsed sidebar">
  <img src="docs/images/split.png" width="49%" alt="Yeoyu in a two-pane split view">
</p>

## Architecture at a glance

```text
React Native UI
      │
BrowserController and typed ports
      ├──────── Android native layer ─────── GeckoView sessions
      │
      └──────── generated JSI bridge ────── Rust domain core
                                              │
                                      validated snapshots
```

The browser engine and the durable browser model are intentionally separate. Android owns live `GeckoSession` objects, while Rust owns serializable identities and state transitions. See [Architecture](docs/architecture.md) for the boundaries and data flows.

## Requirements

- Android 8 / API 26 or newer; the UI currently targets landscape tablets
- Node.js 22 (`.node-version`) and Bun 1.4.1 (`.bun-version`)
- Rust 1.98 (`rust-toolchain.toml`) with the `aarch64-linux-android` target
- JDK 17 or newer, Android SDK 37.1, Build Tools 37.0.0, and NDK 27.1.12297006
- `cargo-ndk` 4.1.2 for Android builds

## Quick start

```sh
rustup target add aarch64-linux-android
cargo install cargo-ndk --version 4.1.2 --locked
./scripts/bootstrap.sh
./scripts/check.sh
./scripts/build-android.sh Debug
bun start
```

`bootstrap.sh` downloads the pinned [Rustra](https://github.com/loopy-lim/rustra) source into the ignored `.deps/` directory, installs dependencies, and verifies generated bindings. The default Android ABI is `arm64-v8a`.

For device installation, build profiles, environment variables, and the complete verification workflow, see [Development](docs/development.md).

## Project layout

| Path | Responsibility |
| --- | --- |
| `src/` | React Native browser chrome, controllers, policies, and UI state |
| `native/` | Rust workspace/tab/bookmark domain and snapshot validation |
| `android/` | GeckoView surfaces, session registry, Android integrations, and app shell |
| `modules/rustra-jsi/` | Generated Rust-to-React Native bridge runtime |
| `generated/` | Generated TypeScript contracts and codecs |
| `tests/` | Browser policy, UI, controller, and acceptance helpers |
| `docs/` | Public architecture, development, and project-status documentation |

## Verification

The main host gate runs Rust formatting/tests/Clippy, Bun tests, Python checks, layout geometry assertions, contrast checks, TypeScript, and generated-code consistency:

```sh
./scripts/check.sh
```

Android unit tests and a local signed test APK are exercised separately in CI. A successful build is not treated as device acceptance or a public release. Current proof boundaries and known gaps are listed in [Project status](docs/project-status.md).

## Documentation

- [Documentation index](docs/README.md)
- [Architecture](docs/architecture.md)
- [Development and verification](docs/development.md)
- [Project status and limitations](docs/project-status.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Project status

Yeoyu currently runs only as an Android proof of concept. The repository includes an iOS browser-surface interface, but no runnable iOS application. Sync, saved split groups, isolated account profiles, and automatic archiving are not implemented. Extension support targets compatible Mozilla add-ons; Chrome CRX and every Firefox API are not supported.

Yeoyu is inspired by spatial browser workflows, but it is not affiliated with or endorsed by The Browser Company, Arc, Mozilla, or Google. GeckoView and other third-party components remain subject to their respective licenses and trademarks.

## License

Yeoyu is licensed under the [Apache License 2.0](LICENSE).
