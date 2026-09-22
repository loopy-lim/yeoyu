import { expect, test } from "bun:test";
import { blendOn, contrastRatio, luminance, resolveTheme, themes, WORKSPACE_PALETTE } from "../src/theme";
import { failedGates, paletteContrastGates } from "../src/themeGates";

test("both appearances define the same color roles", () => {
  expect(Object.keys(themes.lavender).sort()).toEqual(
    Object.keys(themes.warm).sort()
  );
});

test("contrast helper matches the WCAG reference values", () => {
  expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
});

test("luminance treats mid gray as ordered between black and white", () => {
  const black = luminance("#000000");
  const mid = luminance("#777777");
  const white = luminance("#ffffff");
  expect(black).toBeLessThan(mid);
  expect(mid).toBeLessThan(white);
});

test("palette holds every contrast gate in both appearances", () => {
  const failures = failedGates();
  expect(failures).toEqual([]);
});

test("system mode follows live brightness changes and explicit modes remain fixed", () => {
  const preferences = { appearance: "lavender", colorSource: "appearance", colorMode: "system" } as const;
  const light = resolveTheme(preferences, "", "light");
  const dark = resolveTheme(preferences, "", "dark");
  expect(light).toBe(themes.lavender);
  expect(luminance(dark.sidebar)).toBeLessThan(0.08);
  expect(resolveTheme(preferences, "", "light")).toBe(light);
  expect(resolveTheme({ ...preferences, colorMode: "dark" }, "", "light")).toBe(dark);
  expect(resolveTheme({ ...preferences, colorMode: "light" }, "", "dark")).toBe(light);
  expect(resolveTheme({ appearance: "lavender" }, "", null)).toBe(light);
});

test("dark appearances retain all surface and foreground roles with usable composed contrast", () => {
  for (const appearance of ["lavender", "warm"] as const) {
    const base = resolveTheme({ appearance, colorMode: "dark", colorSource: "appearance" });
    expect(Object.keys(base).sort()).toEqual(Object.keys(themes[appearance]).sort());
    expect(luminance(base.surface)).toBeLessThan(0.08);
    for (const seed of [...WORKSPACE_PALETTE, "#000000", "#ffffff", "#808080", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff"]) {
      const t = resolveTheme({ appearance, colorMode: "dark", colorSource: "custom", customColor: seed });
      expect(contrastRatio(t.ink, t.sidebar)).toBeGreaterThanOrEqual(7);
      for (const background of [t.chrome, t.sidebar, t.canvas, t.surface, t.surfaceElevated, t.white, t.sunken, t.sunkenStrong, blendOn(t.pill, t.sidebar), blendOn(t.fieldOnChrome, t.sidebar), blendOn(t.railIconTile, t.sidebar)]) {
        for (const foreground of [t.ink, t.inkMuted, t.inkFaint, t.icon])
          expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(t.accent, t.sunken)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(t.accentStrong, t.surfaceElevated)).toBeGreaterThanOrEqual(3);
    }
  }
});

test("custom seed and brightness remain independent across mode changes", () => {
  const custom = { appearance: "warm", colorSource: "custom", customColor: "#68b3ae" } as const;
  const light = resolveTheme({ ...custom, colorMode: "light" });
  const dark = resolveTheme({ ...custom, colorMode: "dark" });
  expect(light.sidebar).not.toBe(themes.warm.sidebar);
  expect(dark.sidebar).not.toBe(resolveTheme({ appearance: "warm", colorMode: "dark", colorSource: "appearance" }).sidebar);
  expect(luminance(light.sidebar)).toBeGreaterThan(0.5);
  expect(luminance(dark.sidebar)).toBeLessThan(0.08);
  for (const colorMode of ["light", "dark"] as const) {
    const neutral = resolveTheme({ ...custom, colorMode, customColor: "#000000" });
    expect(neutral.sidebar.slice(1, 3)).toBe(neutral.sidebar.slice(3, 5));
    expect(neutral.sidebar.slice(3, 5)).toBe(neutral.sidebar.slice(5, 7));
  }
});

test("custom color gamut samples preserve the same contrast thresholds in both modes", () => {
  const failures: string[] = [];
  for (const colorMode of ["light", "dark"] as const)
    for (const appearance of ["lavender", "warm"] as const)
      for (const r of [0, 64, 128, 192, 255])
        for (const g of [0, 64, 128, 192, 255])
          for (const b of [0, 64, 128, 192, 255]) {
            const customColor = `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
            const theme = resolveTheme({ appearance, colorMode, colorSource: "custom", customColor });
            const gates = paletteContrastGates(`${appearance} ${colorMode} ${customColor}`, theme);
            failures.push(...gates.filter((gate) => contrastRatio(gate.fg, gate.bg) < gate.min).map((gate) => gate.name));
          }
  expect(failures).toEqual([]);
});
