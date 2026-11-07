[Korean](arc-gap-analysis.ko.md)

---
date: 2026-10-11
compared_at: 2026-10-11
updated_at: 2026-11-06
arc_status: maintenance mode — new feature development stopped 2024-10; weekly Chromium security patches only. Android only has Arc Search
yeoyu_source: docs/project-status.md
arc_census: docs/research/2026-10-11-version-upgrade-arc-gap.md §6
status: complete
---

# Arc feature gap analysis

This document compares Yeoyu against Arc's frozen feature list. Every row was re-adjudicated against the source on 2026-11-06 (six independent research sections, two cross-validated — zero verdict disagreements). Arc is in maintenance mode: new feature development stopped in October 2024 and was officially confirmed in May 2025; releases since then carry only weekly Chromium security patches. There is no desktop-class Arc for Android — only Arc Search, a search-first mobile browser without a sidebar or Spaces.

Because Arc's feature list no longer moves, this document is not a catch-up list. Read it as a catalog of proven ideas, and adopt only what fits Yeoyu: tablet-first, keyboard-friendly, local state ownership on a Rust domain core. Rows here are proposals, not promises.

Evidence rule: every gap row carries Yeoyu-side evidence (a file path or a [project-status.md](project-status.md) section). Items that cannot be judged from source are not counted as gaps and live under [Verified-required, not gaps](#4-verified-required-not-gaps). Items whose only evidence is a documented-but-unused API (for example in the GeckoView AAR) carry a `documented-only` note.

## 1. Reading the matrix

- **Yeoyu state** — `yes` (implemented), `partial` (exists in another shape or scope), `no` (not implemented).
- **Suggested priority** — calibrated to Yeoyu's philosophy (tablet-first, keyboard-friendly, local state ownership, Rust domain core). `high` mostly wires into existing structure, `medium` fits the philosophy but needs real work, `low` is possible with little effect, `backlog` conflicts with the philosophy or requires infrastructure Yeoyu deliberately does not run.

## 2. Gap matrix

### 2.1 Tab management

| Arc feature | Yeoyu state | Evidence | Suggested priority |
|---|---|---|---|
| Auto Archive (12h–30d, cannot be disabled) | no | No time-based trigger code. `Tab.updated_at` exists (native/src/domain.rs, "drives the Today/Earlier split (12h archive)" comment) but no consumer anywhere in src·android. [project-status.md](project-status.md) roadmap gates it behind a safe-restoration signal | Medium — after that signal; the domain field is ready |
| Archive browsing & restore | partial | Closed tabs live in a memory-only stack capped at 12 plus `tab.reopen` for the latest one (src/App.tsx closedTabs, src/BrowserController.ts reopen). No archive list UI or persistence | Low |
| Tab rename | yes | `Tab.custom_title` (native/src/domain.rs — kept across same-site (same-origin) navigation, released on leaving the site), `tab_rename` command (native/src/lib.rs register!), context-menu "Rename tab" → edit dialog (src/components/Dialogs.tsx onRename, src/App.tsx renameTab), display prefers customTitle in `tabLabel` | — |
| Tab multi-select | partial | Menu "Select tabs" entry → row check toggles → bottom toolbar with batch close and move-to-Space (src/App.tsx selectionMode, src/sidebarModel.ts batchCloseTargets·batchMoveTargets). Missing: batch pin/favorite, batch move to folder | — |
| Tab Previews (Gmail/GitHub/Notion summaries) | no | No preview or page-summary code in src/. "summary" matches are extension permission strings (src/browserExtensions.ts) | Backlog — no on-device summarization component |
| Live Folders (GitHub PR collection) | no | Folders are static bookmark folders (native/src/domain.rs). No polling or external data sources | Backlog — background network polling is outside the local-state core |
| Live Calendars (countdowns + join) | no | "calendar" matches only prompt date math (PromptValues.kt) | Backlog |
| Air Traffic Control (URL rules route to Spaces) | no | No URL rule routing. Space switching is fully manual (sidebar pill row, bottom chips, SpaceSwitcherDialog). Wiring point: uiPreferences rule storage (siteSearches sanitize precedent) + rule check on tab creation — medium difficulty | Backlog |

### 2.2 Windows & multitasking

| Arc feature | Yeoyu state | Evidence | Suggested priority |
|---|---|---|---|
| Up to 4-tab split + presets | partial | 2 panes, horizontal·vertical, ratio clamp 0.25–0.75 (src/splitLayout.ts). 4-pane needs a destructive change: the pair model is fixed across 7 layers (model, gates, renderer, motion, divider, persistence, drop judgment). Two-pane ratio/orientation "presets" are effectively served by saved split groups | Low |
| Saved split groups (a split kept as one reusable tab) | partial | `SplitGroup` (native/src/domain.rs, URL-based, 20 per Workspace), `split_group_save/remove` (native/src/lib.rs), save·list·restore·remove·**rename** UI (src/App.tsx pendingSplitSave·openSplitGroup·openSplitGroupRename). Groups survive restart (Rust snapshot). Missing: replacing a group's tabs, moving between Spaces, list previews | — |
| Little Arc (lightweight external-link window) | partial | External links open as ordinary tabs in the active Space (ExternalLinkPolicy.kt, PendingExternalLinks.kt → controller.openExternal). A light-window host exists (BrowserWindow.kt "chrome-light host for exactly one tab") but only the manual window.new path uses it. Missing: auto-opening external links in a light window, session separation, auto-close | Medium |
| Independent service video PiP (extracted overlay) | no | PiP re-parents the whole GeckoView into ExternalPictureInPictureActivity (transfer) with a video-region crop (VideoPipViewport.kt). A true independent overlay needs session duplication — hard | Medium |
| Sidebar audio/video controls | partial | The sidebar shows a playing icon only (src/App.tsx, no handler). The only control surface is the shade notification (BrowserMedia.kt, single-tab binding). Wiring point exists (GeckoSessionRegistry mediaSetPlayback) — easy-to-medium once wired | Low |

### 2.3 Address bar & commands

| Arc feature | Yeoyu state | Evidence | Suggested priority |
|---|---|---|---|
| Site Search (keyword + Tab searches a specific site) | partial | The `keyword terms` (space)+Enter flow, settings UI, and sanitize are implemented: `resolveSiteSearch` (src/suggestions.ts), `SiteSearchEntry`+`sanitizeSiteSearches` (src/uiPreferences.ts), settings (src/components/SiteSearchSettings.tsx). Missing: **Tab-key mode entry** (bare Tab currently passes through RemapEngine.kt — needs a TAB entry in its Kotlin InputKey map), a keyword-prefix hint row, and a mode exit path | Medium — Tab entry needs IME interplay on-device (easy-to-medium) |
| Instant Links (open top web result) | no | suggestions cover only the 4 local sources (src/suggestions.ts) | Backlog — requires a web ranking service Yeoyu does not run |
| Per-profile search engines & custom engine URLs | partial | Fixed global choice among 3 engines (src/suggestions.ts SEARCH_ENGINES, src/App.tsx radio). Missing: per-Space engines (Rust snapshot extension — medium), custom default engine URL (uiPreferences extension — easy) | Low |
| Command bar (⌘T) unified input | partial | ⌘T opens the quick-open dialog, which unifies command search, open-tab switching, site search, suggestions, URL submission, and favorite tiles (src/components/AddressBox.tsx, src/commandRegistry.ts). Missing: typing a Space name to switch directly (SpaceSwitcherDialog has no text filter — src/components/Dialogs.tsx), Instant Links | Low |

### 2.4 AI

None of the Arc Max features exist in Yeoyu. Propose the whole category as backlog. The only philosophy-consistent form is on-device processing, and no component is reachable through a general-purpose JS API (GeckoView's internal ML resources are gecko-only). All rows are `no`, all `Backlog`:

| Arc feature | Yeoyu state | Evidence | Suggested priority |
|---|---|---|---|
| Arc Max 5-second previews / Tidy Tab·Download Titles / Tidy Tabs / ChatGPT in command bar / Browse for Me·Pinch to Summarize | no | Zero external AI calls or summary generation across src+native. App-level external fetches are the favicon fetcher (src/App.tsx) and the extension catalog (BrowserExtensionCatalog.kt, pinned to addons.mozilla.org) | Backlog |

### 2.5 Profiles & sync

| Arc feature | Yeoyu state | Evidence | Suggested priority |
|---|---|---|---|
| Arc Sync (E2EE, account-based) | no | No network sync or account code (Rust has no HTTP client dependency at all — native/Cargo.toml). The file-based starting point, the bounded work archive (src/workArchive.ts, native/src/archive.rs), lacks device identity, two-way merge, delete propagation, and deltas; import always appends with fresh IDs (archive.rs). The revision guard (prepare/commit) is reusable. Narrowed to file-based 1:1 it is medium; an account service stays Backlog | High (file-based) / Backlog (account-based) |
| Separate account profiles (logins·cookies·extensions isolated) | no | The only isolation is private tabs (src/privateTabs.ts — stripped from snapshots). GeckoView 157 has no multi-profile API; per-session `contextId` (storage separation) exists `documented-only` and is unused. Multiple GeckoRuntime instances are unsupported | Backlog |
| Full browser data import | partial | Covers spaces·folders·bookmarks·non-private tabs·keymap·presentation (native/src/archive.rs, src/workArchive.ts, BrowserDataPanel.tsx), plus Netscape bookmark HTML import/export. Excluded by design: cookies·passwords·history·favicons (warning copy states it). Extending to "full data" needs session history and site settings transfer — hard | Low |

### 2.6 Media & library

| Arc feature | Yeoyu state | Evidence | Suggested priority |
|---|---|---|---|
| Unified Library (media·downloads·archive together) | partial | History (sidebar menu/command palette → HistoryDialog), downloads·archive (settings data category) live in separate surfaces. All data APIs exist — a single surface is an easy rearrangement | Low |
| Mini Player (floating playback) | partial | System PiP moves the surface (src/hooks/usePictureInPicture.ts "never mounts a second player", BrowserPictureInPicture.kt). An unwired scaffold for an in-app floating tile exists (src/policy.ts miniPlayerTabs, src/chrome/appStyles.ts minis — zero TSX consumers). Needs a session-display policy review — hard | Medium |

### 2.7 Extensions & developer

| Arc feature | Yeoyu state | Evidence | Suggested priority |
|---|---|---|---|
| Developer Mode / remote DevTools | no | No devtools code in the app tree. **The GeckoView 157 API exists `documented-only`** — `GeckoRuntimeSettings.setRemoteDebuggingEnabled` in the AAR classes plus the GeckoViewRemoteDebugger module in omni.ja. Wiring point: `applyRuntimeSettings` (GeckoSessionRegistry.kt) — easy-to-medium. Real sessions need device acceptance | Low |
| Group Policy / managed deployment | no | No managed policy or device-admin declarations (AndroidManifest.xml) | Backlog — outside a personal tablet browser's scope |

### 2.8 Security & privacy

| Arc feature | Yeoyu state | Evidence | Suggested priority |
|---|---|---|---|
| Secure DNS setting | yes | `secureDnsMode` (auto/off/custom) + `secureDnsUri` (https-validated) in BrowserToolsConfig.kt, applied via TRR typed setters in `applyRuntimeSettings` (GeckoSessionRegistry.kt), settings UI in the privacy section (src/components/BrowserToolsPanel.tsx). Applied at runtime creation (instant re-apply is a follow-up). Compiled against GV157's TRR setters and `TRR_MODE_*` constants | — |
| Built-in password manager | no | Zero credential storage; the archive excludes credentials by design (src/workArchive.ts). GeckoView ships login infrastructure `documented-only` (Autocomplete$LoginEntry·loginAutofillEnabled·PromptController LoginSaveHandler) — unused. Hard | Low |
| Automatic page translation | no | "translat" matches in src·Kotlin are UI i18n and coordinate moves. **GeckoView 157 has a complete API `documented-only`** — `SessionTranslation.translate/restoreOriginalPage`, language-detection delegate, model management (RuntimeTranslation), and GV's default pref `browser.translations.enable=true`. The bridge·state·UI are new work (medium). The on-device engine fits local ownership; first model download and Korean pairs need device verification | Medium |

### 2.9 Capture & extras

| Arc feature | Yeoyu state | Evidence | Suggested priority |
|---|---|---|---|
| Full-page capture & share | partial | **PDF capture and share are implemented**: `GeckoSession.saveAsPdf()` → file → FileProvider URI → ACTION_SEND share sheet (GeckoSessionRegistry.capturePagePdf, BrowserModule.capturePagePdf/sharePagePdf, src/platform.ts, command `browser.captureShare` + sidebar menu). Missing: image capture and gallery saving; GV has no scroll-stitch API (no fullPage-family entries across the AAR). The pre-existing `platform.captureRendering` is a transition-only viewport snapshot (GeckoSessionRegistry captureForTransition), never user-facing | Low |
| Boosts (per-domain colors·fonts·Zap·CSS/JS) | partial | **A CSS-only site boost has shipped since 2026-09-22** (the initial version of this document wrongly said no): `SiteBoost` (src/uiPreferences.ts), native injection (GeckoSessionRegistry setBoosts/injectBoost — a yeoyu-boost style tag), UI (src/components/Dialogs.tsx BoostsDialog). Missing: color·font presets, Zap, JS injection (needs a rendering policy review) | Backlog |
| Easel (whiteboard) | no | No matches in src·android | Backlog |
| Home screen widget (Arc Search) | no | No AppWidget receiver in AndroidManifest | Backlog |

### 2.10 Sidebar & tab interaction differences (outside the feature matrix)

Current differences against Arc's sidebar interactions, confirmed during re-adjudication:

| Arc interaction | Yeoyu state | Evidence |
|---|---|---|
| Date-grouped tabs (Today/Yesterday) | no | sidebarPresentation has no date grouping (src/sidebarPresentation.ts); zero consumers of `updated_at` |
| Drag a tab into a folder | no | Drop targets are favorites·pinned·ordinary·split only (src/dragLifecycle.ts, src/sidebarModel.ts sidebarDropChange); folders are reachable via context menu only |
| Drag a tab into a Space | no | Space moves go through the tab menu and the multi-select toolbar (src/components/Dialogs.tsx onMoveToWorkspace) |
| Space rename·delete·reorder | no | Rust has only workspace_create/activate (native/src/domain.rs) — no rename or delete commands. Creation is auto-named "Space N". SpaceSwitcherDialog switches and creates only (src/components/Dialogs.tsx) |
| Space switching UX | yes | Four entries: header pill row (tap = switch, long-press = manage), bottom chip rail, dialog, command |
| Tab reorder & role-change drag | yes | ordinary·pinned reorder, favorite↔pin↔ordinary role changes, split-window drops (src/sidebarModel.ts, src/dragLifecycle.ts) |

## 3. Confirmed gaps

Features Arc has while [project-status.md](project-status.md) "current limits" states non-implementation — as of 2026-11-06, four:

1. Sync
2. Automatic tab archive
3. Separate account profile
4. Independent service video PiP

(Saved split groups were removed from this list — implemented in 2026-11; project-status updated alongside.)

## 4. Verified-required, not gaps

These are not counted as gaps. The open question is whether Yeoyu's current behavior works, not whether the feature exists. [project-status.md](project-status.md) "current limits" requires dedicated device/account validation:

- **Passkey** — the bridge is already active: `CredentialActivityCoordinator.kt` forwards FIDO2 OS-provider intents via `GeckoRuntime.ActivityDelegate.onStartActivityForResult`, and MainActivity receives the results. Only device acceptance remains.
- **Autofill** — the app sets no delegate (platform default). GeckoView ships AndroidAutofillDelegate `documented-only`. On-device suggestion behavior unverified.
- **OAuth** — no blocking flags. Custom-scheme loopback behavior unverified. FedCM (IdentityCredential) prompts are not handled by the custom PromptDelegate — behavior unverified.
- **DRM media** — an explicit auto-deny state is source-confirmed: `PERMISSION_MEDIA_KEY_SYSTEM_ACCESS` is absent from the contentPermissionKind mapping, so requests emit an event and immediately VALUE_DENY (GeckoSessionRegistry.kt). GV's pref `media.eme.require-app-approval=true` also applies. Enablement path: add the kind mapping + a prompt UI — medium. Whether to enable it is a separate decision.
- TalkBack voice·gesture acceptance
- Downloads across process death
- Per-provider behavior

Per the evidence policy in [project-status.md](project-status.md), calling any of these a gap first requires device acceptance evidence.

## 5. Shared non-gaps

Features neither side has, noted to avoid miscounting Yeoyu gaps:

- **PWA install** — Arc does not support PWAs and Yeoyu has no install path.
- **Reading list** — absent from Arc (replaced by folders + Auto Archive); Yeoyu also has no reading-list model.
- **Built-in 2FA** — no browser ships its own authenticator.

## 6. Yeoyu's own strengths

Where Yeoyu is not behind Arc, including places Arc cannot follow:

- **Native Android integration** — separate windows, share intake, background media control, download recovery, web notifications while running, PiP ([project-status.md](project-status.md) "implemented scope"). The only Arc on Android is Arc Search.
- **Extensions on Android** — Mozilla-compatible search·install, toolbar behavior, permission review·withdrawal (src/browserExtensions.ts). Arc's mobile browser has no extension system.
- **Korean·English UI as first-class citizens** (src/i18n.ts).
- **A revisioned snapshot owned by Rust** — validation, corruption quarantine, ordered saves, import prepare/commit separation ([architecture.md](architecture.md) "State flow"). The base that saved split groups, the archive, and sync extensions all build on.
- **Keyboard-first chrome** — editable shortcuts over a verified keymap (src/keyboardEditor.ts, src/keyboardProfiles.ts), command palette, quick open.
- **Account-free local state ownership** — a bounded export that excludes credentials and private state (src/workArchive.ts). Arc sync requires an account.
- **Snapshot-level private tab isolation** (src/privateTabs.ts) — private tabs never touch the disk.

---

Sources: Arc feature census and development status — docs/research/2026-10-11-version-upgrade-arc-gap.md §6 (arc.net, official help articles, release notes, the 2025-05 letter to Arc members). Yeoyu implementation state — [project-status.md](project-status.md) plus the 2026-11-06 independent source re-adjudication (6 sections, 2 cross-validated). GeckoView 157 API evidence — exhaustive inspection of the gradle-cache AAR's classes.jar·omni.ja (classes, methods, pref strings). Architecture — [architecture.md](architecture.md).
