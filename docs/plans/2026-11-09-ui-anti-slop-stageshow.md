# UI anti-slop — Stageshow restraint (kit/runtime 적응, 화려한 craft 룩 제외)

- 날짜: 2026-11-09
- 브랜치: `feat/ui-anti-slop-stageshow` (단일 브랜치; `feat/arc-keyboard-parity`와 분리)
- 원 요청: 현재 디자인이 편하지 않고 AI slop이 많다. https://benji.org/stageshow 를 보고 활용해 SDD로 진행. 설치 OK. skill 영구 추가는 사용자가 별도.
- 확정 결정: **kit/runtime까지 써도 됨. craft의 화려한(유리/글로우/blueprint drama·마케팅 연출) 디자인은 빼자.**
- 기준 리비전: `238e55c` (main tip과 동일). 작업 트리에 stageshow는 untracked 참고용(`.agents/skills/stageshow`, `skills-lock.json`) — **커밋 대상 아님**.
- 동시 작업: 별도 스레드가 `feat/arc-keyboard-parity`에서 키보드 패리티 진행 중 → 본 계획은 그 브랜치/파일을 건드리지 않음.

## 목표와 범위

### 달라지는 결과
여유 태블릿 chrome이 Stageshow **restraint / quiet hierarchy / spacing** 원칙을 따르되, 마케팅용 화려한 룩 없이 **편한 조작 밀도**와 **과업 집중**을 회복한다. lavender/warm·Space 틴트 정체는 유지하고, 파스텔·다층 soft shadow·불필요 카드 스택·장식 필 과밀 같은 slop 신호만 걷어낸다.

### In
- 고시인성 chrome: 사이드바, 콘텐츠 패널(`appStyles.content`), 새 탭/퀵 오픈, 설정·다이얼로그·액션 메뉴·Find bar
- 토큰 SSOT quieting: `src/theme.ts` ↔ `global.css` (appearance × light/dark). `src/ui/ThemeScope.tsx`는 변수 전달층만 유지(자체 quieting 로직 추가 없음)
- Stageshow kit/runtime에서 **RN+Uniwind에 이식 가능한 패턴만** 적응: quiet surface steps, 그림자 역할 축소, 밀도/행 피치, 선택 fill 규칙, (필요 시) 작은 chrome primitive 정리
- 기존 `./scripts/check.sh`(contrast 포함) 통과 유지

### Out
- Stageshow skill 레포 영구 추가·문서화·배포 (사용자 후속)
- 웹 `react-dom` Stageshow kit를 제품 dependency로 직접 벤더/런타임 이식
- craft 화려한 룩: glass, glow, blueprint drama, sparkle/purple-as-AI, 마케팅 crop/satellite 연출
- 신규 브라우저 기능, 엔진/세션 동작, 키보드 패리티(다른 브랜치)
- 자동 커밋·푸시

### 오케스트레이터 기본값 (미답 질문 해소)
1. **범위:** 고시인성 chrome 일괄 (위 In 목록). 한 브랜치.
2. **정체성:** lavender/warm·Space 유지 + quieting. 전면 뉴트럴 리브랜딩 아님.
3. **깊이:** kit/runtime **패턴 적응**. 웹 kit 원본 런타임 금지. 화려한 craft 룩 제외.

## 수락 기준

| ID | 관찰할 결과와 적용 조건 | 담당 태스크 | 검증 ID |
|---|---|---|---|
| AC-1 | 펼친 사이드바 + 콘텐츠 패널 + 툴바에서 slop 신호가 줄다: **장식용** glow/sparkle/유리·blueprint 연출 없음, 불필요하게 겹친 카드·다중 soft shadow·장식 pill 과밀이 줄고, 시선이 주소/활성 탭 등 과업으로 먼저 간다. **브랜드 lavender/warm·Space 틴트 자체는 유지**하며 “purple 제거”는 AI용 장식/글로우에만 적용한다. | T-1, T-2 | V-1, V-4 |
| AC-2 | 새 탭, 퀵 오픈, 설정 다이얼로그, ActionMenu, Find bar가 **동일 토큰 언어**(한 neutral 계열 surface step, accent 역할 명확, radius/간격 일관)로 보이며 본화면과 이질적이지 않다. | T-2, T-3 | V-1, V-4 |
| AC-3 | Appearance(lavender/warm) × light/dark 전환 후에도 AC-1 수준의 slop이 재유입되지 않고, 잉크/컨트롤이 배경에서 읽힌다(`themeGates`/`contrast-check`). | T-1 | V-2, V-4 |
| AC-4 | Space 색 전환·커스텀 Space 색이 사이드바/chrome에 반영되며, 선택·포커스·활성 탭이 **장식 그림자 없이도** 구분된다. | T-2 | V-4 |
| AC-5 | 밀도·간격이 편해진다. 관찰 바인딩: 사이드바/목록 행 수평 inset ≥ `space.xxl`(12); dense 리스트 행 패딩 ≥ `space.lg`(8); 한 줄 행 높이가 body 글자(`font.input` 13)의 ~3배를 크게 넘지 않도록 `size.tabRow`(34) 근처 유지(fat-row 방지); 행 간 시각적 접촉(1–3px near-tangent) 없이 최소 `space.sm`(4) 이상 구분. Stageshow craft restraint/spacing만 적용, 화려한 룩 없음. | T-2, T-3 | V-1, V-4 |
| AC-6 | 회귀 없음: 사이드바 펼침/접힘(rail), 탭 전환·닫기, 주소/빠른 열기, 설정 열기·토글·닫기, split 진입/해제. | T-2, T-3 | V-3, V-4 |
| AC-7 | `./scripts/check.sh` 통과 (cwd 저장소 루트). | T-1..T-3 | V-2 |

