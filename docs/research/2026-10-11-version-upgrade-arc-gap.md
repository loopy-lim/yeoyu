---
date: 2026-10-11T11:20:00+09:00
researcher: Claude (SDD orchestrator)
git_commit: 229a88b
branch: main
repository: yeoyu
topic: "전체 버전 업그레이드(bun/node 26/의존성/Rust/GeckoView/Android/CI) 및 Arc 브라우저 기능 갭 분석"
tags: [research, versions, upgrade, arc, geckoview, rust, bun, node]
status: complete
last_updated: 2026-10-11
last_updated_by: Claude (SDD orchestrator)
---

# 리서치: 전체 버전 업그레이드 및 Arc 브라우저 기능 갭 분석

**날짜**: 2026-10-11
**Git Commit**: 229a88b
**Branch**: main
**Repository**: yeoyu (React Native 안드로이드 태블릿 브라우저 — GeckoView + Rust 코어)

## 연구 질문

1. 레포의 모든 버전 항목을 2026-10-11 기준 최신으로 올리려면 무엇을 어디서 바꿔야 하는가? (bun 최신, node 26, npm 의존성, Rust, GeckoView, Android SDK/NDK, CI)
2. Arc 브라우저(The Browser Company)와 비교해 Yeoyu에 없는 기능은 무엇인가?

## 요약

- **react-native 0.87.1이 이미 최신 안정**(0.88은 RC) — 최대 리스크인 RN 메이저 bump가 없음. RN 생태계(templates, cli, babel/metro/ts-config) 전부 0.87.1 조합 유지.
- 실제 bump 대상: **bun 1.4.1→1.4.3, node 22→26.11.1, react 19.2.3→19.3.0(+test-renderer/@types 동반), uniwind 1.12.1→1.12.2, safe-area-context→5.10.1, typescript ^6.0.3→7.0.2(검증 후 확정), prettier 2.8.8→3.9.10, rust 1.98.0→1.99.0, GeckoView 155→157.0.20261005135250, CI 액션 SHA 몇 건**.
- 이미 최신이라 유지: tailwindcss 4.3.3(uniwind 내부 고정과 일치), clsx, tailwind-merge, CVA, react-native-svg, url-polyfill, @react-native-community/cli 20.2.0, cargo-ndk 4.1.2, compileSdk 37.1, build-tools 37.0.0, NDK 27.1(RN 0.87 템플릿 고정값), Gradle 9.4.1.
- Babel은 latest 태그가 8.0.7이지만 `@react-native/babel-preset@0.87.1`이 `@babel/core ^7.25.2` 요구 → **7.x 내에서만** 갱신(^7.29.0).
- targetSdk 36 → 37은 RN 템플릿이 36 유지 + 기기 동작 검증 불가 → 유지(예외 기록). NDK도 동일 사유로 27.1 유지.
- Arc는 **유지보수 모드**(2024-10 신규 개발 중단 선언, 2025-05 공식화, 2026 현재 주간 Chromium 보안 패치만). 안드로이드용은 "Arc Search"뿐(사이드바/스페이스형 없음) — Yeoyu가 Arc의 탭 관리 철학을 안드로이드 태블릿에서 대체하는 포지션.
- Yeoyu 미구현 확정 갭(project-status.md 명시): Sync, 자동 탭 아카이브, 저장되는 split group, 분리 계정 프로필, 독립 서비스 PiP. Arc 대비 추가 갭: Air Traffic Control, Peek/Little Arc형 외부 링크 트리아지, Site Search, Live Folders/Calendars, Boosts, AI 요약군, 통합 Library, 전체페이지 캡처 등.

---

## 1. 외부 최신 버전 조사 (2026-10-11, 전부 실제 조회 확인)

