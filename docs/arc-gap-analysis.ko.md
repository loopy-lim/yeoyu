[English](arc-gap-analysis.md)

---
date: 2026-10-11
compared_at: 2026-10-11
updated_at: 2026-11-06
arc_status: 유지보수 모드 — 2024-10부터 신규 기능 개발 중단, 주간 Chromium 보안 패치만 제공. 안드로이드에는 Arc Search만 존재
yeoyu_source: docs/project-status.ko.md
arc_census: docs/research/2026-10-11-version-upgrade-arc-gap.md §6
status: complete
---

# Arc 기능 갭 분석

이 문서는 Yeoyu를 Arc의 동결된 기능 목록과 비교합니다. 2026-11-06에 전 행을 소스 기준으로 재판정했습니다(독립 조사 6섹션, 2섹션은 교차 검증 — 판정 불일치 0). Arc는 유지보수 모드입니다. 2024년 10월에 신규 기능 개발이 중단되었고 2025년 5월에 공식 확인되었으며, 그 이후 릴리스는 주간 Chromium 보안 패치만 담습니다. 안드로이드에는 데스크톱급 Arc가 없고, 사이드바·Spaces가 없는 검색 우선 모바일 브라우저인 Arc Search만 존재합니다.

Arc의 기능 목록은 더 이상 움직이지 않으므로, 이 문서는 "따라잡기" 목록이 아닙니다. Arc는 이미 검증된 아이디어의 카탈로그로 읽고, 그중 태블릿 우선·키보드 친화적이며 Rust 도메인 코어 위에서 로컬 상태를 소유하는 Yeoyu에 맞는 것만 제안합니다. 이 문서의 행은 제안이지 약속이 아닙니다.

