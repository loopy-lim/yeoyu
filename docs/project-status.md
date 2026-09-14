[한국어](project-status.ko.md)

# Project status

This document describes the current public source. It deliberately avoids promoting an old APK, device capture, or partial endurance run into current acceptance.

## Implemented

- Workspace/Space model with ordinary tabs, cross-Space Favorites, per-Space pinned tabs, folders, bookmarks, history, and editable shortcuts.
- Expanded and collapsed tablet chrome, quick open, command palette, context menus, and horizontal/vertical split views.
- GeckoView session registry with navigation, popup, permission, file, download, external-link, media, and Android PiP integration.
- Rust-owned revisioned snapshots with validation, corruption quarantine, ordered persistence, and import preparation/commit separation.
- Private tabs with private Gecko sessions, non-persistent history/permissions, local favicon placeholders, and explicit persistence warnings.
- Bookmark HTML and bounded work-archive import/export with preview, fresh IDs, and excluded credentials/private state.
- Site settings, tracking-protection controls, site-data removal, tab protection, and conservative memory-pressure policy.

## Reproducible repository gates

The public source provides:

- `./scripts/check.sh` for Rust, Bun, Python, contrast, TypeScript, and generated-code checks.
- Android JUnit coverage for native policies.
- CI assembly of a local test APK.
- Explicit build profiles that separate development, acceptance, and distribution signing.

These gates establish source and build behavior. They do not, by themselves, establish a safe daily-driver browser, public-release signing, store distribution, or universal website compatibility.

## Current limitations

- Android landscape tablets are the only runnable target; the iOS directory exposes an interface but no application.
- There is no public APK release or supported automatic update channel.
- Sync, extensions, saved split groups, isolated account profiles, and automatic tab archiving are not implemented.
- The mini player and Android PiP move the full browser surface/session; they do not extract a service-independent video overlay.
- Automatic memory release stays conservative when the app cannot prove that page state is safely restorable. No general memory-saving claim is made.
- Passkeys, autofill, OAuth, DRM media, accessibility, downloads under process death, and provider-specific behavior require dedicated device/account validation.
- Engine upgrades require fresh compilation, session restoration, permission, media, surface, and device checks.

## Evidence policy

Public documentation records stable behavior and reproducible commands. Raw device XML, browsing history, local paths, device identifiers, signing information, and session-specific logs are intentionally excluded. When reporting a change, keep these levels separate:

1. Source review
2. Unit and integration tests
3. APK assembly
4. Emulator or physical-device behavior
5. Long-duration acceptance
6. Signed public distribution

A pass at one level is not evidence for a later level.

## Near-term roadmap

- Establish a repeatable public release/signing process before distributing APKs.
- Add trustworthy safe-restoration signals before making tab release more aggressive.
- Expand accessibility and real-provider acceptance with isolated test accounts.
- Measure input readiness, frame timing, memory, and energy on matched devices.
- Re-run compatibility and durability gates whenever GeckoView changes.
