import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { parse } from "@babel/parser";
import {
  animations,
  latestAnimation,
  resetAnimations,
} from "./chromeTestHarness";
import type { SplitLayout } from "../src/splitLayout";
const { useSplitMotion } = await import("../src/chrome/useChromeMotion");

// Execute the actual App geometry expressions so the fixture cannot silently
// assert a separate rendering policy. Native Fabric/Yoga is not simulated here.
const appSource = readFileSync(
  resolve(import.meta.dir, "../src/App.tsx"),
  "utf8"
);
const appAst = parse(appSource, {
  sourceType: "module",
  plugins: ["typescript", "jsx"],
});
function declaration(name: string, contains?: string): string {
  const found: string[] = [];
  function visit(node: unknown) {
    if (!node || typeof node !== "object") return;
    const entry = node as Record<string, unknown>;
    if (entry.type === "VariableDeclarator") {
      const id = entry.id as { type?: string; name?: string };
      const init = entry.init as { start?: number; end?: number } | null;
      if (id?.type === "Identifier" && id.name === name && init) {
        const source = appSource.slice(init.start, init.end);
        if (!contains || source.includes(contains)) found.push(source);
      }
    }
    for (const value of Object.values(entry)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(appAst);
  if (found.length !== 1)
    throw new Error(`Expected one App ${name}, found ${found.length}`);
  return found[0]!;
}
const fixedGeometry = new Function(
  "pipVisible",
  "splitRestoreToken",
  "splitMotion",
  `return (${declaration("fixedSplitGeometry")});`
);
const paneRatio = new Function(
  "contentFullscreen",
  "renderSplit",
  "fixedSplitGeometry",
  "index",
  "splitMotion",
  `return (${declaration("ratio", "splitMotion.firstFraction")});`
);

const pair: SplitLayout = {
  first: "a",
  second: "b",
  ratio: 0.5,
  orientation: "horizontal",
};
type Motion = ReturnType<typeof useSplitMotion>;
type Props = {
  layout: SplitLayout | null;
  selected?: string;
  space?: string;
  reduced?: boolean;
  restoreToken?: number;
  repaint?: number;
};
let root: ReactTestRenderer | undefined;
let motion: Motion;
const commits: Array<{
  first: unknown;
  second: unknown;
  layout: SplitLayout | null;
  fixed: boolean;
}> = [];
function Scene(props: Props) {
  motion = useSplitMotion(
    props.layout,
    props.space ?? "one",
    props.selected ?? "a",
    props.reduced ?? false,
    props.restoreToken
  );
  const fixed = fixedGeometry(false, props.restoreToken, motion) as boolean;
  const first = paneRatio(false, motion.layout, fixed, 0, motion);
  const second = paneRatio(false, motion.layout, fixed, 1, motion);
  useLayoutEffect(() => {
    commits.push({ first, second, layout: motion.layout, fixed });
  });
  return (
    <>
      <div data-pane="first" data-flex={first} />
      {motion.layout && <div data-pane="second" data-flex={second} />}
    </>
  );
}
const last = () => commits.at(-1)!;
async function render(props: Props) {
  await act(() => {
    if (root) root.update(<Scene {...props} />);
    else root = create(<Scene {...props} />);
  });
}
function expectAnimated() {
  expect(typeof last().first).toBe("object");
  expect(typeof last().second).toBe("object");
  expect(last().fixed).toBe(false);
}
function expectFinal(ratio = 0.5) {
  expect(last().first).toBe(ratio);
  expect(last().second).toBe(1 - ratio);
  expect(last().fixed).toBe(true);
}
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  commits.length = 0;
  resetAnimations();
});

test.each(["a", "b"])(
  "opening from %s commits exact final pane shares after the last frame",
  async (selected) => {
    await render({ layout: null, selected });
    await render({ layout: pair, selected });
    expectAnimated();
    // A real intermediate value must remain Animated; numeric endpoint must not
    // make the ordinary opening jump immediately to its destination.
    motion.firstFraction.setValue(selected === "a" ? 0.61 : 0.4766);
    motion.progress.setValue(0.93);
    const beforeFinish = commits.length;
    await act(() => latestAnimation().finish());
    expect(commits.length).toBeGreaterThan(beforeFinish);
    expectFinal();
  }
);

