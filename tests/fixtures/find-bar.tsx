import { mock } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { parse } from "@babel/parser";
import { themes } from "../../src/theme";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const absoluteFill = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};
const flatten = (value: unknown): Record<string, any> =>
  Array.isArray(value)
    ? Object.assign({}, ...value.flat(Infinity).filter(Boolean))
    : (value as Record<string, any>) ?? {};
class Value {
  constructor(public value: number) {}
  setValue(next: number) {
    this.value = next;
  }
  stopAnimation() {}
}
mock.module("react-native", () => ({
  View: "View",
  Text: "Text",
  TextInput: "TextInput",
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill, flatten },
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(true),
    addEventListener: () => ({ remove() {} }),
  },
  Easing: { bezier: () => (value: number) => value },
  Animated: { View: "AnimatedView", Value },
}));
const { resolveTestClassNames } = await import("../uniwindTestHarness");
const { FindBar } = await import("../../src/components/FindBar");
const { Overlay } = await import("../../src/chrome/Overlay");
const { appClasses } = await import("../../src/chrome/appStyles");
const app = readFileSync(`${import.meta.dir}/../../src/App.tsx`, "utf8");
const ast = parse(app, {
  sourceType: "module",
  plugins: ["typescript", "jsx"],
});
let findOverlay = "";
let panePointerEvents = "undefined";
function visit(node: unknown) {
  if (!node || typeof node !== "object") return;
  const item = node as Record<string, any>;
  if (
    item.type === "JSXElement" &&
    item.openingElement.name?.name === "Overlay" &&
    item.children.some(
      (child: Record<string, any>) =>
        child.type === "JSXExpressionContainer" &&
        child.expression?.right?.openingElement?.name?.name === "FindBar"
    )
  )
    findOverlay = app.slice(item.start, item.end);
  if (
    item.type === "JSXOpeningElement" &&
    item.name?.name === "View" &&
    item.attributes.some(
      (attr: Record<string, any>) =>
        attr.name?.name === "ref" && attr.value?.expression?.name === "panesRef"
    )
  ) {
    const expression = item.attributes.find(
      (attr: Record<string, any>) => attr.name?.name === "pointerEvents"
    )?.value?.expression;
    if (expression)
      panePointerEvents = app.slice(expression.start, expression.end);
  }
  for (const value of Object.values(item)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") visit(value);
  }
}
visit(ast);
assert(
  findOverlay,
  "the App find overlay is exercised rather than a replacement scene"
);
const { transformSync } = require("@babel/core");
const javascript = transformSync(`const element = (${findOverlay});`, {
  babelrc: false,
  configFile: false,
  plugins: [["@babel/plugin-transform-react-jsx", { runtime: "classic" }]],
}).code;
const renderOverlay = new Function(
  "React",
  "Overlay",
  "FindBar",
  "c",
  "findTab",
  "findResult",
  "lastFindQuery",
  "platform",
  "closeFind",
  "reducedMotion",
  `${javascript}; return element;`
);
const dispatches: Array<[string, string, boolean]> = [];
const lastFindQuery = { current: "" };
const platform = {
  findInPage: (id: string, query: string, backward: boolean) =>
    dispatches.push([id, query, backward]),
};
function Scene({
  tab = "a",
  result = null,
}: {
  tab?: string;
  result?: { current: number; total: number } | null;
}) {
  return renderOverlay(
    React,
    Overlay,
    FindBar,
    appClasses,
    tab,
    result,
    lastFindQuery,
    platform,
    () => {},
    true
  );
}
let renderer!: ReactTestRenderer;
const input = () => renderer.root.findByType("TextInput" as React.ElementType);
const button = (label: string) =>
  renderer.root.findByProps({ accessibilityLabel: label });
