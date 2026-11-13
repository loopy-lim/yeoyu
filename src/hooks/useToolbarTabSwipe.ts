import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, type GestureResponderHandlers } from "react-native";
import {
  clampToolbarSwipeOffset,
  classifyToolbarHorizontalSwipe,
  resolveSwipeTargetTab,
  resolveToolbarSwipeCommit,
  resolveToolbarSwipeDelta,
  type SwipeableTab,
  type TabSwipePreview,
} from "@/tabSwipe";

export interface ToolbarTabSwipeBinding {
  panHandlers: GestureResponderHandlers;
  offsetX: Animated.Value;
  preview: TabSwipePreview | null;
}

export function useToolbarTabSwipe<T extends SwipeableTab>({
  enabled,
  tabs,
  currentTabId,
  reducedMotion,
  labelOf,
  onSwitchTab,
}: {
  enabled: boolean;
  tabs: readonly T[];
  currentTabId: string | null | undefined;
  reducedMotion: boolean;
  labelOf: (tab: T) => string;
  onSwitchTab: (tabId: string) => void;
}): ToolbarTabSwipeBinding {
  const offsetX = useRef(new Animated.Value(0)).current;
  const [preview, setPreview] = useState<TabSwipePreview | null>(null);
  const previewRef = useRef<TabSwipePreview | null>(null);

  const enabledRef = useRef(enabled);
  const tabsRef = useRef(tabs);
  const currentTabIdRef = useRef(currentTabId);
  const reducedMotionRef = useRef(reducedMotion);
  const labelOfRef = useRef(labelOf);
  const onSwitchTabRef = useRef(onSwitchTab);

  enabledRef.current = enabled;
  tabsRef.current = tabs;
  currentTabIdRef.current = currentTabId;
  reducedMotionRef.current = reducedMotion;
  labelOfRef.current = labelOf;
  onSwitchTabRef.current = onSwitchTab;

  const updatePreview = (next: TabSwipePreview | null) => {
    const prev = previewRef.current;
    if (
      prev?.delta === next?.delta &&
      prev?.title === next?.title &&
      prev?.ready === next?.ready
    ) {
      return;
    }
    previewRef.current = next;
    setPreview(next);
  };

  const resetMotion = (immediate = false) => {
    updatePreview(null);
    if (reducedMotionRef.current || immediate) {
      offsetX.stopAnimation();
      offsetX.setValue(0);
      return;
    }
    Animated.spring(offsetX, {
      toValue: 0,
      bounciness: 4,
      useNativeDriver: true,
    }).start();
  };

  useEffect(() => {
    if (!enabled || tabs.length <= 1) {
      resetMotion(true);
    }
  }, [enabled, tabs.length]);

  useEffect(() => {
    if (reducedMotion) {
      offsetX.stopAnimation();
      offsetX.setValue(0);
    }
  }, [reducedMotion, offsetX]);

  useEffect(() => () => offsetX.stopAnimation(), [offsetX]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) =>
          enabledRef.current &&
          tabsRef.current.length > 1 &&
          classifyToolbarHorizontalSwipe(gestureState.dx, gestureState.dy) === "claim",
        onMoveShouldSetPanResponderCapture: (_, gestureState) =>
          enabledRef.current &&
          tabsRef.current.length > 1 &&
          classifyToolbarHorizontalSwipe(gestureState.dx, gestureState.dy) === "claim",
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, gestureState) => {
          if (!enabledRef.current || tabsRef.current.length <= 1) return;
          if (!reducedMotionRef.current) {
            offsetX.setValue(clampToolbarSwipeOffset(gestureState.dx));
          }
          const delta = resolveToolbarSwipeDelta(gestureState.dx);
          const nextTab = delta
            ? resolveSwipeTargetTab(tabsRef.current, currentTabIdRef.current, delta)
            : null;
          if (!delta || !nextTab) {
            updatePreview(null);
            return;
          }
          const ready = resolveToolbarSwipeCommit(gestureState.dx, 0) === delta;
          updatePreview({
            delta,
            title: labelOfRef.current(nextTab),
            ready,
          });
        },
        onPanResponderRelease: (_, gestureState) => {
          const commitDelta = enabledRef.current
            ? resolveToolbarSwipeCommit(gestureState.dx, gestureState.vx)
            : null;
          const nextTab = commitDelta
            ? resolveSwipeTargetTab(
                tabsRef.current,
                currentTabIdRef.current,
                commitDelta
              )
            : null;
          resetMotion();
          if (nextTab) {
            onSwitchTabRef.current(nextTab.id);
          }
        },
        onPanResponderTerminate: () => {
          resetMotion();
        },
      }),
    [offsetX]
  );

  return {
    panHandlers: panResponder.panHandlers,
    offsetX,
    preview,
  };
}
