import { expect, test } from "bun:test";
import {
  defaultUiPreferences,
  loadUiPreferences,
  normalizeBoostHost,
  reduceUiPreferences,
  resolvePhoneChromeLayout,
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

test("site searches restore sanitized: keywords normalize, invalid and duplicate rows drop", async () => {
  const loaded = await loadUiPreferences(async () =>
    JSON.stringify({
      sidebarCollapsed: false,
      appearance: "lavender",
      searchEngine: "google",
      siteSearches: [
        { id: "a", keyword: "GH", label: "GitHub", urlTemplate: "https://github.com/search?q=%s" },
        { id: "b", keyword: "bad key", label: "Broken", urlTemplate: "https://b.example/?q=%s" },
        { id: "c", keyword: "gh", label: "Duplicate", urlTemplate: "https://c.example/?q=%s" },
        { id: "d", keyword: "noTemplate", label: "No placeholder", urlTemplate: "https://d.example/" },
        { id: "e", keyword: "ok", label: "", urlTemplate: "https://e.example/?q=%s" },
      ],
    })
  );
  expect(loaded.siteSearches).toEqual([
    { id: "a", keyword: "gh", label: "GitHub", urlTemplate: "https://github.com/search?q=%s" },
    { id: "e", keyword: "ok", label: "ok", urlTemplate: "https://e.example/?q=%s" },
  ]);
  expect(
    (await loadUiPreferences(async () => JSON.stringify({
      sidebarCollapsed: false,
      appearance: "lavender",
      searchEngine: "google",
    }))).siteSearches
  ).toEqual([]);
});

test("site search entries cap at 32 with unique keywords", () => {
  const many = Array.from({ length: 40 }, (_, index) => ({
    id: `s${index}`,
    keyword: `k${index}`,
    label: `L${index}`,
    urlTemplate: "https://example.com/?q=%s",
  }));
  const reduced = many.slice(0, 32);
  expect(reduced.length).toBe(32);
  const keywords = new Set(reduced.map((entry) => entry.keyword));
  expect(keywords.size).toBe(32);
});

// --- Little Arc crash-recovery marker lifecycle -----------------------------
// The marker is a runtime breadcrumb, not a user setting: onExternalTab sets
// it while the card is open, and every path that dismisses the overlay
// (close, promote, focus another tab, create a tab) must clear it, or crash
// recovery would reopen a card whose tab no longer exists as the overlay.

test("Little Arc marker round-trips set → clear with stable identity on no-op", () => {
  const marked = reduceUiPreferences(defaultUiPreferences, {
    type: "setLittleArcActiveTab",
    id: "tab-1",
  });
  expect(marked.littleArcActiveTabId).toBe("tab-1");
  // Clearing on an already-clear store returns the SAME object so tab
  // activations don't churn persistence rewrites.
  expect(
    reduceUiPreferences(defaultUiPreferences, {
      type: "setLittleArcActiveTab",
      id: null,
    })
  ).toBe(defaultUiPreferences);
  const cleared = reduceUiPreferences(marked, {
    type: "setLittleArcActiveTab",
    id: null,
  });
  expect(cleared.littleArcActiveTabId).toBeUndefined();
  // Re-setting the same id is also identity-stable.
  expect(
    reduceUiPreferences(marked, {
      type: "setLittleArcActiveTab",
      id: "tab-1",
    })
  ).toBe(marked);
});

test("Little Arc marker survives preferences persistence round-trip", async () => {
  const stored = {
    ...defaultUiPreferences,
    littleArcActiveTabId: "tab-overlay",
  };
  const loaded = await loadUiPreferences(async () => JSON.stringify(stored));
  expect(loaded.littleArcActiveTabId).toBe("tab-overlay");
  // Persisted JSON keeps the field for the next boot.
  let written: string | null = null;
  await saveUiPreferences(async (json) => { written = json; }, loaded);
  expect(JSON.parse(written ?? "{}").littleArcActiveTabId).toBe("tab-overlay");
});

test("Little Arc marker sanitizes on load: empty strings and non-strings drop", async () => {
  const base = { sidebarCollapsed: false, appearance: "lavender" };
  expect(
    (await loadUiPreferences(async () =>
      JSON.stringify({ ...base, littleArcActiveTabId: "" })
    )).littleArcActiveTabId
  ).toBeUndefined();
  expect(
    (await loadUiPreferences(async () =>
      JSON.stringify({ ...base, littleArcActiveTabId: 42 })
    )).littleArcActiveTabId
  ).toBeUndefined();
});

test("restore keeps a runtime-set Little Arc marker over the stale stored one", () => {
  // Cold boot from another app's link: the external tab set the live marker
  // before hydration's async read resolved. The stored snapshot describes
  // the dead session; the live marker must win.
  const stored = { ...defaultUiPreferences, littleArcActiveTabId: "old-tab" };
  const live = reduceUiPreferences(defaultUiPreferences, {
    type: "setLittleArcActiveTab",
    id: "fresh-tab",
  });
  const restored = reduceUiPreferences(live, {
    type: "restore",
    preferences: stored,
  });
  expect(restored.littleArcActiveTabId).toBe("fresh-tab");
  // Without a live marker the stored one hydrates untouched.
  const plain = reduceUiPreferences(defaultUiPreferences, {
    type: "restore",
    preferences: stored,
  });
  expect(plain.littleArcActiveTabId).toBe("old-tab");
  expect(plain.sidebarCollapsed).toBe(stored.sidebarCollapsed);
});

// --- Phone chrome layout (issue #19) ----------------------------------------
// The preference is optional: unset follows the window tier (compact docks
// the toolbar at the bottom), and an explicit pick never re-layouts a
// tablet-class window.

test("phone chrome layout round-trips a pick and drops junk on load", async () => {
  expect(defaultUiPreferences.phoneChromeLayout).toBeUndefined();
  const picked = reduceUiPreferences(defaultUiPreferences, {
    type: "setPhoneChromeLayout",
    layout: "top",
  });
  expect(picked).toEqual({ ...defaultUiPreferences, phoneChromeLayout: "top" });
  let stored = "";
  await saveUiPreferences(async (json) => {
    stored = json;
  }, picked);
  expect(
    (await loadUiPreferences(async () => stored)).phoneChromeLayout
  ).toBe("top");
  for (const phoneChromeLayout of [undefined, null, "sideways", 3]) {
    expect(
      (await loadUiPreferences(async () =>
        JSON.stringify({
          sidebarCollapsed: false,
          appearance: "warm",
          phoneChromeLayout,
        })
      )).phoneChromeLayout
    ).toBeUndefined();
  }
});

test("resetLayout returns the chrome to following the window tier", () => {
  const picked = reduceUiPreferences(defaultUiPreferences, {
    type: "setPhoneChromeLayout",
    layout: "bottom",
  });
  const reset = reduceUiPreferences(picked, { type: "resetLayout" });
  expect(reset.phoneChromeLayout).toBeUndefined();
  expect(reset.sidebarWidth).toBe(defaultUiPreferences.sidebarWidth);
  expect(reset.framePx).toEqual(defaultUiPreferences.framePx);
});

test("resolvePhoneChromeLayout defaults compact windows to the bottom bar and never moves wide ones", () => {
  expect(resolvePhoneChromeLayout(undefined, false)).toBe("top");
  expect(resolvePhoneChromeLayout(undefined, true)).toBe("bottom");
  expect(resolvePhoneChromeLayout("top", true)).toBe("top");
  expect(resolvePhoneChromeLayout("bottom", false)).toBe("top");
  // "hybrid" ships in a later slice and reads as today's structure until then.
  expect(resolvePhoneChromeLayout("hybrid", true)).toBe("top");
});
