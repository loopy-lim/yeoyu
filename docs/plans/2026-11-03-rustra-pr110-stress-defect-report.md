# [결함 보고] PR #110 — scriptc retained callback stress가 run-1에서 즉시 실패 (PR 도입)

## 요약

`safety/nitro-parity-hardening`(PR #110, head `ad0af8e6`)에서 `test:runtime:scriptc:stress`가
**첫 실행(run-1)에서 즉시 실패**합니다. 취소 시나리오의 비동기 응답 봉투 검증에서
`result` 필드에 스키마상 `number | undefined`(생략 또는 number)를 기대하는데
**`null`이 도착**합니다. 동일 환경에서 main(`d5d3ba87`)은 PASS — **PR 도입 결함**으로 귀속됩니다.

- 심각도 제안: **P1** — PR 게이트(gate)를 막는 신규 회귀. 러스트/새니타이저/퍼즈 트랙은 전부 green이므로 이 항목만 해소되면 머지 가능 상태로 보임.

## 재현 (CI와 동일하게 로컬에서 재현 확인됨)

```sh
git fetch https://github.com/loopy-lim/rustra.git safety/nitro-parity-hardening
git checkout --detach ad0af8e6408b6dfa3a95061846dc6a0538405f4e
bun install --frozen-lockfile
npm install -g scriptc@0.2.1   # run.sh의 SCRIPTC_VERSION 핀과 동일
node examples/calculator/scriptc/run-stress.mjs --runs=2
```

| 대상 | 결과 |
|---|---|
| PR head `ad0af8e6` | **FAIL** — `run-1 failed (1)`, exit 1 |
| main `d5d3ba87` (같은 머신·같은 scriptc@0.2.1·Node 26.12.0·Linux x64) | **PASS 2/2** |

## 기대 vs 실제

- **기대**: 스트레스 5(로컬은 2)회 실행 전부 PASS. 취소 응답 봉투는 `{ ok, result?: number, error?: unknown }` 구조.
- **실제**:
  ```
  Uncaught TypeError: expected number | undefined at $.result, got null
  run-1 failed (1); see target/scriptc-stress/linux-x64/release/run-1.log
  ```
  run-1.log에는 위 한 줄만 기록됨(추가 스택 없음). CI에서도 동일 문언.

## 관측 지점 (yeoyu 쪽에서 추적한 발원지 정보)

- 예약 콜백 페이로드를 `JSON.parse`해 검증하는 앱 측 코드:
  `examples/calculator/apps/scriptc-stress.ts:91-98` — 봉투 타입을
  `{ ok: boolean; result?: number; error?: unknown }`으로 구조 고정하고
  `result !== 100 && result !== 101`을 확인. 이 파일이 던지는 것은 평문 Error이므로
  **"expected number | undefined at $.result, got null" TypeError는 더 아래 검증 계층의 산출물**.
  (scriptc 생성 래퍼/런타임 검증기 또는 응답 직렬화 계층 — 정확한 emitter까지는 미특정)
- 스트레스 입력 해시 대상: `crates/rustra/src/ffi_scriptc.rs`, `ffi_event_core.rs`, `ffi_channel.rs`,
  `ffi_async_entries.rs`, `ffi_workers.rs`, `ffi_pool.rs` + `examples/calculator/scriptc/*`.
  PR diff에서 이 중 `ffi_pool.rs`(+4)와 `tests/ffi_scriptc.rs`가 변경되었음.

## 후보 원인 (가설 — 검증 필요)

PR #110의 두 성격이 모두 후보입니다:

1. **응답 직렬화 변화**: unwrap/expect 500건 정리 중 신뢰 경계 오류 전파 전환 과정에서
   취소(non-ok 아닌) 응답의 `result`가 **생략 대신 명시적 `null`으로 직렬화**되도록 바뀌었을 가능성.
   `Option::None`의 JSON 직렬화 차이(omit vs null)로 설명되는 형상.
2. **검증기 강화**: TS strictness(5플래그)·오류 형식 보장 작업으로 응답 검증기가
   `undefined`(생략)만 허용하던 것을 엄격 검증으로 바꿔 `null`을 거절하게 됐을 가능성.

둘 중 어느 쪽이든 **봉투 계약(`result?: number`)과 직렬화/검증기 사이의 불일치**라는 점은 동일.

## 참고: PR의 다른 CI 실패 2건 (별도 성격)

| 잡 | 원인 | 성격 |
|---|---|---|
| `ts-checks` — Production dependency audit | `bun audit --audit-level=high` exit 1 | 의존성 감사 — PR 코드와 무관 추정 |
| `gate` — actionlint 설치 | curl 다운로드 실패 | CI 인프라 플레이크 |

참고로 main 최신 CI(2026-11-02 12:35Z)는 `rust-audit` 1건만 실패(rust-audit은 crates.io 고지 문제로 추정).

## 제안 수정 방향

- 봉투 계약을 단일 출처로 고정: 취소/비정상 응답에서 `result`를 **생략(omitted)**으로 통일하거나,
  계약을 `result?: number | null`로 명시하고 검증기·생성 타입·문서를 동시 정합.
- 회귀 고정: `tests/ffi_scriptc.rs`에 "취소 응답 봉투의 result는 null이 아니다(또는 null이다)" 단언 추가 —
  이번처럼 스트레스에서만 발견되는 계약 드리프트를 유닛 경계에서 잡도록.

## 증거 경로

- CI 실패 run: 41459227116 (2026-11-02 14:29Z, head ad0af8e6) — `ts-runtime` 잡, 문언 동일(영속 참조)
- 로컬 재현: 위 절차 명령으로 수 분 내 재검증 가능(임시 로그는 휘발 — 2026-11-03 /tmp 정리로 소멸, 결과는 본문 표 기록)
- 보고서 작성 경위: yeoyu 저장소의 rustra 채택 검증 중 PR #110 상태 조사에서 발견 (yeoyu `docs/plans/2026-11-02-rustra-update-feasibility.md`)
