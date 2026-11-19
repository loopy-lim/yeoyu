# uniwind 1.12.2+ 업그레이드 재검증 (이슈 #30)

- 날짜: 2026-11-18
- 목표: uniwind 1.12.1 핀 해제 가능성을 릴리스(수용/Acceptance) 빌드 실측으로 재판정하고, 회귀를 결정적 테스트로 방어하며, loadBar 테스트 간섭(2026-11-02 rustra 문서 :50 유보 항목)을 종결한다.

## 배경

- 2026-11-02 bisect(커밋 792012e)에서 릴리스 빌드 ScrollView 제스처 전멸을 보고 `package.json`을 `"uniwind": "1.12.1"`로 핀했다. 당시 원인을 1.12.2의 css-processor `declarationConfig.root` 스코프 수정으로 추정했다.
- 이슈 #30은 (1) 업스트림 수정 추적, (2) 최신 버전 핀 해제 재시도 + 릴리스 빌드 스크롤 실측, (3) 회귀 재현 테스트, (4) loadBar 간섭 정리를 요구한다.

## 업스트림 조사 (2026-11-18 기준)

| 버전 | 날짜 | 내용 |
|---|---|---|
| 1.12.2 | 2026-10-05 | `:root` 파서 상태가 같은 at-rule 블록 내 형제 클래스로 새어 들어가 class 선언이 변수로 유입되던 버그 수정(#709 → PR #710). 레이어·서포츠 내 `:root` 이후 클래스의 스타일이 비는 것이 원리. |
| 1.13.0 | 2026-10-19 | 네이티브 스토어 구조 개편: CSS 캐스케이드 순서 준수(#722), 스타일 메타데이터 분리(#723), 매치 서술자 생성(#725). |
| 1.13.1·1.13.2 | 10-28·11-05 | 초기 테마 경쟁 수정(#761) 등. |
| 1.14.0 | 2026-11-17 | 최신. platform-color(), 성능 개선. |

- 업스트림 이슈 트래커에 "릴리스 빌드 ScrollView 제스처 전멸" 보고는 없다(uni-stack/uniwind 검색 확인). 우리 회귀에 대한 업스트림 수정 존재를 지시하는 changelog 항목도 없다.

## 원인 재분석 — 종전 추정의 번복

실측으로 1.12.1과 1.12.2가 **이 리포의 global.css에 대해 바이트 동일한 컴파일 스토어**를 생성함을 확인했다(md5 일치, 210,150바이트). 네이티브 런타임 소스·nativeResolver도 두 버전이 동일하다(전체 패키지 diff에서 네이티브 경로 차이는 프로세서뿐이며 산출물에 영향 없음). 즉 순수 1.12.1→1.12.2 스왑만으로는 릴리스 번들이 달라질 수 없고, 종전 "1.12.2 css-processor가 스토어를 바꿔 제스처를 깨뜨린다"는 귀속은 성립하지 않는다.

- bisect 커밋 792012e는 uniwind 단독이 아니라 Bun 1.4.3·Node 26·react 19.3·TypeScript 7 동기화 커밋이다.
- "uniwind만 1.12.2로 올린 단독 재현"도 실제로는 `bun install`의 peer 재해석으로 metro 0.87.0→0.87.3급 패치 이동을 수반한다(초안 작성 시점의 1.14.0 설치에서 동일 현상 관찰 — typecheck가 metro-resolver 타입 신규 필드로 실패). 다만 리베이스 후 최종 스냅샷에서는 해당 없음: #48이 `package.json` overrides로 `metro*`를 0.87.0에 고정해 패치 이동과 typecheck 실패가 모두 발생하지 않았다. 당시 문서화된 "수용 빌드의 스테일 JS 번들 재사용" 함정과 겹치면, 단독 재현의 인과는 uniwind 코드가 아니라 번들/캐시 신선도였을 가능성이 크다.
- 결론: 핀의 근거가 소실됐으므로 실측 재판정이 유일한 정당한 기준이다(아래 검증 참조).

## 회귀 방어 (tests/uniwindReleaseCompile.test.ts)

업스트림 #709 계열 실패 형상 — "class 선언이 vars로 유입되어 클래스 스타일이 비면 릴리스 제스처·레이아웃이 죽는다" — 을 두 계층으로 고정한다.

1. **앱 스토어 계층**: 설정 다이얼로그 스크롤 구조 클래스(`flex-1 min-h-0`, `shrink bg-sidebar`, `p-md gap-[2px]`, `overflow-hidden`, 그룹 카드)가 실제 compileCSS→스토어→getStyles 경로(릴리스 번들이 심는 것과 동일한 산출물)에서 구체적 스타일로 해석되는지 단정. `tests/uniwindTestHarness.ts`가 이미 이 경로를 구축 중.
2. **업스트림 메커니즘 계층**: `tests/fixtures/uniwind-root-leak/fixture.css`(레이어 내 `:root` + 형제 클래스)를 설치된 컴파일러로 컴파일해 `.after-root`가 스타일시트에 width 항목을 유지하고 vars에 누수되지 않음을 단정. 하네스에 `compileEntryCss()` 진입점을 추가해 픽스처 컴파일을 재사용한다.

판별력 실측: 1.12.1에서는 실패(`.after-root` 스타일시트 항목 소실), 1.12.2·1.14.0에서는 통과 — 고장 입력에서 확실히 붉어지는 재현 테스트다.

증명 범위 경계: 이 회귀 테스트는 CSS 컴파일 스토어 계층(#709 `:root` 누수 + global.css 유틸 해석)의 자동 방어일 뿐, 릴리스 Android 런타임의 ScrollView 제스처 자체를 증명하지 않는다. 런타임 제스처는 V-5 수용 빌드 실측이 보완하며, 자동 테스트가 이를 대체하지 않는다.

## loadBar 테스트 간섭 종결 (rustra 문서 :50 유보)

- 2026-11-02 문서는 "loadBar 간섭 실패는 rustra 채택과 무관 — 별도 원인 규명 필요(uniwind 1.12.2 또는 테스트 격리)"로 유보했다.
- 실측: 핀 상태(1.12.1)와 1.14.0 모두에서 전체 `bun test tests`(98파일)를 loadBar 포함 실행해 간섭 없음(749 pass / 0 fail). 당시 실패는 그 시점의 uniwind/의존성 상태에서만 재현되고, 현재 두 버전 어느 쪽에서도 테스트 격리 결함은 없다.
- 종결 처리: 원인은 당시 테스트 환경(1.12.2 실험 중 의존성 재배치)으로 수렴하며, 잔여 위험은 위 회귀 테스트가 상수 계층에서 감시한다.

## 검증 계획과 결과

| ID | 방법 | 환경 | 기대 결과 | 실제 | 판정 |
|---|---|---|---|---|---|
| V-1 | `bun test tests` 전체(1.14.0) | repo root | 759 pass | 759 pass / 0 fail (100파일) | PASS |
| V-2 | `bun run typecheck` | repo root | 무오류 | #48의 `metro*` 0.87.0 overrides로 metro-resolver가 고정되어 패치 이동 없음 — `tests/importAliases.test.ts` 스텁은 무수정, typecheck exit 0 | PASS |
| V-3 | `node scripts/css-compile-check.mjs`, `bun run codegen --check` | repo root | 게이트 통과 | 25 유틸리티 통과 / codegen check 통과 | PASS |
| V-4 | 재현 테스트 판별력: 노드 모듈 스왑(1.12.1 ↔ 1.14.0) | repo root | 1.12.1 실패·1.14.0 통과 | 1.12.1에서 `.after-root` 소실로 실패, 1.14.0 통과 | PASS |
| V-5 | x86_64 수용 빌드(스테일 번들 정리 후) + 에뮬레이터 설정 다이얼로그·사이드바 스크롤 실측 | emulator-5556 (yeoyu-tab) | 스와이프 스크롤 동작 | Acceptance(`ll3.kr.yeoyu.acceptance.issue30`) 포그라운드 확인 후 설정 Appearance 패널 스와이프 스크롤(`COLOR MODE`→`DISPLAY`·`Restore default sidebar and frame` 노출) 및 38+탭 오버플로 사이드바 양방향 스와이프 스크롤 동작 실측(uniwind `1.14.0` 핀 해제 + `react-native-svg` `15.16.1` 유지) | PASS |
| V-6 | `./scripts/check.sh` 전체 | repo root | 모두 통과 | `cargo fmt/test(81 pass)/clippy`, `bun test tests`(100파일 759 pass), `split-geometry`, `unittest`(75 pass), `contrast-check`, `css-compile-check`(25 유틸), `typecheck`, `codegen --check` 모두 통과 (exit 0) | PASS |

## 잔여 리스크

- 물리 태블릿(ARM64) 수용 빌드 재검증은 이번 재검증 범위에서 분리(이전에도 x86 에뮬레이터로 bisect하고 ARM은 별도 확인했다). 필요 시 dist 산출 APK로 후속 실측.
- #48의 npm 기반 `@unikit-bridge/ui`(0.4.1) 전환 후 중첩 uniwind 설치는 부재하다(`node_modules/@unikit-bridge/ui/node_modules` 없음) — 번들은 루트 uniwind 1.14.0 단일 스토어로만 구성된다. 다만 unikit 측 의존성 정렬 시점에 uniwind 버전이 엇갈리면 이중 스토어 위험이 다시 생길 수 있으므로 별도 이슈로 감시한다.
