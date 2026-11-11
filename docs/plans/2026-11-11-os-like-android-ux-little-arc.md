# OS다운 안드로이드 사용성 및 Little Arc 플로팅 시스템 윈도우 완성 계획

- 날짜: 2026-11-11
- 브랜치: `design-improvement`
- 요청: "지금 사용해보니깐 자연스러운 사용성이 없는거 같아. 특히 하나의 os처럼 느껴져야 할텐데 그런게 전혀 안보여서 확인을 같이 진행해주면 좋을꺼 같아. 안드로이드에서 전혀 그런 부분들이 없더라고." → "좋아 그러면 그거 진행해주라."
- 목적: 실측 에뮬레이터에서 확인된 Little Arc 레이아웃 붕괴(좌상단 쏠림, 검은 레터박스 노출), 모션/제스처 결여, 세로/가로 태블릿 반응성 부재, 시스템 바 단절 문제를 해결하여, Arc 본연의 "웹을 위한 OS"이자 안드로이드 대화면에 녹아드는 자연스러운 OS-like 사용성을 달성한다.

---

## 1. 실측 문제점 요약

1. **Little Arc 레이아웃 붕괴 (V-1 확인)**:
   - React Native Yoga 엔진에서 `m-auto`가 작동하지 않아 1600×2560 세로 화면에서 카드가 좌상단(0,0)에 고정됨.
   - `max-w-[960px]`로 인해 우측 640px 및 하단 1700px에 시커먼 빈 공간(letterbox)이 노출되어 OS 창이 아닌 깨진 앱처럼 보임.
2. **배경 스크림 및 윈도우 깊이감(Depth) 부재**:
   - 스크림이 `c.body` 내부 패딩에 갇혀 전체 화면을 덮지 못함.
   - 호출한 외부 앱 위에 부드럽게 오버레이되는 투명도와 딤(Dim) 처리가 미흡함.
3. **등장/퇴장 모션 및 스와이프 제스처 단절**:
   - Little Arc 오픈 시 갑작스러운 팝업(무애니메이션), 닫힐 때도 뚝 끊김.
   - 드래그 다운 제스처 핸들러와 퇴장 트랜지션의 일체감 부족.
4. **대화면 세로/가로 모드 적응형 레이아웃**:
   - 세로 태블릿 모드에서 사이드바와 캔버스의 반응형 비율 조정 및 꽉 찬 화면 경험 필요.

---

## 2. 수용 조건 (Acceptance Criteria)

- **AC-1 (완벽한 중앙 정렬 및 반응형 카드)**: Little Arc가 가로/세로 모든 해상도(에뮬레이터 1600×2560 포함)에서 화면 정중앙에 정확히 위치하고, 빈 검은 여백 없이 화면에 알맞은 크기(`w-[92%]` 세로, `w-[84%] max-w-[1040px]` 가로)와 카드 비주얼(`rounded-dialog`, `shadow-dialog`, `border-card-border`)을 갖춘다.
- **AC-2 (풀스크린 딤 스크림 & 터치 해제)**: 카드가 뜰 때 전체 화면을 덮는 반투명 스크림(`bg-black/60`)이 부드럽게 페이드인되며, 스크림 터치 시 부드럽게 닫힌다.
- **AC-3 (스프링 등장 & 슬라이드다운 제스처 모션)**:
  - 열릴 때: 아래에서 위로 살짝 떠오르며(`translateY: 40 -> 0`, `opacity: 0 -> 1`) 스프링 등장.
  - 상단 핸들/툴바 드래그: 아래로 당기면 손가락을 따라 이동, 120dp 이상 또는 빠른 플릭 시 아래로 슬라이드다운되며 자연스럽게 닫힘. 미만 시 스프링 복귀.
  - 닫기 버튼/시스템 뒤로가기 시: 아래로 슬라이드다운(`translateY: 600+`) 후 탭 정리 및 직전 앱 복귀.
