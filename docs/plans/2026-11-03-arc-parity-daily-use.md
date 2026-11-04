# Arc 패리티 — 일상 사용 슬라이스 1 (저장 split 그룹 + Site Search)

- 날짜: 2026-11-03
- 요청: "Arc 브라우저처럼 사용할 수 있도록 해줘. 벤치마킹은 Arc 브라우저, Crest로 진행"
- 기준 리비전: main @ ecf499b (2026-11-03) + 다른 세션의 Crest WIP 22파일이 worktree에 존재 — 공유 파일은 최소 diff 원칙

## 목표와 범위

**사용자에게 달라지는 결과**

1. 사용자가 만든 분할 화면(Split)이 이름 붙은 그룹으로 저장되고, 나중에(다른 세션·재시작 후에도) 한 번에 복원된다 — Arc의 저장 split group, Crest의 Split View 그룹에 해당.
2. 주소창에서 `키워드 검색어` 형태로 등록된 사이트 검색(Site Search)을 쓸 수 있다 — 예: `gh rustra` → GitHub 검색. 사용자가 키워드·이름·URL 템플릿을 등록·편집한다 — Arc의 Site Search, Crest의 커스텀 검색 엔진에 해당.

**이번 슬라이스에서 제외 (후속 SDD 분리)**

- 기기 간 동기화(Arc Sync 대응) — 파일 기반 설계 자체가 필요한 별도 과제
- 탭 이름 변경, 탭 멀티 셀렉트, Peek, Link Routing 확장, 번역 — 갭 문서 medium 이하, 후속

**벤치마크 근거**

- Arc 갭 문서: `docs/arc-gap-analysis.ko.md` — 저장 split group(High, "Rust가 소유하는 revisioned snapshot의 자연스러운 확장"), Site Search(High, "기존 suggestion pipeline에서 작은 변경")
- Crest README 기능 전수(2026-11-03 조사): Split View "2~4개 라이브 페이지를 하나의 그룹으로", 통합 필드의 커스텀 검색 엔진, 사이드바 구조(pins·folders) — 여유는 pins/folders 보유, split 그룹 저장이 빠진 형태

## 확인한 근거(조사 요약 — 조사 에이전트 보고서, 2026-11-03)

