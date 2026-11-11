// Design tokens for the yeoyu chrome. Every color role, gap, radius, size,
// and duration in the UI derives from here, so the two appearances stay
// consistent and the acceptance gates (docs/reference/design-gates.md,
// scripts/contrast-check.ts) have a single source of truth.

import { resolveColorMode, type ResolvedColorMode, type UiPreferences } from "@/uiPreferences";

export type Appearance = "lavender" | "warm";

// 4dp-leaning spacing scale (dp). Odd gaps snap to the nearest step.
export const space = {
  xs: 2,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 10,
  xxl: 12,
  xxxl: 16,
} as const;

export const radius = {
  chip: 5,
  control: 9,
  field: 11,
  tile: 12,
  card: 16,
  dialog: 18,
} as const;

export const font = {
  micro: 9,
  small: 10,
  body: 11,
  bodyPlus: 12,
  input: 13,
  inputPlus: 14,
  icon: 16,
  title: 18,
} as const;

export const size = {
  frame: 8, // default outer frame in dp when no user px preference exists
  sidebar: 240, // Arc's expanded sidebar width, 1:1
  rail: 48, // Arc's collapsed rail width, 1:1
  row: 30, // pane/divider row height
  tabRow: 34, // tablet rows keep a clear touch lane without overlapping hit targets
  workspaceRow: 28,
  railItem: 36,
  tile: 38,
  favorite: 40, // rounded favorite tiles, up to three columns
  iconButton: 32,
  avatar: 28,
  toolbar: 44,
  address: 34,
  addressCompact: 34,
  input: 44,
  actionRow: 48,
  bookmarkRow: 44,
} as const;

// Durations in ms. `pill` uses physical spring params (tension/friction):
// ~200ms settle with a soft, single overshoot. Curves live in
// src/chrome/motion.ts (React Native Easing is unavailable in bun tests).
export const motion = {
  micro: 120,
  fade: 140,
  base: 170,
  slide: 200,
  split: 280,
  pill: { tension: 200, friction: 16 },
  press: { scale: 0.98, tension: 300, friction: 22 },
} as const;

// Opacity treatments. disabled 0.38 is intentionally below usable contrast —
// disabled chrome must read as inert at a glance (docs/reference/design-gates.md).
export const alpha = { pressed: 0.58, disabled: 0.38 } as const;

export interface Theme {
  // Surfaces
  chrome: string; // app background behind the sidebar
  sidebar: string;
  canvas: string; // panes area behind the content card
  surface: string; // content card
  surfaceElevated: string; // dialogs, compact toolbar
  white: string; // raised tiles, pane background, mini players
  sunken: string; // inputs and action rows on elevated surfaces
  sunkenStrong: string; // focused pane header, selected option fill
  fieldOnChrome: string; // translucent address field on the sidebar
  pill: string; // active tab selection pill
  favChip: string; // favicon chip behind tab rows
  pinnedRow: string;
  railIconTile: string;
  manageTile: string;
  ghost: string; // drag ghost card
  // Accents
  accent: string; // ≥3:1 against sunken surfaces; progress hairline, rings
  accentStrong: string; // selected borders, check marks
  paneFocus: string; // quiet outline of the focused pane — NOT the accent,
  // so a settled page never reads as a stuck full-width progress bar
  ringShadow: string; // shadow tint for raised tiles and the card
  // Ink
  ink: string; // ≥7:1 on sidebar
  inkMuted: string; // ≥4.5:1 on sidebar
  inkFaint: string; // ≥4.5:1 on chrome and white surfaces, including small text
  icon: string; // ≥4.5:1 on sidebar and surface
  // Lines
  cardBorder: string;
  hairline: string; // separators on white surfaces
  hairlineOnChrome: string; // separators on the sidebar
  tileBorder: string;
  switchOff: string;
  // Overlays
  scrim: string;
  noticeBg: string;
  noticeInk: string;
  errorBg: string;
  errorInk: string;
  dropBorder: string;
  dropFill: string;
}

