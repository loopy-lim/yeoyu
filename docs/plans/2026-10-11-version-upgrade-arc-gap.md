# 전체 버전 업그레이드 및 Arc 기능 갭 분석 구현 계획

## 개요

yeoyu의 모든 버전 핀을 2026-10-11 기준 최신 안정으로 올린다 — Bun 1.4.3, Node 26.11.1, npm 의존성(react 19.3.0 등), Rust 1.99.0, GeckoView 157, CI 액션 SHA. 별도로 Arc 브라우저 대비 기능 갭 분석 문서를 docs/에 추가한다. react-native는 이미 최신(0.87.1)이라 bump 없음 — 이것이 이 계획의 리스크를 크게 낮춘다.

## 현재 상태 분석

- 상세 근거: `docs/research/2026-10-11-version-upgrade-arc-gap.md` (버전 전수표, 검증 명령, 커플링, Arc 기능 전수)
- 로컬: Android SDK 존재(`~/Library/Android/sdk`), JDK 17, cargo-ndk 4.1.2, rustup(1.98 active), `.deps/rustra-main` 부트스트랩됨, **node_modules 미설치**, bun 로컬 1.4.1
- 검증 게이트: `scripts/check.sh` 9단계(호스트 전체), `android/gradlew :app:testDebugUnitTest`(Kotlin 컴파일·55 JUnit), `scripts/build-android.sh LocalRelease`(APK, cargo-ndk), CI 2개 워크플로
- 핵심 커플링: react↔react-test-renderer↔@types 정확 일치 / uniwind가 tailwindcss 4.3.3 고정 / rust-toolchain.toml↔CI rustup 하드코딩 / bun.lock↔bootstrap `--frozen-lockfile` / GeckoView↔Kotlin 87개 파일

## 목표 상태

모든 버전 핀이 2026-10-11 최신 안정(Node는 26.x)이고, `scripts/check.sh` 전체 + 로컬 `:app:testDebugUnitTest`가 통과하며, CI가 새 버전을 참조하고, README/docs 표기가 실제와 일치하며, `docs/arc-gap-analysis{,.ko}.md`에 코드 근거 기반 갭 목록이 존재한다.

### 해석 규칙 (Gate 0에서 요구된 우선순위)

1. **"latest" = 검증을 통과하는 latest 조합.** bump가 검증을 깨뜨리고 최소 수정(≤10줄 설정/코드)으로 해소되면 수정해 진행, 아니면 해당 핀만 이전 안정으로 롤백하고 실행 노트에 기록한다.
2. **사전 정의된 유지 예외** (이미 최신이거나 상위 템플릿 고정값): react-native 0.87.1 조합 전체, tailwindcss 4.3.3, clsx, tailwind-merge, CVA, react-native-svg, url-polyfill, cli 20.2.0, cargo-ndk 4.1.2, compileSdk 37.1, targetSdk 36, NDK 27.1, build-tools 37.0.0, Gradle 9.4.1, Kotlin 2.4.10, AGP(RN 플러그인 결정), JDK(CI 21), Babel 7.x(latest 태그 8은 RN preset이 거부), `native/Cargo.toml` 크레이트 플로어(schemars 0.8, serde 1, serde_json 1, url 2.5.8), android 앱 레벨 의존성(androidx.media 1.7.0, junit 4.13.2, org.json 20250517, robolectric 4.16.1).
3. **범위 외**: `.deps/rustra-main`의 `RUSTRA_REV`(도메인 코어 소스 자체의 갱신은 별도 작업), prettier 리포맷 대량 실행(포맷 강제가 없어 버전 bump만), Arc 갭 기능의 구현.

## 범위 제한 (하지 않을 것)

- Arc 부족 기능의 구현 (갭 문서화만)
- GeckoView API 변경에 따른 기능 개편 — 컴파일·테스트가 깨지는 최소 수정만
- targetSdk 37·NDK r30 상승 (기기 동작 검증 불가 + RN 템플릿 미따름 — 예외 기록)
- 리팩터링, RUSTRA_REV 갱신, generated/ 코드 수동 수정

## 구현 접근 방식

공유 상태(package.json+bun.lock, workflows, docs) 단일 작성자 원칙으로 태스크를 파일 분리 설계하고, Wave 1은 **같은 작업 트리에서 파일 분리 병렬**(worktree 대신 — .deps가 git-ignored라 worktree마다 bootstrap 재수행 비용과 lockfile 충돌을 피함; 파일 분리는 계획이 보장). 커밋은 태스크별 Gate 2 통과 후 순차 수행. Wave 2는 Wave 1 커밋 위에서 진행.

검증은 테스트 강제가 아니라 전략: 기존 게이트(check.sh·gradle·CI)가 이미 존재하므로 bump 후 이것들이 회귀를 잡는다. 신규 테스트를 추가하지 않는다.

