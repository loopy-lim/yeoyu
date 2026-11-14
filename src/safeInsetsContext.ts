import React from "react";

export interface SafeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const ZERO_INSETS: SafeInsets = {
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
};

/**
 * Lightweight safe-area context provided at the root App host from
 * `useSafeAreaInsets()`, allowing anchored overlays to avoid Android system
 * bars without importing `react-native-safe-area-context` in component unit
 * test harnesses.
 */
export const SafeInsetsContext = React.createContext<SafeInsets>(ZERO_INSETS);

export const useSafeInsets = () => React.useContext(SafeInsetsContext);