const shared = {
  surface: "#f7f6f7",
  surfaceElevated: "#fbfafb",
  white: "#ffffff",
  fieldOnChrome: "rgba(255,255,255,0.38)",
  // Selection is a quiet opaque step, not a milky raised card.
  pill: "rgba(255,255,255,0.42)",
  favChip: "rgba(255,255,255,0.4)",
  pinnedRow: "rgba(255,255,255,0.28)",
  railIconTile: "rgba(255,255,255,0.55)",
  manageTile: "rgba(255,255,255,0.5)",
  ghost: "rgba(255,255,255,0.96)",
  errorBg: "#f5dfe4",
  errorInk: "#7b2934",
};

export const themes: Record<Appearance, Theme> = {
  // Quieted lavender: keep the hue, drop pastel punch and creamy overlays.
  lavender: {
    ...shared,
    chrome: "#d2ced6",
    sidebar: "#d6d2da",
    canvas: "#d4d0d8",
    sunken: "#eeebf0",
    sunkenStrong: "#e4e0e7",
    accent: "#8f7a93",
    accentStrong: "#7d697f",
    paneFocus: "#a89aad",
    ringShadow: "#6a5f70",
    ink: "#3d3642",
    inkMuted: "#564e5c",
    inkFaint: "#564d5c",
    icon: "#4d4554",
    cardBorder: "#c4bec9",
    hairline: "#e2dee6",
    hairlineOnChrome: "#c3bcc8",
    tileBorder: "rgba(70,62,78,0.14)",
    switchOff: "#dbd6df",
    scrim: "rgba(45,40,52,0.32)",
    noticeBg: "rgba(55,48,62,0.92)",
    noticeInk: "#faf8fb",
    dropBorder: "#887690",
    dropFill: "rgba(143,122,147,0.16)",
  },
  warm: {
    ...shared,
    chrome: "#d6cfcf",
    sidebar: "#dbd4d3",
    canvas: "#d8d1d0",
    sunken: "#f0ebe9",
    sunkenStrong: "#e6dfdc",
    accent: "#9d756e",
    accentStrong: "#8a645d",
    paneFocus: "#b89a95",
    ringShadow: "#74605d",
    ink: "#433837",
    inkMuted: "#5c504e",
    inkFaint: "#5c504c",
    icon: "#524441",
    cardBorder: "#cdc2c1",
    hairline: "#e6dfdd",
    hairlineOnChrome: "#c9bfbd",
    tileBorder: "rgba(90,70,66,0.14)",
    switchOff: "#e0d5d3",
    scrim: "rgba(48,40,40,0.32)",
    noticeBg: "rgba(62,50,48,0.92)",
    noticeInk: "#faf8f7",
    dropBorder: "#94706a",
    dropFill: "rgba(157,117,110,0.16)",
  },
};

// Dark roles use bright ink on low-luminance surfaces. Controls use calibrated
// alpha fills to provide clear contrast and shape without washing out ink.
const sharedDark = {
  fieldOnChrome: "rgba(255,255,255,0.09)",
  pill: "rgba(255,255,255,0.14)",
  favChip: "rgba(255,255,255,0.08)",
  pinnedRow: "rgba(255,255,255,0.08)",
  railIconTile: "rgba(255,255,255,0.10)",
  manageTile: "rgba(255,255,255,0.10)",
  ghost: "rgba(39,34,43,0.98)",
  scrim: "rgba(0,0,0,0.58)",
  noticeBg: "rgba(238,231,243,0.96)",
  noticeInk: "#302735",
  errorBg: "#49272e",
  errorInk: "#ffccd2",
};

