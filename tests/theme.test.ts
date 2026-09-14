import { expect, test } from "bun:test";
import { contrastRatio, luminance, themes } from "../src/theme";
import { failedGates } from "../src/themeGates";

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
