[한국어](arc-gap-analysis.ko.md)

---
date: 2026-10-11
compared_at: 2026-10-11
arc_status: maintenance mode — no new feature development since 2024-10, weekly Chromium security patches only; the only Arc on Android is Arc Search
yeoyu_source: docs/project-status.md
arc_census: docs/research/2026-10-11-version-upgrade-arc-gap.md §6
status: complete
---

# Arc gap analysis

This document compares Yeoyu against Arc's frozen feature set as of 2026-10-11. Arc is in maintenance mode: new feature development stopped in October 2024, was confirmed officially in May 2025, and releases since then carry weekly Chromium security patches only (for example v1.168.0 on 2026-10-08). Android has no desktop-class Arc; the only Arc on Android is Arc Search, a search-first mobile browser without sidebar or Spaces.

Because Arc's feature list no longer moves, this is not a catch-up exercise. Arc is read here as a catalog of already-verified ideas, and the matrix below proposes which of them fit Yeoyu — a tablet-first, keyboard-friendly Android browser that owns its local state on a Rust domain core. A row in this document is a suggestion, not a commitment.

Evidence rule: every gap row carries a Yeoyu-side source (a file path, or a section of [project-status.md](project-status.md)). Judgments that could not be settled against source are not counted as gaps; they sit in [Unverified, not gaps](#4-unverified-not-gaps).

## 1. How to read the matrix

- **Yeoyu status** — `Yes` (implemented), `Partial` (exists with a different shape or scope), `No` (not implemented).
- **Suggested priority** — a proposal weighed against the Yeoyu philosophy (tablet-first, keyboard-friendly, local-state ownership, Rust domain core). `high` mostly wires an idea into a structure Yeoyu already has; `medium` fits the philosophy and needs real new work; `low` is plausible but marginal; `backlog` conflicts with the philosophy or needs infrastructure Yeoyu deliberately does not run.

## 2. Gap matrix

### 2.1 Tab management

| Arc feature | Yeoyu status | Evidence | Suggested priority |
|---|---|---|---|
| Auto Archive (12h–30d, non-optional) | No | "Current limitations" in [project-status.md](project-status.md): automatic tab archiving not implemented. src/App.tsx keeps a closed-tab stack only for manual `tab.reopen`. | Medium — the [project-status.md](project-status.md) roadmap already sequences more aggressive tab release behind trustworthy safe-restoration signals; time-based archiving belongs after those signals |
| Archive browsing and restore | Partial | Closed-tab stack with `tab.reopen` in src/App.tsx; no archive list surface | Low |
| Tab Previews (hover summaries of Gmail/GitHub/Notion) | No | No preview or page-summary code in src/; "summary" matches only extension permission text in src/browserExtensions.ts | Low |
| Rename tab | No | src/BrowserController.ts exposes `bookmarkFolderRename` only; there is no tab-title editing command | Medium |
| Multi-select tabs | No | No multi-select or selection-mode code anywhere in src/ | Medium — bulk close/move matches direct tablet manipulation |
| Live Folders (auto-collected GitHub PRs) | No | Folders are static bookmark folders (src/BrowserController.ts); no external data source in src/ | Backlog — needs background network polling the local-state core does not model |
| Live Calendars (event countdown, join) | No | No calendar code in src/ | Backlog |
| Air Traffic Control (URL rules route into Spaces) | No | No URL-rule routing in src/; Space switching is manual (`space.manage` in src/App.tsx) | Backlog |

### 2.2 Window and multitasking

| Arc feature | Yeoyu status | Evidence | Suggested priority |
|---|---|---|---|
| Split View with up to 4 tabs and presets | Partial | Two panes, horizontal/vertical, ratio clamped to 0.25–0.75 (src/splitLayout.ts; `browser.split` commands in src/App.tsx) | Low — two panes match tablet geometry; the four-pane case is unproven |
| Saved split groups (a split persists as one reusable tab) | No | "Current limitations" in [project-status.md](project-status.md): saved split groups not implemented; src/splitLayout.ts holds runtime geometry only | High — the split model already exists; persistence is a natural extension of the Rust-owned revisioned snapshot |
| Little Arc (lightweight window for external links) | Partial | Android separate windows and share input receive external links ([project-status.md](project-status.md) "Implemented"); ExternalLinkPolicy.kt governs custom-scheme exits | Medium |
| Service-independent video PiP (extracted overlay) | No | PiP integration exists but moves the whole browser surface/session (src/hooks/usePictureInPicture.ts; "Current limitations" in [project-status.md](project-status.md)) | Medium |
| Sidebar audio/video controls | Partial | Background media controls exist ([project-status.md](project-status.md) "Implemented"; BrowserMedia.kt, BrowserVideoRegions.kt); no per-tab control surface | Low |

### 2.3 Address bar and commands

| Arc feature | Yeoyu status | Evidence | Suggested priority |
|---|---|---|---|
| Site Search (keyword + Tab searches one site) | No | src/suggestions.ts fixes three engines (google, naver, duckduckgo) with no keyword-to-site mapping | High — a pure keyboard flow with a small surface in the existing suggestion pipeline |
| Instant Links (open the top web result directly) | No | src/suggestions.ts suggests only local favorites, history, bookmarks, and open tabs | Backlog — needs a web ranking service Yeoyu does not run |
| Per-profile search engine and custom engine URLs | Partial | Global engine selection over the three fixed engines (src/suggestions.ts; settings in src/App.tsx) | Low — folds into Site Search |

### 2.4 AI

No Arc Max feature exists in Yeoyu. The whole category is proposed as backlog: on-device processing would be the only variant consistent with local-state ownership, and no such component exists in the source. Feature-by-feature rows, all `No`, all `Backlog`:

| Arc feature | Yeoyu status | Evidence | Suggested priority |
|---|---|---|---|
| Arc Max 5-second previews | No | No page-summary code in src/ | Backlog |
| Tidy Tab / Download Titles (generated names) | No | Titles come from the page or user entry; no generation code in src/ | Backlog |
| Tidy Tabs (AI organization) | No | No such command in the src/App.tsx command registry | Backlog |
| ChatGPT in the command bar | No | No external AI call in src/ | Backlog |
| Browse for Me / Pinch to Summarize (Arc Search) | No | No such code in src/ | Backlog |

### 2.5 Profiles and sync

| Arc feature | Yeoyu status | Evidence | Suggested priority |
|---|---|---|---|
| Arc Sync (E2EE, account-based) | No | "Current limitations" in [project-status.md](project-status.md): Sync not implemented; no network sync code in src/ | High — extend the existing bounded work archive (src/workArchive.ts) instead: per-Space export/import with preview, fresh IDs, and credential exclusion is already the local backup path, and device-to-device transfer through that file needs no account service |
| Isolated account profiles (separate logins, cookies, extensions) | No | "Current limitations" in [project-status.md](project-status.md); the only isolation is private tabs, which are stripped from the persisted snapshot (src/privateTabs.ts) | Medium |
| Full browser-data import (cookies, passwords, history) | Partial | Bookmark HTML import and bounded work-archive import/export with preview exist (src/workArchive.ts; [project-status.md](project-status.md) "Implemented") | Low |

### 2.6 Media and library

| Arc feature | Yeoyu status | Evidence | Suggested priority |
|---|---|---|---|
| Unified Library (media, downloads, archives in one place) | Partial | Separate history panel (`history.open` in src/App.tsx) and download history (src/downloadHistory.ts, DownloadHistory.kt); no unified surface | Low |
| Mini Player / floating audio-video player | Partial | The mini player moves the full browser surface ([project-status.md](project-status.md) "Current limitations") — the same limit as service-independent PiP in §2.2 | Medium — same work item as that row |

### 2.7 Extensions and developer

| Arc feature | Yeoyu status | Evidence | Suggested priority |
|---|---|---|---|
| Developer Mode / remote DevTools | No | No devtools or remote-debugging code in src/ or android/app/src/main/java/dev/browser/ | Low |
| Group Policy / managed deployment | No | No managed-policy code in src/ or the Kotlin tree | Backlog — out of scope for a personal tablet browser |

### 2.8 Security and privacy

| Arc feature | Yeoyu status | Evidence | Suggested priority |
|---|---|---|---|
| Secure DNS setting | No | No secure-DNS or DoH code in src/ or GeckoSessionRegistry.kt; GeckoView-side capability would need checking before any work | Low |
| Built-in password management | No | No credential storage in src/; password text appears only as extension-search placeholder copy (src/i18n.ts), and archives exclude credentials by design (src/workArchive.ts) | Low — autofill itself is separately unverified (§4) |
| Automatic page translation | No | Translation matches in src/ are UI i18n only (src/i18n.ts) | Medium — reading pages outside the app's two UI languages is a normal tablet case |

### 2.9 Capture and extras

| Arc feature | Yeoyu status | Evidence | Suggested priority |
|---|---|---|---|
| Full-page capture and share | No | `platform.captureRendering` (invoked in src/App.tsx) is an internal focus-transition snapshot, not a user-facing capture | Medium |
| Boosts (per-domain color, font, Zap, CSS/JS) | No | No user CSS/JS injection in src/; theming is app-level (src/theme.ts) | Backlog — app-level themes and per-window/Space colors already cover the visible need; page rewriting would sit outside the current rendering policy |
| Easel (whiteboard canvas) | No | No such code in src/ | Backlog |
| Home-screen widget (Arc Search) | No | No AppWidget receiver in android/app/src/main/AndroidManifest.xml (MAIN/VIEW/SEND intent actions only) | Backlog |

## 3. Confirmed gaps

Five gaps are confirmed twice — Arc has the feature and [project-status.md](project-status.md) "Current limitations" names it as not implemented:

1. Sync
2. Automatic tab archiving
3. Saved split groups
4. Isolated account profiles
5. Service-independent video PiP

Two further rows were flagged for checking and are settled by source review as `No`: **rename tab** (src/BrowserController.ts carries bookmark-folder rename only) and **multi-select tabs** (no selection-mode code in src/).

## 4. Unverified, not gaps

These are not counted as gaps, because the open question is whether Yeoyu's current behavior works — not whether a feature exists. [project-status.md](project-status.md) "Current limitations" lists them as requiring dedicated device/account validation:

- Passkeys
- Autofill
- OAuth flows
- DRM media
- TalkBack speech/gesture acceptance
- Downloads under process death
- Provider-specific behavior

Per the evidence policy in [project-status.md](project-status.md), a gap claim on any of these would need device acceptance evidence first.

## 5. Shared non-gaps

Features neither browser has, listed so they are not mistaken for Yeoyu gaps:

- **PWA install** — Arc does not support PWA; Yeoyu has no install path either (no install-prompt or service-worker registration code in src/; the only serviceWorker matches are extension-compat copy in src/i18n.ts).
- **Reading list** — Arc has none (folders plus Auto Archive substitute); Yeoyu has no reading-list model in the workspace/space snapshot either.
- **Built-in 2FA** — neither browser ships its own authenticator.

## 6. Yeoyu-specific strengths

Where Yeoyu is not behind Arc, including places Arc cannot follow:

- **Android-native integration** — separate windows, share input, background media controls, download recovery, live-runtime web notifications, PiP ([project-status.md](project-status.md) "Implemented"). Arc on Android is Arc Search only.
- **Extensions on Android** — Mozilla-compatible search/install, toolbar actions, permission review and revocation (src/browserExtensions.ts; [project-status.md](project-status.md)). Arc's mobile browsers have no extension system.
- **Korean/English UI as a first-class concern** (src/i18n.ts).
- **Rust-owned revisioned snapshots** — validation, corruption quarantine, ordered persistence, import prepare/commit separation ([project-status.md](project-status.md); [architecture.md](architecture.md), "State flow"). This is the substrate any saved split group, archive, or sync extension would build on.
- **Keyboard-first chrome** — editable shortcuts with a validated keymap (src/keyboardEditor.ts, src/keyboardProfiles.ts), command palette, quick open.
- **Local-state ownership without an account** — bounded export that excludes credentials and private state (src/workArchive.ts). Arc sync requires an account.
- **Snapshot-level private-tab isolation** (src/privateTabs.ts) — private tabs never reach disk.

---

Sources: Arc feature census and development status — docs/research/2026-10-11-version-upgrade-arc-gap.md §6 (arc.net, official help articles, release notes, 2025-05 letter to Arc members); Yeoyu implementation status — [project-status.md](project-status.md); architecture — [architecture.md](architecture.md).
