[English](arc-gap-analysis.md)

---
date: 2026-10-11
compared_at: 2026-10-11
arc_status: 유지보수 모드 — 2024-10부터 신규 기능 개발 중단, 주간 Chromium 보안 패치만 제공. 안드로이드에는 Arc Search만 존재
yeoyu_source: docs/project-status.ko.md
arc_census: docs/research/2026-10-11-version-upgrade-arc-gap.md §6
status: complete
---

# Arc 기능 갭 분석

이 문서는 2026-10-11 기준으로 Yeoyu를 Arc의 동결된 기능 목록과 비교합니다. Arc는 유지보수 모드입니다. 2024년 10월에 신규 기능 개발이 중단되었고 2025년 5월에 공식 확인되었으며, 그 이후 릴리스는 주간 Chromium 보안 패치만 담습니다(예: 2026-10-08 v1.168.0). 안드로이드에는 데스크톱급 Arc가 없고, 사이드바·Spaces가 없는 검색 우선 모바일 브라우저인 Arc Search만 존재합니다.

Arc의 기능 목록은 더 이상 움직이지 않으므로, 이 문서는 "따라잡기" 목록이 아닙니다. Arc는 이미 검증된 아이디어의 카탈로그로 읽고, 그중 태블릿 우선·키보드 친화적이며 Rust 도메인 코어 위에서 로컬 상태를 소유하는 Yeoyu에 맞는 것만 제안합니다. 이 문서의 행은 제안이지 약속이 아닙니다.

