import {
  blendOn,
  contrastRatio,
  retintTheme,
  themes,
  WORKSPACE_PALETTE,
  type Theme,
} from "./theme";

// Numeric acceptance gates for the palette (docs/architecture.md). Every
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

const baseGates = (variant: string, t: Theme) => [
  gate(t, variant, "icon", "sidebar", 4.5),
  gate(t, variant, "ink", "sidebar", 7),
  gate(t, variant, "inkMuted", "sidebar", 4.5),
  gate(t, variant, "inkFaint", "sidebar", 4.5),
  gate(t, variant, "inkFaint", "surface", 4.5),
  gate(t, variant, "inkFaint", "sunken", 4.5),
  gate(t, variant, "accent", "sunken", 3),
  gate(t, variant, "accentStrong", "surfaceElevated", 3),
  gate(t, variant, "errorInk", "errorBg", 4.5),
  {
    name: `${variant}: noticeInk on noticeBg (worst case over white)`,
    fg: t.noticeInk,
    bg: blendOn(t.noticeBg, "#ffffff"),
    min: 4.5,
  },
];

export const contrastGates = (): ContrastGate[] =>
  (Object.keys(themes) as ("lavender" | "warm")[]).flatMap((appearance) => [
    ...baseGates(appearance, themes[appearance]),
    // Every space tint must hold the ink and accent roles too: the sidebar
    // and sunken surfaces retint with the space color.
    ...WORKSPACE_PALETTE.flatMap((color) =>
      baseGates(
        `${appearance} ${color}`,
        retintTheme(themes[appearance], color)
      )
    ),
  ]);

export const failedGates = () =>
  contrastGates().filter((g) => !(contrastRatio(g.fg, g.bg) >= g.min));
