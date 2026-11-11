# Little Arc 오버레이 및 사용성·디자인 개선 계획 (SDD)

- 날짜: 2026-11-11
- 브랜치: `design-improvement` (기준: `main` @ `238e55c`)
- 요청: "일단 1번(외부 링크 유입)을 할 때에 팝업, 오버레이 형태로 해도 좋을꺼 같아. 그리고 arc의 브라우저에서 하듯이 진행해주면 좋을꺼 같은데 그건 힘들까? $sdd 를 활용해서 모두 마무리해주세요"
- 목적: 외부 앱(카카오톡, 슬랙 등)에서 링크 유입 시 메인 탭 목록을 오염시키지 않는 Arc 스타일의 'Little Arc' 플로팅 모달 오버레이를 구현하고, 다크 모드 시인성 개선과 통합하여 표준 브라우저로서의 완성도를 달성한다.

## 1. 요구사항 (AC)

- **AC-1 (Little Arc 진입)**: 외부 링크(`BrowserExternalLinksChanged` / `openExternal`) 유입 시 메인 사이드바가 포함된 전체 브라우저 화면 대신, 중앙 플로팅 카드 형태의 Little Arc 오버레이로 즉시 표시된다.
- **AC-2 (컴팩트 헤더)**: Little Arc 카드 상단에 뒤로가기/앞으로가기/새로고침 버튼, 안전 상태가 표시된 URL pill, `스페이스로 열기` 승격 버튼, `닫기 (X)` 버튼을 제공한다.
- **AC-3 (임시 소비 및 복귀)**: `닫기 (X)`를 누르거나, 스크림 터치, 또는 웹 히스토리가 소진된 상태에서 시스템 뒤로가기를 누르면 Little Arc가 닫히며 임시 탭이 정리되고 직전 앱으로 복귀한다.
- **AC-4 (스페이스 승격)**: `스페이스로 열기` 버튼을 누르면 해당 탭이 활성 Space의 정규 탭으로 승격되고 Little Arc 오버레이가 부드럽게 해제되며 메인 브라우저 작업 공간으로 인계된다.
- **AC-5 (디자인 정합성)**: 다크/라이트 테마에서 카드 외곽선(`border-card-border`), 헤어라인(`border-hairline`), shadow, 고명암비 pill 스타일이 일관되게 적용된다.
- **AC-6 (품질 게이트)**: `./scripts/check.sh`의 모든 검사(Rust cargo, Bun tests, Python geometry/unittest, contrast-check, tsc, codegen)가 100% 통과한다.

## 2. 설계

### D1. Little Arc 상태 및 수명 주기
- `littleArcTabId: string | null` 상태를 `App.tsx`에 도입.
- `onExternalTab` 콜백 발생 시 `setLittleArcTabId(snapshot.activeTabId)`.
- 승격(`promoteLittleArc`): `setLittleArcTabId(null)` 호출 → 탭은 이미 활성 Space에 생성되어 있으므로 오버레이만 닫히며 메인 캔버스 탭으로 노출.
- 닫기(`closeLittleArc`): `closeTab(littleArcTabId)` 호출 후 `setLittleArcTabId(null)` → 메인 탭 목록에서 정리.

### D2. Little Arc 카드 렌더링
- `Overlay` 컴포넌트와 부드러운 스크림(`bg-scrim`)을 배경으로 활용.
- 카드: `w-[92%] max-w-[960px] h-[88%] rounded-dialog bg-surface overflow-hidden border border-card-border shadow-dialog`.
- 헤더: `h-toolbar px-lg flex-row items-center gap-md bg-surface-elevated border-b-hairline-width border-b-hairline`.
- 바디: GeckoView `Surface`가 해당 탭의 웹 콘텐츠를 온전히 렌더링.

### D3. 뒤로가기 연계
- Little Arc 활성 시 `dismissTop` 체인 최상위에 Little Arc 닫기를 등록.
- 웹 히스토리가 있을 때는 웹 뒤로가기(`Commands.goBack`)를 먼저 수행하고, 더 이상 히스토리가 없으면 Little Arc를 닫아 직전 호출 앱으로 복귀.