test("an initially open pair and a settled ratio edit use numeric shares without a trailing animation", async () => {
  await render({ layout: pair });
  expectFinal();
  expect(animations.length).toBe(0);
  await render({ layout: { ...pair, ratio: 0.75 } });
  expectFinal(0.75);
  expect(animations.length).toBe(0);
  const count = commits.length;
  await render({ layout: { ...pair, ratio: 0.75 }, repaint: count });
  expectFinal(0.75);
  expect(animations.length).toBe(0);
});

test("closing remains animated and retires only after the selected survivor settles", async () => {
  await render({ layout: pair, selected: "b" });
  await render({ layout: null, selected: "b" });
  expectAnimated();
  expect(last().layout).toEqual(pair);
  await act(() => latestAnimation().finish());
  expect(last().layout).toBeNull();
  expect(last().first).toBe(1);
});

test("a stale close cannot mark a reopened pair settled or replace its current fraction", async () => {
  await render({ layout: pair, selected: "b" });
  await render({ layout: null, selected: "b" });
  const closing = latestAnimation();
  motion.firstFraction.setValue(0.2);
  motion.progress.setValue(0.4);
  await render({ layout: pair, selected: "a" });
  const reopening = latestAnimation();
  expectAnimated();
  expect(motion.firstFraction).toMatchObject({ value: 0.2 });
  await act(() => closing.callback?.({ finished: true }));
  expectAnimated();
  await act(() => reopening.finish());
  expectFinal();
});

test("a replaced opening ignores late completion and settles only the current pair and Space", async () => {
  await render({ layout: null });
  await render({ layout: pair });
  const old = latestAnimation();
  const next: SplitLayout = {
    ...pair,
    first: "c",
    second: "d",
    ratio: 0.3,
    orientation: "vertical",
  };
  await render({ layout: next, selected: "c", space: "two" });
  const fresh = latestAnimation();
  await act(() => old.callback?.({ finished: true }));
  expectAnimated();
  expect(last().layout).toEqual(next);
  await act(() => fresh.finish());
  expectFinal(0.3);
});

test("reduced motion settles immediately and invalidates the old completion", async () => {
  await render({ layout: null });
  await render({ layout: pair });
  const old = latestAnimation();
  await render({ layout: pair, reduced: true });
  expectFinal();
  await act(() => old.callback?.({ finished: true }));
  expectFinal();
});

test("return-specific geometry remains numeric when its token is cleared", async () => {
  await render({ layout: null });
  await render({ layout: pair, restoreToken: 17 });
  expectFinal();
  expect(animations.length).toBe(0);
  await render({ layout: pair });
  expectFinal();
  expect(animations.length).toBe(0);
});

test("completion republishes endpoints to bound views before the numeric commit detaches animation", async () => {
  await render({ layout: null });
  await render({ layout: pair });
  const opening = latestAnimation();
  // Model the reported boundary: the JS values reached the endpoint, while a
  // bound host still holds an earlier frame. RN AnimatedValue.setValue flushes
  // even an equal value; the completion must publish before its React commit.
  motion.progress.setValue(1);
  motion.firstFraction.setValue(0.5);
  const host = { progress: 0.93, fraction: 0.4766, updates: 0 };
  const originalProgress = motion.progress.setValue.bind(motion.progress);
  const originalFraction = motion.firstFraction.setValue.bind(
    motion.firstFraction
  );
  motion.progress.setValue = (value) => {
    host.progress = value;
    host.updates++;
    originalProgress(value);
  };
  motion.firstFraction.setValue = (value) => {
    host.fraction = value;
    host.updates++;
    originalFraction(value);
  };
  await act(() => opening.callback?.({ finished: true }));
  expect(host.progress).toBe(1);
  expect(host.fraction).toBe(0.5);
  expectFinal();
  const updates = host.updates;
  const count = commits.length;
  await act(() => opening.callback?.({ finished: true }));
  expect(host.updates).toBe(updates);
  expect(commits.length).toBe(count);
});
