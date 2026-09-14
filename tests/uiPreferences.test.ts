import { expect, test } from "bun:test";
import {
  defaultUiPreferences,
  loadUiPreferences,
  reduceUiPreferences,
  saveUiPreferences,
} from "../src/uiPreferences";

test("an unreadable settings store must not hydrate and overwrite saved preferences with defaults", async () => {
  const writes: string[] = [];
  const hydrateThenSave = loadUiPreferences(async () => {
    throw new Error("read unavailable");
  }).then((preferences) =>
    saveUiPreferences(async (json) => {
      writes.push(json);
    }, preferences)
  );
  await expect(hydrateThenSave).rejects.toThrow("read unavailable");
  expect(writes).toEqual([]);
});

test("sidebar toggle collapses and expands from the current preference", () => {
  const collapsed = reduceUiPreferences(defaultUiPreferences, {
    type: "toggleSidebar",
  });
  expect(collapsed.sidebarCollapsed).toBe(true);
  expect(
    reduceUiPreferences(collapsed, { type: "toggleSidebar" }).sidebarCollapsed
  ).toBe(false);
});

test("appearance selection changes only the requested visual preference", () => {
  expect(
    reduceUiPreferences(defaultUiPreferences, {
      type: "setAppearance",
      appearance: "warm",
    })
  ).toEqual({ ...defaultUiPreferences, appearance: "warm" });
});

test("fullscreen toggle flips only the immersive preference", () => {
  expect(
    reduceUiPreferences(defaultUiPreferences, {
      type: "setFullscreen",
      fullscreen: false,
    })
  ).toEqual({ ...defaultUiPreferences, fullscreen: false });
});

test("loading accepts only a complete valid preference payload", async () => {
  expect(
    await loadUiPreferences(async () =>
      JSON.stringify({
        sidebarCollapsed: true,
        appearance: "warm",
        fullscreen: false,
      })
    )
  ).toEqual({
    ...defaultUiPreferences,
    sidebarCollapsed: true,
    appearance: "warm",
    fullscreen: false,
  });
  expect(
    await loadUiPreferences(async () =>
      JSON.stringify({ sidebarCollapsed: "yes", appearance: "warm" })
    )
  ).toEqual(defaultUiPreferences);
  expect(await loadUiPreferences(async () => "not-json")).toEqual(
    defaultUiPreferences
  );
});

test("loading defaults fullscreen to immersive for stored payloads without it", async () => {
  expect(
    await loadUiPreferences(async () =>
      JSON.stringify({ sidebarCollapsed: true, appearance: "warm" })
    )
  ).toEqual({
    ...defaultUiPreferences,
    sidebarCollapsed: true,
    appearance: "warm",
    fullscreen: true,
  });
  expect(
    await loadUiPreferences(async () =>
      JSON.stringify({
        sidebarCollapsed: true,
        appearance: "warm",
        fullscreen: "yes",
      })
    )
  ).toEqual({
    ...defaultUiPreferences,
    sidebarCollapsed: true,
    appearance: "warm",
    fullscreen: true,
  });
});

test("stored boosts sanitize: malformed entries drop, missing enabled defaults on", async () => {
  expect(
    await loadUiPreferences(async () =>
      JSON.stringify({
        sidebarCollapsed: false,
        appearance: "warm",
        boosts: [
          { host: "example.com", css: "body{}", enabled: false },
          { host: "kept.org", css: "a{}" },
          { host: 42, css: "body{}" },
          "junk",
        ],
      })
    )
  ).toMatchObject({
    boosts: [
      { host: "example.com", css: "body{}", enabled: false },
      { host: "kept.org", css: "a{}", enabled: true },
    ],
  });
});

test("setBoosts replaces the boost list", () => {
  const boosts = [{ host: "example.com", css: "body{}", enabled: true }];
  expect(
    reduceUiPreferences(defaultUiPreferences, { type: "setBoosts", boosts })
      .boosts
  ).toEqual(boosts);
});