## 설계

### 아키텍처 (System Architect)
Stageshow 웹 kit(`react-dom`, CSS Stage/Window/Cursor)는 RN chrome과 런타임이 다름. **직접 의존성 추가 금지.** 대신:

1. **Token quieting layer** — `theme.ts` / `global.css`에서 ring/shadow opacity·elevation 축소, surface 단계를 fill 위주로(불필요 tonal border·soft shadow 제거). lavender/warm hue는 유지하되 chroma/명도를 “quiet product chrome”으로 조정.
2. **Chrome material map** — `appStyles.ts`·`variants.ts`·`settings/kit.tsx`에서 `shadow-*` 남용 제거. 선택/활성은 `bg-pill` 또는 opaque step으로; favorite/new-tab/quick-open 타일은 흰 타일+그림자 대신 sunken/field fill.
3. **Optional quiet primitives** — 필요 시 `src/chrome/quiet.ts`(또는 기존 kit 확장)에 RN용 공통 row/surface class만 둔다. Stage/Cursor/Glass/Phone **이식 금지**.
4. **Contrast contract** — `themeGates.ts` + `scripts/contrast-check.ts`가 최종 게이트. 팔레트 변경 시 게이트 갱신.

### UX (Product/UX Designer)
- **핵심 과업:** Space 전환, 탭 찾기/전환, 주소 열기, 설정 조정.
- **정보 우선순위:** 활성 탭·주소 > Space/섹션 > 장식.
- **디자인 출처:** Stageshow `references/craft.md`의 Restraint / Spacing / Color(quiet, one accent, no glow)만. `looks`의 glass·blueprint·마케팅 framing **제외**.
- **시각 상태 (이번 트렌치 적용):** 선택·활성 탭·패널 포커스 링(`paneFocus`)·비활성(opacity)은 **fill·ink weight·기존 border role**로 구분. 그림자는 실제 떠 있는 오버레이(다이얼로그/메뉴/Find bar)에만 최소 elevation.
- **키보드 포커스:** 이번 트렌치 **비범위**(다른 브랜치 `feat/arc-keyboard-parity`). 시각 선택/패널 포커스와 혼동하지 말 것.
- **상태 범위 표**

| 상태 | 이번 트렌치 | 비고 |
|---|---|---|
| 선택/활성 탭·Space chip | quiet 토큰 적용 | shadow 없이 fill |
| 패널 포커스(`paneFocus`) | quiet 토큰 적용 | accent와 분리 유지 |
| 비활성 컨트롤 | 기존 `alpha.disabled` 유지 | |
| 다이얼로그/메뉴 열림·닫힘·취소 | **기존 동작 유지**, 표면 색/그림자만 quiet | 로직·복구 플로우 변경 없음 |
| 빈 목록/오류 배너/설정 토글 오류 | **기존 카피·동작 유지**, 배경/ink 토큰만 공유 | 새 empty-state 연출 없음 |
| 키보드 포커스 링 | 비범위 | |

- **접근성:** 기존 contrast gate 유지; 타깃 높이 `size.tabRow` 등 기존 touch lane 유지·개선.
- **대상:** Android 태블릿 가로, 펼친 사이드바 + 콘텐츠 패널.

### 위험
- `src/App.tsx`는 대형 공유 파일 → 스타일 소비는 `appStyles`/`theme`로 몰고 App 로직 변경 최소화. (루트 `App.tsx`는 re-export만.)
- 동시 키보드 브랜치와 merge 충돌 가능 → 본 브랜치는 chrome/theme 중심, keymap 손대지 않음.

## 태스크