| 항목 | 현재 | 최신 안정 | 비고 |
|---|---|---|---|
| bun | 1.4.1 | **1.4.3** (2026-10-10) | bun docs 호환 기준 = Node 26 |
| node | 22.21.1 | **26.11.1** (2026-10-07) | 26 LTS 전환은 2026-10-28 예정. RN 0.87.1 engines `^22.13.0 \|\| ^24.3.0 \|\| >= 26.0.0` 허용 |
| react / react-test-renderer | 19.2.3 | **19.3.0** | 정확히 동일 버전 유지 필수 |
| @types/react / @types/react-test-renderer | ^19.2.0 / ^19.1.0 | **19.3.0** | react와 함께 |
| react-native | 0.87.1 | **0.87.1 (최신)** | next=0.88.0-rc.4 → 스킵 |
| @react-native/babel-preset·metro-config·typescript-config | 0.87.1 | 0.87.1 | RN과 정확 일치 유지 |
| @react-native-community/cli 3종 | 20.2.0 | 20.2.0 | 유지 |
| typescript | ^6.0.3 | **7.0.2** | 메이저. RN 템플릿은 ^6.0.3 고정, RN 자체는 TS peer 제약 없음 → 7 시도, 실패 시 6.x 롤백 |
| tailwindcss | 4.3.3 | 4.3.3 | 유지 (uniwind가 @tailwindcss/node·oxide 4.3.3 고정) |
| uniwind | 1.12.1 | **1.12.2** | peer: tailwindcss >=4(상한 없음), RN >=0.81 |
| react-native-safe-area-context | ^5.5.2 | **5.10.1** | |
| react-native-svg / url-polyfill | 15.15.5 / 4.0.0 | 동일 | 유지 |
| class-variance-authority / clsx / tailwind-merge | 0.7.1 / 2.1.1 / 3.7.0 | 동일 | 유지 |
| @babel/core·preset-env·runtime | ^7.25.x | 7.29.x (latest 태그는 8.0.7 — **Babel 8 금지**) | ^7.29.0으로 floor 상향 |
| @types/bun | ^1.2.0 | **1.4.2** | |
| prettier | 2.8.8 | **3.9.10** | 메이저. 포맷 강제(CI check) 없음 → 버전만 bump, 리포맷은 범위 외 |
| rust | 1.98.0 (2026-08-18) | **1.99.0** (2026-10-01) | stable 채널 매니페스트 확인 |
| cargo-ndk | 4.1.2 | 4.1.2 | 유지 |
| GeckoView | 155.0.20260903215306 | **157.0.20261005135250** | 중간 156.0.20260921121718 — 롤백 사다리용 |
| compileSdk | 37 (37.1) | 37.1 (37.2는 beta) | 유지 |
| targetSdk | 36 | (37 안정) | **36 유지** — RN 템플릿 36, 기기 동작 검증 불가 |
| NDK | 27.1.12297006 | r30 LTS 존재 | **27.1 유지** — RN 0.87 템플릿 고정값 |
| build-tools | 37.0.0 | 37.0.0 | 유지 |
| Gradle wrapper | 9.4.1 | 9.4.1 (템플릿 동일) | 유지 |
| Kotlin plugin | 2.4.10 | (템플릿 2.2.0보다 위) | 유지 |
| AGP | RN gradle-plugin 결정 (템플릿 9.2.1) | — | 변경 불필요, `android.builtInKotlin=false`·`android.newDsl=false` opt-out도 템플릿과 동일 |
| JDK | CI 21 / 문서 17+ | 17 권장(RN 문서) | 유지 |
| actions/checkout | v7.0.1 | v7.0.1 (최신) | 유지 |
| actions/setup-node | v7.0.0 | **v7.1.0** (2026-10-08) | SHA 갱신 |
| oven-sh/setup-bun | v2 | **v2.2.0** (2026-03-14) | SHA 갱신 |
| actions/setup-java | v6.0.1 | 최신 확인 필요 | SHA 갱신 |
| actions/upload-artifact | v7.0.1 | 최신 확인 필요 | SHA 갱신 |