test("frame padding tunes per side and stays clamped to 0..64px", () => {
  expect(defaultUiPreferences.framePx).toEqual({
    left: 0,
    right: 20,
    top: 20,
    bottom: 20,
  });
  expect(
    reduceUiPreferences(defaultUiPreferences, {
      type: "setFramePx",
      side: "top",
      value: 8,
    }).framePx
  ).toEqual({ left: 0, right: 20, top: 8, bottom: 20 });
  expect(
    reduceUiPreferences(defaultUiPreferences, {
      type: "setFramePx",
      side: "right",
      value: 999,
    }).framePx.right
  ).toBe(64);
  expect(
    reduceUiPreferences(defaultUiPreferences, {
      type: "setFramePx",
      side: "left",
      value: -5,
    }).framePx.left
  ).toBe(0);
  expect(
    reduceUiPreferences(defaultUiPreferences, {
      type: "setFramePx",
      side: "bottom",
      value: 17.6,
    }).framePx.bottom
  ).toBe(18);
});

test("stored frame values sanitize: junk falls back to defaults, stale keys ignored", async () => {
  expect(
    await loadUiPreferences(async () =>
      JSON.stringify({
        sidebarCollapsed: false,
        appearance: "warm",
        framePx: "wide",
        permissions: { camera: true, geolocation: "yes" },
      })
    )
  ).toMatchObject({
    framePx: { left: 0, right: 20, top: 20, bottom: 20 },
  });
  expect(
    await loadUiPreferences(async () =>
      JSON.stringify({
        sidebarCollapsed: false,
        appearance: "warm",
        framePx: { left: 4, top: 400 },
      })
    )
  ).toMatchObject({ framePx: { left: 4, right: 20, top: 64, bottom: 20 } });
});

test("optional native storage is safe before a rebuilt binary is installed", async () => {
  expect(await loadUiPreferences(undefined)).toEqual(defaultUiPreferences);
  await expect(
    saveUiPreferences(undefined, {
      ...defaultUiPreferences,
      sidebarCollapsed: true,
      appearance: "warm",
      fullscreen: false,
    })
  ).resolves.toBeUndefined();
});

test("saving serializes the validated preference shape", async () => {
  let stored = "";
  await saveUiPreferences(
    async (json) => {
      stored = json;
    },
    {
      ...defaultUiPreferences,
      sidebarCollapsed: true,
      appearance: "warm",
      fullscreen: false,
    }
  );
  expect(JSON.parse(stored)).toEqual({
    ...defaultUiPreferences,
    sidebarCollapsed: true,
    appearance: "warm",
    fullscreen: false,
  });
});

test("automatic picture-in-picture preference survives save and restore when disabled", async () => {
  expect(defaultUiPreferences.autoPictureInPicture).toBe(true);
  const preferences = reduceUiPreferences(defaultUiPreferences, {
    type: "setAutoPictureInPicture",
    enabled: false,
  });
  expect(preferences).toEqual({
    ...defaultUiPreferences,
    autoPictureInPicture: false,
  });
  let stored = "";
  await saveUiPreferences(async (json) => {
    stored = json;
  }, preferences);
  expect(
    (await loadUiPreferences(async () => stored)).autoPictureInPicture
  ).toBe(false);
  expect(
    reduceUiPreferences(preferences, {
      type: "setAutoPictureInPicture",
      enabled: true,
    }).autoPictureInPicture
  ).toBe(true);
});

test("preferences saved before picture-in-picture existed default automatic entry on", async () => {
  for (const autoPictureInPicture of [undefined, null, "false", 0]) {
    const restored = await loadUiPreferences(async () =>
      JSON.stringify({
        sidebarCollapsed: true,
        appearance: "warm",
        fullscreen: false,
        autoPictureInPicture,
      })
    );
    expect(restored.autoPictureInPicture).toBe(true);
    expect(restored.sidebarCollapsed).toBe(true);
    expect(restored.appearance).toBe("warm");
    expect(restored.fullscreen).toBe(false);
  }
});
