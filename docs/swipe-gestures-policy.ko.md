[English](swipe-gestures-policy.md)

# 스와이프 제스처 및 충돌 회피 정책

이슈 `#22`는 Android 예측 백(predictive back)과 웹의 가로 스크롤·캐러셀 동작을 훼손하지 않으면서 폰과 컴팩트 크롬에서 제스처 탐색을 지원하기 위한 정책을 정의합니다.

## 1. 제스처 영역 및 역할

| 제스처 | 대상 표면 | 방향 | 동작 |
| --- | --- | --- | --- |
| 엣지 뒤로가기 | `BrowserSurfaceView` (`EdgeSwipeHelper`) | 좌측 엣지 → 오른쪽 드래그 | 리더 모드가 켜져 있으면 먼저 종료, 아니면 `Commands.goBack` 실행 |
| 엣지 앞으로가기 | `BrowserSurfaceView` (`EdgeSwipeHelper`) | 우측 엣지 → 왼쪽 드래그 | `canGoForward`일 때 `Commands.goForward` 실행 |
| 탭 전환 | `PhoneBottomBar` 및 상단 `canvasToolbar` (`useToolbarTabSwipe`) | 툴바 가로 드래그 | 활성 워크스페이스·즐겨찾기 탭 순환 전환(왼쪽 드래그 `+1`, 오른쪽 `-1`) |

`PhoneHybridBar`는 자체 가로 탭 칩 `ScrollView`를 소유하므로, `hybrid` 및 `top` 레이아웃에서는 상단 `canvasToolbar`가, `bottom` 레이아웃에서는 `PhoneBottomBar`가 탭 전환 스와이프를 담당합니다. 웹 캔버스 중앙에서의 가로 스와이프에는 탭 전환을 걸지 않습니다.

## 2. Android 예측 백(Predictive Back) 공존 정책

`AndroidManifest.xml`에 `android:enableOnBackInvokedCallback="true"`가 활성화되어 있으며, `MainActivity`는 `OnBackPressedDispatcher`를 RN `BackHandler`로 연결합니다. Android 제스처 내비게이션 환경에서는 OS가 화면 최외곽 좌우 베젤(`WindowInsetsCompat.Type.systemGestures()`)을 점유합니다.

`EdgeSwipePolicy`와 `EdgeSwipeHelper`는 다음 규칙으로 공존합니다.

1. **웹뷰 가장자리 전체에 `setSystemGestureExclusionRects`를 일괄 등록하지 않습니다.** 화면 최외곽 OS 예측 백 영역을 유지해야 모달 닫기, Little Arc 닫기, 리더 모드 종료, 루트 뒤로가기 및 홈 복귀가 OS 제스처와 일관되게 동작합니다.
2. **뷰 좌표 기준 시스템 인셋 중첩 계산.** `EdgeSwipeBounds`는 `BrowserSurfaceView.getLocationInWindow()`와 `WindowInsetsCompat.Type.systemGestures()`의 실제 중첩(`overlap`)을 계산합니다.
   - 캔버스가 OS 시스템 제스처 베젤과 맞닿아 있으면(`overlap > 0`), OS 베젤 바로 안쪽까지 `[0 .. min(viewWidth * 0.25, overlap + 28dp)]` 구간을 브라우저 엣지 레인으로 인식해 플로팅 쉐브론 필 피드백을 제공합니다.
   - 사이드바가 열린 태블릿, 분할 우측 패인, 또는 3버튼 내비게이션처럼 중첩이 없으면(`overlap == 0`) 기본 `32dp` 엣지 레인(최대 `viewWidth * 0.25`)을 사용합니다.
3. **이동 가능할 때만 엣지 제스처 활성화.** `canEdgeBack`과 `canEdgeForward`가 모두 `false`이면(새 탭 루트, `about:blank` 등) 터치를 가로채지 않고 OS·웹에 그대로 전달합니다.
4. **입력·오버레이 상태 차단.** IME(소프트 키보드) 표시 중, `GeckoResizeCover` 표시 중, 멀티터치, 콘텐츠 전체화면, 탭 다중 선택 모드, 모달·권한 프롬프트 표시 중에는 제스처를 비활성화합니다.

## 3. 웹 가로 스크롤·캐러셀 충돌 회피 규칙

`EdgeSwipeHelper`는 `PullToRefreshHelper`와 `StableGeckoView.touchDetailObserver`를 공유하여 `ACTION_DOWN`과 첫 가로 `ACTION_MOVE`에서만 Gecko의 `PanZoomController.onTouchEventForDetailResult()`로 `InputResultDetail`을 조회합니다.

1. **웹 페이지 JS 터치 소비 존중 (`INPUT_RESULT_HANDLED_CONTENT` / `INPUT_RESULT_IGNORED`).** 캐러셀, 이미지 슬라이더, 지도 위젯 등이 `touchstart`/`touchmove`에서 `preventDefault()`를 호출하거나 `touch-action: none` / `pan-y`를 선언하면 `EdgeSwipePolicy.canEdgeNavigate()`가 즉시 제스처를 양보합니다.
2. **가로 스크롤 가능 컨테이너 우선 (`SCROLLABLE_FLAG_LEFT` / `SCROLLABLE_FLAG_RIGHT`).**
   - 왼쪽에서 오른쪽으로 스와이프하는 `BACK` 제스처는 `(scrollableDirections & SCROLLABLE_FLAG_LEFT) != 0`(왼쪽으로 더 스크롤 가능)일 때 거부합니다.
   - 오른쪽에서 왼쪽으로 스와이프하는 `FORWARD` 제스처는 `(scrollableDirections & SCROLLABLE_FLAG_RIGHT) != 0`일 때 거부합니다.
3. **방향 히스테리시스 및 조기 포기.** 세로 스크롤(`|dy| > touchSlop && |dy| > |dx| * 0.85`), 반대 방향 이동, 멀티터치(`ACTION_POINTER_DOWN`)는 즉시 거부합니다. 가로 이동량이 `|dx| > touchSlop && |dx| > |dy| * 1.4`를 만족할 때만 인터셉트합니다.
4. **Pull-to-Refresh와의 상호 배제.** `EdgeSwipeHelper`가 `DRAGGING`에 진입하면 `PullToRefreshHelper.cancelActivePull()`을 호출(반대 방향도 동일)하며, `gecko.parent === BrowserSurfaceView` 직접 소유 불변식을 항상 유지합니다.
