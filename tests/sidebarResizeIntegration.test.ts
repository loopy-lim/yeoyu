import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@babel/parser";
import { FrameCoalescer } from "../src/chrome/FrameCoalescer";
import {
  clampSidebarWidth,
  sidebarSizing,
  SIDEBAR_WIDTH_STEP,
} from "../src/sidebarSizing";

// Execute the actual App handlers; the native responder/Yoga are not simulated.
const source = readFileSync(resolve(import.meta.dir, "../src/App.tsx"), "utf8");
const tree = parse(source, {
  sourceType: "module",
  plugins: ["typescript", "jsx"],
});
const declarations = new Map<string, string>();
const attributes = new Map<string, string>();
function visit(node: unknown) {
  if (!node || typeof node !== "object") return;
  const item = node as Record<string, any>;
  if (item.type === "VariableDeclarator" && item.id?.name && item.init)
    declarations.set(
      item.id.name,
      source.slice(item.init.start, item.init.end)
    );
  if (
    item.type === "JSXOpeningElement" &&
    item.attributes.some(
      (attr: any) =>
        attr.name?.name === "accessibilityLabel" &&
        (attr.value?.value === "Resize sidebar" ||
          (attr.value && source.slice(attr.value.start, attr.value.end).includes('tr("chrome.resizeSidebar")')))
    )
  ) {
    for (const attr of item.attributes) {
      if (attr.name?.name && attr.value?.expression)
        attributes.set(
          attr.name.name,
          source.slice(attr.value.expression.start, attr.value.expression.end)
        );
    }
  }
  for (const value of Object.values(item)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") visit(value);
  }
}
visit(tree);
const transpiler = new Bun.Transpiler({ loader: "tsx" });
function evaluate(
  text: string | undefined,
  environment: Record<string, unknown>
): any {
  expect(text).toBeDefined();
  const code = transpiler
    .transformSync(`export const value = (${text});`)
    .replace(/^export /m, "");
  return new Function(...Object.keys(environment), `${code}\nreturn value;`)(
    ...Object.values(environment)
  );
}

function resizing(hydrated = true) {
  const changes: number[] = [];
  const sidebarLimits = { min: 200, max: 254, width: 254 };
  const sidebarWidthRef = { current: sidebarLimits.width };
  const resizeSidebarTo = evaluate(declarations.get("resizeSidebarTo"), {
    uiHydrated: hydrated,
    sidebarLimits,
    sidebarWidthRef,
    clampSidebarWidth,
    updateUi: (action: { width: number }) => changes.push(action.width),
  });
  return { changes, sidebarLimits, sidebarWidthRef, resizeSidebarTo };
}

test("accessible width actions resize within the same split bounds as dragging", () => {
  const state = resizing();
  const action = evaluate(attributes.get("onAccessibilityAction"), {
    ...state,
    SIDEBAR_WIDTH_STEP,
  });
  expect(evaluate(attributes.get("accessibilityValue"), state)).toMatchObject({
    min: 200,
    max: 254,
    now: 254,
  });
  action({ nativeEvent: { actionName: "increment" } });
  action({ nativeEvent: { actionName: "decrement" } });
  action({ nativeEvent: { actionName: "activate" } });
  expect(state.changes).toEqual([246]);
});

test("drag starts at the displayed width and flushes the final sample, not the larger saved width", () => {
  const state = resizing();
  const sidebarFrames = new FrameCoalescer<number>(state.resizeSidebarTo, {
    request: () => 1,
    cancel: () => {},
  });
  const handlers = evaluate(declarations.get("sidebarResize"), {
    useMemo: (create: () => unknown) => create(),
    PanResponder: { create: (handlers: unknown) => handlers },
    sidebarFrames,
    sidebarWidthRef: { current: 254 },
    resizeOrigin: { current: { x: 0, width: 0 } },
  });
  handlers.onPanResponderGrant({ nativeEvent: { pageX: 254 } });
  handlers.onPanResponderMove({ nativeEvent: { pageX: 240 } });
  handlers.onPanResponderRelease({ nativeEvent: { pageX: 230 } });
  expect(state.changes).toEqual([230]);
});

test("no-op drags preserve a temporarily capped preference, and hydration blocks resize writes", () => {
  const state = resizing();
  for (const width of [254, 320, Number.NaN]) state.resizeSidebarTo(width);
  expect(state.changes).toEqual([]);
  const loading = resizing(false);
  loading.resizeSidebarTo(220);
  expect(loading.changes).toEqual([]);
});

test("the final drag sample wins even before React commits the preceding frame", () => {
  const state = resizing();
  state.resizeSidebarTo(230);
  state.resizeSidebarTo(254);
  expect(state.changes).toEqual([230, 254]);
});

test("App sizes the split sidebar from safe width and converts frame pixels to dp", () => {
  const inputs = {
    sidebarSizing,
    ui: { sidebarWidth: 320, framePx: { left: 8, right: 16 } },
    windowWidth: 1000,
    safeInsets: { left: 20, right: 20 },
    PixelRatio: { get: () => 2 },
    space: { sm: 4 },
  };
  expect(
    evaluate(declarations.get("sidebarLimits"), {
      ...inputs,
      renderSplit: { orientation: "horizontal" },
    })
  ).toEqual({ min: 200, max: 296, width: 296 });
  expect(
    evaluate(declarations.get("sidebarLimits"), {
      ...inputs,
      renderSplit: { orientation: "vertical" },
    }).width
  ).toBe(320);
});
