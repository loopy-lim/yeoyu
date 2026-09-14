[English](architecture.md)

# 아키텍처

## 설계 목표

여유는 저장 가능한 브라우저 모델을 웹 엔진과 UI framework에서 분리합니다. Android 없이도 workspace 규칙을 검사할 수 있고, 직렬화하거나 Rust로 옮길 수 없는 engine object는 Android가 맡습니다.

## Runtime 경계

| Layer | 소유하는 것 | 소유하지 않는 것 |
| --- | --- | --- |
| React Native (`src/`) | 브라우저 chrome, overlay, 사용자 의도, controller 조정, 보이는 split layout | 영속 domain 규칙, 실제 Gecko engine object |
| Browser controller | typed storage/native port, command 순서, 저장 retry, reconciliation | UI rendering, Rust state-transition 규칙 |
| Rust (`native/`) | workspace·tab·bookmark·folder·keymap ID, validation, revision, import 준비 | Android view, `GeckoSession`, network·disk API |
| Generated JSI (`generated/`, `modules/rustra-jsi/`) | TypeScript와 Rust 사이의 typed transport | 제품 policy |
| Android (`android/`) | `GeckoSession` registry, browser surface, system intent, permission, file, download, media 연동 | 영속 workspace 의미 |

## 상태 흐름

1. UI action을 typed browser command로 바꿉니다.
2. Controller는 domain 변경을 generated JSI로, engine command를 Android port로 전달합니다.
3. Rust가 상태 전이를 검증하고 revision이 있는 snapshot을 반환합니다.
4. Controller가 storage port를 통해 snapshot을 저장합니다.
5. Android가 안정적인 tab ID를 기준으로 보이는 pane과 실제 Gecko session을 맞춥니다.

저장은 순서를 지키며 retry합니다. 손상된 snapshot은 거부·격리하고, 준비된 import가 저장되기 전에는 durable state로 공개하지 않습니다. 실제 engine state와 직렬화 가능한 domain state는 연결되어 있지만 같은 객체로 취급하지 않습니다.

## 브라우저 session과 view

각 tab은 Rust가 소유하는 안정적인 ID를 갖습니다. Android는 이 ID를 실제 `GeckoSession`에 연결합니다. 새 tab을 만들지 않고 session을 main pane, split pane, 작은 media surface 사이에서 옮길 수 있습니다. View를 분리했다고 session이 자동으로 제거되지는 않습니다.

Split layout은 React의 화면 상태이며 저장되는 split group은 아닙니다. 보이는 tab, private tab, media 재생, recording, upload, dialog, permission 처리 등 안전하게 복원할 수 없는 상태는 release하지 않도록 보호합니다.

## Privacy 경계

비공개 tab은 Gecko private session과 별도 in-memory collection을 사용하며 일반 snapshot과 history에서 제외됩니다. 비공개 permission은 일회성이고, private page에서는 persistent site setting을 저장할 수 없습니다. 다만 download 저장이나 bookmark 같은 명시적 action은 durable data를 만들 수 있으므로 UI에서 이를 설명해야 합니다.

Work archive는 private tab, cookie, credential, permission grant, history, 불투명한 Gecko state, device-local ID를 제외합니다. Import는 크기를 제한하고, 검증·preview한 뒤 새 ID로 append합니다.

## Generated code

Rustra는 commit으로 고정되며 Git에서 제외된 `.deps/rustra-main`에 bootstrap됩니다. `rustra.json`이 generated contract의 source configuration입니다. `generated/`와 generated bridge output은 직접 수정하지 않습니다.

```sh
bun run codegen
bun run codegen --check
```

## UI quality gate

Theme role, spacing, motion, contrast는 `src/theme.ts`, `src/themeGates.ts`, `src/chrome/motion.ts`에 있습니다. `scripts/contrast-check.ts`, TypeScript test, geometry check가 기계적으로 확인 가능한 범위를 강제합니다. 기기 screenshot은 특정 build를 보여줄 수 있지만 현재 source check를 대신하지 않습니다.

## Test seam

- Rust domain test: validation, identity, migration, archive, state-transition 규칙.
- Bun test: controller, browser policy, UI model, hook, generated contract.
- Python check: layout과 acceptance helper.
- Android JUnit: native session, storage, permission, media, activity policy.
- 실기기 acceptance: unit test와 APK assembly만으로 engine/provider/device 동작을 증명할 수 없으므로 별도 gate입니다.
