import { Easing } from "react-native";

// Easing curves for the chrome, matching the Material 3 emphasized set.
// Kept out of src/theme.ts because Easing comes from react-native and the
// token module must stay importable from bun tests.
// enter: emphasized-decelerate bezier(0.05,0.7,0.1,1)
// exit:  emphasized-accelerate bezier(0.3,0,0.8,0.15)
// standard: emphasized bezier(0.2,0,0,1)
export const easing = {
  enter: Easing.bezier(0.05, 0.7, 0.1, 1),
  exit: Easing.bezier(0.3, 0, 0.8, 0.15),
  standard: Easing.bezier(0.2, 0, 0, 1),
  // Resizing a live web viewport needs a gradual start, unlike fading chrome.
  geometry: Easing.bezier(0.4, 0, 0.2, 1),
} as const;