export const darkThemes: Record<Appearance, Theme> = {
  lavender: {
    ...sharedDark,
    chrome: "#211c26", sidebar: "#28212e", canvas: "#1d1922",
    surface: "#25212a", surfaceElevated: "#302936", white: "#2d2633",
    sunken: "#2d2633", sunkenStrong: "#3a3042",
    accent: "#b49cbe", accentStrong: "#c4add0", paneFocus: "#77647f",
    ringShadow: "#100d13", ink: "#f3edf6", inkMuted: "#d6c9dc",
    inkFaint: "#c5b7cd", icon: "#dacfe0", cardBorder: "#55445f",
    hairline: "#4b3d54", hairlineOnChrome: "#53425c",
    tileBorder: "rgba(213,194,225,0.24)", switchOff: "#67576f",
    dropBorder: "#bc9fce", dropFill: "rgba(180,151,191,0.16)",
  },
  warm: {
    ...sharedDark,
    chrome: "#261d1e", sidebar: "#2e2324", canvas: "#211a1b",
    surface: "#2a2223", surfaceElevated: "#352a2b", white: "#322829",
    sunken: "#322829", sunkenStrong: "#413133",
    accent: "#c29c93", accentStrong: "#d3aea4", paneFocus: "#826760",
    ringShadow: "#140e0f", ink: "#f7eeeb", inkMuted: "#dfcdc7",
    inkFaint: "#cfbab3", icon: "#e3d0c9", cardBorder: "#604845",
    hairline: "#54413e", hairlineOnChrome: "#5e4844",
    tileBorder: "rgba(228,198,185,0.24)", switchOff: "#725b55",
    dropBorder: "#d0a99d", dropFill: "rgba(191,151,148,0.16)",
  },
};

const HEX6_RE = /^#[0-9a-fA-F]{6}$/;
const RGBA_RE = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/;

