import { expect, test } from "bun:test";
import { sidebarSizing, clampSidebarWidth } from "../src/sidebarSizing";
import {
  defaultUiPreferences,
  loadUiPreferences,
  reduceUiPreferences,
} from "../src/uiPreferences";

test("side-by-side pages constrain the displayed sidebar without changing its saved width", () => {
  const saved = { ...defaultUiPreferences, sidebarWidth: 320 };
  // 902dp inside the frame: 648dp is reserved for two pages, borders and divider.
  expect(sidebarSizing(saved.sidebarWidth, 902, true)).toEqual({
    min: 200,
    max: 254,
    width: 254,
  });
  expect(saved.sidebarWidth).toBe(320);
  expect(sidebarSizing(saved.sidebarWidth, 902, false).width).toBe(320);
  expect(sidebarSizing(saved.sidebarWidth, 1200, true).width).toBe(320);
});

test("a small saved width is retained, and narrow layouts keep a usable sidebar minimum", () => {
  expect(sidebarSizing(208, 900, true).width).toBe(208);
  expect(sidebarSizing(320, 500, true)).toEqual({
    min: 200,
    max: 200,
    width: 200,
  });
  expect(sidebarSizing(280, 560, false).width).toBe(236);
});

test("dragging and accessibility steps use the current layout bounds", () => {
  const limits = sidebarSizing(320, 902, true);
  expect(clampSidebarWidth(700, limits.max)).toBe(254);
  expect(clampSidebarWidth(50, limits.max)).toBe(200);
  expect(clampSidebarWidth(limits.width - 8, limits.max)).toBe(246);
  expect(clampSidebarWidth(245.7, limits.max)).toBe(246);
});

test.each([Number.NaN, Infinity, -Infinity])(
  "invalid resize sample %s does not poison the saved width",
  (width) => {
    const saved = { ...defaultUiPreferences, sidebarWidth: 272 };
    expect(reduceUiPreferences(saved, { type: "setSidebarWidth", width })).toBe(
      saved
    );
  }
);

test("the user-selected width survives persistence independently of temporary split limits", async () => {
  const saved = reduceUiPreferences(defaultUiPreferences, {
    type: "setSidebarWidth",
    width: 296,
  });
  const restored = await loadUiPreferences(async () => JSON.stringify(saved));
  expect(restored.sidebarWidth).toBe(296);
  expect(sidebarSizing(restored.sidebarWidth, 880, true).width).toBe(232);
  expect(sidebarSizing(restored.sidebarWidth, 1200, true).width).toBe(296);
});
