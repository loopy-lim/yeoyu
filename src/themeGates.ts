import {
  blendOn,
  contrastRatio,
  resolveTheme,
  themes,
  WORKSPACE_PALETTE,
  type Theme,
} from "./theme";

// Numeric acceptance gates for the palette (docs/reference/design-gates.md). Every
// text/icon role must hold its ratio in BOTH appearances — including every
// space-tinted variant the retint engine can produce — and the check runs
// in the bun suite and as scripts/contrast-check.ts in check.sh.
export interface ContrastGate {
  name: string;
  fg: string;
  bg: string;
  min: number;
}

const gate = (
  theme: Theme,
  variant: string,
  role: keyof Theme,
  background: keyof Theme | string,
  min: number
): ContrastGate => ({
  name: `${variant}: ${String(role)} on ${String(background)}`,
  fg: theme[role],
  bg: background.startsWith("#")
    ? background
    : theme[background as keyof Theme],
  min,
});

export const paletteContrastGates = (variant: string, t: Theme) => [
  gate(t, variant, "icon", "sidebar", 4.5),
  gate(t, variant, "ink", "sidebar", 7),
  gate(t, variant, "inkMuted", "sidebar", 4.5),
  gate(t, variant, "inkFaint", "sidebar", 4.5),
  gate(t, variant, "inkFaint", "surface", 4.5),
  gate(t, variant, "inkFaint", "sunken", 4.5),
  gate(t, variant, "accent", "sunken", 3),
  gate(t, variant, "accentStrong", "surfaceElevated", 3),
  gate(t, variant, "errorInk", "errorBg", 4.5),
  // The address-bar shield glyph (secure/attention) lives on the pill and
  // compact-toolbar fills; it is an icon, so the graphic 3:1 bar applies.
  ...(["fieldOnChrome", "sunken"] as const).map((background) => ({
    name: `${variant}: errorInk on composed ${background}`,
    fg: t.errorInk,
    bg: blendOn(t[background], t.sidebar),
    min: 3,
  })),
  ...(["ink", "inkMuted", "inkFaint", "icon"] as const).flatMap((role) =>
    (["chrome", "sidebar", "canvas", "surface", "surfaceElevated", "white", "sunken", "sunkenStrong", "fieldOnChrome", "pill", "favChip", "pinnedRow", "railIconTile", "manageTile", "ghost"] as const).map((background) => ({
      name: `${variant}: ${role} on composed ${background}`,
      fg: t[role],
      bg: blendOn(t[background], t.sidebar),
      min: 4.5,
    }))
  ),
  {
    name: `${variant}: noticeInk on noticeBg (worst case over white)`,
    fg: t.noticeInk,
    bg: blendOn(t.noticeBg, "#ffffff"),
    min: 4.5,
  },
  {
    name: `${variant}: noticeInk on noticeBg (over black)`,
    fg: t.noticeInk,
    bg: blendOn(t.noticeBg, "#000000"),
    min: 4.5,
  },
];

export const contrastGates = (): ContrastGate[] =>
  (["light", "dark"] as const).flatMap((colorMode) =>
    (Object.keys(themes) as ("lavender" | "warm")[]).flatMap((appearance) => [
      ...paletteContrastGates(`${colorMode} ${appearance}`, resolveTheme({ appearance, colorMode, colorSource: "appearance" })),
      ...WORKSPACE_PALETTE.flatMap((color) => paletteContrastGates(
        `${colorMode} ${appearance} Space ${color}`,
        resolveTheme({ appearance, colorMode, colorSource: "space" }, color)
      )),
      ...[...WORKSPACE_PALETTE, "#000000", "#ffffff", "#808080", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff"].flatMap((customColor) => paletteContrastGates(
        `${colorMode} ${appearance} custom ${customColor}`,
        resolveTheme({ appearance, colorMode, colorSource: "custom", customColor })
      )),
    ])
  );

export const failedGates = () =>
  contrastGates().filter((g) => !(contrastRatio(g.fg, g.bg) >= g.min));
