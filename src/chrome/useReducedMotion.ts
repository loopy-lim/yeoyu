import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";
import { ReducedMotionStore } from "./reducedMotionStore";

const preference = new ReducedMotionStore({
  read: () => AccessibilityInfo.isReduceMotionEnabled(),
  subscribe: (listener) => {
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      listener
    );
    return () => subscription.remove();
  },
});

export function useReducedMotion(): boolean {
  return useSyncExternalStore(preference.subscribe, preference.getSnapshot);
}
