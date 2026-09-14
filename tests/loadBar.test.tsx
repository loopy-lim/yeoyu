import { afterEach, expect, test } from "bun:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  animations,
  latestAnimation,
  resetAnimations,
  setReduceMotion,
  type TestValue,
} from "./chromeTestHarness";
import { themes } from "../src/theme";
import type { LoadState } from "../src/chrome/LoadBar";
const { LoadBar } = await import("../src/chrome/LoadBar");

let tree: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  resetAnimations();
  setReduceMotion(false);
});
async function render(state?: LoadState, reducedMotion?: boolean) {
  await act(async () => {
    const element = (
      <LoadBar
        state={state}
        theme={themes.lavender}
        reducedMotion={reducedMotion}
      />
    );
    if (tree) tree.update(element);
    else tree = create(element);
  });
}
function bar() {
  const [track, fill] = tree!.root.findAllByType("View" as React.ElementType);
  return {
    opacity: track.props.style.opacity as TestValue,
    scale: fill.props.style.transform?.[0]?.scaleX as TestValue | undefined,
    fillStyle: fill.props.style,
  };
}

test("progress uses the native driver and grows from the left without animating layout width", async () => {
  await render({ loading: true, progress: 25 }, false);
  expect(
    animations.every((animation) => animation.config.useNativeDriver)
  ).toBe(true);
  expect(bar().fillStyle.width).toBe("100%");
  expect(bar().fillStyle.transformOrigin).toEqual([0, 0, 0]);
  await act(() => latestAnimation().finish());
  expect(bar().scale?.value).toBe(0.25);
});

test("load completion fills the bar before fading and a rapid restart ignores old callbacks", async () => {
  await render({ loading: true, progress: 45 }, false);
  await act(() => latestAnimation().finish());
  resetAnimations();
  await render({ loading: false, progress: 100 }, false);
  expect(animations.some((animation) => animation.config.toValue === 0)).toBe(
    false
  );
  const completing = latestAnimation();
  await act(() => completing.finish());
  expect(bar().scale?.value).toBe(1);
  const fading = latestAnimation();
  expect(fading.config.toValue).toBe(0);
  await render({ loading: true, progress: 0 }, false);
  expect(fading.stopped).toBe(true);
  expect(bar().opacity.value).toBe(1);
  const count = animations.length;
  await act(() => completing.callback?.({ finished: true }));
  expect(animations).toHaveLength(count);
  await act(() => latestAnimation().finish());
  expect(bar().scale?.value).toBe(0.04);
  expect(bar().opacity.value).toBe(1);
});

test("OS reduced motion defaults to direct updates and clamps indeterminate or invalid progress", async () => {
  setReduceMotion(true);
  for (const [progress, expected] of [
    [0, 0.04],
    [-1, 0.04],
    [NaN, 0.04],
    [Infinity, 0.04],
    [150, 1],
  ]) {
    await render({ loading: true, progress });
    expect(bar().scale?.value).toBe(expected);
    expect(bar().opacity.value).toBe(1);
  }
  expect(animations).toHaveLength(0);
  await render({ loading: false, progress: 100 });
  expect(bar().opacity.value).toBe(0);
  expect(animations).toHaveLength(0);
});

test("enabling reduced motion during completion stops animation and hides the settled bar", async () => {
  await render({ loading: true, progress: 70 });
  await render({ loading: false, progress: 100 });
  const pending = latestAnimation();
  await act(() => setReduceMotion(true));
  expect(pending.stopped).toBe(true);
  expect(bar().opacity.value).toBe(0);
  const count = animations.length;
  await act(() => pending.callback?.({ finished: true }));
  expect(animations).toHaveLength(count);
});

test("a completed initial state stays hidden and an absent state cancels an active load", async () => {
  await render({ loading: false, progress: 100 }, false);
  expect(bar().opacity.value).toBe(0);
  expect(animations).toHaveLength(0);
  await render({ loading: true, progress: 20 }, false);
  const active = latestAnimation();
  await render(undefined, false);
  expect(active.stopped).toBe(true);
  expect(tree!.toJSON()).toBeNull();
});
