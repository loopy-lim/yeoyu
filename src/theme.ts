// Design tokens for the yeoyu chrome. Every color role, gap, radius, size,
// and duration in the UI derives from here, so the two appearances stay
// consistent and the acceptance gates (docs/reference/design-gates.md,
// scripts/contrast-check.ts) have a single source of truth.

import { resolveColorMode, type ResolvedColorMode, type UiPreferences } from "@/uiPreferences";

export type Appearance = "lavender" | "warm";

// 4dp-leaning spacing scale (dp). Odd gaps snap to the nearest step.
// Tablet comfort pass (2026-11): steps from md up gained breathing room;
// xs/sm stay hairline-adjacent for label-to-content pairs.
export const space = {
  xs: 2,
  sm: 4,
  md: 8,
  lg: 10,
  xl: 12,
  xxl: 16,
  xxxl: 20,
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
  micro: 10,
  small: 11,
  body: 13,
  bodyPlus: 14,
  input: 14,
  inputPlus: 15,
  icon: 18,
  title: 20,
} as const;

export const size = {
  frame: 10, // default outer frame in dp when no user px preference exists
  sidebar: 240, // Arc's expanded sidebar width, 1:1
  rail: 48, // Arc's collapsed rail width, 1:1
  row: 36, // pane/divider row height
  tabRow: 40, // tablet rows keep a clear touch lane without overlapping hit targets
  workspaceRow: 34,
  railItem: 40,
  tile: 44,
  favorite: 44, // rounded favorite tiles, up to three columns
  iconButton: 40,
  avatar: 32,
  toolbar: 48,
  address: 40,
  addressCompact: 36,
  input: 48,
  actionRow: 48,
  bookmarkRow: 48,
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
  surface: "#f8f8fa",
  surfaceElevated: "#ffffff",
  white: "#ffffff",
  fieldOnChrome: "rgba(255,255,255,0.58)",
  // Selection is a crisp translucent lift over the sidebar canvas.
  pill: "rgba(255,255,255,0.86)",
  favChip: "rgba(0,0,0,0.06)",
  pinnedRow: "rgba(255,255,255,0.42)",
  railIconTile: "rgba(255,255,255,0.68)",
  manageTile: "rgba(255,255,255,0.58)",
  ghost: "rgba(255,255,255,0.96)",
  errorBg: "#f5dfe4",
  errorInk: "#7b2934",
};

export const themes: Record<Appearance, Theme> = {
  // Zen-aligned neutral cool slate with quiet lavender-indigo accents.
  lavender: {
    ...shared,
    chrome: "#e8e8ec",
    sidebar: "#ebebf0",
    canvas: "#e8e8ec",
    sunken: "#f1f1f5",
    sunkenStrong: "#e4e4ec",
    accent: "#7a7099",
    accentStrong: "#645a82",
    paneFocus: "#a6a0b8",
    ringShadow: "#2c2c34",
    ink: "#1c1c21",
    inkMuted: "#4b4b56",
    inkFaint: "#575763",
    icon: "#363640",
    cardBorder: "#d6d6df",
    hairline: "#e2e2ea",
    hairlineOnChrome: "#d4d4dc",
    tileBorder: "rgba(0,0,0,0.08)",
    switchOff: "#d5d5de",
    scrim: "rgba(20,20,26,0.28)",
    noticeBg: "rgba(30,30,36,0.94)",
    noticeInk: "#f8f8fa",
    dropBorder: "#7a7099",
    dropFill: "rgba(122,112,153,0.16)",
  },
  // Zen-aligned warm alabaster stone with muted rose-terracotta accents.
  warm: {
    ...shared,
    chrome: "#ebe7e5",
    sidebar: "#eeebe9",
    canvas: "#ebe7e5",
    sunken: "#f3efed",
    sunkenStrong: "#e7e1de",
    accent: "#967168",
    accentStrong: "#7e5d55",
    paneFocus: "#b8a39d",
    ringShadow: "#3a312e",
    ink: "#231e1c",
    inkMuted: "#534a46",
    inkFaint: "#5c524e",
    icon: "#3d3532",
    cardBorder: "#dcd5d2",
    hairline: "#e6e0dd",
    hairlineOnChrome: "#d8d1ce",
    tileBorder: "rgba(0,0,0,0.08)",
    switchOff: "#dcd5d2",
    scrim: "rgba(32,26,24,0.28)",
    noticeBg: "rgba(42,35,33,0.94)",
    noticeInk: "#faf8f7",
    dropBorder: "#967168",
    dropFill: "rgba(150,113,104,0.16)",
  },
};

// Dark roles use crisp light ink on deep neutral obsidian surfaces, matching
// Zen Browser's signature calm borderless dark chrome.
const sharedDark = {
  fieldOnChrome: "rgba(255,255,255,0.07)",
  pill: "rgba(255,255,255,0.13)",
  favChip: "rgba(255,255,255,0.08)",
  pinnedRow: "rgba(255,255,255,0.07)",
  railIconTile: "rgba(255,255,255,0.09)",
  manageTile: "rgba(255,255,255,0.09)",
  ghost: "rgba(32,32,38,0.98)",
  scrim: "rgba(0,0,0,0.52)",
  noticeBg: "rgba(242,242,246,0.96)",
  noticeInk: "#1c1c22",
  errorBg: "#49272e",
  errorInk: "#ffccd2",
};

export const darkThemes: Record<Appearance, Theme> = {
  lavender: {
    ...sharedDark,
    chrome: "#18181b", sidebar: "#1b1b1f", canvas: "#151518",
    surface: "#202025", surfaceElevated: "#26262c", white: "#2b2b32",
    sunken: "#1d1d22", sunkenStrong: "#31313a",
    accent: "#a59bc7", accentStrong: "#bbb2dc", paneFocus: "#646175",
    ringShadow: "#09090b", ink: "#f2f2f5", inkMuted: "#c2c2ce",
    inkFaint: "#adadb9", icon: "#d7d7e0", cardBorder: "#2d2d35",
    hairline: "#303039", hairlineOnChrome: "#2e2e36",
    tileBorder: "rgba(255,255,255,0.10)", switchOff: "#42424d",
    dropBorder: "#b0a6d4", dropFill: "rgba(165,155,199,0.16)",
  },
  warm: {
    ...sharedDark,
    chrome: "#1b1918", sidebar: "#1f1c1b", canvas: "#181615",
    surface: "#23201f", surfaceElevated: "#2a2624", white: "#302b29",
    sunken: "#201d1c", sunkenStrong: "#37312e",
    accent: "#c59e92", accentStrong: "#d8b3a8", paneFocus: "#74625c",
    ringShadow: "#0b0908", ink: "#f5f1ef", inkMuted: "#cbc1bd",
    inkFaint: "#b8ada9", icon: "#dfd7d4", cardBorder: "#342e2c",
    hairline: "#37312f", hairlineOnChrome: "#362f2d",
    tileBorder: "rgba(255,255,255,0.10)", switchOff: "#4a413e",
    dropBorder: "#cfaba0", dropFill: "rgba(197,158,146,0.16)",
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
