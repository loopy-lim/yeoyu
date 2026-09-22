import { expect, test } from "bun:test";
import { catalog, josaRo, resolveLanguage, translate } from "../src/i18n";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

test("system language resolves Korean only for Korean device locale", () => {
  expect(resolveLanguage("system", "ko-KR")).toBe("ko");
  expect(resolveLanguage("system", "en-US")).toBe("en");
  expect(resolveLanguage("system", "ja-JP")).toBe("en");
  expect(resolveLanguage("ko", "en-US")).toBe("ko");
  expect(resolveLanguage("en", "ko-KR")).toBe("en");
});

test("both catalogs have the same keys and interpolation parameters", () => {
  expect(Object.keys(catalog.ko).sort()).toEqual(
    Object.keys(catalog.en).sort()
  );
  const params = (text: string) =>
    [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();
  // The 로/으로 particle is Korean grammar and exists only in ko wording.
  const koOnlyParams: Partial<Record<keyof typeof catalog.en, string[]>> = {
    "dialog.switchSpace": ["ro"],
    "dialog.moveSpace": ["ro"],
    "address.go": ["ro"],
  };
  for (const key of Object.keys(catalog.en) as (keyof typeof catalog.en)[]) {
    const expected = params(catalog.en[key]).concat(koOnlyParams[key] ?? []);
    expect(params(catalog.ko[key])).toEqual(expected.sort());
  }
  expect(translate("ko", "settings.matchCount", { count: 2 })).toBe(
    "일치하는 분류 2개"
  );
});

test("the 로/으로 particle follows final-consonant rules", () => {
  expect(josaRo("Space 2")).toBe("로");
  expect(josaRo("GitHub")).toBe("로");
  expect(josaRo("작업")).toBe("으로");
  expect(josaRo("서울")).toBe("로");
  expect(josaRo("3")).toBe("으로");
  expect(josaRo("12")).toBe("로");
  expect(josaRo("Default")).toBe("로");
});

test("core settings and browser controls keep UI labels behind translation keys", () => {
  const surfaces = [
    "App",
    "SettingsDialog",
    "AppearanceSettings",
    "ConsentSettings",
    "ExtensionsSettings",
    "KeyboardSettings",
    "BrowserToolsPanel",
    "BrowserDataPanel",
    "PictureInPictureSettings",
    "Dialogs",
    "AddressBox",
    "BrowserContentMenu",
    "ActionMenu",
  ];
  for (const surface of surfaces) {
    const path = new URL(
      `../src/${surface === "App" ? "" : "components/"}${surface}.tsx`,
      import.meta.url
    );
    const source = readFileSync(fileURLToPath(path.href), "utf8");
    const directLabels = [
      ...source.matchAll(
        /\b(?:accessibilityLabel|closeLabel|label|placeholder)="([^"]+)"/g
      ),
    ]
      .map((match) => match[1])
      // URL/domain and HEX samples are editable input examples, not app copy.
      .filter(
        (value) =>
          /[A-Za-z]/.test(value) &&
          value !== "example.com" &&
          !/^https?:\/\//.test(value) &&
          !/^#[0-9a-f]{3,8}$/i.test(value)
      );
    expect(
      directLabels,
      `${surface} has untranslated static UI labels`
    ).toEqual([]);
  }
});
