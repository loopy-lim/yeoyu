import { expect, test } from "bun:test";
import React from "react";
import { act, create } from "react-test-renderer";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { resolveTestClassNames } from "./uniwindTestHarness";
import { phoneSize, size, space, themes, TOUCH_TARGET } from "../src/theme";
import {
  COMPACT_TOOLBAR_VIEWPORT_WIDTH,
  compactToolbarAddressWidth,
  denseVerticalHitSlop,
  failedTouchTargetGates,
  hitSlopForTarget,
  iconButtonHitSlop,
  phoneTouchTargetGates,
  spaceChipHitSlop,
  toolbarLayerHeight,
} from "../src/touchTargets";
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
  "spaceHeader",
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
  expect(denseVerticalHitSlop()).toEqual({
    top: 1,
    bottom: 1,
    left: 6,
    right: 6,
  });
  expect(spaceChipHitSlop()).toEqual({
    top: 12,
    bottom: 12,
    left: 1,
    right: 1,
  });
  expect(toolbarLayerHeight(true)).toBe(phoneSize.toolbar);
  expect(toolbarLayerHeight(false)).toBe(size.toolbar);
  expect(iconButtonHitSlop(true)).toBe(2);
  expect(iconButtonHitSlop(false)).toBe(7);
  expect(failedTouchTargetGates()).toEqual([]);

  const addressGate = phoneTouchTargetGates().find(
    (gate) => gate.name === "compact address trigger",
  );
  expect(addressGate?.hitSlop).toBe(hitSlopForTarget(phoneSize.addressCompact));

  const read = (relative: string) =>
    readFileSync(new URL(relative, import.meta.url), "utf8");
  const app = read("../src/App.tsx");
  const bar = read("../src/components/PhoneBottomBar.tsx");
  const collections = read("../src/components/SidebarCollections.tsx");
  const extensionBar = read("../src/components/ExtensionActionsBar.tsx");
  const addressTrigger = read("../src/components/AddressTrigger.tsx");
  expect(app).toContain("toolbarLayerHeight(compactWindow)");
  expect(app).toContain("outputRange: [14 + toolbarLayerHeight(compactWindow), 14]");
  expect(app).toContain("outputRange: [0, -toolbarLayerHeight(compactWindow)]");
  expect(app).not.toContain("outputRange: [58, 14]");
  expect(app).not.toContain("outputRange: [0, -44]");
  expect(app).not.toContain("outputRange: [size.toolbar, 0]");
  expect(app).not.toContain("hitSlopForTarget(size.iconButton)");
  expect(app).not.toContain("hitSlopForTarget(36)");
  expect(app).not.toContain("hitSlopForTarget(24)");
  expect(app).toContain("c.canvasToolbarCompact");
  expect(app).toContain("c.compactNavigationCompact");
  expect(bar).not.toContain("hitSlopForTarget(size.iconButton)");
  expect(collections).not.toContain("hitSlopForTarget(36)");
  expect(extensionBar).not.toContain("hitSlop={8}");
  expect(addressTrigger).not.toContain("hitSlop={8}");
  expect(appClasses.spaceHeader).toContain("min-h-space-header");
  expect(appClasses.spaceHeader).not.toContain("min-h-[32px]");
});

test("compact canvasToolbar keeps AddressTrigger at or above touch floor on 360dp phones", () => {
  const width360 = compactToolbarAddressWidth(COMPACT_TOOLBAR_VIEWPORT_WIDTH);
  expect(width360).toBeGreaterThanOrEqual(TOUCH_TARGET.floor);
  expect(
    width360 + 2 * hitSlopForTarget(phoneSize.addressCompact),
  ).toBeGreaterThanOrEqual(TOUCH_TARGET.target);
  expect(compactToolbarAddressWidth(390)).toBeGreaterThanOrEqual(80);

  expect(resolveTestClassNames(appClasses.canvasToolbarCompact)).toEqual({
    paddingHorizontal: space.md,
    gap: space.sm,
  });
  expect(resolveTestClassNames(appClasses.compactNavigationCompact)).toEqual({
    gap: space.sm,
  });
  expect(resolveTestClassNames(appClasses.canvasToolbar)).toMatchObject({
    paddingHorizontal: space.xxl,
  });
  expect(resolveTestClassNames(appClasses.compactNavigation)).toMatchObject({
    gap: space.md,
  });
});