근거 규칙: 모든 갭 행에는 Yeoyu 측 근거(파일 경로 또는 [project-status.ko.md](project-status.ko.md) 섹션)를 붙입니다. 소스로 판정하지 못한 항목은 갭으로 세지 않고 [검증 필요, 갭 아님](#4-검증-필요-갭-아님)에 둡니다.

## 1. 매트릭스 읽는 법

- **Yeoyu 상태** — `있음`(구현), `부분`(다른 형태·범위로 존재), `없음`(미구현).
- **제안 우선순위** — Yeoyu 철학(태블릿 우선, 키보드 친화, 로컬 상태 소유, Rust 도메인 코어)에 맞춘 제안입니다. `high`는 이미 있는 구조에 대부분 연결만 하면 되는 항목, `medium`은 철학에는 맞지만 실질적 신규 작업이 필요한 항목, `low`는 가능하지만 효과가 작은 항목, `backlog`는 철학과 충돌하거나 Yeoyu가 일부러 두지 않은 인프라를 요구하는 항목입니다.

## 2. 갭 매트릭스

### 2.1 탭 관리

| Arc 기능 | Yeoyu 상태 | 근거 | 제안 우선순위 |
|---|---|---|---|
| Auto Archive(12h–30d, 끌 수 없음) | 없음 | [project-status.ko.md](project-status.ko.md) "현재 한계": 자동 tab archive 미구현. src/App.tsx는 수동 `tab.reopen`용 닫힌 tab 목록만 유지 | Medium — [project-status.ko.md](project-status.ko.md) roadmap이 이미 tab release 확대를 신뢰할 수 있는 safe-restoration signal 뒤에 둠. 시간 기반 archive는 그 signal 이후의 작업 |
| Archive 열람·복원 | 부분 | src/App.tsx의 닫힌 tab 스택과 `tab.reopen`뿐. archive 목록 화면 없음 | Low |
| 탭 Previews(Gmail/GitHub/Notion 요약) | 없음 | src/에 preview·page 요약 코드 없음. "summary" 일치는 src/browserExtensions.ts의 확장 권한 문구뿐 | Low |
| 탭 이름 변경 | 없음 | src/BrowserController.ts는 `bookmarkFolderRename`만 노출. tab 제목 편집 command 없음 | Medium |
| 탭 멀티 셀렉트 | 없음 | src/ 전체에 multi-select·selection mode 코드 없음 | Medium — 일괄 닫기·이동은 태블릿 직접 조작에 맞음 |
| Live Folders(GitHub PR 자동 수집) | 없음 | Folder는 정적 bookmark folder(src/BrowserController.ts). src/에 외부 데이터 소스 없음 | Backlog — 로컬 상태 코어가 다루지 않는 백그라운드 네트워크 폴링 필요 |
| Live Calendars(일정 카운트다운·참여) | 없음 | src/에 calendar 코드 없음 | Backlog |
| Air Traffic Control(URL 규칙으로 Space 자동 라우팅) | 없음 | src/에 URL 규칙 라우팅 없음. Space 전환은 수동(src/App.tsx의 `space.manage`) | Backlog |

### 2.2 창·멀티태스킹

| Arc 기능 | Yeoyu 상태 | 근거 | 제안 우선순위 |
|---|---|---|---|
| 최대 4탭 split + 프리셋 | 부분 | 2 pane, 가로·세로, 비율 0.25–0.75 클램프(src/splitLayout.ts, src/App.tsx의 `browser.split` command) | Low — 2 pane은 태블릿 기하에 맞고 4 pane 사례는 검증되지 않음 |
| 저장되는 split group(split이 하나의 재사용 tab으로 유지) | 없음 | [project-status.ko.md](project-status.ko.md) "현재 한계": 저장되는 split group 미구현. src/splitLayout.ts는 런타임 geometry만 보유 | High — split model이 이미 존재. persistence는 Rust가 소유하는 revisioned snapshot의 자연스러운 확장 |
| Little Arc(외부 링크 경량 창) | 부분 | Android 별도 창·공유 받기가 외부 링크를 받음([project-status.ko.md](project-status.ko.md) "구현된 범위"). 커스텀 스킴 처리는 ExternalLinkPolicy.kt가 관리 | Medium |
| 독립 서비스 video PiP(추출 오버레이) | 없음 | PiP 연동은 존재하지만 browser surface/session 전체를 옮김(src/hooks/usePictureInPicture.ts, [project-status.ko.md](project-status.ko.md) "현재 한계") | Medium |
| 사이드바 오디오·비디오 컨트롤 | 부분 | 백그라운드 media control 존재([project-status.ko.md](project-status.ko.md) "구현된 범위", BrowserMedia.kt, BrowserVideoRegions.kt). tab별 컨트롤 표면 없음 | Low |

### 2.3 주소창·명령

| Arc 기능 | Yeoyu 상태 | 근거 | 제안 우선순위 |
|---|---|---|---|
| Site Search(키워드 + Tab으로 특정 사이트 검색) | 없음 | src/suggestions.ts가 google·naver·duckduckgo 3종으로 고정. 키워드→사이트 매핑 없음 | High — 순수 키보드 흐름이고 기존 suggestion pipeline에서 작은 변경 |
| Instant Links(최상위 웹 결과 즉시 오픈) | 없음 | src/suggestions.ts는 로컬 favorite·history·bookmark·열린 tab만 제안 | Backlog — Yeoyu가 운영하지 않는 웹 랭킹 서비스 필요 |
| 프로필별 검색 엔진·커스텀 엔진 URL | 부분 | 3종 고정 엔진에 대한 전역 선택만 존재(src/suggestions.ts, src/App.tsx 설정) | Low — Site Search에 흡수 |

### 2.4 AI

Arc Max 기능은 Yeoyu에 하나도 없습니다. 카테고리 전체를 backlog로 제안합니다. 로컬 상태 소유와 일관되는 유일한 형태는 온디바이스 처리인데, 그런 컴포넌트가 소스에 없습니다. 항목별 행은 모두 `없음`, 모두 `Backlog`:

| Arc 기능 | Yeoyu 상태 | 근거 | 제안 우선순위 |
|---|---|---|---|
| Arc Max 5-second previews | 없음 | src/에 page 요약 코드 없음 | Backlog |
| Tidy Tab / Download Titles(이름 생성) | 없음 | 제목은 page 또는 사용자 입력에서 옴. 생성 코드 없음 | Backlog |
| Tidy Tabs(AI 정리) | 없음 | src/App.tsx command registry에 해당 command 없음 | Backlog |
| Command bar의 ChatGPT | 없음 | src/에 외부 AI 호출 없음 | Backlog |
| Browse for Me / Pinch to Summarize(Arc Search) | 없음 | src/에 해당 코드 없음 | Backlog |

### 2.5 프로필·동기화

| Arc 기능 | Yeoyu 상태 | 근거 | 제안 우선순위 |
|---|---|---|---|
| Arc Sync(E2EE, 계정 기반) | 없음 | [project-status.ko.md](project-status.ko.md) "현재 한계": Sync 미구현. src/에 네트워크 sync 코드 없음 | High — 기존 bounded work archive(src/workArchive.ts) 확장으로 접근: preview·새 ID·credential 제외를 갖춘 Space별 export/import가 이미 로컬 백업 경로이고, 그 파일을 통한 기기 간 전송에는 계정 서비스가 필요 없음 |
| 분리된 account profile(로그인·쿠키·확장 격리) | 없음 | [project-status.ko.md](project-status.ko.md) "현재 한계". 유일한 격리는 비공개 tab이며, 이는 저장 snapshot에서 제거됨(src/privateTabs.ts) | Medium |
| 전체 브라우저 데이터 가져오기(쿠키·비밀번호·history) | 부분 | bookmark HTML 가져오기와 preview를 갖춘 bounded work archive import/export 존재(src/workArchive.ts, [project-status.ko.md](project-status.ko.md) "구현된 범위") | Low |

### 2.6 미디어·라이브러리

| Arc 기능 | Yeoyu 상태 | 근거 | 제안 우선순위 |
|---|---|---|---|
| 통합 Library(media·download·archive 한곳에) | 부분 | 별도 history panel(src/App.tsx의 `history.open`)과 download history(src/downloadHistory.ts, DownloadHistory.kt)만 존재. 통합 표면 없음 | Low |
| Mini Player·플로팅 재생기 | 부분 | Mini player는 browser surface 전체를 옮김([project-status.ko.md](project-status.ko.md) "현재 한계") — §2.2의 독립 PiP와 같은 한계 | Medium — 해당 행과 같은 작업 |

### 2.7 확장·개발자

| Arc 기능 | Yeoyu 상태 | 근거 | 제안 우선순위 |
|---|---|---|---|
| Developer Mode / 원격 DevTools | 없음 | src/와 android/app/src/main/java/dev/browser/에 devtools·원격 디버깅 코드 없음 | Low |
| Group Policy / 관리 배포 | 없음 | src/와 Kotlin 트리에 managed policy 코드 없음 | Backlog — 개인 태블릿 브라우저 범위 밖 |

### 2.8 보안·개인정보

| Arc 기능 | Yeoyu 상태 | 근거 | 제안 우선순위 |
|---|---|---|---|
| Secure DNS 설정 | 없음 | src/와 GeckoSessionRegistry.kt에 secure DNS·DoH 코드 없음. 구현 전 GeckoView 측 지원 여부 확인 필요 | Low |
| 내장 비밀번호 관리 | 없음 | src/에 credential 저장 없음. password 문구는 확장 검색 placeholder(src/i18n.ts)뿐이고 archive는 설계상 credential 제외(src/workArchive.ts) | Low — autofill 자체는 별도 검증 필요 항목(§4) |
| 웹페이지 자동 번역 | 없음 | src/의 translate 일치는 UI i18n뿐(src/i18n.ts) | Medium — 앱의 두 UI 언어 밖의 page를 읽는 것은 흔한 태블릿 사례 |

### 2.9 캡처·부가기능

| Arc 기능 | Yeoyu 상태 | 근거 | 제안 우선순위 |
|---|---|---|---|
| 전체페이지 캡처·공유 | 없음 | src/App.tsx의 `platform.captureRendering` 호출은 focus 전환용 내부 snapshot이지 사용자 노출 캡처가 아님 | Medium |
| Boosts(도메인별 색상·폰트·Zap·CSS/JS) | 없음 | src/에 사용자 CSS/JS 주입 없음. theming은 앱 수준(src/theme.ts) | Backlog — 앱 수준 테마와 창·Space별 색상이 이미 눈에 보이는 수요를 다룸. page 재작성은 현재 rendering 정책 밖 |
| Easel(화이트보드) | 없음 | src/에 해당 코드 없음 | Backlog |
| 홈 화면 위젯(Arc Search) | 없음 | android/app/src/main/AndroidManifest.xml에 AppWidget receiver 없음(MAIN/VIEW/SEND intent action만 존재) | Backlog |

## 3. 확정 갭

다섯 갭은 이중으로 확인됩니다 — Arc에 기능이 있고, [project-status.ko.md](project-status.ko.md) "현재 한계"가 미구현으로 명시합니다:

1. Sync
2. 자동 tab archive
3. 저장되는 split group
4. 분리된 account profile
5. 독립 서비스 video PiP

확인 대상으로 표시됐다가 소스 검토로 `없음`이 확정된 두 항목: **탭 이름 변경**(src/BrowserController.ts는 bookmark folder rename만 보유)과 **탭 멀티 셀렉트**(src/에 selection mode 코드 없음).

## 4. 검증 필요, 갭 아님

다음은 갭으로 세지 않습니다. 열린 질문은 기능의 존재가 아니라 Yeoyu의 현재 동작이 작동하는지 여부이기 때문입니다. [project-status.ko.md](project-status.ko.md) "현재 한계"가 전용 device/account validation이 필요하다고 명시합니다:

- Passkey
- Autofill
- OAuth 흐름
- DRM media
- TalkBack 음성·gesture 수용
- Process death 중 download
- Provider별 동작

[project-status.ko.md](project-status.ko.md)의 근거 정책에 따라, 이 중 무엇을 갭이라 부르려면 먼저 device acceptance 근거가 필요합니다.

## 5. 공통 비갭

어느 쪽에도 없는 기능입니다. Yeoyu 갭으로 오해하지 않도록 적어둡니다:

- **PWA 설치** — Arc는 PWA를 지원하지 않고, Yeoyu에도 설치 경로가 없습니다(src/에 install prompt·service worker 등록 코드 없음. serviceWorker 일치는 src/i18n.ts의 확장 호환 문구뿐).
- **리딩리스트** — Arc에 없음(folder + Auto Archive로 대체). Yeoyu의 workspace/space snapshot에도 reading-list model이 없습니다.
- **자체 2FA** — 어느 브라우저도 자체 인증기를 제공하지 않습니다.

## 6. Yeoyu 고유 강점

Yeoyu가 Arc 뒤에 있지 않은 지점, Arc가 따를 수 없는 지점을 포함해:

- **Android 네이티브 통합** — 별도 창, 공유 받기, 백그라운드 media control, download 복구, 앱 실행 중 웹 알림, PiP([project-status.ko.md](project-status.ko.md) "구현된 범위"). 안드로이드의 Arc는 Arc Search뿐입니다.
- **Android에서의 확장** — Mozilla 호환 검색·설치, 툴바 동작, 권한 검토·철회(src/browserExtensions.ts, [project-status.ko.md](project-status.ko.md)). Arc 모바일 브라우저에는 확장 시스템이 없습니다.
- **1급 시민으로서의 한국어·영어 UI**(src/i18n.ts).
- **Rust가 소유하는 revisioned snapshot** — validation, corruption quarantine, 순서 있는 저장, import prepare/commit 분리([project-status.ko.md](project-status.ko.md), [architecture.ko.md](architecture.ko.md) "State flow"). 저장 split group·archive·sync 확장이 모두 얹히는 기반입니다.
- **키보드 우선 chrome** — 검증된 keymap으로 편집 가능한 shortcut(src/keyboardEditor.ts, src/keyboardProfiles.ts), command palette, quick open.
- **계정 없는 로컬 상태 소유** — credential과 비공개 상태를 제외하는 bounded export(src/workArchive.ts). Arc sync에는 계정이 필요합니다.
- **Snapshot 수준의 비공개 tab 격리**(src/privateTabs.ts) — 비공개 tab은 디스크에 닿지 않습니다.

---

출처: Arc 기능 전수와 개발 상태 — docs/research/2026-10-11-version-upgrade-arc-gap.md §6(arc.net, 공식 헬프 문서, 릴리스 노트, 2025-05 Arc 멤버 서신). Yeoyu 구현 상태 — [project-status.ko.md](project-status.ko.md). 아키텍처 — [architecture.ko.md](architecture.ko.md).