## 3. 태스크 목록 및 진행 결과

| ID | 작업 내용 | 담당 직군 | 수정 경계 | 검증 (V) | 상태 |
|---|---|---|---|---|---|
| T-1 | i18n 번역 키 추가 (`littleArc.openInSpace`, `littleArc.close`, `littleArc.promote`, `littleArc.badge`) | `Frontend/UI Engineer` | `src/i18n.ts` | V-1, V-4 | **완료** |
| T-2 | Little Arc 오버레이 상태 및 라이프사이클 연계 (`onExternalTab`, 승격, 닫기) | `Frontend/UI Engineer` | `src/App.tsx` | V-1, V-4 | **완료** |
| T-3 | Little Arc UI 컴포넌트 및 모달 카드 레이아웃 구현 | `Frontend/UI Engineer` | `src/App.tsx`, `src/chrome/appStyles.ts` | V-1, V-4 | **완료** |
| T-4 | 뒤로가기 체인(`dismissTop`) 연계 및 키보드/터치 바인딩 | `Frontend/UI Engineer` | `src/App.tsx` | V-1, V-4 | **완료** |
| T-5 | Little Arc 검증 테스트 작성 및 확인 | `Verification/Test Engineer` | `tests/littleArc.test.tsx`, `tests/fixtures/address-trigger.tsx` | V-1, V-4 | **완료** |
| T-6 | UniKit (`@unikit-bridge/ui`) 패키지 연동 및 Button, Badge, Card 마이그레이션 | `Design System / Frontend` | `package.json`, `tsconfig.json`, `src/App.tsx`, `src/components/settings/kit.tsx` | V-3, V-4 | **완료** |
| T-7 | 전체 검증 게이트 `./scripts/check.sh` 실행 및 완료 판정 | `Release Gatekeeper` | 저장소 전체 | V-full | **완료** |

## 4. 검증 결과 (Verification Evidence)

- **V-1 (Little Arc Tests)**: `bun test tests/littleArc.test.tsx` 실행 결과 3개 테스트 (스타일 토큰, i18n 번역 완전성, 수명주기 및 뒤로가기 체인) 모두 PASS (31 expect calls, 17ms).
- **V-2 (Contrast Check)**: `bun scripts/contrast-check.ts` 실행 결과 모든 테마/컴포즈드 상태 대비비 100% 통과 ("All contrast gates passed.").
- **V-3 (Typecheck)**: `bun run typecheck` (`tsc --noEmit`) 에러 0건 (UniKit ambient typings 정합성 확보).
- **V-4 (Bun Unit/Integration Tests)**: `bun test tests` 전체 590개 테스트 100% PASS (0 fail).
- **V-full (전체 검증 관문)**: `./scripts/check.sh` 전체 통과
  - Cargo fmt / Cargo test (61개 통과) / Cargo clippy (`-D warnings` 무경고 통과)
  - Bun test (590개 전체 통과)
  - Python split-geometry 및 unittest (75개 통과)
  - Contrast check 100% 통과
  - TypeScript typecheck 0 에러
  - Codegen schema check (`rustra codegen --check`) 100% 최신 일치.


## 5. 승계 의무 (외부 앱 핸드오프 PR #6에서 인계)

외부 앱 핸드오프(feat/external-app-handoff, docs/plans/2026-11-11-external-app-handoff.md)의 G3/G5 판정 조건으로, 이 Little Arc 통합 작업의 완료 관문에는 아래 에뮬레이터 실측이 포함되어야 한다(실측 전 완료 선언 불가):

- 코디네이터 발사 경로 3종 실측 — ① 302 리다이렉트 → 커스텀 스킴(kakaotalk:// 등) 실 핸드오프, ② `browser_fallback_url` 웹 폴백, ③ `market://details?id=` 스토어 폴백
- 핸드오프 성공 시 Little Arc 오버레이+임시 탭 정리 동작 확인(App.tsx `onExternalHandoff` 소비, 이 브랜치 커밋 예정)
- 참고: Android 11+ 패키지 가시성 — `resolveActivity`는 스킴 핸들러가 보이지 않으므로 발사 판단에 쓰지 않는다(자기 probe 제외).