## Wave 1 (병렬 4 — 같은 트리, 파일 분리)

### T1 — JS 툴체인·npm 의존성 업그레이드

**파일**: `.bun-version`, `.node-version`, `package.json`, `bun.lock`, (로컬 도구: bun 자체)

**변경사항**:
- `.bun-version` → `1.4.3`, `package.json` packageManager → `bun@1.4.3`
- `.node-version` → `26.11.1`, engines.node → `>= 26.0.0`
- deps: react `19.3.0`, react-test-renderer `19.3.0`, @types/react `^19.3.0`, @types/react-test-renderer `^19.3.0`, react-native-safe-area-context `^5.10.1`, uniwind `1.12.2`
- devDeps: typescript `7.0.2`(**롤백 규칙**: typecheck·test 실패 원인이 TS 버전이고 ≤10줄로 해소 불가 → 6.x 최신으로 되돌림), @types/bun `^1.4.2`, @babel/core·preset-env·runtime `^7.29.0`, prettier `3.9.10`
- 로컬 bun을 1.4.3으로 업그레이드(`bun upgrade`; brew 관리면 `brew upgrade bun`), `bun install`로 lockfile 재생성
- tailwindcss가 4.3.3 단일 설치인지 확인(uniwind bump 후 `bun.lock`에서 @tailwindcss/* 중복 없음)

**성공 기준**:
- 자동: `bun --version` = 1.4.3 · `bun install` OK · **`bun install --frozen-lockfile` OK**(CI 부팅 조건) · `bun run typecheck` OK · `bun test tests` OK · `bun run codegen --check` OK · `bun scripts/contrast-check.ts` OK
- 수동: 없음 (전부 기계 검증)

### T2 — Rust 툴체인 1.99.0

**파일**: `rust-toolchain.toml`, `.github/workflows/check.yml:23`, `.github/workflows/android.yml`(rustup 라인 2곳)

**변경사항**: channel `1.98.0` → `1.99.0`; CI의 rustup 하드코딩 3줄(check.yml:23 — 한 줄에 두 치환, android.yml:32·33) → `1.99.0`. 로컬 `rustup toolchain install 1.99.0 --profile minimal --component rustfmt,clippy` 실행.

**성공 기준**:
- 자동: `cargo fmt --manifest-path native/Cargo.toml -- --check` · `cargo test --manifest-path native/Cargo.toml` · `cargo clippy --manifest-path native/Cargo.toml --all-targets -- -D warnings` — 전부 1.99.0에서 통과
- 수동: 없음

### T3 — GeckoView 157

**파일**: `android/app/build.gradle:143`

**변경사항**: `org.mozilla.geckoview:geckoview:155.0.20260903215306` → `157.0.20261005135250`

**롤백 사다리**: `:app:testDebugUnitTest` 컴파일 실패가 GeckoView API 변경이고 최소 수정 불가 → `156.0.20260921121718` → `155` 유지 순으로 되돌리고 기록.

**성공 기준**:
- 자동: `cd android && ./gradlew :app:testDebugUnitTest --no-daemon -PreactNativeArchitectures=arm64-v8a` 통과(컴파일+55 JUnit). 로컬 미통과 요인이 환경(NDK 등)이면 CI android 워크플로를 최종 검증으로 대체하고 기록
- 수동: 실기기 세션·권한·미디어 재검증은 project-status.md의 엔진 업그레이드 절차 항목 — 본 작업 후 별도 수동 확인 목록으로 문서화(차단 아님)

### T6 — Arc 기능 갭 분석 문서

**파일**(신규): `docs/arc-gap-analysis.md`, `docs/arc-gap-analysis.ko.md`

**변경사항**: 리서치 문서 §5–6을 근거로 갭 문서 작성. 구조: ① 비교 프레임(Arc 유지보수 모드·안드로이드는 Arc Search뿐 → Yeoyu 포지션) ② 범주별 갭 매트릭스(Arc 기능 | Yeoyu 상태 | 근거: 파일 경로 또는 project-status 섹션 | 제안 우선순위) ③ 확정 갭(Sync, 자동 탭 아카이브, 저장 split group, 분리 프로필, 독립 PiP, Air Traffic Control, Peek/Little Arc형 트리아지, Site Search, Live Folders/Calendars, 탭 Previews, Boosts, AI 요약군, 통합 Library, 전체페이지 캡처, 웹페이지 번역, 탭 이름 변경·멀티 셀렉트 확인 필요) ④ 미검증 항목(Passkey, autofill, OAuth, DRM, TalkBack) ⑤ 비갭(PWA·리딩리스트는 Arc에도 없음) ⑥ Yeoyu 고유 강점(안드로이드 네이티브 통합, 확장, 한·영 UI).

**성공 기준**:
- 자동: 두 문서 존재 · 모든 갭 항목에 Yeoyu 측 근거(파일 경로 또는 project-status.md 섹션) 포함 · 내부 상대 링크 유효(grep 검증)
- 수동: 없음

## Wave 2 (병렬 2 — Wave 1 커밋 후)

### T4 — CI 액션 SHA 갱신

**파일**: `.github/workflows/check.yml`, `.github/workflows/android.yml`

**변경사항**: setup-node → v7.1.0 SHA, setup-bun → v2.2.0 SHA, setup-java·upload-artifact → `gh api`로 최신 확인 후 SHA. checkout은 v7.0.1이 최신이라 유지. SHA는 릴리스 태그 커밋을 `gh api repos/<owner>/<repo>/git/ref/tags/<tag>`로 조회해 주석에 태그 병기(기존 관례 유지).

**성공 기준**:
- 자동: `actionlint`(있으면) 또는 `python3 -c "import yaml,sys; [yaml.safe_load(open(f)) for f in ['.github/workflows/check.yml','.github/workflows/android.yml']]"` 통과 · SHA가 실존 커밋(`gh api` 검증)
- 수동: 병합 후 CI 녹색

### T5 — 문서 동기화

**파일**: `README.md`, `README.ko.md`, `docs/development.md`, `docs/development.ko.md`

**변경사항**: Requirements 표기 → Node 26(.node-version), Bun 1.4.3, Rust 1.99(rustfmt·clippy·aarch64), GeckoView 157이 언급되면 반영, 나머지(SDK 37.1, BT 37.0.0, NDK 27.1, cargo-ndk 4.1.2, JDK 17+) 확인. `cargo install cargo-ndk --version 4.1.2` 등 명령줄 버전 불변.

**성공 기준**:
- 자동: `grep -rnE "22\.21\.1|Node\.js 22|1\.4\.1|1\.98(\.0)?\b|155\.0\.2026" README.md README.ko.md docs/development.md docs/development.ko.md` 매치 없음 — 구버전 표기가 "Node.js 22", "Rust 1.98" 같은 축약형으로도 남지 않도록 패턴에 포함 (계획·리서치·갭 문서는 애초 검색 대상 아님)
- 수동: 없음

## 병합·전체 검증

- Wave 1 종료 후 순차 커밋(T1→T2→T3→T6; 파일 분리라 충돌 없음) → **전체 `sh scripts/check.sh`** + `:app:testDebugUnitTest` 재실행
- Wave 2 커밋(T4→T5) → 전체 check.sh 재실행
- 최종: `scripts/build-android.sh LocalRelease` 로컬 시도(실패 환경이면 CI android 결과로 대체)
- UI 코드 변경이 없으므로 **Gate 4는 생략** — UI 회귀는 기존 UI 계약·기하·접근성 bun 테스트(~85개)와 contrast-check이 담당. 만약 bump가 UI 계약 테스트를 깨뜨리면 그 시점에 Gate 4(스크린샷)를 활성화

## 테스트 전략 (태스크별 검증 수단)

| 태스크 | 성격 | 검증 수단 |
|---|---|---|
| T1 | 타입·의존성 | `bun install --frozen-lockfile`, typecheck, bun test, codegen --check, contrast-check |
| T2 | 툴체인 | cargo fmt/test/clippy (1.99.0 하에서) |
| T3 | 네이티브 의존성 | gradle :app:testDebugUnitTest (+CI android 빌드) |
| T4 | CI 설정 | yaml 파싱 + SHA 실존 검증 + 병합 후 CI |
| T5 | 문서 | grep 잔존 버전 검증 |
| T6 | 문서 | 구조·근거·링크 grep 검증 |

## 리스크

- **TypeScript 6→7**: RN 템플릿 미검증 영역 → 롤백 규칙(T1)
- **GeckoView 155→157**: 87개 Kotlin 파일 커플링 → 롤백 사다리(T3), 실기기 재검증은 수동 목록
- **bun.lock**: bootstrap `--frozen-lockfile` — lockfile 동기 커밋 필수(T1 검증에 포함)
- **prettier 3**: 리포맷 강제 없음 → 버전만 bump, 트리 불변
- **Node 26**: 로컬 node 22 잔존해도 무방(검증 명령 전반이 bun 기반, node 직접 호출 없음 확인)

## 참고 자료

- 리서치: `docs/research/2026-10-11-version-upgrade-arc-gap.md`
- 검증 게이트: `scripts/check.sh`, `scripts/bootstrap.sh`, `.github/workflows/{check,android}.yml`
- 프로젝트 상태: `docs/project-status.md` (갭 분석의 Yeoyu 측 근거 원천)
