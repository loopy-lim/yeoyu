import React, { memo } from "react";
import Svg, { Path } from "react-native-svg";
import { useTheme } from "../themeContext";

const paths = {
  sidebar: "M4 4h16v16H4z M9 4v16",
  back: "M15 5l-7 7 7 7 M8 12h13",
  forward: "M9 5l7 7-7 7 M3 12h13",
  reload: "M20 10a8 8 0 1 0-1 7 M20 4v6h-6",
  close: "M6 6l12 12 M18 6L6 18",
  plus: "M12 5v14 M5 12h14",
  home: "M3 10l9-7 9 7 M5 9v11h5v-6h4v6h5V9",
  space:
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M3 12h18 M12 3c-5 5-5 13 0 18 M12 3c5 5 5 13 0 18",
  folder: "M3 6h7l2 3h9v11H3z",
  chevronRight: "M9 5l7 7-7 7",
  chevronDown: "M5 9l7 7 7-7",
  chevronUp: "M5 15l7-7 7 7",
  minus: "M5 12h14",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  settings:
    "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0",
  split: "M3 4h18v16H3z M12 4v16",
  history: "M3 5v5h5 M3 10a9 9 0 1 1 1 7 M12 7v5l4 2",
  pin: "M8 3h8l-1 6 4 4v2H5v-2l4-4z M12 15v6",
  star: "M12 3l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z",
  play: "M7 4l13 8-13 8z",
  search: "M17 10a7 7 0 1 0-14 0 7 7 0 0 0 14 0 M15 15l6 6",
  copy: "M8 8h12v13H8z M16 8V3H3v13h5",
  edit: "M4 16L16 4l4 4L8 20H4z M13 7l4 4",
  trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  check: "M4 12l5 5L20 6",
  external: "M14 3h7v7 M21 3L10 14 M10 3H3v18h18v-7",
  private:
    "M9 5l-1.5 7 M15 5l1.5 7 M4 12h16 M9.5 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0 M14.5 16a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0 M9.5 16h5",
} as const;

export type IconName = keyof typeof paths;

/** One geometry and stroke weight for all browser controls, independent of fonts. */
export const ChromeIcon = memo(function ChromeIcon({
  name,
  size = 18,
  color,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  const theme = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path
        d={paths[name]}
        fill="none"
        stroke={color ?? theme.icon}
        strokeWidth={1.65}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
});
