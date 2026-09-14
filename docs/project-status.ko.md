[English](project-status.md)

# 프로젝트 상태

이 문서는 현재 공개 소스를 설명합니다. 과거 APK, 기기 캡처, 일부만 실행된 endurance run을 현재 acceptance로 확대하지 않습니다.

## 구현된 범위

- 일반 tab, 모든 Space의 Favorite, Space별 pinned tab, folder, bookmark, history, 편집 가능한 shortcut을 가진 Workspace/Space model.
- 펼치고 접는 tablet chrome, quick open, command palette, context menu, 가로·세로 split view.
- Navigation, popup, permission, file, download, external link, media, Android PIP를 연결하는 GeckoView session registry.
- Validation, corruption quarantine, 순서 있는 저장, import prepare/commit 분리를 갖춘 Rust revisioned snapshot.
- Private Gecko session, 저장하지 않는 history/permission, local favicon placeholder, 명시적 저장 경고를 갖춘 비공개 tab.
- Preview와 새 ID를 사용하고 credential/private state를 제외하는 bookmark HTML·bounded work archive import/export.
- Site setting, tracking-protection control, site-data removal, tab protection, 보수적인 memory-pressure policy.

## 저장소에서 재현 가능한 gate

공개 소스는 다음을 제공합니다.

- Rust, Bun, Python, contrast, TypeScript, generated-code 검사용 `./scripts/check.sh`.
- Native policy용 Android JUnit.
- Local test APK를 assembly하는 CI.
- Development, acceptance, distribution signing을 구분하는 build profile.

이 gate는 source와 build 동작을 확인합니다. 이것만으로 안전한 daily-driver browser, public-release signing, store 배포, 모든 웹사이트 호환성을 증명하지는 않습니다.

## 현재 한계

- 실행 가능한 대상은 Android 가로 화면 tablet뿐입니다. iOS directory에는 interface만 있고 app은 없습니다.
- 공개 APK release와 지원되는 자동 update channel이 없습니다.
- Sync, extension, 저장되는 split group, 분리된 account profile, 자동 tab archive는 구현하지 않았습니다.
- Mini player와 Android PIP는 browser surface/session 전체를 옮깁니다. 서비스와 독립적인 video overlay를 추출하지 않습니다.
- Page state의 안전한 복원을 증명할 수 없으면 automatic memory release를 보수적으로 막습니다. 일반적인 memory 절감 효과를 주장하지 않습니다.
- Passkey, autofill, OAuth, DRM media, accessibility, process death 중 download, provider별 동작은 전용 device/account validation이 필요합니다.
- Engine update마다 compilation, session restore, permission, media, surface, device check가 새로 필요합니다.

## 근거 정책

공개 문서는 안정적인 동작과 재현 가능한 명령을 기록합니다. 원시 device XML, browsing history, local path, device identifier, signing 정보, session별 log는 의도적으로 제외합니다. 변경을 보고할 때 다음 단계를 구분합니다.

1. Source review
2. Unit·integration test
3. APK assembly
4. Emulator·physical device 동작
5. Long-duration acceptance
6. Signed public distribution

한 단계의 pass는 다음 단계의 근거가 아닙니다.

## 가까운 roadmap

- APK 배포 전에 반복 가능한 public release/signing 절차 확립.
- Tab release를 공격적으로 바꾸기 전에 신뢰할 수 있는 safe-restoration signal 추가.
- 격리된 test account로 accessibility·real-provider acceptance 확대.
- 같은 조건의 기기에서 input readiness, frame timing, memory, energy 측정.
- GeckoView 변경마다 compatibility·durability gate 재실행.