- **AC-4 (스페이스 승격 트랜지션)**: `스페이스로 열기` 시 카드가 부드럽게 메인 작업공간으로 인계되고 토스트 피드백 표시.
- **AC-5 (세로 모드 적응성)**: 세로 모드에서 사이드바와 캔버스가 어색한 여백 없이 자연스러운 비율을 유지.
- **AC-6 (품질 게이트 및 에뮬레이터 실측)**: `./scripts/check.sh` 100% PASS 및 에뮬레이터 실측 스크린샷에서 레이아웃 정상 표시 확인.

---

## 3. 세부 설계 및 수정 범위

### D1. Little Arc 레이아웃 구조 (`src/App.tsx`, `src/chrome/appStyles.ts`)
- `c.body`에 `isLittleArc && "items-center justify-center"`를 부여하여 flex 차원에서 정중앙 정렬.
- `c.contentLittleArc`에서 `absolute inset-0 m-auto` 제거, `self-center` 및 반응형 크기 설정.
- 스크림을 `SafeAreaView` 전면을 덮는 절대 뷰로 승격하거나 `c.body`의 전체 영역을 덮는 `absolute inset-0 bg-black/60 z-[1]`로 배치.

### D2. 등장/퇴장 모션 (`src/App.tsx`)
- `littleArcTranslateY`: 등장 시 `40 -> 0` (스프링/이징).
- `littleArcOpacity`: 등장 시 `0 -> 1` (페이드인).
- `closeLittleArcWithMotion`: 닫기 요청 시 `littleArcTranslateY`를 화면 아래(`800+`)로 내린 후 `closeTab` 호출.

### D3. 테스트 및 검증
- `tests/littleArc.test.tsx` 갱신: 모션 및 중앙 정렬 클래스 검증 반영.
- `./scripts/check.sh` 전체 통과.
- 에뮬레이터에서 앱 실행 및 스크린샷 캡처하여 시각적 검증.

---

| 태스크 | 대상 파일 | 내용 | 상태 |
|---|---|---|---|
| T-1 | `src/chrome/appStyles.ts` | `contentLittleArc` 스타일 개편 (중앙 정렬, 적응형 크기, 그림자/보더 완성) | **완료** |
| T-2 | `src/App.tsx` | Little Arc 등장/퇴장 스프링 애니메이션, 정중앙 정렬 컨테이너, 스와이프 제스처 완성 | **완료** |
| T-3 | `src/App.tsx` | 세로 모드 적응형 레이아웃 및 시스템 인셋 보정 | **완료** |
| T-4 | `tests/littleArc.test.tsx` | 단위/통합 테스트 갱신 및 검증 | **완료** |
| T-5 | 전체 저장소 | `./scripts/check.sh` 검증 게이트 통과 | **완료** |
| T-6 | 에뮬레이터 실측 | 에뮬레이터에서 Little Arc 재실행 및 스크린샷 캡처 검증 | **완료** |

---

## 5. 검증 결과 및 증거 (Verification Evidence)

1. **V-1 (에뮬레이터 실측 검증)**:
   - 외부 링크 오픈 시 Little Arc 카드가 1600×2560 세로 화면 정중앙에 정확히 위치하고 레터박스 없이 수려하게 렌더링됨 확인 (`media_0.png` 152단계).
   - "스페이스로 열기" 클릭 시 Default 스페이스 4번째 정규 탭으로 즉시 승격 및 메인 캔버스 렌더링 확인 (`media_0.png` 202단계).
   - 닫기(X) 클릭 시 아래로 부드럽게 슬라이드다운되며 정리 완료 확인 (`media_0.png` 222단계).
2. **V-2 (Little Arc 단위/통합 테스트)**:
   - `bun test tests/littleArc.test.tsx` 5/5 pass (0 fail, 41 expect calls).
3. **V-3 (Typecheck)**:
   - `bun run typecheck` (`tsc --noEmit`) 0 errors.
4. **V-4 (전체 Bun 테스트)**:
   - `bun test tests` 592 pass / 0 fail (4385 expect calls, 85 files).
5. **V-full (전체 검증 관문)**:
   - `./scripts/check.sh` 전체 통과 (Cargo fmt/test 61개/Clippy 0경고, Python geometry/unittest 75개, Contrast check 100%, TypeScript typecheck, Rustra codegen 최신 일치).
