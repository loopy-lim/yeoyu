import { afterEach, expect, test } from "bun:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useContentFullscreen } from "../src/hooks/useContentFullscreen";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let tree: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
});

async function mount(initial: Parameters<typeof useContentFullscreen>[0]) {
  let current!: ReturnType<typeof useContentFullscreen>;
  let options = initial;
  function Harness(props: typeof initial) {
    current = useContentFullscreen(props);
    return null;
  }
  await act(async () => {
    tree = create(<Harness {...options} />);
  });
  return {
    get: () => current,
    update: async (next: Partial<typeof initial>) => {
      options = { ...options, ...next };
      await act(async () => tree!.update(<Harness {...options} />));
    },
  };
}

test("a fullscreen request in the second split pane becomes the presentation target", async () => {
  const hook = await mount({
    navigation: { a: {}, b: { fullscreen: true } },
    visibleTabIds: ["a", "b"],
    focusedTabId: "a",
    exit: () => {},
  });
  expect(hook.get().tabId).toBe("b");
});

test("Back and Escape close a modal before exiting fullscreen and wait for Gecko's exit", async () => {
  const exits: string[] = [];
  const hook = await mount({
    navigation: { video: { fullscreen: true } },
    visibleTabIds: ["video"],
    focusedTabId: "video",
    exit: (id) => exits.push(id),
  });
  expect(hook.get().dismiss(() => true)).toBe(true);
  expect(exits).toEqual([]);
  expect(hook.get().dismiss(() => false)).toBe(true);
  expect(exits).toEqual(["video"]);
  expect(hook.get().tabId).toBe("video");
  await hook.update({ navigation: { video: { fullscreen: false } } });
  expect(hook.get().tabId).toBeUndefined();
  expect(hook.get().dismiss(() => false)).toBe(false);
});

test("changing Space exits the old fullscreen session without entering an unrelated tab", async () => {
  const exits: string[] = [];
  const hook = await mount({
    navigation: { old: { fullscreen: true }, next: {} },
    visibleTabIds: ["old"],
    focusedTabId: "old",
    exit: (id) => exits.push(id),
  });
  await hook.update({ visibleTabIds: ["next"], focusedTabId: "next" });
  expect(hook.get().tabId).toBeUndefined();
  expect(exits).toEqual(["old"]);
  await hook.update({
    navigation: { old: { fullscreen: true }, next: { fullscreen: false } },
  });
  expect(exits).toEqual(["old"]);
  await hook.update({ navigation: { old: { fullscreen: false }, next: {} } });
  await hook.update({ navigation: { old: { fullscreen: true }, next: {} } });
  expect(exits).toEqual(["old", "old"]);
});

test("a background request is rejected and a closing split pane stops owning fullscreen", async () => {
  const exits: string[] = [];
  const hook = await mount({
    navigation: {
      a: {},
      b: { fullscreen: true },
      hidden: { fullscreen: true },
    },
    visibleTabIds: ["a", "b"],
    focusedTabId: "b",
    exit: (id) => exits.push(id),
  });
  expect(exits).toEqual(["hidden"]);
  await hook.update({ visibleTabIds: ["a"], focusedTabId: "a" });
  expect(exits).toEqual(["hidden", "b"]);
  expect(hook.get().tabId).toBeUndefined();
});
