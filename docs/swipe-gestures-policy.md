[한국어](swipe-gestures-policy.ko.md)

# Swipe gestures & coexistence policy

Issue `#22` implements gesture-driven navigation across phone and compact chrome surfaces while preserving Android predictive back and avoiding conflicts with horizontal web scrollers and carousels.

## 1. Gesture surfaces

| Gesture | Surface | Direction | Outcome |
| --- | --- | --- | --- |
| Edge Back | `BrowserSurfaceView` (`EdgeSwipeHelper`) | Left bezel, drag right | Exits Reader Mode if active; otherwise invokes `Commands.goBack` |
| Edge Forward | `BrowserSurfaceView` (`EdgeSwipeHelper`) | Right bezel, drag left | Invokes `Commands.goForward` when `canGoForward` is true |
| Tab switch | `PhoneBottomBar` & compact `canvasToolbar` (`useToolbarTabSwipe`) | Horizontal drag on toolbar row | Switches between active non-suspended workspace/favorite tabs (`-1` right, `+1` left) |

`PhoneHybridBar` owns a horizontal `ScrollView` of tab chips, so toolbar tab-swipe stays anchored to the top `canvasToolbar` in `hybrid` and `top` modes and to `PhoneBottomBar` in `bottom` mode. Full-canvas horizontal swipes over web content never trigger tab switching.

## 2. Android predictive back coexistence policy

`AndroidManifest.xml` enables `android:enableOnBackInvokedCallback="true"` and `MainActivity` bridges `OnBackPressedDispatcher` into React Native `BackHandler`. On Android gesture navigation, the OS claims outer screen-edge bezels (`WindowInsetsCompat.Type.systemGestures()`).

Rules enforced by `EdgeSwipePolicy` and `EdgeSwipeHelper`:

1. **Never apply blanket `setSystemGestureExclusionRects` over webview edges.** Outer screen bezels remain owned by Android OS predictive back so users can always dismiss dialogs, exit Little Arc sheets, exit Reader Mode, navigate back at the root boundary, or return home predictably.
2. **Coordinate-space overlap calculation.** `EdgeSwipeBounds` compares `BrowserSurfaceView.getLocationInWindow()` against `WindowInsetsCompat.Type.systemGestures()`:
   - When the surface hugs a system-gesture screen edge (`overlap > 0`), the browser edge corridor spans `[0 .. min(viewWidth * 0.25, overlap + 28dp)]` from that edge so an inward stroke right beside the OS bezel is captured cleanly with a floating chevron pill.
   - When the surface is offset from screen edges (tablet with expanded sidebar, split right pane, or 3-button navigation where `overlap == 0`), the edge corridor defaults to `32dp` (capped at `viewWidth * 0.25`).
3. **Arm only when history/reader back is available.** If `canEdgeBack` and `canEdgeForward` are both `false` (such as a fresh tab root or `about:blank` / New Tab), `EdgeSwipeHelper` never intercepts touches on either edge.
4. **Input & overlay suppression.** Edge gestures and toolbar tab swipes are disabled while IME is visible, while `GeckoResizeCover` is active, during multi-touch, in fullscreen content, in tab selection mode, or while modal overlays/permission prompts are open.

## 3. Web horizontal scroll & carousel conflict avoidance

`EdgeSwipeHelper` shares `StableGeckoView.touchDetailObserver` with `PullToRefreshHelper` so Gecko processes each `ACTION_DOWN` and initial horizontal `ACTION_MOVE` through `PanZoomController.onTouchEventForDetailResult()` exactly once, returning `InputResultDetail`:

1. **JS touch interception (`INPUT_RESULT_HANDLED_CONTENT` / `INPUT_RESULT_IGNORED`).** If a page carousel, image gallery, map widget, or slider calls `preventDefault()` on `touchstart`/`touchmove` or sets `touch-action: none` / `pan-y`, `EdgeSwipePolicy.canEdgeNavigate()` immediately rejects the gesture so page controls keep ownership.
2. **Scrollable horizontal containers (`SCROLLABLE_FLAG_LEFT` / `SCROLLABLE_FLAG_RIGHT`).**
   - Left-to-right `BACK` swipes are rejected whenever `(scrollableDirections & SCROLLABLE_FLAG_LEFT) != 0` (the container or carousel still has horizontal scroll room to the left).
   - Right-to-left `FORWARD` swipes are rejected whenever `(scrollableDirections & SCROLLABLE_FLAG_RIGHT) != 0`.
3. **Strict directional hysteresis.** Vertical scrolling (`|dy| > touchSlop && |dy| > |dx| * 0.85`), reverse drags, and multi-pointer gestures (`ACTION_POINTER_DOWN`) reject immediately. Dragging requires `|dx| > touchSlop && |dx| > |dy| * 1.4` before locking horizontal ownership.
4. **Mutual exclusion with Pull-to-Refresh.** Once `EdgeSwipeHelper` commits to `DRAGGING`, `PullToRefreshHelper.cancelActivePull()` resets vertical pull tracking (and vice-versa), while preserving direct `gecko.parent === BrowserSurfaceView` surface ownership.