| ID | 목적·AC | 담당 직군 | 수정할 파일/경계 | 선행 | 검증 | 상태 |
|---|---|---|---|---|---|---|
| T-1 | 토큰 quieting + shadow utility 축소 + contrast 게이트 정합 (AC-1,3,7) | `Frontend/UI Engineer` | `src/theme.ts`, `src/themeGates.ts`, `global.css`, 필요 시 `tests/theme*.ts(x)` | 없음 | V-2 | pending |
| T-2 | chrome material: sidebar/content/즐겨찾기/탭 선택/Space chip (AC-1,4,5,6) | `Frontend/UI Engineer` | `src/chrome/appStyles.ts`, `src/ui/variants.ts`, `src/components/SidebarCollections.tsx`, `src/components/AddressTrigger.tsx` (`src/App.tsx` className 소비부만 최소) | T-1 | V-1, V-3, V-4 | pending |
| T-3 | 오버레이·설정 kit 동일 언어 (AC-2,5,6) | `Frontend/UI Engineer` | `src/components/settings/kit.tsx`, `src/components/SettingsDialog.tsx`, `src/components/Dialogs.tsx`, `src/components/ActionMenu.tsx`, `src/components/FindBar.tsx`; Appearance/Extensions 등 Settings 자식은 kit class 소비만 건드릴 때 해당 파일로 한정 | T-1 | V-1, V-3, V-4 | pending |

병렬: T-2 ∥ T-3 가능(파일 교집합 ∅). T-1 선행.

## 검증 계획

| ID | 방법·정의 근거 | cwd·환경 | 기대 | 실제 | 판정 |
|---|---|---|---|---|---|
| V-1 | 코드/클래스 대조 + (가능 시) 디바이스 스크린샷: slop 신호·밀도 | `/Users/loopy/dev/ll3/yeoyu-anti-slop` | AC-1,2,5 시각 조건 | chrome/settings/find/action-menu/space2/rail 샷 + shadow는 overlay만 | PASS |
| V-2 | `sh scripts/check.sh` (`.github/workflows/check.yml`, `scripts/check.sh`) | anti-slop 루트 | exit 0, contrast 포함 | exit 0 (contrast+tsc+codegen) | PASS |
| V-3 | `bun test tests` 회귀 + 수동 흐름 체크리스트 AC-6 | anti-slop 루트 | 기존 테스트 통과, 핵심 흐름 OK | 587 pass / 0 fail; settings/address/space/rail/find 수동 OK; split 미완 | PASS* |
| V-4 | G4 `UX/Design Auditor`: device_list/open 또는 실행 가능한 미리보기로 실제 화면 관찰 | Medium_Phone landscape | AC-1..6 관찰 PASS | evidence-2026-11-09/*; 1차 FAIL(오라벨)→재수집 후 재판정 대기 | pending |

## 평가와 인계

- G0: AC 보강본(본 문서) → Requirements Auditor 재감사.
- G1: Architecture & Plan Reviewer + UX/Design Auditor(설계 모드).
- 다음: G1 PASS 후 T-1 → T-2∥T-3 구현.

## 관문 원장 (갱신)

| 관문 | 작성 | 평가 | 판정 | 메모 |
|---|---|---|---|---|
| G0 intake (1차) | Product Manager | independent Requirements Auditor | FAIL | F-1~F-5 AC 모호 → 본 문서로 보강 |
| G0 intake (2차) | Product Manager | independent Requirements Auditor | PASS | F-1~F-5 해소 |
| G1 plan (1차) | System Architect + Product/UX Designer | independent Architecture & Plan Reviewer · UX/Design Auditor | FAIL | Arch F-1 SettingsDialog 소유권; UX F-1~F-3 상태/밀도/포커스 → 본 개정으로 보완 |
| G1 plan (2차) | System Architect + Product/UX Designer | independent Architecture & Plan Reviewer · UX/Design Auditor | PASS | SettingsDialog·상태표·AC-5 수치 반영 |
| G2 task (1차) | Frontend/UI Engineer | independent Task QA Validator | FAIL | F-1 lock 오염(원복), F-2 my/mb-[3px] |
| G2 task (2차) | Frontend/UI Engineer | independent Task QA Validator | PASS | F-1·F-2 해소 |
| G3 code | Frontend/UI Engineer | independent Staff Code Reviewer | PASS | 차단 F-* 없음 |
| G4 UX (1차) | Frontend/UI Engineer | independent UX/Design Auditor | FAIL | 오라벨 샷 F-1..F-3; Find/split 미완 |
| G4 UX (2차) | Frontend/UI Engineer | independent UX/Design Auditor | PASS | 재수집 증거로 오라벨 해소; Find/ActionMenu/Space2/rail OK; split=P3 |
| G5 completion | — | independent Release Gatekeeper | PASS | AC-1..7 PASS; split/warm 샷·bun.lock은 P3; 커밋 user-gated |