const resolvedStyle = (props: Record<string, any>) => ({
  ...resolveTestClassNames(props.className, themes.lavender),
  ...flatten(
    typeof props.style === "function"
      ? props.style({ pressed: false })
      : props.style
  ),
});
const delay = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 280)));
const previousError = console.error;
console.error = (...args: unknown[]) => {
  if (!String(args[0]).includes("react-test-renderer is deprecated"))
    previousError(...args);
};
try {
  const scenario = process.argv[2];
  await act(() => {
    renderer = create(<Scene />);
  });
  if (scenario === "position") {
    const overlay = renderer.root.findByType(
      "AnimatedView" as React.ElementType
    );
    const host = flatten(overlay.props.style);
    assert.equal(
      host.position,
      "absolute",
      "a find host after flex panes must not lay out below the clipped page"
    );
    assert.equal(
      host.inset,
      0,
      "all four edges remain bound to the content card"
    );
    assert.equal(
      overlay.props.pointerEvents,
      "box-none",
      "only the find strip consumes touches"
    );
    const pageEvents =
      new Function("findBlocking", `return (${panePointerEvents});`)(true) ??
      "auto";
    assert.equal(
      pageEvents,
      "auto",
      "the page can scroll/select while find remains open"
    );
  } else if (scenario === "narrow") {
    const strip = input().parent!;
    const style = resolvedStyle(strip.props);
    const field = resolvedStyle(input().props);
    const parentWidth = 256;
    const width =
      typeof style.width === "string" && style.width.endsWith("%")
        ? Math.min(
            (parentWidth * Number.parseFloat(style.width)) / 100,
            style.maxWidth ?? Infinity
          )
        : Number(style.width);
    assert(
      Number.isFinite(width) && width <= parentWidth,
      "the strip fits its content card, even when the full window is wider"
    );
    assert(
      (field.flex ?? field.flexGrow) > 0 &&
        field.minWidth === 0 &&
        field.width === undefined,
      "the query field yields width to previous/next/close controls"
    );
    const controls = ["Previous match", "Next match", "Close find"].map(
      (label) => button(label)
    );
    const fixedWidth =
      controls.reduce(
        (sum, control) => sum + Number(resolvedStyle(control.props).width),
        0
      ) +
      34 +
      4 * style.gap +
      Number(style.paddingLeft ?? style.paddingHorizontal) +
      Number(style.paddingRight ?? style.paddingHorizontal);
    assert(
      width > fixedWidth,
      "a 256dp content card retains positive query width beside every control"
    );
  } else if (scenario === "counts") {
    for (const [current, total, label] of [
      [0, 0, "0/0"],
      [1, 3, "1/3"],
      [3, 3, "3/3"],
      [1, -1, "1/?"],
    ] as const) {
      await act(() => renderer.update(<Scene result={{ current, total }} />));
      assert(
        renderer.root
          .findAllByType("Text" as React.ElementType)
          .some((node) => node.props.children === label),
        `Gecko ordinal ${current} and total ${total} must display ${label}`
      );
    }
  } else if (scenario === "no-matches") {
    await act(() => input().props.onChangeText("missing"));
    await act(() =>
      renderer.update(<Scene result={{ current: 0, total: 0 }} />)
    );
    for (const label of ["Previous match", "Next match"]) {
      assert.equal(
        button(label).props.disabled,
        true,
        "zero-match navigation is disabled"
      );
      assert.equal(button(label).props.accessibilityState.disabled, true);
    }
    await delay();
    dispatches.length = 0;
    await act(() => input().props.onSubmitEditing());
    assert.deepEqual(
      dispatches,
      [],
      "IME submit cannot step a zero-match query"
    );
    await act(() =>
      renderer.update(<Scene result={{ current: 1, total: -1 }} />)
    );
    assert.equal(
      button("Next match").props.disabled,
      false,
      "an unknown count must not suppress valid matching"
    );
    await act(() => button("Next match").props.onPress());
    assert.deepEqual(dispatches, [["a", "missing", false]]);
  } else if (scenario === "retarget") {
    await act(() => input().props.onChangeText("old"));
    lastFindQuery.current = "";
    await act(() => renderer.update(<Scene tab="b" />));
    assert.equal(
      input().props.value,
      "",
      "the replacement tab cannot retain an old-tab query"
    );
    await act(() => input().props.onChangeText("new"));
    await delay();
    assert.deepEqual(
      dispatches,
      [["b", "new", false]],
      "retarget cancels the old query before the debounce dispatch"
    );
  } else throw new Error(`Unknown find scenario ${scenario}`);
} finally {
  if (renderer) await act(() => renderer.unmount());
  console.error = previousError;
}
