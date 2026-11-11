# 외부 앱 핸드오프 완성 — 리다이렉트 승인·커스텀 스킴·폴백 사슬·핸드오프 이벤트

- 요청: "현재 default로 사용하려는데 로그인하고 다른 앱으로 넘어가게 하는게 안되어 보여서 이거 확인해줄 수 있어?" → 원인 분석 후 "그것들을 모두 진행해주면 좋을꺼 같아. branch를 따서 진행해주고, PR까지 올리자."
- 목적: 여우를 기본 브라우저로 쓸 때 웹 로그인(OAuth2/SSO) 완료 후 원래 앱(카카오톡·Slack 등)으로 돌아가는 흐름이 차단되지 않게 한다. 보안 경계(BROWSABLE 재구성 인텐트·스킴 블랙리스트·자기 루프 방지·루프 가드)는 유지한다.

## 원인(실측, 2026-11-11)

1. `ExternalNavigationCoordinator`가 `hasUserGesture` 없는 최상위 내비게이션을 모두 거부 — HTTP 302 리다이렉트로 오는 OAuth 콜백(`slack://`, `kakaotalk://` 등)은 제스처 비트가 없어 전부 `DENY`.
2. `ExternalLinkPolicy.directSchemes` 화이트리스트가 `mailto/tel/sms/smsto/geo/market` 6개뿐 — 일반 커스텀 스킴과 패키지 없는 `intent:`는 `appTarget`이 `null`을 반환.
3. 실행 인텐트에 `FLAG_ACTIVITY_NEW_TASK` 부재, 핸들러 없는 스킴의 안내가 예외 메시지에 의존.
4. 핸드오프 성공 이벤트가 없어 Little Arc 오버레이가 로그인 페이지에 남는다.

## 수용 조건

- **AC-1**: 최상위 프레임의 외부 스킴 내비게이션이 (a) 사용자 제스처 직접 발생 또는 (b) `request.isRedirect` 연속(리다이렉트)이면 허용된다. 서브프레임과 제스처 없는 비리다이렉트 최상위는 계속 차단되고 안내가 표시된다.
- **AC-2**: 엔진 위험 스킴 블랙리스트(javascript/file/content/data/blob/about/chrome/resource/jar/view-source/intent 직접/android-app)와 패키지 정규식 검증·자기 패키지 거부는 유지되면서, 그 외 커스텀 스킴이 `BROWSABLE` 핸들러 존재 시 허용된다. http/https는 패키지 지정 딥링크가 아니면 엔진에 남는다.
- **AC-3**: 실행 인텐트에 `FLAG_ACTIVITY_NEW_TASK`가 붙는다. 핸들러 부재 시 Chrome 순서로 폴백한다 — `intent:`의 `browser_fallback_url` → (패키지 알려지면) `market://details?id=` → 명확한 안내.
- **AC-4**: 실제 앱 핸드오프 성공 시 `BrowserExternalNavigationHandoff {tabId}` 이벤트가 발행되고, JS 훅이 선택 콜백 `onExternalHandoff`로 노출한다. Little Arc 탭이면 오버레이와 임시 탭을 정리한다(App.tsx 소비는 진행 중인 Little Arc 브랜치 작업에 동승).

## 태스크와 소유권

| 태스크 | 파일 | 내용 |
|---|---|---|
| T-1 | `ExternalLinkPolicy.kt` | `directSchemes` 제거, 웹 스킴 게이트 정리, `navigationAdmitted(gesture, redirect)` 순수 함수 |
| T-2 | `ExternalNavigationCoordinator.kt` | admitted 계산 적용, `NEW_TASK`, 핸들러 부재 폴백 사슬, `handedOff` 이벤트 |
| T-3 | `ExternalLinkPolicyTest.kt` | 커스텀 스킴 허용·블랙리스트 유지·리다이렉트 승인 단위 테스트 |
| T-4 | `useBrowserWorkflows.ts`(커밋), `src/App.tsx`(미커밋 동승) | 핸드오프 리스너·선택 콜백, Little Arc 정리 소비 |

보안 설계: 웹이 준 인텐트를 재구성해 발사하는 기존 원칙 유지 — 컴포넌트·extras·권한은 폐기, `ACTION_VIEW`+데이터+`CATEGORY_BROWSABLE`(+검증된 패키지)만, 자기 재오픈 검사와 5초 루프 가드(`ExternalLaunchGuard`) 유지. 리다이렉트 승인은 이 재구성 경계 안에서만 확장한다.

## 검증 증거(V-*)

- **V-1** `:app:testDebugUnitTest`(android/) 전체 — BUILD SUCCESSFUL(2026-11-11, 변경 후). `ExternalLinkPolicyTest` 갱신 케이스 포함.
- **V-2** `bun run typecheck` exit 0, `bun test tests` 590 pass / 0 fail(변경 후, Little Arc 진행 중 작업 트리 포함).
- **V-3** 독립 G3 코드 리뷰(Staff Code Reviewer + 보안 렌즈) — PR 게시 후 본 문서에 판정 기록.
- **V-4** G5 Release Gatekeeper — 동일.

## 잔여 한계

- 제스처도 리다이렉트도 아닌 최상위 JS 내비게이션(비동기 콜백 뒤 `location.href`)은 여전히 차단 — 자동 앱 실행 광거동 방지. 실사용에서 막히면 `isRedirect` 외 세션 근접 제스처 완화 후속 과제.
- `browser_fallback_url`/market 폴백은 유닛테스트로 검증하지 못함(디바이스 의존) — 에뮬레이터 실측은 Little Arc 브랜치 통합 시점에 함께 권장.
- AC-4의 App.tsx 소비 코드는 이 PR에 포함되지 않는다(진행 중 미커밋 Little Arc 작업 보존).