근거 규칙: 모든 갭 행에는 Yeoyu 측 근거(파일 경로 또는 [project-status.ko.md](project-status.ko.md) 섹션)를 붙입니다. 소스로 판정하지 못한 항목은 갭으로 세지 않고 [검증 필요, 갭 아님](#4-검증-필요-갭-아님)에 둡니다. 기호는 Arc가 실제로 지원하지만 문서상 근거만 확인된 것(예: GeckoView AAR의 API)에 `문서상 근거` 표기를 붙입니다.

## 1. 매트릭스 읽는 법

- **Yeoyu 상태** — `있음`(구현), `부분`(다른 형태·범위로 존재), `없음`(미구현).
- **제안 우선순위** — Yeoyu 철학(태블릿 우선, 키보드 친화, 로컬 상태 소유, Rust 도메인 코어)에 맞춘 제안입니다. `high`는 이미 있는 구조에 대부분 연결만 하면 되는 항목, `medium`은 철학에는 맞지만 실질적 신규 작업이 필요한 항목, `low`는 가능하지만 효과가 작은 항목, `backlog`는 철학과 충돌하거나 Yeoyu가 일부러 두지 않은 인프라를 요구하는 항목입니다.

## 2. 갭 매트릭스

### 2.1 탭 관리

| Arc 기능 | Yeoyu 상태 | 근거 | 제안 우선순위 |
|---|---|---|---|
| Auto Archive(12h–30d, 끌 수 없음) | 없음 | 시간 기반 트리거 코드 부재. `Tab.updated_at` 필드는 존재(native/src/domain.rs, "drives the Today/Earlier split (12h archive)" 주석)하나 소비 코드가 src·android 어디에도 없음. [project-status.ko.md](project-status.ko.md) roadmap이 safe-restoration signal을 선행 조건으로 명시 | Medium — 그 signal 이후의 작업. 도메인 필드는 준비됨 |
| Archive 열람·복원 | 부분 | 닫힌 탭은 메모리 전용 스택 12개 상한 + `tab.reopen` 최신 1개(src/App.tsx closedTabs, src/BrowserController.ts reopen). 목록 화면·영구 저장 없음 | Low |
| 탭 이름 변경 | 있음 | `Tab.custom_title`(native/src/domain.rs — 같은 사이트(오리진) 내 이동은 유지, 다른 사이트로 이동 시 해제), `tab_rename` 커맨드(native/src/lib.rs register!), 컨텍스트 메뉴 "탭 이름 변경"→편집 다이얼로그(src/components/Dialogs.tsx onRename, src/App.tsx renameTab), 표시는 `tabLabel`이 customTitle 우선 | — |
| 탭 멀티 셀렉트 | 부분 | 메뉴 "탭 선택" 진입 → 행 체크 토글 → 하단 툴바에서 일괄 닫기·스페이스 이동(src/App.tsx selectionMode, src/sidebarModel.ts batchCloseTargets·batchMoveTargets). 잔여: 일괄 고정·즐겨찾기, 폴더로 일괄 이동 | — |
| 탭 Previews(Gmail/GitHub/Notion 요약) | 없음 | src/에 preview·page 요약 코드 없음. "summary" 일치는 확장 권한 문구(src/browserExtensions.ts)뿐 | Backlog — 온디바이스 요약 컴포넌트 부재 |
| Live Folders(GitHub PR 자동 수집) | 없음 | Folder는 정적 bookmark folder(native/src/domain.rs). 폴링·외부 데이터 소스 0건 | Backlog — 로컬 상태 코어가 다루지 않는 백그라운드 네트워크 폴링 필요 |
| Live Calendars(일정 카운트다운·참여) | 없음 | calendar 일치는 프롬프트 날짜 산술(PromptValues.kt)뿐 | Backlog |
| Air Traffic Control(URL 규칙으로 Space 자동 라우팅) | 없음 | URL 규칙 라우팅 0건. Space 전환은 전부 수동(사이드바 필 행·하단 칩·SpaceSwitcherDialog). 구현 접점: uiPreferences 규칙 저장(siteSearches sanitize 선례) + 탭 생성 경로에서 규칙 판정 — 난이도 중 | Backlog |

### 2.2 창·멀티태스킹

| Arc 기능 | Yeoyu 상태 | 근거 | 제안 우선순위 |
|---|---|---|---|
| 최대 4탭 split + 프리셋 | 부분 | 2 pane, 가로·세로, 비율 0.25–0.75 클램프(src/splitLayout.ts). 4-pane은 쌍 모델이 7개 층(모델·게이트·렌더러·모션·divider·영속화·드롭 판정)에 고정되어 파괴적 변경 필요 — 난이도 상. 2-pane 비율·방향 "프리셋"은 저장 split group 인프라로 사실상 대체됨 | Low |
| 저장되는 split group(split이 하나의 재사용 탭) | 부분 | `SplitGroup`(native/src/domain.rs, URL 기반·Workspace당 20개 상한), `split_group_save/remove`(native/src/lib.rs), 저장·목록·복원·삭제·**이름 변경** UI(src/App.tsx pendingSplitSave·openSplitGroup·openSplitGroupRename). 복원은 재시작 후에도 존속(Rust snapshot). 잔여: 그룹 내 탭 교체, Space 간 이동, 목록 미리보기 | — |
| Little Arc(외부 링크 경량 창) | 부분 | 외부 링크는 활성 Space 탭으로 개봉(ExternalLinkPolicy.kt, PendingExternalLinks.kt → controller.openExternal). 경량 창 호스트(BrowserWindow.kt "chrome-light host for exactly one tab")는 존재하나 window.new 수동 경로만 사용. 잔여: 외부 링크의 경량 창 자동 개방, 세션 분리, 자동 닫힘 | Medium |
| 독립 서비스 video PiP(추출 오버레이) | 없음 | PiP는 GeckoView 전체를 ExternalPictureInPictureActivity로 재부모화(ExternalPictureInPicture.kt transfer)하되 비디오 영역으로 크롭(VideoPipViewport.kt). 진정한 독립 오버레이는 세션 복제 필요 — 난이도 상 | Medium |
| 사이드바 오디오·비디오 컨트롤 | 부분 | 사이드바는 재생 아이콘 표시만(src/App.tsx playing 인디케이터, 핸들러 없음). 제어 표면은 shade 알림뿐(BrowserMedia.kt, 단일 탭 바인딩). 접점 존재(GeckoSessionRegistry mediaSetPlayback) — 배선이면 되는 난이도 하~중 | Low |

### 2.3 주소창·명령

| Arc 기능 | Yeoyu 상태 | 근거 | 제안 우선순위 |
|---|---|---|---|
| Site Search(키워드 + Tab으로 특정 사이트 검색) | 부분 | `키워드 검색어`(공백)+Enter 흐름·설정 UI·sanitize 구현: `resolveSiteSearch`(src/suggestions.ts), `SiteSearchEntry`+`sanitizeSiteSearches`(src/uiPreferences.ts), 설정(src/components/SiteSearchSettings.tsx). 잔여: **Tab 키로 모드 진입**(현재 bare Tab은 RemapEngine.kt가 Pass — Kotlin InputKey 맵에 TAB 추가 필요), 키워드 프리픽스 힌트 행, 모드 이탈 경로 | Medium — Tab 진입은 IME 상호작용 실측 필요(하~중) |
| Instant Links(최상위 웹 결과 즉시 오픈) | 없음 | suggest는 로컬 4원천만(src/suggestions.ts) | Backlog — Yeoyu가 운영하지 않는 웹 랭킹 서비스 필요 |
| 프로필별 검색 엔진·커스텀 엔진 URL | 부분 | 3종 고정 전역 선택(src/suggestions.ts SEARCH_ENGINES, src/App.tsx 설정 라디오). 잔여: Space별 엔진(Rust snapshot 확장 필요 — 중), 커스텀 기본 엔진 URL(uiPreferences 확장 — 하) | Low |
| 커맨드바(⌘T) 통합 입력 | 부분 | ⌘T=퀵오픈 다이얼로그가 커맨드 검색·열린 탭 전환·사이트 검색·제안·URL 제출·favorite 타일을 한 입력에서 처리(src/components/AddressBox.tsx, src/commandRegistry.ts). 잔여: 스페이스 이름 타이핑 직접 전환(현재 SpaceSwitcherDialog는 필터 없는 리스트 — src/components/Dialogs.tsx), Instant Links | Low |

### 2.4 AI

Arc Max 기능은 Yeoyu에 하나도 없습니다. 카테고리 전체를 backlog로 제안합니다. 로컬 상태 소유와 일관되는 유일한 형태는 온디바이스 처리인데, 범용 JS API로 접근 가능한 컴포넌트가 없습니다(GeckoView 내부 ML 리소스는 gecko 전용). 항목별 행은 모두 `없음`, 모두 `Backlog`:

| Arc 기능 | Yeoyu 상태 | 근거 | 제안 우선순위 |
|---|---|---|---|
| Arc Max 5-second previews / Tidy Tab·Download Titles / Tidy Tabs / Command bar의 ChatGPT / Browse for Me·Pinch to Summarize | 없음 | src+native에서 외부 AI 호출·요약 생성 0건. 앱 레벨 외부 fetch는 favicon(src/App.tsx)과 확장 카탈로그(BrowserExtensionCatalog.kt, addons.mozilla.org 고정)뿐 | Backlog |

### 2.5 프로필·동기화

| Arc 기능 | Yeoyu 상태 | 근거 | 제안 우선순위 |
|---|---|---|---|
| Arc Sync(E2EE, 계정 기반) | 없음 | 네트워크 sync·계정 코드 0건(Rust에 HTTP 클라이언트 의존성 자체가 없음 — native/Cargo.toml). 파일 기반 출발점인 bounded work archive(src/workArchive.ts, native/src/archive.rs)에는 기기 식별·양방향 병합·삭제 전파·증분이 없고, import는 항상 새 ID로 append(archive.rs). revision 가드(archive.rs의 prepare/commit)는 재사용 가능. 파일 기반 1:1로 좁히면 중, 계정 서비스형은 Backlog 성격 | High(파일 기반) / Backlog(계정형) |
| 분리된 account profile(로그인·쿠키·확장 격리) | 없음 | 유일 격리는 비공개 tab(src/privateTabs.ts — snapshot에서 제거). GeckoView 157에 multi-profile API는 없고 세션별 `contextId`(저장소 분리)만 존재 `문서상 근거` — yeoyu 브리지 미사용. GeckoRuntime 다중 인스턴스 미지원 | Backlog |
| 전체 브라우저 데이터 가져오기 | 부분 | 담는 것: space·폴더·북마크·비공개 아닌 탭·키맵·프레젠테이션(native/src/archive.rs, src/workArchive.ts, BrowserDataPanel.tsx). Netscape bookmark HTML import/export 포함. 제외(설계상): 쿠키·비밀번호·history·favicon(i18n 경고 문구 명시). "전체 데이터"로 확장하려면 세션 히스토리·사이트 설정 이동 필요 — 상 | Low |

### 2.6 미디어·라이브러리

| Arc 기능 | Yeoyu 상태 | 근거 | 제안 우선순위 |
|---|---|---|---|
| 통합 Library(media·download·archive 한곳에) | 부분 | history(사이드바 메뉴·커맨드 팔레트 → HistoryDialog), downloads·archive(설정 data 카테고리)로 분산. 데이터 API는 전부 존재 — 단일 표면 재배치는 하 난이도 | Low |
| Mini Player·플로팅 재생기 | 부분 | 시스템 PiP가 surface를 옮기는 형태(src/hooks/usePictureInPicture.ts "never mounts a second player", BrowserPictureInPicture.kt). 인앱 플로팅 타일의 미연결 스캐폴드 존재(src/policy.ts miniPlayerTabs, src/chrome/appStyles.ts minis — TSX 소비자 0건). 세션-디스플레이 정책 검증 필요 — 상 | Medium |

### 2.7 확장·개발자

| Arc 기능 | Yeoyu 상태 | 근거 | 제안 우선순위 |
|---|---|---|---|
| Developer Mode / 원격 DevTools | 없음 | 앱 트리에 devtools 0건. **GeckoView 157에는 API 존재 `문서상 근거`** — AAR classes의 `GeckoRuntimeSettings.setRemoteDebuggingEnabled` + omni.ja의 GeckoViewRemoteDebugger 모듈. 삽입점 `applyRuntimeSettings`(GeckoSessionRegistry.kt) — 난이도 하~중. 실제 접속은 device acceptance 영역 | Low |
| Group Policy / 관리 배포 | 없음 | managed policy·device admin 선언 0건(AndroidManifest.xml) | Backlog — 개인 태블릿 브라우저 범위 밖 |

### 2.8 보안·개인정보

| Arc 기능 | Yeoyu 상태 | 근거 | 제안 우선순위 |
|---|---|---|---|
| Secure DNS 설정 | 있음 | `secureDnsMode`(auto/off/custom)+`secureDnsUri`(https 검증) in BrowserToolsConfig.kt, `applyRuntimeSettings`에서 TRR typed setter 적용(GeckoSessionRegistry.kt), 설정 UI는 개인정보 섹션의 보안 DNS 그룹(src/components/BrowserToolsPanel.tsx). 적용 시점은 런타임 생성 시(설정 즉시 재적용은 후속). GV157 `GeckoRuntimeSettings`의 TRR setter·`TRR_MODE_*` 상수로 컴파일 검증 | — |
| 내장 비밀번호 관리 | 없음 | credential 저장 0건; archive는 credential 설계상 제외(src/workArchive.ts). GeckoView에는 로그인 인프라 존재 `문서상 근거`(Autocomplete$LoginEntry·loginAutofillEnabled·PromptController LoginSaveHandler) — 미사용. 난이도 상 | Low |
| 웹페이지 자동 번역 | 없음 | src·Kotlin의 translate 일치는 UI i18n·좌표 이동뿐. **GeckoView 157에 API 완비 `문서상 근거`** — `SessionTranslation.translate/restoreOriginalPage`, 언어 감지 Delegate, 모델 관리(RuntimeTranslation), `browser.translations.enable=true`가 GV 기본 pref. 브리지+상태+UI가 신규(중). 온디바이스 엔진이라 로컬 소유 원칙과 일치. 최초 모델 다운로드·한국어 언어쌍은 기기 검증 필요 | Medium |

### 2.9 캡처·부가기능

| Arc 기능 | Yeoyu 상태 | 근거 | 제안 우선순위 |
|---|---|---|---|
| 전체페이지 캡처·공유 | 부분 | **PDF 캡처·공유 구현**: `GeckoSession.saveAsPdf()`→파일 저장 후 FileProvider URI로 ACTION_SEND 공유 시트(GeckoSessionRegistry.capturePagePdf, BrowserModule.capturePagePdf/sharePagePdf, src/platform.ts, 커맨드 `browser.captureShare`+사이드바 메뉴). 잔여: 이미지 캡처·갤러리 저장, GV에 스크롤 합성 API 부재(AAR 전수에서 fullPage 계열 0건). 기존 `platform.captureRendering`은 포커스 전환용 뷰포트 스냅샷(GeckoSessionRegistry captureForTransition)으로 사용자 노출 아님 | Low |
| Boosts(도메인별 색상·폰트·Zap·CSS/JS) | 부분 | **CSS 전용 site boost가 구현돼 있음**(2026-09-22부터 — 갭문서 초기판의 "없음"은 부정확): `SiteBoost`(src/uiPreferences.ts), 네이티브 주입(GeckoSessionRegistry setBoosts/injectBoost — yeoyu-boost style 태그), UI(src/components/Dialogs.tsx BoostsDialog). 잔여: 색상·폰트 프리셋, Zap, JS 주입(rendering 정책 검토 필요) | Backlog |
| Easel(화이트보드) | 없음 | src·android grep 0건 | Backlog |
| 홈 화면 위젯(Arc Search) | 없음 | AndroidManifest에 AppWidget receiver 없음 | Backlog |

### 2.10 사이드바·탭 인터랙션 차이 (기능 매트릭스 밖)

Arc 사이드바의 상호작용 대비 현재 차이 — 재판정에서 확인:

| Arc 상호작용 | Yeoyu 상태 | 근거 |
|---|---|---|
| 탭 날짜 그룹핑(Today/Yesterday) | 없음 | sidebarPresentation 출력에 날짜 그룹 없음(src/sidebarPresentation.ts). `updated_at` 소비자 0건 |
| 탭→폴더 드래그 이동 | 없음 | 드롭 타깃은 favorites·pinned·ordinary·split 4곳뿐(src/dragLifecycle.ts, src/sidebarModel.ts sidebarDropChange). 폴더 배치는 컨텍스트 메뉴 경로만 |
| 탭→스페이스 드래그 이동 | 없음 | 스페이스 이동은 탭 메뉴 항목·멀티 셀렉트 툴바 경로만(src/components/Dialogs.tsx onMoveToWorkspace) |
| 스페이스 이름 변경·삭제·재정렬 | 없음 | Rust에 workspace_create/activate만 존재(native/src/domain.rs) — rename·delete 커맨드부터 없음. 생성도 자동 이름 "Space N". SpaceSwitcherDialog는 전환+생성만(src/components/Dialogs.tsx) |
| 스페이스 전환 UX | 있음 | 헤더 필 행(탭=전환/길게=관리), 하단 칩 레일, 다이얼로그, 커맨드 — 4진입로 |
| 탭 재정렬·역할 변경 드래그 | 있음 | ordinary·pinned 재정렬, favorite↔pin↔ordinary 역할 변경, split 창 드롭(src/sidebarModel.ts, src/dragLifecycle.ts) |

## 3. 확정 갭

Arc에 기능이 있고 [project-status.ko.md](project-status.ko.md) "현재 한계"가 미구현으로 명시하는 것 — 2026-11-06 기준 4개:

1. Sync
2. 자동 tab archive
3. 분리된 account profile
4. 독립 서비스 video PiP

(저장되는 split group은 2026-11 구현으로 목록에서 제거 — project-status 갱신 동반)

## 4. 검증 필요, 갭 아님

다음은 갭으로 세지 않습니다. 열린 질문은 기능의 존재가 아니라 Yeoyu의 현재 동작이 작동하는지 여부이기 때문입니다. [project-status.ko.md](project-status.ko.md) "현재 한계"가 전용 device/account validation이 필요하다고 명시합니다:

- **Passkey** — 브리지는 이미 활성: `CredentialActivityCoordinator.kt`가 `GeckoRuntime.ActivityDelegate.onStartActivityForResult`로 FIDO2 OS provider 인텐트를 전달하고 MainActivity가 결과를 수신. 남은 것은 device acceptance뿐.
- **Autofill** — 앱 측 delegate 설정 없음(플랫폼 기본 의존). GeckoView 내장 AndroidAutofillDelegate 존재 `문서상 근거`. 실기기 제안 동작 미확인.
- **OAuth** — 차단 플래그 없음. 커스텀 스킴 루프백 실동작 미확인. FedCM(IdentityCredential) 프롬프트는 커스텀 PromptDelegate가 미처리 — 동작 미확인.
- **DRM media** — 명시적 auto-deny 상태가 소스로 확정: `PERMISSION_MEDIA_KEY_SYSTEM_ACCESS`는 contentPermissionKind 매핑에 없어 이벤트 후 즉시 VALUE_DENY(GeckoSessionRegistry.kt). GV pref도 `media.eme.require-app-approval=true`. 활성화 경로: kind 매핑 추가+프롬프트 UI — 중. 활성화 여부는 별도 결정 사항.
- TalkBack 음성·gesture 수용
- Process death 중 download
- Provider별 동작

[project-status.ko.md](project-status.ko.md)의 근거 정책에 따라, 이 중 무엇을 갭이라 부르려면 먼저 device acceptance 근거가 필요합니다.

## 5. 공통 비갭

어느 쪽에도 없는 기능입니다. Yeoyu 갭으로 오해하지 않도록 적어둡니다:

- **PWA 설치** — Arc는 PWA를 지원하지 않고, Yeoyu에도 설치 경로가 없습니다.
- **리딩리스트** — Arc에 없음(folder + Auto Archive로 대체). Yeoyu에도 reading-list model이 없습니다.
- **자체 2FA** — 어느 브라우저도 자체 인증기를 제공하지 않습니다.

## 6. Yeoyu 고유 강점

Yeoyu가 Arc 뒤에 있지 않은 지점, Arc가 따를 수 없는 지점을 포함해:

- **Android 네이티브 통합** — 별도 창, 공유 받기, 백그라운드 media control, download 복구, 앱 실행 중 웹 알림, PiP([project-status.ko.md](project-status.ko.md) "구현된 범위"). 안드로이드의 Arc는 Arc Search뿐입니다.
- **Android에서의 확장** — Mozilla 호환 검색·설치, 툴바 동작, 권한 검토·철회(src/browserExtensions.ts). Arc 모바일 브라우저에는 확장 시스템이 없습니다.
- **1급 시민으로서의 한국어·영어 UI**(src/i18n.ts).
- **Rust가 소유하는 revisioned snapshot** — validation, corruption quarantine, 순서 있는 저장, import prepare/commit 분리([architecture.ko.md](architecture.ko.md) "State flow"). 저장 split group·archive·sync 확장이 모두 얹히는 기반.
- **키보드 우선 chrome** — 검증된 keymap으로 편집 가능한 shortcut(src/keyboardEditor.ts, src/keyboardProfiles.ts), command palette, quick open.
- **계정 없는 로컬 상태 소유** — credential과 비공개 상태를 제외하는 bounded export(src/workArchive.ts). Arc sync에는 계정이 필요합니다.
- **Snapshot 수준의 비공개 tab 격리**(src/privateTabs.ts) — 비공개 tab은 디스크에 닿지 않습니다.

---

출처: Arc 기능 전수와 개발 상태 — docs/research/2026-10-11-version-upgrade-arc-gap.md §6(arc.net, 공식 헬프 문서, 릴리스 노트, 2025-05 Arc 멤버 서신). Yeoyu 구현 상태 — [project-status.ko.md](project-status.ko.md)와 2026-11-06 독립 소스 재판정(6섹션, 2섹션 교차 검증). GeckoView 157 API 근거 — gradle cache AAR의 classes.jar·omni.ja 전수 검사(클래스·메서드·pref 문자열). 아키텍처 — [architecture.ko.md](architecture.ko.md).