출처: registry.npmjs.org, nodejs.org/dist/index.json, api.github.com(oven-sh/bun, bbqsrc/cargo-ndk, actions/*), static.rust-lang.org/channel-rust-stable.toml, maven.mozilla.org geckoview maven-metadata.xml, developer.android.com, raw.githubusercontent.com facebook/react-native v0.87.1 libs.versions.toml + @react-native-community/template 0.87.2. `bun outdated` 로컬 크로스체크 일치.

## 2. 내부 버전 핀 전수 (변경 대상)

| 파일:줄 | 항목 | 현재 → 목표 |
|---|---|---|
| `.bun-version:1` | bun | 1.4.1 → 1.4.3 |
| `.node-version:1` | node | 22.21.1 → 26.11.1 |
| `package.json:5` | packageManager | bun@1.4.1 → bun@1.4.3 |
| `package.json:47` | engines.node | >= 22.11.0 → >= 26.0.0 |
| `package.json:20,43` | react, react-test-renderer | 19.2.3 → 19.3.0 (쌍 유지) |
| `package.json:39–41` | @types/bun, @types/react, @types/react-test-renderer | ^1.2.0→^1.4.2, ^19.2.0→^19.3.0, ^19.1.0→^19.3.0 |
| `package.json:22` | react-native-safe-area-context | ^5.5.2 → ^5.10.1 |
| `package.json:27` | uniwind | 1.12.1 → 1.12.2 |
| `package.json:44` | typescript | ^6.0.3 → 7.0.2 (검증 실패 시 6.x 유지) |
| `package.json:42` | prettier | 2.8.8 → 3.9.10 |
| `package.json:30–32` | @babel/core·preset-env·runtime | ^7.25.x → ^7.29.0 |
| `bun.lock` | 재생성 | bun 1.4.3으로 `bun install` (bootstrap이 `--frozen-lockfile` 사용 — 커밋 필수) |
| `rust-toolchain.toml:2` | channel | 1.98.0 → 1.99.0 |
| `.github/workflows/check.yml:23` | rustup 하드코딩 | 1.98.0 → 1.99.0 |
| `.github/workflows/android.yml:32–33` | rustup 하드코딩(3줄, 발생 4회) | 1.98.0 → 1.99.0 |
| `android/app/build.gradle:143` | GeckoView | 155.0.20260903215306 → 157.0.20261005135250 |
| `.github/workflows/*.yml` | 액션 SHA | setup-node, setup-bun, setup-java, upload-artifact 갱신 |
| `README.md:52–61`, `README.ko.md:52–61` | Requirements | Node 26, Bun 1.4.3, Rust 1.99, GeckoView 관련 표기 |
| `docs/development.md:11–23`, `.ko.md` | 동일 | 동일 |

변경 **아님**: modules/rustra-jsi/package.json(peer), codegenConfig, gradle.properties AGP opt-out, sdkmanager 설치 목록(android-37.1, build-tools 37.0.0, ndk 27.1.12297006), `scripts/bootstrap.sh:6`의 `RUSTRA_REV`(벤더링 도메인 코어 소스 — 버전 업그레이드 범위 외, 별도 작업).

## 3. 검증 명령 전수

- **`scripts/check.sh`** (로컬 호스트 게이트): cargo fmt --check → cargo test → cargo clippy -D warnings → `bun test tests` → `python3 scripts/check-split-geometry.py` → `python3 -m unittest discover -s tests` → `bun scripts/contrast-check.ts` → `bun run typecheck` → `bun run codegen --check`
- **`scripts/bootstrap.sh`**: RUSTRA_REV 검증 → rustra `bun install --frozen-lockfile` → types/react-native 패키지 빌드 → 루트 `bun install --frozen-lockfile` → codegen + `codegen --check`
- **CI check.yml**: bootstrap → check.sh. **CI android.yml**: setup-java 21 → 툴체인+SDK 설치 → bootstrap → `:app:testDebugUnitTest` → `build-android.sh LocalRelease` → APK sha256
- **로컬 가용**: Android SDK 존재(`~/Library/Android/sdk`), JDK 17, cargo-ndk 4.1.2, rustup(1.98 active), `.deps/rustra-main` 이미 부트스트랩됨, node_modules 설치됨(베이스라인 검증 수행)
- 테스트 규모: bun 테스트 82개(탭·스페이스·크롬 UI·접근성·기하 계약 포함), Python 3개, Rust 3개(test 파일), Android JUnit 55개(Kotlin, Robolectric)

## 4. 패키지 버전 커플링 (함수 올리기 규칙)

| 쌍 | 규칙 |
|---|---|
| react ↔ react-test-renderer ↔ @types/react ↔ @types/react-test-renderer | 전부 19.3.0으로 동시 bump |
| react-native ↔ @react-native/* ↔ cli | 0.87.1/20.2.0 전부 유지(변경 없음) |
| uniwind ↔ tailwindcss | uniwind 1.12.2 bump 시 tailwindcss 4.3.3 유지 확인(이중 설치 방지) |
| @types/bun ↔ .bun-version | 1.4.x 라인 정렬 |
| bun.lock ↔ bootstrap `--frozen-lockfile` | lockfile 갱신 후 커밋 필수, 아니면 CI 부팅 실패 |
| GeckoView ↔ android Kotlin 89개 파일 | bump 시 `:app:testDebugUnitTest` 컴파일로 API 호환 검증 |
| rust-toolchain.toml ↔ CI rustup 하드코딩 | 같은 값으로 동시 갱신 |

## 5. 브라우저 기능 인벤토리 (갭 분석용 Yeoyu 측 지도)

**구현 완료**(docs/project-status.md:7–22): workspace/space 모델(일반 탭, 크로스-Space Favorites, Space별 pinned, 폴더, 북마크, 히스토리, 편집 가능 단축키), 펼침·접힘 사이드바, quick open, 커맨드 팔레트, 컨텍스트 메뉴, 가로·세로 split, Uniwind+Tailwind 테마, 키보드 주소 오버레이, GeckoView 세션 레지스트리(네비·팝업·권한·파일·다운로드·외부링크·미디어·PiP), Rust 리비전 스냅샷(손상 격리), 프라이빗 탭, bookmark HTML·work-archive import/export, 사이트 설정·트래킹 보호·site-data 삭제, 한·영 UI, Android 다중 창·공유 받기·백그라운드 미디어·다운로드 복구·웹 알림, Mozilla 호환 확장(검색·설치·툴바·권한 철회).

**미구현 명시**(project-status.md:35–44): Sync, 저장되는 split group, 분리된 account profile, 자동 tab archive, 독립 서비스 PiP 오버레이. iOS 앱 없음, 자동 업데이트 채널 없음. **미검증**: Passkey, autofill, OAuth, DRM media, TalkBack 접근성, process death 중 다운로드.

**주요 파일 지도**: `src/BrowserController.ts`(830행 JSI 커맨드), `src/platform.ts`(네이티브 표면 126행), `src/sidebarModel.ts`·`src/splitLayout.ts`, `src/history.ts`(메모리+네이티브 영속), `src/suggestions.ts`·`src/components/AddressBox.tsx`, `src/commandRegistry.ts`·`src/keyboardEditor.ts`, `src/downloadHistory.ts`+`Download*.kt`, `src/browserExtensions.ts`+`BrowserExtension*.kt`, `src/hooks/usePictureInPicture.ts`+`BrowserPictureInPicture.kt`, `android/app/src/main/java/dev/browser/`(GeckoSession 레지스트리·세션 수명 87개 Kotlin 파일).

## 6. Arc 브라우저 기능 전수 (2026-10 기준)

**개발 상태**: 2024-10-24 신규 기능 개발 중단 발표 → 2025-05-27 공식 서신("핵심 개발 중단, Chromium 보안·버그 수정 지속") → 2025-09 Atlassian 인수($610M) → 2026 현재 유지보수 모드(주간 보안 패치만, 예: 2026-10-08 v1.168.0 = Chromium 155 보안패치, "새 기능 없음"). 안드로이드 데스크톱급 Arc는 없고 **Arc Search for Android**(2024-11-14 GA, 검색 우선 모바일 브라우저)만 존재.

**탭 관리**: 세로 사이드바, Spaces(스페이스별 고정탭·테마), Favorites(최대 12), Pinned Tabs(리셋·복제·폴더), Folders, Auto Archive(12h~30d 자동, 비활성화 불가), Archive 열람·복원, Tidy Tabs(AI), 탭 Previews(호버 시 Gmail/GitHub/Notion 등 요약), Peek(외부 링크 오버레이 탭), Live Folders(GitHub PR 자동 수집), Live Calendars(일정 카운트다운+Join), 탭 이름 변경, 멀티 셀렉트, Air Traffic Control(URL 규칙별 스페이스 자동 라우팅).

**창/멀티태스킹**: Split View(최대 4탭, 프리셋, 분할 자체가 하나의 탭으로 저장·재사용), 멀티 윈도우, Little Arc(외부 앱 링크 경량 팝업 창), 미디어 컨트롤(사이드바 오디오/비디오).

**Command Bar**: 주소·검색·명령 통합, ChatGPT 질의, Instant Links(Shift-Enter 최상위 결과 즉시 오픈), Site Search("yt"+Tab 커스텀 사이트 검색), 전면 단축키 리매핑.

**Easel/Boosts**: Easel(화이트보드, 캡처, 공유), Capture/전체페이지 캡처, Boosts(도메인별 색상·폰트·Zap(요소 제거)·CSS/JS).

**AI(Arc Max, 축소 중)**: 5-second Previews, Tidy Tab/Download Titles, Tidy Tabs, Instant Links, ChatGPT. Ask On Page는 2025-08 제거.

**프로필/동기화/데이터**: Profiles(로그인·쿠키·확장 분리), Arc Sync(E2EE, Spaces·Folders·Tabs만, 복구카드), 계정 필수.

**라이브러리/미디어**: Library(미디어·다운로드·Easel·아카이브 통합), 다운로드 관리, Mini Player(플로팅 비디오), Audio Player.

**확장/개발자**: Chrome 웹스토어 호환, Developer Mode, DevTools, Group Policy.

**검색/보안/비번**: 검색엔진 프로필별 변경, 시크릿, Secure DNS, 자동 번역, Chromium 비밀번호 관리·자동완성, 타 브라우저 가져오기/내보내기.

**모바일(Arc Search)**: Browse for Me(AI 검색 답변), Pinch to Summarize, 내장 광고 차단기(쿠키 배너 자동 거절), Auto Archive, 위젯, 번역.

**명시적 비보유**: PWA 미지원, 리딩리스트 없음(폴더+Auto Archive로 대체), 자체 2FA 없음.

출처: arc.net, resources.arc.net(공식 헬프 60여 편), 공식 릴리스 노트(macOS/Windows/iOS/Android), browsercompany.substack.com/p/letter-to-arc-members-2025, Wikipedia, TechCrunch, CNBC.

## 미해결 질문

- TypeScript 7.0.2의 RN 0.87 실측 호환 — 구현 단계 typecheck로 판정(롤백 규칙 준비됨)
- GeckoView 155→157 Kotlin API 호환 — 로컬 `:app:testDebugUnitTest` + CI android 빌드로 판정(156/155 롤백 사다리 준비)
- actions/setup-java·upload-artifact의 최신 정확 버전/SHA — 구현 시 `gh api`로 조회