const channel = (value: number) => {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

const parseHex = (hex: string) => {
  const body = hex.replace(/^#/, "");
  if (body.length === 3)
    return [0, 1, 2].map((i) => parseInt(body[i] + body[i], 16)) as [
      number,
      number,
      number
    ];
  return [
    parseInt(body.slice(0, 2), 16),
    parseInt(body.slice(2, 4), 16),
    parseInt(body.slice(4, 6), 16),
  ] as [number, number, number];
};

export const luminance = (hex: string) => {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

// WCAG 2.x contrast ratio between two opaque colors.
export const contrastRatio = (a: string, b: string) => {
  const la = luminance(a);
  const lb = luminance(b);
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
};

// Worst-case blend of an rgba() color onto an opaque background (used by
// gates for translucent scrubs/notices floating over unknown content).
export const blendOn = (rgba: string, background: string) => {
  const match = RGBA_RE.exec(rgba);
  if (!match) return rgba;
  const [, r, g, b, alphaText] = match;
  const alpha = parseFloat(alphaText);
  const [br, bg, bb] = parseHex(background);
  const mix = (fg: number, bg: number) =>
    Math.round(alpha * fg + (1 - alpha) * bg);
  const mixed = `#${[
    mix(parseInt(r), br),
    mix(parseInt(g), bg),
    mix(parseInt(b), bb),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
  return mixed;
};

// Mirror of native WORKSPACE_PALETTE (native/src/domain.rs): tints assigned
// to created spaces, in order. The default space carries no color and keeps
// the appearance hue, so the shipped look is unchanged.
export const WORKSPACE_PALETTE = [
  "#7d94d4",
  "#68b3ae",
  "#82b478",
  "#d0a86c",
  "#cf8a70",
  "#c47fa4",
] as const;

const rgbToHsl = (
  r: number,
  g: number,
  b: number
): [number, number, number] => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn
      ? ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
      : max === gn
      ? ((bn - rn) / d + 2) * 60
      : ((rn - gn) / d + 4) * 60;
  return [h, s, l];
};

const hslToRgb = (
  h: number,
  s: number,
  l: number
): [number, number, number] => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
      ? [x, c, 0]
      : hp < 3
      ? [0, c, x]
      : hp < 4
      ? [0, x, c]
      : hp < 5
      ? [x, 0, c]
      : [c, 0, x];
  const m = l - c / 2;
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
};

const hexToHsl = (hex: string): [number, number, number] => {
  const [r, g, b] = parseHex(hex);
  return rgbToHsl(r, g, b);
};

const hslToHex = (h: number, s: number, l: number) =>
  `#${hslToRgb(h, s, l)
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;

interface ParsedColor {
  h: number;
  s: number;
  l: number;
  alpha: number | null;
}

const parseColor = (color: string): ParsedColor | null => {
  if (HEX6_RE.test(color)) {
    const [h, s, l] = hexToHsl(color);
    return { h, s, l, alpha: null };
  }
  const rgba = RGBA_RE.exec(color);
  if (rgba) {
    const [h, s, l] = rgbToHsl(
      parseInt(rgba[1]),
      parseInt(rgba[2]),
      parseInt(rgba[3])
    );
    return { h, s, l, alpha: parseFloat(rgba[4]) };
  }
  return null;
};

const renderColor = ({ h, s, l, alpha }: ParsedColor) => {
  if (alpha === null) return hslToHex(h, s, l);
  const [r, g, b] = hslToRgb(h, s, l);
  return `rgba(${r},${g},${b},${alpha})`;
};

const retintOne = (color: string, hue: number, saturationScale = 1) => {
  const parsed = parseColor(color);
  if (!parsed) return color;
  if (parsed.alpha !== null) {
    // Low-alpha fills carry no gate duty; a pure hue slide is enough.
    return renderColor({ ...parsed, h: hue, s: parsed.s * saturationScale });
  }
  // Tone-preserving retint: after the hue slide, walk the lightness axis
  // until the WCAG luminance matches the original. Opaque colors stay near their base luminance; 8-bit quantization
  // can slightly change contrast. Translucent fills still need composited checks.
  const { h, s, l } = parsed;
  const saturation = s * saturationScale;
  const target = luminance(hslToHex(h, s, l));
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (luminance(hslToHex(hue, saturation, mid)) < target) lo = mid;
    else hi = mid;
  }
  const pick =
    Math.abs(luminance(hslToHex(hue, saturation, lo)) - target) <=
    Math.abs(luminance(hslToHex(hue, saturation, hi)) - target)
      ? lo
      : hi;
  return hslToHex(hue, saturation, pick);
};

// Space tinting: slide the hue of the chrome surfaces, ink, and accents
// toward the space color while preserving each color's WCAG luminance, so
// opaque contrast ratios remain close to the base appearance. Semantic overlays (scrim, notices, errors) and white-alpha fills
// stay untouched.
export const retintTheme = (base: Theme, color: string, saturationScale = 1): Theme => {
  if (!HEX6_RE.test(color)) return base;
  const hue = hexToHsl(color)[0];
  const shift = (c: string) => retintOne(c, hue, saturationScale);
  return {
    ...base,
    chrome: shift(base.chrome),
    sidebar: shift(base.sidebar),
    canvas: shift(base.canvas),
    surface: shift(base.surface),
    surfaceElevated: shift(base.surfaceElevated),
    white: shift(base.white),
    sunken: shift(base.sunken),
    sunkenStrong: shift(base.sunkenStrong),
    cardBorder: shift(base.cardBorder),
    hairline: shift(base.hairline),
    hairlineOnChrome: shift(base.hairlineOnChrome),
    tileBorder: shift(base.tileBorder),
    switchOff: shift(base.switchOff),
    dropBorder: shift(base.dropBorder),
    dropFill: shift(base.dropFill),
    accent: shift(base.accent),
    accentStrong: shift(base.accentStrong),
    paneFocus: shift(base.paneFocus),
    ringShadow: shift(base.ringShadow),
    ink: shift(base.ink),
    inkMuted: shift(base.inkMuted),
    inkFaint: shift(base.inkFaint),
    icon: shift(base.icon),
  };
};

/** A color seed chooses hue/chroma while retaining the base palette's tone targets. */
export function resolveTheme(
  preferences: Pick<UiPreferences, "appearance" | "colorMode" | "colorSource" | "customColor">,
  spaceColor = "",
  systemScheme?: ResolvedColorMode | null
): Theme {
  const palettes = resolveColorMode(preferences.colorMode, systemScheme) === "dark" ? darkThemes : themes;
  const base = palettes[preferences.appearance];
  if (preferences.colorSource === "appearance") return base;
  if (preferences.colorSource === "custom") {
    const color = preferences.customColor ?? "";
    if (!HEX6_RE.test(color)) return base;
    return retintTheme(base, color, hexToHsl(color)[1]);
  }
  return retintTheme(base, spaceColor);
}
