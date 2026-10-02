import { expect, test } from "bun:test";
import React from "react";
import { act, create } from "react-test-renderer";
import {
  resolveTestClassNames,
  resolveTestVariable,
} from "./uniwindTestHarness";
import {
  darkThemes,
  font,
  radius,
  retintTheme,
  size,
  space,
  themes,
} from "../src/theme";

const { useResolveClassNames } = await import("uniwind");
const { ThemeScope, themeToVariables } = await import("../src/ui/ThemeScope");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test("scoped theme variables include every role with stable CSS names", () => {
  const variables = themeToVariables(themes.warm);
  expect(variables["--color-chrome"]).toBe("#dfcfd1");
  expect(variables["--color-ink-muted"]).toBe("#63504d");
  expect(variables["--color-hairline-on-chrome"]).toBe("#d4bfbc");
  expect(Object.keys(variables).sort()).toEqual(
    [
      "--color-chrome",
      "--color-sidebar",
      "--color-canvas",
      "--color-surface",
      "--color-surface-elevated",
      "--color-white",
      "--color-sunken",
      "--color-sunken-strong",
      "--color-field-on-chrome",
      "--color-pill",
      "--color-fav-chip",
      "--color-pinned-row",
      "--color-rail-icon-tile",
      "--color-manage-tile",
      "--color-ghost",
      "--color-accent",
      "--color-accent-strong",
      "--color-pane-focus",
      "--color-ring-shadow",
      "--color-ink",
      "--color-ink-muted",
      "--color-ink-faint",
      "--color-icon",
      "--color-card-border",
      "--color-hairline",
      "--color-hairline-on-chrome",
      "--color-tile-border",
      "--color-switch-off",
      "--color-scrim",
      "--color-notice-bg",
      "--color-notice-ink",
      "--color-error-bg",
      "--color-error-ink",
      "--color-drop-border",
      "--color-drop-fill",
    ].sort()
  );
});

function ResolvedSwatch({ id }: { id: string }) {
  const style = useResolveClassNames(
    "bg-sidebar text-body text-ink border-hairline-on-chrome"
  );
  return React.createElement("NativeSwatch", { id, style });
}

test("sibling roots and nested Spaces resolve their own theme without changing global defaults", async () => {
  const tinted = retintTheme(themes.lavender, "#68b3ae");
  let tree!: ReturnType<typeof create>;
  await act(() => {
    tree = create(
      <>
        <ThemeScope theme={themes.lavender}>
          <ResolvedSwatch id="outer" />
          <ThemeScope theme={tinted}>
            <ResolvedSwatch id="space" />
          </ThemeScope>
          <ResolvedSwatch id="after-space" />
        </ThemeScope>
        <ThemeScope theme={darkThemes.warm}>
          <ResolvedSwatch id="window" />
        </ThemeScope>
      </>
    );
  });
  const styleFor = (id: string) =>
    tree.root.findByProps({ id }).find((node) => node.props.style !== undefined)
      .props.style;
  expect(styleFor("outer")).toMatchObject({
    backgroundColor: "#ddd1e1",
    color: "#43384a",
    fontSize: 11,
    borderColor: "#cbbdce",
  });
  expect(styleFor("after-space")).toEqual(styleFor("outer"));
  expect(styleFor("space")).toMatchObject({
    backgroundColor: tinted.sidebar,
    color: tinted.ink,
  });
  expect(styleFor("window")).toMatchObject({
    backgroundColor: "#2e2324",
    color: "#f7eeeb",
  });
  expect(resolveTestClassNames("bg-sidebar text-ink")).toMatchObject({
    backgroundColor: "#ddd1e1",
    color: "#43384a",
  });
  await act(() => tree.unmount());
});

test("compiled semantic utilities retain existing control geometry and text size", () => {
  expect(
    resolveTestClassNames(
      "flex-row items-center gap-md px-xxl h-action-row rounded-control text-input-plus text-ink-muted opacity-disabled"
    )
  ).toMatchObject({
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    height: 48,
    borderRadius: 9,
    fontSize: 14,
    color: "#5b4d60",
    opacity: 0.38,
  });
  expect(
    resolveTestClassNames(
      "size-icon-button rounded-chip text-icon-size text-icon opacity-pressed"
    )
  ).toMatchObject({
    width: 32,
    height: 32,
    borderRadius: 5,
    fontSize: 16,
    color: "#574d5c",
    opacity: 0.58,
  });
});

test("compiled CSS numeric tokens match the existing native geometry scale", () => {
  for (const [prefix, values] of [
    ["spacing", { ...space, ...size }],
    ["radius", radius],
    ["text", font],
  ] as const) {
    for (const [key, value] of Object.entries(values)) {
      const role =
        prefix === "text" && key === "icon"
          ? "icon-size"
          : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      expect(resolveTestVariable(`--${prefix}-${role}`)).toBe(value);
    }
  }
});
