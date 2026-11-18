import { expect, test } from "bun:test";
import React from "react";
import { act, create } from "react-test-renderer";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { resolveTestClassNames } from "./uniwindTestHarness";
import { phoneSize, size, themes, TOUCH_TARGET } from "../src/theme";
import { failedTouchTargetGates, hitSlopForTarget } from "../src/touchTargets";
import { appClasses } from "../src/chrome/appStyles";

const { useResolveClassNames } = await import("uniwind");
const { ThemeScope, sizeToVariables } = await import("../src/ui/ThemeScope");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// The interactive tokens the phone tier scales, and the surfaces that must
// not move (layout/display geometry stays tablet-dense in both tiers).
const SCALED_TOKENS = [
  "tabRow",
  "workspaceRow",
  "railItem",
  "favorite",
  "iconButton",
  "toolbar",
  "address",
  "addressCompact",
] as const;
const UNSCALED_TOKENS = [
  "frame",
  "sidebar",
  "rail",
  "row",
  "tile",
  "avatar",
  "input",
  "actionRow",
  "bookmarkRow",
] as const;

test("hitSlop compensation lifts a visual to the 48dp target and never goes negative", () => {
  expect(hitSlopForTarget(34)).toBe(7);
  expect(hitSlopForTarget(44)).toBe(2);
  expect(hitSlopForTarget(26)).toBe(11);
  expect(hitSlopForTarget(24)).toBe(12);
  expect(hitSlopForTarget(48)).toBe(0);
  expect(hitSlopForTarget(60)).toBe(0);
  for (const visual of [24, 26, 32, 34, 36, 40, 44, 48])
    expect(visual + 2 * hitSlopForTarget(visual)).toBeGreaterThanOrEqual(
      TOUCH_TARGET.target,
    );
  expect(hitSlopForTarget(30, 44)).toBe(7);
});

test("phone tier scales only interactive tokens and never below the floor", () => {
  expect(Object.keys(phoneSize).sort()).toEqual(Object.keys(size).sort());
  for (const token of SCALED_TOKENS)
    expect(phoneSize[token]).toBeGreaterThanOrEqual(
      Math.max(size[token], TOUCH_TARGET.floor),
    );
  expect(phoneSize.toolbar).toBeGreaterThanOrEqual(TOUCH_TARGET.target);
  for (const token of UNSCALED_TOKENS)
    expect(phoneSize[token]).toBe(size[token]);
});

test("every phone-tier primary control passes the touch-target gates", () => {
  expect(failedTouchTargetGates()).toEqual([]);
});

test("token utilities keep the default tablet density (regression guard)", () => {
  expect(resolveTestClassNames("h-tab-row")).toEqual({ height: size.tabRow });
  expect(resolveTestClassNames("size-icon-button")).toEqual({
    width: size.iconButton,
    height: size.iconButton,
  });
  expect(resolveTestClassNames("h-toolbar")).toEqual({ height: size.toolbar });
  expect(resolveTestClassNames("h-rail-item")).toEqual({
    height: size.railItem,
  });
  expect(resolveTestClassNames("h-favorite")).toEqual({
    height: size.favorite,
  });
  expect(resolveTestClassNames("h-address-compact")).toEqual({
    height: size.addressCompact,
  });
});

test("scoped phone size variables retarget the same utilities at runtime", () => {
  const phoneVariables = sizeToVariables(phoneSize);
  expect(resolveTestClassNames("h-tab-row", undefined, phoneVariables)).toEqual(
    { height: phoneSize.tabRow },
  );
  expect(
    resolveTestClassNames("size-icon-button", undefined, phoneVariables),
  ).toEqual({ width: phoneSize.iconButton, height: phoneSize.iconButton });
  expect(resolveTestClassNames("h-toolbar", undefined, phoneVariables)).toEqual(
    { height: phoneSize.toolbar },
  );
  expect(
    resolveTestClassNames("h-rail-item", undefined, phoneVariables),
  ).toEqual({ height: phoneSize.railItem });
  // Scoped overrides must not leak outside their ThemeScope subtree.
  expect(resolveTestClassNames("h-tab-row")).toEqual({ height: size.tabRow });
});

test("ThemeScope applies phone sizes to its subtree only", async () => {
  const Row = ({ id }: { id: string }) => {
    const style = useResolveClassNames("h-tab-row h-toolbar");
    return React.createElement("NativeRow", { id, style });
  };
  let tree!: ReturnType<typeof create>;
  await act(() => {
    tree = create(
      <>
        <ThemeScope theme={themes.lavender}>
          <Row id="tablet" />
        </ThemeScope>
        <ThemeScope theme={themes.lavender} sizes={phoneSize}>
          <Row id="phone" />
        </ThemeScope>
      </>,
    );
  });
  const styleFor = (id: string) =>
    tree.root.findByProps({ id }).find((node) => node.props.style !== undefined)
      .props.style;
  expect(styleFor("tablet")).toEqual({
    height: size.toolbar,
  });
  expect(styleFor("phone")).toEqual({
    height: phoneSize.toolbar,
  });
  await act(() => tree.unmount());
});

// Phone-tier controls whose geometry is a literal class, not a token: the
// source of truth is the class string / cva definition itself.
test("phone-tier literal controls ride tokens or hold the floor", () => {
  expect(appClasses.railItem).toContain("h-rail-item");
  expect(appClasses.railItem).toContain("w-[36px]");
  expect(appClasses.phoneHybridTab).toContain("h-tab-row");
  expect(appClasses.phoneHybridTab).toContain("min-w-[44px]");
  expect(appClasses.tabClose).toContain("w-[26px]");

  const dialogsSource = readFileSync(
    new URL("../src/components/Dialogs.tsx", import.meta.url),
    "utf8",
  );
  const spaceRow = dialogsSource.match(/min-h-\[(\d+)px\][^"]*px-lg/g) ?? [];
  for (const row of spaceRow)
    expect(Number(row.match(/min-h-\[(\d+)px\]/)![1])).toBeGreaterThanOrEqual(
      TOUCH_TARGET.floor,
    );

  const collectionsSource = readFileSync(
    new URL("../src/components/SidebarCollections.tsx", import.meta.url),
    "utf8",
  );
  expect(collectionsSource).toContain('"w-[36px] h-rail-item justify-center"');
});
