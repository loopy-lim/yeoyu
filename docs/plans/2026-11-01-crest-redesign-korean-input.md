# Crest 스킨 리디자인 + cmd+L 한글 입력 수정

- 날짜: 2026-11-01
- 요청: 태블릿 모드 실측 기준으로 디자인 전반 개선(설정 화면 우선), cmd+L 주소 편집기 한글 입력 불가 수정, 디자인 레퍼런스는 [Crest](https://github.com/pauljoda/Crest) + Arc
- 기준 리비전: main @ 4d16fbb (작업 시작 시 clean)

## 목표와 범위

**사용자에게 달라지는 결과**

1. cmd+L(하드웨어 키보드)로 연 주소 편집기에서 한국어 IME 조합 입력이 동작한다.
2. 사이드바가 Space별 딥 컬러 배경 + 배너 아트워크(Crest 언어)로 바뀌고, 콘텐츠 카드는 웜 아이보리 계열로 바뀐다.
3. 설정 다이얼로그의 시각이 하나의 그룹 카드 키트로 통일된다(현재 5곳의 제각각 스타일 소스).
4. 변경은 에뮬레이터 태블릿(가로) 실측 스크린샷과 WCAG 게이트로 증명된다.

**제외**: GeckoView 렌더링 자체, 신규 기능(Arc 갭 문서의 기능 항목), iOS, 정보 구조 재편(Arc 구조 유지 — 사이드바 240/rail 48 치수 유지).

**확인한 근거(조사 요약)**

- cmd+L 흐름: `location.focus` 바인딩(native/src/domain.rs:1456) → InputRouter 소비 → `openLocationEditor("keyboard")`(App.tsx:1305-1310, 1392) → quickOpen 다이얼로그 AddressBox `autoFocus` + **`softInput=false`**(App.tsx:4311) → `showSoftInputOnFocus=false`(AddressBox.tsx:236) → **IME 세션 미시작**. IME 없이는 한국어 조합이 불가능하고 EditText 내장 KeyListener fallback은 라틴 문자만 생성 → "영어는 되고 한글은 안 됨"과 일치. 마우스 탭 경로는 `openLocationEditor("touch")`(softInput=true)라 IME가 시작됨 — 판별 실험으로 확인 예정.
- 네이티브 pre-IME 라우팅은 plain 문자키를 소비하지 않음(RemapEngine.kt:23-35, 기본 keymap에 수정자 없는 바인딩 없음 — domain.rs:1449-1604). 단 addressInputActive 중 plain ENTER pre-IME 소비는 조합 확정을 막을 수 있어 수정 후 실측으로 판단.
- 테마: 35역할 Theme + WCAG 게이트(themeGates.ts — ink 7:1 on sidebar, 잉크 4역할 × 15합성표면 4.5:1 등, bun test + check.sh 양쪽에서 실행). `ink` 하나가 사이드바와 콘텐츠를 동시에 담당하므로 Crest식 딥 사이드바+밝은 잉크는 **사이드바 스코프 전용 파생 테마**로 만들어야 함(단일 역할 교체로는 불가능 — 게이트가 같은 ink의 양쪽 4.5:1을 요구).
- 설정: SettingsDialog는 이미 2판(wide≥820px)+검색 구조. 문제는 시각 일관성 — radius 8/10/24px 하드코딩, 섹션 헤더 3종, 패널별 로컬 스타일 5곳, 아이콘은 네비/consent에만 존재.
- WORKSPACE_PALETTE는 native/src/domain.rs와 미러 관계(양쪽 동시 갱신 필요).
- 스타일링: uniwind 1.12.2 + tailwind 4, 토큰은 theme.ts + global.css `@theme static` 이중 관리(불일치 시 themeScope.test.tsx가 잡음).

**가정과 미해결 결정**

- 한글 원인 H1(IME 세션 미시작)이 최유력 — 에뮬레이터에서 판별 실험 후 확정. H2(제어 컴포넌트 value 라운드트립)는 관찰에서 조합 깨짘이 보이면 그때 처리.
- 팔레트 구체색은 구현 중 게이트 통과 범위에서 확정(Crest 스크린샷 샘플링값 기반).

**사용 가능한 도구·환경**

- 호스트: bun test, tsc, cargo test/fmt/clippy, scripts/check.sh 전체, bun scripts/contrast-check.ts
- 실측: adb `/home/loopy/android-sdk/platform-tools/adb`, 에뮬레이터 emulator-5554(x86_64), `ANDROID_ABIS="x86_64-linux-android" ./scripts/build-android.sh Debug`, 부트스트랩 완료(.deps, node_modules 존재)
- 평가자: 위임 가능(Agent 도구) — G3 코드 리뷰는 독립 평가자로 실행

## 수락 기준

> **방향 수정(2026-11-01 사용자 피드백)**: 딥 사이드바·배너·웜 아이보리 재색상은 취소 — "이전 디자인이 더 좋아보인다, 색은 이전 형태로". 남는 우선순위는 사용성: 한글 입력, 설정 화면 일관성, Space/색상 전환 시 표시가 올바르게 나오는 것. 원 AC-2/AC-3(딥 파생·웜 아이보리)는 폐기하고 아래로 대체했다.

| ID | 관찰할 결과와 적용 조건 | 담당 태스크 | 검증 ID |
|---|---|---|---|
| AC-1 | 한국어 IME로 cmd+L 편집기에 한글 조합(입력·백스페이스 수정·확정)이 동작한다 — 앱 쪽 차단 요소(IME 세션 미확립, 조합 중 ENTER 소비)가 제거된다 | T-1 | V-1 |
| AC-2' | 팔레트·테마는 이전 형태를 유지하고(기준 리비전 값), Space 색상 전환·커스텀 색상이 사이드바/콘텐츠에 올바르게 반영된다 | T-2'(되돌림+검증) | V-2' |
| AC-4 | 설정 다이얼로그 섹션이 하나의 그룹 카드 키트(토큰 radius, 통일 헤더, 카드 내 행)로 렌더링되고 wide/narrow·fontScale 레이아웃이 유지된다 | T-4 | V-3 |
| AC-5 | 태블릿 가로에서 펼침/접힘/분할/설정 화면이 계층·정렬·잘림 없이 렌더링된다 | T-5 | V-4 |
| AC-6 | 기존 전체 게이트(bun test, tsc, cargo, python check, contrast-check)가 통과한다 | T-1~T-5 | V-5 |
| AC-7 | 기존 설정 기능(검색, 라디오/토글, 언어 전환, 키보드 시트 진입, 임시값 draft)이 회귀하지 않는다 | T-4 | V-3, V-5 |

## 설계

### D1. 한글 입력 (T-1)

- **원칙**: `showSoftInputOnFocus=false`는 유지(하드웨어 키보드에서 시각 키보드를 띄우지 않는 현 동작 보존), 대신 **IME 세션만 명시 확립**.
- `BrowserModule.kt`에 `ensureAddressImeSession()` 추가: 하드웨 키보드 존재(`configuration.keyboard != Configuration.KEYBOARD_NOKEYS`) 시 `InputMethodManager.showSoftInput(currentFocus, SHOW_IMPLICIT)` 호출. IME는 하드웨어 모드에서 시각 뷰 없이 InputConnection 세션을 열어 한국어 조합 가능.
- `AddressBox.tsx`의 focus effect에서 `softInput === false` 경로(=cmd+L)에만 platform 호출 추가. `src/platform.ts`에 선택적 메서드 선언(기존 nullable 패턴 동일).
- **조합 확정(Enter) 경계**: addressInputActive 중 pre-IME ENTER 소비가 조합 확정을 막는지 에뮬레이터에서 관찰 후, 문제가 확인되면 RemapEngine이 addressInputActive에서 ENTER을 소비하지 않도록 조정(대신 JS onSubmitEditing 경로로 Enter 처리 유지). 관찰 근거 없이 네이티브를 먼저 바꾸지 않는다.
- 회귀 고정: RemapEngineTest.kt(해당 시) + tests/addressBox.test.ts fixture 갱신. `openLocationEditor`/`closeQuickOpen` 본문은 변경하지 않음(mainInputGeometry.test.ts 보호).

### D2. 테마 파생 구조 (T-2)

- `src/theme.ts`에 순수 함수 추가:
  - `sidebarOverlayTheme(base: Theme): Theme` — base.sidebar의 hue로 딥 표면(목표 휘도 대역)을 만들고, 잉크 역할(ink/inkMuted/inkFaint/icon)을 아이보리 램프로, 반투명 필(pill/favChip/fieldOnChrome 등)을 white-alpha로, 선(hairlineOnChrome 등)을 밝은 알파로 교체. notice/error/drop 계열은 다크 맥락용 파생. 입력값이 Theme이므로 기존 게이트 함수를 그대로 재사용해 검증 가능.
  - `sidebarBands(base: Theme): { deep, band, bandAlt }` — 배너 아트워크용 3색(Space hue 기반). CSS 변수화하지 않고 SVG props로만 소비(35역할 리스트 불변).
- 웜 아이보리 베이스: light 테마의 surface/canvas/sunken/white 등을 웜 톤으로, dark 테마도 톤 정렬. 두 appearance(lavender/warm) 이름·역할 집합은 유지(i18n·테스트 파장 최소화).
- `WORKSPACE_PALETTE`를 Crest 기반 6색으로 갱신 + `native/src/domain.rs` 미러 동시 갱신(신규 Space에만 배정되고 기존 Space 저장색은 불변).
- `themeGates.ts`: 각 base 테마 × Space 색에 대해 **파생 사이드바 테마 게이트**를 추가 수집(같은 gate() 함수 재사용). `scripts/contrast-check.ts`는 gates 소비만 하므로 자동 반영.
- 테스트 갱신: theme.test.ts(게이트·resolveTheme 메모이제이션), themeScope.test.tsx(CSS 변수·색값 고정분), uiClasses.test.ts(필요 시).

### D3. 사이드바 크롬 (T-3)

- 신규 `src/chrome/SidebarBanner.tsx`: react-native-svg로 하단 배너 아트워크(Crest 로고의 스왈로테일+대각 밴드 모티프). 색은 `sidebarBands`에서 props로.
- App.tsx 사이드바 레이어를 파생 테마의 ThemeScope로 래핑(컴포넌트 트리 변경 최소화 — 사이드바 내부 className은 그대로 잉크 역할을 씀). 레일(접힘 상태)도 동일 스코프.
- AddressTrigger 필: 라운드 필 강화 + favicon/shield 정돈(구조 유지).
- 사이드바 푸터를 Crest식 플로팅 필 툴바로 정돈(스페이스 전환·설정 진입 유지, 기능 로직 변경 없음).
- 즐겨찾기 타일 라운딩/간격 정돈.

### D4. 설정 키트 (T-4)

- 신규 `src/components/settings/kit.tsx`(파일명 구현 시 확정): `SettingsGroup`(섹션 헤더+inset 카드), 공통 헤더/행 스타일. radius·간격은 토큰(radius.card/control 등)만 사용.
- SettingsDialog.tsx + 6개 패널(Appearance/Consent/Extensions/BrowserData/BrowserTools/PiP)을 키트로 이관. 로컬 c 상수의 하드코딩 px를 토큰 클래스로 교체.
- 레이아웃 계약 유지: wide 820px/fontScale 1.5 분기, SettingsRow onLayout 측정, a11y 라벨, draft 동작(settingsDialog.test.ts가 고정).
- 새 카피는 i18n en/ko 동시 추가(i18n.test.ts 하드코딩 스캔).

### D5. 개발 용이성 (요청 반영)

- 새 디자인 표면은 전부 토큰 경유. App.tsx에는 래핑·임포트 수준의 최소 diff만 허용하고 로직/스타일을 키우지 않는다.
- theme.ts의 파생 함수에 계약 주석(게이트 포함)을 남겨 다음 디자인 작업의 진입점으로 삼는다.

### UI 상태 (review-design 설계 모드)

- 대상 화면: 가로 태블릿(에뮬레이터 2560×1440 급으로 wm size 조정해 실측), 폰트 스케일 1.0/1.35.
- 핵심 상태: 사이드바 펼침/접힘/분할, 설정 wide/narrow, 다이얼로그 위 주소 편집기(빈 URL/URL 존재), 라이트/다크, Space 6색.
- 접근성: 게이트가 색 대비를 강제, 라벨은 i18n 테스트가 강제, 터치 타깃은 기존 size 토큰 유지.
- 디자인 출처: Crest 웹 자산 스크린샷에서 샘플한 색(#AC8431/#55805E/#DA4532/#1C2939/#F3EFE5) + Arc 구조(현행 유지).

## 태스크

| ID | 목적·AC | 수정할 파일/경계 | 선행 | 검증 | 상태 |
|---|---|---|---|---|---|
| T-1 | AC-1 한글 입력 수정 | src/components/AddressBox.tsx, src/platform.ts, android/.../BrowserModule.kt, android/.../RemapEngine.kt, tests/addressBox.test.ts(+fixture), RemapEngineTest.kt | 없음 | V-1 | done |
| T-2' | AC-2' 딥 파생·팔레트 변경 되돌림(사용자 결정), 이전 팔레트에서 Space 색 전환 검증 | src/theme.ts, src/themeGates.ts, native/src/domain.rs, tests/themeScope.test.tsx, src/App.tsx(래핑 제거), src/chrome/SidebarBanner.tsx(삭제) | 없음 | V-2' | done |
| T-3' | 주소 필 파비콘(사이트 식별 — 색 불변 사용성 개선만 유지) | src/components/AddressTrigger.tsx | 없음 | V-4 | done |
| T-4 | AC-4, AC-7 설정 키트 통일 | src/components/settings/kit.tsx(신규), SettingsDialog.tsx, 패널 6종 | 없음 | V-3 | in-progress(위임) |
| T-5 | AC-5, AC-6 통합 검증·실측 | 없음(검증만) — 결함 시 원인 태스크로 되돌림 | T-1~T-6 | V-4, V-5 | done |
| T-6 | **사용자 제보 결함(실측 중 발견)**: 릴리스 빌드에서 설정 ScrollView 제스처 전멸. 원인 2겹: (1) 키트 group 카드의 `overflow-hidden`이 스크롤 콘텐츠 안에서 릴리스 제스처를 깨뜨림(제거로 해결), (2) uniwind 1.12.2가 동일 증상 유발(1.12.1 핀 고정). 에뮬레이터 x86 수용 빌드로 6점 bisect로 확정 | package.json, bun.lock, src/components/settings/kit.tsx | 없음 | V-4' | done |

## 검증 계획과 결과

| ID | 방법 | cwd·환경 | 기대 결과 | 실제 | 판정 |
|---|---|---|---|---|---|
| V-1 | 사용자 물리 태블릿(TB522FU) + Gboard 한국어(두벌식): Ctrl+L → 한글 키 주입 → uiautomator 관찰. 수정 빌드에서 "가" 조합 확인 + logcat으로 IME 세션(onStartInput, Uri 필드 바인딩) 확립 확인. 최종 판별(실물 키보드 조합)은 사용자 확인 필요 | HA2H8QSD 실측 | 조합·확정 동작 | "가" 조합 + IME 세션 확립 확인, RemapEngineTest 17·addressBox 4 통과 | PASS(주입 경로) / 실물 키보드 확인 대기 |
| V-2' | 되돌림 확인: git checkout으로 theme/gates/palette 원복 + contrast-check·bun test | repo root | 게이트 통과, 팔레트=기준 리비전 | 0 fail, 전체 bun 577 통과 | PASS |
| V-3 | 설정 관련 bun test 7종 (키트 적용 후) | repo root | 기존 계약 유지 | 17 pass / 0 fail + 전체 577 pass | PASS |
| V-4 | 태블릿(가로) 수용 빌드 관찰: 이전 디자인 복원(다크/라이트), 설정 그룹 카드, 스크롤 | HA2H8QSD | 계층·정렬·잘림 없음, 스크롤 동작 | 다크/라이트 설정 카드 확인. **스크롤 불가 결함 발견 → T-6으로 수정**, 태블릿 재검증은 USB 재연결 후 | 재검증 대기 |
| V-4' | **T-6 수정 검증**: 최종 코드(키트 overflow-hidden 제거 + uniwind 1.12.1 핀) × x86 수용 빌드 신규 설치 → 설정 Appearance 스와이프 → 스크롤 이동 확인 | emulator-5554 | 스크롤 동작 | 스와이프 후 페이지 이동 확인(스크린샷), 그룹 카드 외형 유지 | PASS |
| V-4'' | T-6 태블릿 재검증: 수정된 ARM64 수용 APK 설치 + 설정·한글 재확인 | HA2H8QSD (USB 재연결 필요) | 스크롤·한글 동작 | APK 빌드 완료(arm64), 기기 분리로 미설치 | BLOCKED(기기 연결 대기) |
| V-5 | `./scripts/check.sh` 전체 | repo root | 모두 통과 | exit 0 (cargo fmt/test/clippy 53, bun 577, python, contrast, tsc, codegen --check) | PASS |
| V-6 | Kotlin 유닛테스트 (리뷰어 요청) | repo root, gradle | RemapEngineTest 등 통과 | `:app:testDebugUnitTest` 17 run 0 failed | PASS |

## 평가와 인계

- G3 코드 리뷰: 위임 독립 평가자(Agent) — 원 요청·계획·diff·검증 기록 전달, 작성자 PASS 주장 미포함.
- G4 디자인: review-design 구현 모드, V-4 실측 스크린샷 기반. 스크린샷 관찰 없는 시각 PASS 없음.
- 위험: 팔레트 변경의 기존 스냅샷 영향(없음 — Space 색은 저장값 유지), 네이티브 키 경로 변경 시 RemapEngineTest 동시 갱신.
