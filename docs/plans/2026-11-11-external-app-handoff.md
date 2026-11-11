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

- **V-1** `:app:testDebugUnitTest`(android/) 전체 — BUILD SUCCESSFUL(2026-11-11, 초기 커밋 a0665a4와 G3 수정 커밋 각각). `ExternalLinkPolicyTest` 갱신 케이스 포함.
- **V-2** `bun run typecheck` exit 0, `bun test tests` 590 pass / 0 fail(변경 후, Little Arc 진행 중 작업 트리 포함).
- **V-3** 독립 G3 리뷰 2건(클린 컨텍스트 병행 스폰) — 아래 원장 참조. 수정 반영 후 재판정.
- **V-4** G5 Release Gatekeeper — 재판정 완료 후 기록.
- **CI** PR #6 `android`·`check` 2개 체크 a0665a4에서 통과(수정 커밋에는 재실행됨).

## G3 리뷰 원장(독립 평가, 2026-11-11)

**Staff Code Reviewer: PASS(P3 2건)** — 재실행 검증(`--rerun-tasks`, typecheck, bun 590/0)으로 플랜 증거 정합 확인, AC-1~4 충족 인정.
- F-C1(P3) http/https 게이트가 패키지 없는 packaged-intent를 허용(구 코드는 `targetPackage != null`까지 요구) → 게이트에 `targetPackage == null` 거부 복원 + 회귀 테스트 추가. **수정 반영**
- F-C2(P3) `loadWebFallback`의 루프가드 거부가 무음 → `failed()` 안내 복원. **수정 반영**

**Security & Reliability Reviewer: FAIL(P1 1건, P3 1건)** — 인텐트 재구성 경계·무제스처 완화 범위·URI 파싱은 우회 없음 확인(공식 문서 대조). 결함:
- F-S1(P1) `resolveActivity != null` 발사 게이트가 Android 11+ 패키지 가시성과 충돌 — manifest에 스킴 기반 `<queries>`가 없어 설치된 스킴 핸들러(slack://·mailto: 등)가 resolver에 안 보여 핵심 핸드오프 전면 사망, 기존 mailto/tel도 퇴행. `startActivity()`는 가시성 불필요(공식 문서). → 발사를 `startActivity`+`ActivityNotFoundException` 캐치 기본으로 복원, 자기 재오픈 검사는 자가 가시성이 보장되는 `setPackage(자기)` resolution으로 교체(외부 가시성과 무관). **수정 반영**
- F-S2(P3) market 폴백 발사 시 `handedOff` 미발행 → `launchStoreListing` 추출과 함께 발행 추가. **수정 반영**

교차검증 트리아지: 채택 4건(F-C1·F-C2·F-S1·F-S2, 전부 코드 경로 재현 확인) / 기각 0건.

## 잔여 한계

- 제스처도 리다이렉트도 아닌 최상위 JS 내비게이션(비동기 콜백 뒤 `location.href`)은 여전히 차단 — 자동 앱 실행 광거동 방지. 실사용에서 막히면 `isRedirect` 외 세션 근접 제스처 완화 후속 과제.
- 코디네이터 발사 경로(302→커스텀 스킴 실핸드오프, `browser_fallback_url`, market 폴백)는 유닛테스트·에뮬레이터 실측 미포함 — 발사 메커니즘은 기존 production 경로(startActivity+catch)로 복원되어 회귀 위험은 낮으나, 에뮬레이터 실측은 Little Arc 브랜치 통합 시점에 함께 권장(잔여 한계로 유지).
- AC-4의 App.tsx 소비 코드는 이 PR에 포함되지 않는다(진행 중 미커밋 Little Arc 작업 보존).
