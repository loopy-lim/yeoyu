import { describe, expect, test } from "bun:test";
import {
  compileEntryCss,
  resolveTestClassNames,
} from "./uniwindTestHarness";

// Issue #30 guard. The release bundle ships the precompiled uniwind style
// store; when an upgrade silently empties a class entry (the upstream
// uniwind#709 shape), release ScrollView layouts lose their sizing and swipe
// gestures die while taps keep working. Debug Metro builds can mask it, so
// these tests pin the compiled-store behavior directly against the installed
// uniwind — the same compileCSS→store path a release bundle embeds.

const SETTINGS_BODY = "flex-1 min-h-0";
const SETTINGS_NAV = "shrink bg-sidebar";
const SETTINGS_NAV_CONTENT = "p-md gap-[2px]";

describe("compiled store keeps scroll-structure utilities as real styles", () => {
  test("settings dialog scroll sizing resolves to concrete layout values", () => {
    // bodyClasses — the flex/min-h pair is what lets the scroll container
    // overflow; losing it collapses content and kills swipe scrolling.
    expect(resolveTestClassNames(SETTINGS_BODY)).toEqual({
      flex: 1,
      minHeight: 0,
    });
    expect(resolveTestClassNames(SETTINGS_NAV)).toEqual({
      flexShrink: 1,
      backgroundColor: "#ebebf0",
    });
    expect(resolveTestClassNames(SETTINGS_NAV_CONTENT)).toEqual({
      padding: 8,
      rowGap: 2,
      columnGap: 2,
    });
  });

  test("settings group card clipping and palette resolve through the store", () => {
    expect(resolveTestClassNames("overflow-hidden")).toEqual({
      overflow: "hidden",
    });
    expect(
      resolveTestClassNames("rounded-tile bg-sunken border border-hairline")
    ).toEqual({
      borderRadius: 12,
      backgroundColor: "#f1f1f5",
      borderStyle: "solid",
      borderWidth: 1,
      borderColor: "#e2e2ea",
    });
  });
});

test("uniwind#709: a class after :root inside a layer keeps its declarations", async () => {
  // 1.12.1 leaked `:root` parser state into sibling classes, turning
  // `.after-root`'s width into a variable and shipping an empty class style.
  // Reproduced through the installed compiler with a dedicated fixture so a
  // future upgrade that reintroduces the leak fails here, not in a release
  // build on a device.
  const compiled = await compileEntryCss(
    "./tests/fixtures/uniwind-root-leak/fixture.css"
  );
  const store = (
    new Function("rt", `return ${compiled}`) as (rt: unknown) => {
      stylesheet: Record<string, Array<{ entries?: unknown }>>;
      vars: Record<string, unknown>;
    }
  )({});

  const afterRoot = store.stylesheet["after-root"];
  expect(afterRoot).toBeDefined();
  // The leak's two signatures: the class entry loses its width declaration
  // and the variables store gains one. 1.14 serializes declaration values as
  // runtime expressions (null in the raw template), so assert the entry's
  // structural presence rather than its literal value.
  expect(JSON.stringify(afterRoot)).toContain('"width"');
  expect(store.vars).not.toHaveProperty("width");
});
