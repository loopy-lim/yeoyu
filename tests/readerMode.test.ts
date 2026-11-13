import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canToggleReaderMode,
  deriveReaderStyle,
  fontSizeForTextScale,
  isEligibleReaderUrl,
} from "../src/readerMode";
import { darkThemes, themes } from "../src/theme";
import { CommandRegistry } from "../src/commandRegistry";

test("fontSizeForTextScale maps and clamps text scale within 12..36px", () => {
  expect(fontSizeForTextScale(undefined)).toBe(18);
  expect(fontSizeForTextScale(Number.NaN)).toBe(18);
  expect(fontSizeForTextScale(0.5)).toBe(12);
  expect(fontSizeForTextScale(1)).toBe(18);
  expect(fontSizeForTextScale(1.5)).toBe(27);
  expect(fontSizeForTextScale(2)).toBe(36);
  expect(fontSizeForTextScale(0.1)).toBe(12);
  expect(fontSizeForTextScale(5)).toBe(36);
});

test("deriveReaderStyle maps active Theme tokens, textScale, and readTimeFormat", () => {
  const light = deriveReaderStyle(themes.lavender, 1.2, "{n} min read");
  expect(light).toEqual({
    bg: themes.lavender.surface,
    fg: themes.lavender.ink,
    muted: themes.lavender.inkMuted,
    accent: themes.lavender.accentStrong,
    border: themes.lavender.hairline,
    sunken: themes.lavender.sunken,
    fontSizePx: 22,
    readTimeFormat: "{n} min read",
  });

  const dark = deriveReaderStyle(darkThemes.warm, 0.8, "읽는 시간 {n}분");
  expect(dark.bg).toBe(darkThemes.warm.surface);
  expect(dark.fg).toBe(darkThemes.warm.ink);
  expect(dark.accent).toBe(darkThemes.warm.accentStrong);
  expect(dark.fontSizePx).toBe(14);
  expect(dark.readTimeFormat).toBe("읽는 시간 {n}분");
});

test("canToggleReaderMode requires eligible active tab that is readerable or active", () => {
  const articleTab = { id: "t1", url: "https://example.com/post/1" };
  const blankTab = { id: "t2", url: "about:blank" };
  const suspendedTab = {
    id: "t3",
    url: "https://example.com/post/2",
    suspended: true,
  };

  expect(isEligibleReaderUrl(articleTab.url)).toBe(true);
  expect(isEligibleReaderUrl(blankTab.url)).toBe(false);

  expect(canToggleReaderMode(null, undefined)).toBe(false);
  expect(canToggleReaderMode(articleTab, undefined)).toBe(false);
  expect(
    canToggleReaderMode(articleTab, { readerable: false, active: false })
  ).toBe(false);
  expect(
    canToggleReaderMode(articleTab, { readerable: true, active: false })
  ).toBe(true);
  expect(
    canToggleReaderMode(articleTab, { readerable: false, active: true })
  ).toBe(true);
  expect(
    canToggleReaderMode(blankTab, { readerable: true, active: false })
  ).toBe(false);
  expect(
    canToggleReaderMode(suspendedTab, { readerable: true, active: false })
  ).toBe(false);
});

test("built-in reader extension assets and command registration stay intact", () => {
  const root = resolve(import.meta.dir, "..");
  const manifest = JSON.parse(
    readFileSync(
      resolve(root, "android/app/src/main/assets/yeoyu-reader/manifest.json"),
      "utf8"
    )
  );
  expect(manifest.browser_specific_settings.gecko.id).toBe("reader-mode@yeoyu");
  expect(manifest.permissions).toContain("nativeMessagingFromContent");

  for (const script of manifest.content_scripts[0].js as string[]) {
    const src = readFileSync(
      resolve(root, "android/app/src/main/assets/yeoyu-reader", script),
      "utf8"
    );
    expect(src.length).toBeGreaterThan(100);
    expect(src).not.toMatch(/\b(ChromeUtils|XPCOMUtils|Services\.)\b/);
  }

  const registry = new CommandRegistry();
  registry.register("browser.readerMode", () => {});
  expect(registry.entries("en")[0]?.id).toBe("browser.readerMode");
  expect(registry.entries("ko")[0]?.title).toBe("리더 모드 켜기 또는 끄기");
});