test("ExtensionActionsBar and AddressTrigger derive hitSlop and spacing from ThemeScope", async () => {
  const probe = `
    import { mock } from 'bun:test';
    import React from 'react';
    import { act, create } from 'react-test-renderer';
    mock.module('react-native', () => ({
      View: 'View', Text: 'Text', Pressable: 'Pressable', Image: 'Image',
      Animated: { View: 'View' },
      StyleSheet: { create: (v) => v, hairlineWidth: 1 },
    }));
    mock.module('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }));
    await import('./tests/uniwindTestHarness');
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const { ThemeScope } = await import('./src/ui/ThemeScope');
    const { phoneSize, themes } = await import('./src/theme');
    const { ExtensionActionsBar } = await import('./src/components/ExtensionActionsBar');
    const { AddressTrigger } = await import('./src/components/AddressTrigger');
    const actions = [{
      id: 'ext@example', name: 'Sample', badge: '',
      badgeBackgroundColor: '', badgeTextColor: '', icon: '', actionEnabled: true,
    }];
    let tree;
    await act(async () => {
      tree = create(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(
            ThemeScope,
            { theme: themes.lavender },
            React.createElement(ViewWrap, { id: 'tablet-ext' },
              React.createElement(ExtensionActionsBar, { actions, onOpen: () => {} })
            ),
            React.createElement(ViewWrap, { id: 'tablet-addr' },
              React.createElement(AddressTrigger, { compact: true, url: 'https://example.com', onPress: () => {} })
            ),
          ),
          React.createElement(
            ThemeScope,
            { theme: themes.lavender, sizes: phoneSize },
            React.createElement(ViewWrap, { id: 'phone-ext' },
              React.createElement(ExtensionActionsBar, { actions, onOpen: () => {} })
            ),
            React.createElement(ViewWrap, { id: 'phone-addr' },
              React.createElement(AddressTrigger, { compact: true, url: 'https://example.com', onPress: () => {} })
            ),
          ),
        ),
      );
    });
    function ViewWrap(props) { return React.createElement('Wrap', props); }
    const pressableOf = (id) => tree.root.findByProps({ id }).findByType('Pressable');
    const toolbarOf = (id) => tree.root.findByProps({ id }).findByProps({ accessibilityRole: 'toolbar' });
    console.log(JSON.stringify({
      tabletExtSlop: pressableOf('tablet-ext').props.hitSlop,
      phoneExtSlop: pressableOf('phone-ext').props.hitSlop,
      tabletExtClass: toolbarOf('tablet-ext').props.className,
      phoneExtClass: toolbarOf('phone-ext').props.className,
      tabletAddrSlop: pressableOf('tablet-addr').props.hitSlop,
      phoneAddrSlop: pressableOf('phone-addr').props.hitSlop,
      tabletAddrClass: pressableOf('tablet-addr').props.className,
      phoneAddrClass: pressableOf('phone-addr').props.className,
    }));
  `;
  const child = Bun.spawn([process.execPath, "-e", probe], {
    cwd: new URL("..", import.meta.url).pathname,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(err.replace(/react-test-renderer is deprecated[^\n]*\n?/g, "")).toBe("");
  expect(code).toBe(0);
  const result = JSON.parse(out.trim());
  expect(result.tabletExtSlop).toBe(hitSlopForTarget(size.iconButton));
  expect(result.phoneExtSlop).toBe(hitSlopForTarget(phoneSize.iconButton));
  expect(result.tabletExtClass).toContain("gap-md");
  expect(result.phoneExtClass).toContain("gap-sm");
  expect(result.tabletAddrSlop).toBe(hitSlopForTarget(size.addressCompact));
  expect(result.phoneAddrSlop).toBe(hitSlopForTarget(phoneSize.addressCompact));
  expect(result.tabletAddrClass).toContain("ml-sm");
  expect(result.phoneAddrClass).not.toContain("ml-sm");
  expect(result.phoneAddrClass).toContain("px-md");
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
  expect(resolveTestClassNames("min-h-space-header")).toEqual({
    minHeight: size.spaceHeader,
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
  expect(
    resolveTestClassNames("min-h-space-header", undefined, phoneVariables),
  ).toEqual({ minHeight: phoneSize.spaceHeader });
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
