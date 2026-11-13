import { afterEach, expect, mock, test } from "bun:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  latestAnimation,
  resetAnimations,
  type TestValue,
} from "./chromeTestHarness";
const { useToolbarTabSwipe } = await import("../src/hooks/useToolbarTabSwipe");
import type { SwipeableTab } from "../src/tabSwipe";

const tabs: SwipeableTab[] = [
  { id: "a", title: "Alpha", url: "https://a.example", workspaceId: "w1" },
  { id: "b", title: "Beta", url: "https://b.example", workspaceId: "w1" },
  { id: "c", title: "Gamma", url: "https://c.example", workspaceId: "w1" },
];

let root: ReactTestRenderer | undefined;
let binding!: ReturnType<typeof useToolbarTabSwipe<SwipeableTab>>;

afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  resetAnimations();
});

function Harness({
  enabled = true,
  currentTabId = "b",
  reducedMotion = false,
  onSwitchTab,
}: {
  enabled?: boolean;
  currentTabId?: string | null;
  reducedMotion?: boolean;
  onSwitchTab: (id: string) => void;
}) {
  binding = useToolbarTabSwipe({
    enabled,
    tabs,
    currentTabId,
    reducedMotion,
    labelOf: (tab) => tab.title,
    onSwitchTab,
  });
  return null;
}

const g = (dx: number, dy = 0, vx = 0) => ({ dx, dy, vx });

test("toolbar swipe leaves taps untouched, previews adjacent tab on horizontal drag, and switches on commit", async () => {
  const onSwitchTab = mock(() => {});
  await act(() => {
    root = create(<Harness onSwitchTab={onSwitchTab} />);
  });

  const handlers = binding.panHandlers as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  expect(handlers.onStartShouldSetPanResponder?.({}, g(0))).toBe(false);
  expect(handlers.onMoveShouldSetPanResponderCapture?.({}, g(4, 2))).toBe(false);
  expect(handlers.onMoveShouldSetPanResponderCapture?.({}, g(-24, 4))).toBe(true);

  await act(() => {
    handlers.onPanResponderMove?.({}, g(-36, 2));
  });
  expect((binding.offsetX as unknown as TestValue).value).toBe(-12.6);
  expect(binding.preview).toEqual({ delta: 1, title: "Gamma", ready: false });

  await act(() => {
    handlers.onPanResponderMove?.({}, g(-64, 2));
  });
  expect(binding.preview).toEqual({ delta: 1, title: "Gamma", ready: true });

  await act(() => {
    handlers.onPanResponderRelease?.({}, g(-64, 2, -0.2));
  });
  expect(onSwitchTab).toHaveBeenCalledWith("c");
  expect(binding.preview).toBeNull();
  await act(() => latestAnimation().finish());
  expect((binding.offsetX as unknown as TestValue).value).toBe(0);
});

test("sub-threshold drag cancels cleanly and reducedMotion skips offset translation", async () => {
  const onSwitchTab = mock(() => {});
  await act(() => {
    root = create(<Harness reducedMotion onSwitchTab={onSwitchTab} />);
  });
  const handlers = binding.panHandlers as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;

  await act(() => {
    handlers.onPanResponderMove?.({}, g(24, 0));
  });
  expect((binding.offsetX as unknown as TestValue).value).toBe(0);
  expect(binding.preview).toEqual({ delta: -1, title: "Alpha", ready: false });

  await act(() => {
    handlers.onPanResponderRelease?.({}, g(20, 0, 0.1));
  });
  expect(onSwitchTab).not.toHaveBeenCalled();
  expect(binding.preview).toBeNull();
});

test("disabled swipe refuses capture and clears active preview", async () => {
  const onSwitchTab = mock(() => {});
  await act(() => {
    root = create(<Harness enabled onSwitchTab={onSwitchTab} />);
  });
  const handlers = binding.panHandlers as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;

  await act(() => {
    handlers.onPanResponderMove?.({}, g(-32, 0));
  });
  expect(binding.preview).not.toBeNull();

  await act(() => {
    root!.update(<Harness enabled={false} onSwitchTab={onSwitchTab} />);
  });
  expect(binding.preview).toBeNull();
  expect(handlers.onMoveShouldSetPanResponderCapture?.({}, g(-32, 0))).toBe(false);
});
