# Rustra 업데이트 가용성 실측 (2026-11-02)

- 요청: 현재 rustra 업데이트를 확인하고 진행 가능 여부 판정
- 방법: 메인 트리 무변경 검증 — `/tmp/yeoyu-rustra-trial`에 yeoyu worktree(HEAD 4d16fbb) + rustra `origin/main` 체크아웃 격리 실측
- ~~결정(2026-11-02 사용자): 채택은 Crest 계획 T-4(설정 키트) 종료 후 실행~~ → **동일 날짜에 사용자가 즉시 적용으로 재지시 — 메인 트리 적용 완료(아래 적용 기록)**

## 대상

- 벤더 핀: `scripts/bootstrap.sh` `RUSTRA_REV=87f5f1f3`(2026-09-09, 태그 체계 이전)
- 업스트림 main: `d5d3ba87`(2026-10-19, `@rustra/types@0.12.1` / `@rustra/react-native@0.10.0` / cli `0.12.x`) — **983커밋** 선행
- 새 브랜치 `safety/nitro-parity-hardening` 관찰됨(main과 별도 진행선)

## 핵심 변경 (yeoyu 소비 면 기준)

- **"rkyv V2"→"Frame" 전면 리네임**(CHANGELOG 0.10.0 Breaking): 와이어 바이트 무영향, 공개 심볼·산출물 이름만 변경. `generated/rkyv-codecs.ts`(8,220줄)·`rkyv-registry.ts` 삭제 → `frame-codecs.ts`·`frame-registry.ts` 신규
- 생성 커맨드 `export function`+`.commandId` → `export const`(모듈 네임스페이스 타입에서 해당 키가 readonly화)
- 생성 Kotlin 설치기 개선(invalidate/install의 JS 스레드 배리어, dev 전용 hot-core `nativeConfigureHotCore`) — **JNI 어댑터(`rustra-jsi-jni.cpp`)는 pin→main 무변경**
- C++ 코덱 생성물 대폭 변경(+3,962/−), `modules/rustra-jsi/package.json` peer `^0.7.0`→`^0.10.0`, CMake는 `folly_runtime` 조건부 링크 추가(하위호환)
- yeoyu 도메인 스키마(`generated/types.ts`)는 +5줄 — 도메인 타입 소비자(`@generated/types` 광범위) 무영향
- Rust 크레이트: yeoyu가 쓰는 `prelude::*`, `native_entry!`, `ffi::FfiFormat`, `Result/RustraError` 모두 존재 — `native/src/lib.rs` 등 4파일 무수정 컴파일

## 실측 결과 (격리 트라이얼, 2026-11-02)

| 게이트 | 방법 | 결과 |
|---|---|---|
| codegen | `bun run codegen` | PASS — 산출물 교체 정상 |
| codegen --check | `bun run codegen --check` | PASS |
| Rust 컴파일 | `cargo check`/`cargo test` | PASS (yeoyu-core 무수정) |
| Rust 품질 | `cargo fmt --check` / `cargo clippy` | PASS |
| TS 컴파일 | `bunx tsc --noEmit` | 7오류 → 1줄 수정 후 **0** |
| TS 테스트 | `bun test` 전체 | 575 pass / 1 fail |
| Android 네이티브 | `./gradlew :rustra-jsi:externalNativeBuildDebug` (cargo android + CMake) | **PASS** (25s) |

- tsc 7오류: `tests/controller.test.ts`의 목 할당(`ports.commands.workspaceActivate/tabReset = ...`)이 const 전환으로 readonly화. 수정 1줄 — `src/BrowserController.ts` mapped type에 `-readonly`(목 주입용 포트이므로 의미상 정합)
- bun test 1 fail(`tests/loadBar.test.tsx` 전체 스위트 간섭): **같은 worktree에서 구 rustra 기준선도 동일 575/1** — rustra 무관, HEAD 기존 문제(메인 트리는 uniwind 1.12.1 핀 상태에서 577/0). 별도 이슈로 분리

## 채택 절차 (실 적용 시)

1. `scripts/bootstrap.sh` `RUSTRA_REV` → `d5d3ba87…` 갱신
2. `.deps/rustra-main` 교체(기존 checkout은 가드가 거부 — 수동 `checkout --detach` 또는 재클론) + `bun install --frozen-lockfile` + `packages/types`·`packages/react-native` build
3. yeoyu `bun install`(peer 갱신 bun.lock 반영 — uniwind 1.12.1 핀은 유지됨)
4. `bun run codegen` + `--check`
5. `src/BrowserController.ts` mapped type에 `-readonly` 1줄
6. Cargo.lock 자동 갱신 확인, `./scripts/check.sh` 전체 재실행
7. Android 런타임 바이너리 재빌드(빌드 플로우에서 자동 — contract strict 검증이 구 바이너리와 신규 JS 조합을 loud-fail로 잡음)

## 잔여 항목

- compat 설치기(`android/compat/rustra-jsi`)는 생성 Kotlin을 교체하는 구조라 신규 개선(JS 스레드 배리어, hot-core dev)이 미적용 — JNI 불변이라 동작 호환은 유지. 배리어 개선 도입 여부는 별도 결정
- loadBar 간섭 실패는 rustra 채택과 무관 — 별도 원인 규명 필요(uniwind 1.12.2 또는 테스트 격리)
- 실기기 런타임 초청(invokes) 검증은 다음 build-android + 기기 연결 시 수행 필요

## 적용 기록 (2026-11-02, 메인 트리)

| 단계 | 결과 |
|---|---|
| bootstrap 핀 → `d5d3ba87cf5b04…`, `.deps` detach checkout + rustra 패키지 빌드 | PASS |
| codegen + `codegen --check` | PASS — rkyv→frame 산출물 교체 |
| `src/BrowserController.ts` mapped type `-readonly` 1줄 | 적용 |
| Cargo.lock | rustra 0.12.0·macros 0.12.0·naming 0.12.0 갱신 |
| `./scripts/check.sh` 전체 | exit 0 |
| `bun test` 전체 | **577 pass / 0 fail** (uniwind 1.12.1 핀 유지 확인) |
| `:rustra-jsi:externalNativeBuildDebug` (arm64) | **PASS** — 재빌드한 `libyeoyu_core.a`에 frame 심볼 15개, 링크 성공, 멱등성 확인(재실행 UP-TO-DATE) |

**적용 중 발견·처리한 결함**

- **F-1 (P1, 수정 완료)**: gradle `buildRustAndroid`의 inputs 감시가 `native/`에 한정되어 `.deps` path 의존 변경을 못 보고 **stale `libyeoyu_core.a`**(구 rustra 0.8, frame 심볼 0개)를 링크 — `undefined symbol: rustra_ffi_invoke_frame*` 링크 실패. 복구: `build-rust-android.sh` 수동 재빌드. 재발 방지: 루트 `android/build.gradle`에 `inputs.property('rustraRev', git rev-parse)` 추가 — rev 변경 시 재빌드(실측 확인), 불변 시 UP-TO-DATE(실측 확인). 생성물이 아닌 yeoyu 소유 파일이라 패치 가능
- **F-2 (경미)**: 새 CLI가 `node_modules/@rustra/react-native` 버전 검증(^0.10.0)을 추가 — 오래된 file: 사본(0.7.0)이면 `bun install` 재실행 필요. 절차 3단계를 "codegen **전** `bun install`"로 확정

