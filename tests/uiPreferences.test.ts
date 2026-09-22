import { expect, test } from "bun:test";
import {
  defaultUiPreferences,
  loadUiPreferences,
  normalizeBoostHost,
  reduceUiPreferences,
  saveUiPreferences,
  validateBoostDrafts,
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

test("language defaults to system, restores legacy data, and rejects invalid saved values", async () => {
  expect(defaultUiPreferences.language).toBe("system");
  for (const language of [undefined, null, "fr", 42]) {
    const loaded = await loadUiPreferences(async () => JSON.stringify({
      ...defaultUiPreferences, appearance: "warm", language,
    }));
    expect(loaded.language).toBe("system");
    expect(loaded.appearance).toBe("warm");
  }
  const updated = reduceUiPreferences(defaultUiPreferences, { type: "setLanguage", language: "ko" });
  expect(updated.language).toBe("ko");
  let saved = "";
  await saveUiPreferences(async (json) => { saved = json; }, updated);
  expect((await loadUiPreferences(async () => saved)).language).toBe("ko");
  expect(reduceUiPreferences(updated, { type: "resetLayout" }).language).toBe("ko");
});

test("appearance selection changes only the requested visual preference", () => {
  expect(
    reduceUiPreferences(defaultUiPreferences, {
      type: "setAppearance",
      appearance: "warm",
    })
  ).toEqual({ ...defaultUiPreferences, appearance: "warm" });
});

test("color mode defaults and legacy migration follow system without discarding a custom seed", async () => {
  expect(defaultUiPreferences.colorMode).toBe("system");
  for (const colorMode of [undefined, null, "invalid", false]) {
    const loaded = await loadUiPreferences(async () => JSON.stringify({
      ...defaultUiPreferences, appearance: "warm", colorSource: "custom", customColor: "#ABC", colorMode,
    }));
    expect(loaded.colorMode).toBe("system");
    expect(loaded.customColor).toBe("#aabbcc");
    expect(loaded.colorSource).toBe("custom");
    expect(loaded.appearance).toBe("warm");
  }
});

test("mode changes persist independently of tint and layout, and reset colors returns to system", async () => {
  const initial = { ...defaultUiPreferences, colorSource: "custom", customColor: "#68b3ae", sidebarWidth: 300 } as const;
  for (const colorMode of ["system", "light", "dark"] as const) {
    const updated = reduceUiPreferences(initial, { type: "setColorMode", colorMode });
    expect(updated).toEqual({ ...initial, colorMode });
    let saved = "";
    await saveUiPreferences(async (json) => { saved = json; }, updated);
    expect(await loadUiPreferences(async () => saved)).toEqual(updated);
    expect(reduceUiPreferences(updated, { type: "resetLayout" }).colorMode).toBe(colorMode);
    const reset = reduceUiPreferences(updated, { type: "resetColors" });
    expect(reset.colorMode).toBe("system");
    expect(reset.sidebarWidth).toBe(300);
    expect(reset.customColor).toBeUndefined();
  }
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

test("boost host input uses the same host-only scope for URLs, ports, and www", () => {
  expect(normalizeBoostHost(" HTTPS://WWW.Example.com:8443/path?q=x#part ")).toBe("example.com");
  expect(normalizeBoostHost("example.com:8080/path")).toBe("example.com");
  expect(normalizeBoostHost("localhost:3000")).toBe("localhost");
  for (const host of ["", "https://", "https://user:pass@example.com", "file:///etc/passwd", "*.example.com", "bad host", "example.com\\other", "https://bad_host.example", "example.com:99999"])
    expect(normalizeBoostHost(host)).toBe("");
});

test("boost validation reports empty and duplicate drafts without silently deleting them", () => {
  const draft = [
    { host: "https://www.example.com:8443/path", css: "body { color: red; }", enabled: true },
    { host: "example.com", css: "a { color: blue; }", enabled: false },
    { host: "", css: " ", enabled: true },
  ];
  const result = validateBoostDrafts(draft);
  expect(result.valid).toBe(false);
  expect(result.errors[0]?.host).toContain("Duplicate");
  expect(result.errors[1]?.host).toContain("Duplicate");
  expect(result.errors[2]?.host).toContain("Enter");
  expect(result.errors[2]?.css).toContain("Enter");
  expect(draft).toHaveLength(3);
});

test("valid boost drafts normalize hosts and retain disabled entries and CSS", () => {
  const result = validateBoostDrafts([{ host: "https://WWW.example.com:8443/page", css: "  body { color: red; }\n", enabled: false }]);
  expect(result.valid).toBe(true);
  expect(result.boosts).toEqual([{ host: "www.example.com", css: "  body { color: red; }\n", enabled: false }]);
  expect(validateBoostDrafts([]).valid).toBe(true);
});

test("saving a host with repeated www prefixes does not broaden its matching scope", () => {
  const draft = [{ host: "https://www.www.example.com/path", css: "body{}", enabled: true }];
  const saved = validateBoostDrafts(draft).boosts;
  expect(saved[0].host).toBe("www.www.example.com");
  expect(normalizeBoostHost(saved[0].host)).toBe("www.example.com");
  expect(normalizeBoostHost(validateBoostDrafts(saved).boosts[0].host)).toBe("www.example.com");
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