- **split은 JS 런타임 전용**: Rust command·snapshot 필드 없음. `useState` (App.tsx:455), 유효성 게이트 `liveSplitLayout` (sidebarModel.ts:16-24), App.tsx:810-840의 Space·모드 교차 무효화. 탭 ID 기반이라 저장하려면 URL 기반 모델 필수(비공개 탭 제거 규칙 privateTabs.ts:7-22 준수).
- **snapshot 확장 패턴**: `#[serde(default)]` 필드 추가는 버전 무변경으로 안전(선례 bookmarkFolders, domain.rs:150-151; 테스트 native/tests/domain.rs:346-355). 신규 command는 lib.rs `register!` 목록 **말미 추가** + `bun run codegen`(generated/* 재생성). 검증은 validate_snapshot 폴더 블록(domain.rs:1106-1131) 미러.
- **설정 저장 위치**: 검색 엔진 포함 uiPreferences는 Android SharedPreferences "browser-ui"/"preferences"의 불투명 JSON(BrowserModule.kt:294-299) — **Kotlin 변경 불필요**. sanitize 선례 sanitizeBoosts(uiPreferences.ts:281-288).
- **충돌 위험**: App.tsx는 다른 세션 WIP(139줄)와 공유 — 설정 UI는 WIP의 `SettingsGroup` 키트(src/components/settings/kit) 재사용, 패널 컴포넌트는 건드리지 않음. Rust·controller·suggestions·uiPreferences·i18n은 WIP-free.
- **테스트 기반**: tests/splitLayout.test.ts(6), splitFinalGeometry.test.tsx(8), suggestions.test.ts(3), uiPreferences.test.ts, native/tests/domain.rs(~30). searchEngine 자체 핀 없음 — 신규 핀 필요.

## 설계

### D1. 저장 Split 그룹 (T-1~T-2, T-5)

- **저장소: Rust snapshot**(갭 문서 권고 — "revisioned snapshot의 자연스러운 확장"; 향후 work archive/sync 경로 태승). uiPreferences 폴백은 채택하지 않음 — Space 귀속·보관 파일 이동이 요구본질.
- `native/src/domain.rs`에 `SplitGroup { id, workspace_id, name, orientation, ratio, first_title, first_url, second_title, second_url }` — camelCase serde. `Snapshot.split_groups: Vec<SplitGroup>` `#[serde(default)]` 추가(버전 무변경).
- **URL 기반 저장**(탭 ID 저장 금지 — 세션 종속·비공개 제거). 복원은 기존 tabCreate 2회 + 런타임 splitLayout 지정(App.tsx, open_bookmark_with_mode 선례).
- validate_snapshot: 폴더 블록 미러 — id 비어있지 않고 유일, workspace 존재, orientation ∈ {horizontal, vertical}, ratio ∈ 0.25..=0.75(clampSplitRatio 일치), URL 절대주소(북마크 URL 규칙 미러), **Workspace당 20개 상한**(초과 저장은 도메인이 거부 — 목록 UI 길이·검증 비용 근거, 계획서 상안 확정).
- 신규 command 2개: `splitGroupSave`(id 있으면 upsert, 없으면 도메인이 id 생성 — bookmarkCreate 선례), `splitGroupRemove(id)`. 등록은 register! 말미. codegen 재생성.
- Controller: GeneratedCommands Pick + thin 메서드 + `!this.commands.x` 가드 선례 준수.
- UI(App.tsx 최소 diff): 라이브 split 존재 시 "분할 저장" 액션(현재 first/second 탭의 URL·제목·ratio·방향을 프리필) → 이름 입력 → save. 목록은 탭 섹션의 "분할 그룹" 영역 — 항목 탭 = 복원(두 탭 생성 후 splitLayout 지정), 길게/메뉴 = 삭제. Space별 필터는 기존 사이드바 Space 귀속 규칙 따름.
- 런타임 유효성 게이트 3종(sidebarModel·App 810-840)은 그대로 유지 — 저장 그룹과 무관하게 복원 시점 재판정.

### D2. Site Search (T-3~T-4, T-6)

- **저장소: uiPreferences**(Kotlin 변경 0, sanitize·자동저장 무상). 스냅샷 홈은 채택하지 않음 — 검색엔진 프리셋과 동급의 앱 설정이고 archive 이동 불필요.
- `src/uiPreferences.ts`: `SiteSearchEntry { id, keyword, label, urlTemplate }`, `UiPreferences.siteSearches`(기본 []), action `{type:"setSiteSearches"}`, restore sanitize — keyword `^[a-zA-Z0-9_-]{1,32}$`(저장 시 lowercase 정규화, 대소문자 무관 유일), urlTemplate은 `%s` 1회 포함, 최대 32개, 무효 항목은 복원 시 탈락(sanitizeBoosts 선례).
- `src/suggestions.ts`: `resolveSiteSearch(input, entries): string | null` 순수 함수 — `키워드 공백 나머지` 매칭, 나머지를 encodeURIComponent 후 `%s` 치환. 공백 있으면 기존 URL 판별과 무충돌(DOMAINISH는 공백 거부). 정합 우선순위: Site Search > 일반 엔진.
- 호출부(YeoyuWindow.tsx:365, App.tsx:3806·4314): resolveSiteSearch 선적용 → null이면 normalizeInput 기존 경로. 제안 목록에는 키워드 접두 입력 시 "label — 사이트 검색" 힌트 행 1개(기존 suggestion pipeline에 작은 확장).
- 설정 UI: 검색 엔진 SettingsGroup 옆 형제 그룹(WIP 키트 재사용) — 목록·추가(키워드/이름/URL 템플릿 폼)·삭제. 신규 카피 i18n en/ko 동시 추가(i18n 테스트 하드코딩 스캔 준수).

### D5. 개발 용이성

- App.tsx에는 액션 배선·설정 그룹 수준의 최소 diff만. 순수 로직(resolveSiteSearch, 저장 그룹 프리필 수집)은 suggestions.ts/splitLayout.ts/domain.rs에.
- 생성물은 codegen 재생성만(수동 편집 금지 — codegen --check).

## 태스크

| ID | 목적·AC | 수정할 파일/경계 | 선행 | 검증 | 상태 |
|---|---|---|---|---|---|
| T-1 | AC-1·2·5 Rust SplitGroup 모델+command | native/src/domain.rs, native/src/lib.rs, native/tests/domain.rs, generated/*(codegen) | 없음 | V-2(Rust), V-5 | pending |
| T-2 | AC-1 Controller 노출 | src/BrowserController.ts, tests/controller.test.ts | T-1 | V-3 | pending |
| T-3 | AC-4 Site Search 데이터 계층 | src/uiPreferences.ts, tests/uiPreferences.test.ts | 없음 | V-3 | pending |
| T-4 | AC-3 키워드 해석+제안 힌트 | src/suggestions.ts, src/YeoyuWindow.tsx, tests/suggestions.test.ts | T-3 | V-3 | pending |
| T-5 | AC-1·2 Split 그룹 UI(저장·목록·복원·삭제) | src/App.tsx(최소 diff), src/i18n.ts | T-2 | V-1, V-3 | pending |
| T-6 | AC-4 Site Search 설정 UI | src/App.tsx(형제 그룹), src/i18n.ts | T-4 | V-2, V-3 | pending |
| T-7 | AC-5 통합 검증·실측 | 없음(검증만) | T-1~T-6 | V-4, V-5 | pending |

## 검증 계획과 결과

| ID | 방법 | cwd·환경 | 기대 결과 | 실제 | 판정 |
|---|---|---|---|---|---|
| V-1 | 에뮬레이터 수용 빌드 실측: split 생성→저장→재시작→복원→삭제 | emulator-5554 | 배치(방향·비율) 유지 복원, 재시작 후 존속 | **2026-11-04 재실측**: 2탭 상태에서 분할 상자 후보 정상 렌더 → 상대 탭으로 **분할 생성 성공**(오버레이가 좌패널 좌표로 이동 = 2패널 지오메트리 확인) → 팔레트 "Save Split View as group" 탭 → **저장 다이얼로그 개봉·이름 프리필 확인**. 미완료 구간: Save 버튼 → 재시작 → 복원 → 삭제(에뮬레이터를 병행 세션과 선점 경합하며 앱이 강제 종료됨 — F-4). 도메인·컨트롤러 저장/복원/삭제는 V-2·V-3 단위 검증 PASS | BLOCKED(F-4 해소 후 잔여 구간 재검증) |
| V-2 | bun test: uiPreferences sanitize·suggestions·splitLayout 신규 핀 | repo root | 신규+기존 전부 통과 | **581 pass / 0 fail** (site search 4핀 + controller fixture 포함) | PASS |
| V-3 | cargo test: domain 신규 검증·상한·upsert/remove | native | 신규+기존 전부 통과 | domain **58 pass / 0 fail** (split group 5테스트 신규), fmt·clippy 클린 | PASS |
| V-4 | 에뮬레이터 G4 관찰: 설정 UI·주소창 흐름 스크린샷 | emulator-5554 | 계층·잘림 없음, 키보드 흐름 동작 | SITE SEARCH 그룹 렌더 확인, 폼으로 `gh`/`GitHub`/`https://github.com/search?q=%s` 추가 성공(행+삭제 버튼 렌더), 주소창 `gh react` → **"Repository search results · GitHub" 이동 확인**. 스크린샷 3장(evidence-2026-11-03/) | PASS |
| V-5 | `./scripts/check.sh` 전체 | repo root | exit 0 | **exit 0** (cargo fmt/test/clippy, bun 581, python 75 OK, contrast, tsc, codegen --check). 최초 실행의 python 54건 실패는 어제 앱 ID 변경 시 테스트 픽스처 상수 미갱신 내 회귀 — 수정 후 통과 | PASS |

## 발견 결함 (F-*)

- **F-1 (기각 — 결함 아님, 2026-11-04 확정)**: "시트에서 후보 행 미렌더"는 내 자동화의 상태 착각이었다. 확정 경위: ① ActionMenu 격리 테스트 PASS(컴포넌트 무결립), ② 실측에서 탭이 1개뿐인 상태(사이드바 "+"는 `openQuickOpen("touch")` — 탭을 만들지 않고 퀵오픈만 띄움)의 분할 상자는 후보가 0개라 **비어 있는 것이 정상**, ③ 2개 탭 상태에서는 시트에 후보 행("om - Google 검색")이 정상 렌더되고 탭으로 분할 생성까지 성공. 초기 관측을 오염시킨 것: (a) uiautomator dump가 UiAutomation 이중 등록 크래시 후 파일을 갱신하지 못해 계속 stale XML을 읽음, (b) Gboard가 시트를 덮어 후보 탭이 키보드 키로 향함, (c) 다른 세션과의 에뮬레이터 선점. 교훈은 dump마다 파일 삭제·재생성 검증과 키보드 닫기 선행
- **F-4 (환경, 신규)**: 에뮬레이터가 병행 세션(leftcar)과 공유되며 상호 포그라운드 선점으로 검증이 상호 오염됨 — AVD 분리(`avdmanager`로 전용 AVD 생성) 또는 세션 간 시간 분할 필요

- **F-2 (P3, 수정 완료)**: 어제 앱 ID 변경(`b580149`) 시 python 측정 테스트 픽스처 상수(`tests/test_browser_device_guard.py` ACCEPTANCE/NORMAL, `tests/test_measure_browser_soak.py` PACKAGE)를 갱신하지 않아 check.sh python 단계 54건 실패 — 상수 갱신으로 수정, 75/75 통과
- **F-3 (관찰)**: 라이브 split 중 새 탭 생성이 `setSplitLayout(null)`로 분할을 조용히 해제함(App.tsx 기존 동작) — 저장 UX상 사용자가 의도를 잃을 수 있음. 후속 UX 과제로 기록


## 평가와 인계

- G3 코드 리뷰: 위임 독립 평가자(Agent) — 원 요청·계획·diff·검증 기록 전달, 작성자 PASS 주장 미포함.
- G4 디자인: review-design 구현 모드 — 에뮬레이터 실측 스크린샷 기반. 스크린샷 관찰 없는 시각 PASS 없음.
- 위험: App.tsx는 다른 세션 WIP와 공유 — 현재 worktree 상태 기준 additive diff만, i18n 키 충돌 사전 grep.


## 사용 가능한 도구·환경

- 호스트: bun test, tsc, cargo test/fmt/clippy, scripts/check.sh, bun scripts/contrast-check.ts
- 에뮬레이터: emulator-5554(x86_64), `ANDROID_ABIS="x86_64-linux-android" ./scripts/build-android.sh Acceptance`
- 평가자: 위임 가능(Agent 도구) — G3 코드 리뷰는 독립 평가자로 실행

## 수락 기준

(조사 완료 후 G1에서 확정 — 초안)

| ID | 관찰할 결과와 적용 조건 | 담당 태스크 | 검증 ID |
|---|---|---|---|
| AC-1 | 분할 중인 두 탭을 그룹으로 저장하고, Space 목록 어디에서든 다시 열면 두 탭이 같은 배치(방향·비율)로 복원된다 | T-1 | V-1, V-3 |
| AC-2 | 저장한 그룹은 앱 재시작 후에도 남아 있고, 그룹 삭제가 동작한다 | T-1 | V-1, V-2 |
| AC-3 | 주소창에서 등록 키워드+공백 입력 시 해당 사이트 검색으로 이동하고, 일반 검색·URL 판별은 회귀하지 않는다 | T-2 | V-2, V-3 |
| AC-4 | Site Search 항목을 설정에서 추가·편집·삭제할 수 있다 | T-2 | V-2 |
| AC-5 | 기존 전체 게이트(bun test, tsc, cargo, check.sh, contrast)가 통과한다 | 전체 | V-5 |

## 설계

(조사 결과 반영 후 확정)

## 태스크

(조사 결과 반영 후 확정)

## 검증 계획과 결과

(확정 후 기록)

## 평가와 인계

- G3 코드 리뷰: 위임 독립 평가자(Agent) — 원 요청·계획·diff·검증 기록 전달, 작성자 PASS 주장 미포함.
- G4 디자인: review-design 구현 모드 — 에뮬레이터 실측 스크린샷 기반. 스크린샷 관찰 없는 시각 PASS 없음.
- 위험: App.tsx·설정 패널은 다른 세션 WIP와 공유 — 최소 diff, 충돌 시 순서 조정.
