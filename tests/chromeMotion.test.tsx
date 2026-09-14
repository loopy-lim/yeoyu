import { afterEach, expect, test } from "bun:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  animations,
  latestAnimation,
  resetAnimations,
} from "./chromeTestHarness";
const { useSidebarMotion, useSpaceMotion, useSplitMotion } = await import(
  "../src/chrome/useChromeMotion"
);
import type { SplitLayout } from "../src/splitLayout";

let root: ReactTestRenderer | undefined;
let splitResult: ReturnType<typeof useSplitMotion>;
let sidebarResult: ReturnType<typeof useSidebarMotion>;
let spaceResult: ReturnType<typeof useSpaceMotion>;
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  resetAnimations();
});
const pair: SplitLayout = {
  first: "a",
  second: "b",
  ratio: 0.5,
  orientation: "horizontal",
};
function Split(props: {
  layout: SplitLayout | null;
  space?: string;
  selected?: string;
  reduced?: boolean;
}) {
  splitResult = useSplitMotion(
    props.layout,
    props.space ?? "one",
    props.selected ?? "a",
    props.reduced ?? false
  );
  return null;
}
test("split keeps latest size on exit and ignores a stale close after reopen", async () => {
  await act(() => {
    root = create(<Split layout={pair} />);
  });
  const resized: SplitLayout = {
    ...pair,
    ratio: 0.75,
    orientation: "vertical",
  };
  await act(() => root!.update(<Split layout={resized} />));
  await act(() => root!.update(<Split layout={null} selected="b" />));
  expect(splitResult.layout).toEqual(resized);
  const closing = latestAnimation();
  await act(() => root!.update(<Split layout={pair} />));
  await act(() => closing.callback?.({ finished: true }));
  expect(splitResult.layout).toEqual(pair);
});
test("split never retains the previous Space or a pair unrelated to selection", async () => {
  await act(() => {
    root = create(<Split layout={pair} />);
  });
  await act(() =>
    root!.update(<Split layout={null} space="two" selected="a" />)
  );
  expect(splitResult.layout).toBeNull();
  await act(() => root!.update(<Split layout={pair} />));
  await act(() => root!.update(<Split layout={null} selected="c" />));
  expect(splitResult.layout).toBeNull();
});
test("reduced motion immediately retires an outgoing split", async () => {
  await act(() => {
    root = create(<Split layout={pair} />);
  });
  await act(() => root!.update(<Split layout={null} />));
  const closing = latestAnimation();
  await act(() => root!.update(<Split layout={null} reduced />));
  expect(splitResult.layout).toBeNull();
  expect(splitResult.progress).toMatchObject({ value: 0 });
  expect(closing.stopped).toBe(true);
});
function Sidebar(props: { collapsed: boolean; reduced?: boolean }) {
  sidebarResult = useSidebarMotion(props.collapsed, props.reduced ?? false);
  return null;
}
test("sidebar outgoing children stay mounted from the first transition commit", async () => {
  let mounts = 0;
  let unmounts = 0;
  function Child() {
    React.useLayoutEffect(() => {
      mounts++;
      return () => {
        unmounts++;
      };
    }, []);
    return null;
  }
  function Layer({ collapsed }: { collapsed: boolean }) {
    const motion = useSidebarMotion(collapsed, false);
    return motion.expanded ? <Child /> : null;
  }
  await act(() => {
    root = create(<Layer collapsed={false} />);
  });
  await act(() => root!.update(<Layer collapsed />));
  expect(mounts).toBe(1);
  expect(unmounts).toBe(0);
  await act(() => latestAnimation().finish());
  expect(unmounts).toBe(1);
});
test("sidebar keeps layout and chrome on a shared JS progress and rejects old completions", async () => {
  await act(() => {
    root = create(<Sidebar collapsed={false} />);
  });
  expect(animations.length).toBe(0);
  await act(() => root!.update(<Sidebar collapsed />));
  expect(sidebarResult.expanded).toBe(true);
  expect(sidebarResult.rail).toBe(true);
  const closing = latestAnimation();
  expect(closing.config.useNativeDriver).toBe(false);
  sidebarResult.progress.setValue(0.4);
  await act(() => root!.update(<Sidebar collapsed={false} />));
  expect(sidebarResult.progress).toMatchObject({ value: 0.4 });
  await act(() => closing.callback?.({ finished: true }));
  expect(sidebarResult.rail).toBe(true);
  await act(() => latestAnimation().finish());
  expect(sidebarResult.expanded).toBe(true);
  expect(sidebarResult.rail).toBe(false);
});
function Space(props: { id: string; index: number; reduced?: boolean }) {
  spaceResult = useSpaceMotion(props.id, props.index, props.reduced ?? false);
  return null;
}
test("Space motion follows committed selection in either direction and cancels on preference change", async () => {
  await act(() => {
    root = create(<Space id="one" index={0} />);
  });
  expect(animations.length).toBe(0);
  await act(() => root!.update(<Space id="two" index={1} />));
  expect(spaceResult.offset).toMatchObject({ value: 12 });
  const forward = latestAnimation();
  spaceResult.offset.setValue(6);
  spaceResult.opacity.setValue(0.72);
  await act(() => root!.update(<Space id="one" index={0} />));
  expect(forward.stopped).toBe(true);
  expect(spaceResult.offset).toMatchObject({ value: 6 });
  expect(spaceResult.opacity).toMatchObject({ value: 0.72 });
  const reversing = latestAnimation();
  expect(
    reversing.children?.find((child) =>
      Object.is(child.value, spaceResult.offset)
    )?.config.toValue
  ).toBeLessThan(0);
  await act(() => root!.update(<Space id="one" index={0} reduced />));
  expect(spaceResult.offset).toMatchObject({ value: 0 });
  expect(spaceResult.opacity).toMatchObject({ value: 1 });
  const count = animations.length;
  await act(() => reversing.callback?.({ finished: true }));
  expect(animations.length).toBe(count);
});

test("an initially open split starts at its real ratio with no opening collapse", async () => {
  await act(() => {
    root = create(<Split layout={{ ...pair, ratio: 0.75 }} />);
  });
  expect(splitResult.progress).toMatchObject({ value: 1 });
  expect(splitResult.firstFraction).toMatchObject({ value: 0.75 });
  expect(animations.length).toBe(0);
});

test.each(["a", "b"])(
  "first opening grows from the previous solo pane %s",
  async (selected) => {
    await act(() => {
      root = create(<Split layout={null} selected={selected} />);
    });
    await act(() => root!.update(<Split layout={pair} selected={selected} />));
    expect(splitResult.firstFraction).toMatchObject({
      value: selected === "a" ? 1 : 0,
    });
    expect(splitResult.progress).toMatchObject({ value: 0 });
    const opening = latestAnimation();
    expect(
      opening.children?.every((child) => child.config.useNativeDriver === false)
    ).toBe(true);
    await act(() => opening.finish());
    expect(splitResult.firstFraction).toMatchObject({ value: 0.5 });
    expect(splitResult.progress).toMatchObject({ value: 1 });
  }
);

test("closing toward the second pane then reopening never changes the current fraction synchronously", async () => {
  await act(() => {
    root = create(<Split layout={pair} selected="b" />);
  });
  await act(() => root!.update(<Split layout={null} selected="b" />));
  const closing = latestAnimation();
  expect(
    closing.children?.find((child) =>
      Object.is(child.value, splitResult.firstFraction)
    )?.config.toValue
  ).toBe(0);
  splitResult.firstFraction.setValue(0.2);
  splitResult.progress.setValue(0.4);
  await act(() => root!.update(<Split layout={pair} selected="a" />));
  expect(splitResult.firstFraction).toMatchObject({ value: 0.2 });
  expect(splitResult.progress).toMatchObject({ value: 0.4 });
  await act(() => closing.callback?.({ finished: true }));
  expect(splitResult.layout).toEqual(pair);
  await act(() => latestAnimation().finish());
  expect(splitResult.firstFraction).toMatchObject({ value: 0.5 });
  expect(splitResult.progress).toMatchObject({ value: 1 });
});

test("settled split ratio dragging applies directly without starting a trailing animation", async () => {
  await act(() => {
    root = create(<Split layout={null} />);
  });
  await act(() => root!.update(<Split layout={pair} />));
  await act(() => latestAnimation().finish());
  const count = animations.length;
  await act(() => root!.update(<Split layout={{ ...pair, ratio: 0.75 }} />));
  expect(splitResult.firstFraction).toMatchObject({ value: 0.75 });
  expect(animations.length).toBe(count);
});

test("reduced motion settles closing geometry on the selected survivor and invalidates the exit", async () => {
  await act(() => {
    root = create(<Split layout={pair} selected="b" />);
  });
  await act(() => root!.update(<Split layout={null} selected="b" />));
  const closing = latestAnimation();
  await act(() => root!.update(<Split layout={null} selected="b" reduced />));
  expect(splitResult.firstFraction).toMatchObject({ value: 0 });
  expect(splitResult.progress).toMatchObject({ value: 0 });
  expect(splitResult.layout).toBeNull();
  expect(closing.stopped).toBe(true);
  await act(() => closing.callback?.({ finished: true }));
  expect(splitResult.firstFraction).toMatchObject({ value: 0 });
});

test("rapid Space changes keep their current pose and settle after the latest directional response", async () => {
  await act(() => {
    root = create(<Space id="one" index={0} />);
  });
  await act(() => root!.update(<Space id="two" index={1} />));
  spaceResult.opacity.setValue(0.8);
  spaceResult.offset.setValue(5);
  await act(() => root!.update(<Space id="one" index={0} />));
  const oldResponse = latestAnimation();
  spaceResult.opacity.setValue(0.9);
  spaceResult.offset.setValue(-2);
  await act(() => root!.update(<Space id="three" index={2} />));
  expect(spaceResult.opacity).toMatchObject({ value: 0.9 });
  expect(spaceResult.offset).toMatchObject({ value: -2 });
  const response = latestAnimation();
  expect(
    response.children?.find((child) =>
      Object.is(child.value, spaceResult.offset)
    )?.config.toValue
  ).toBeGreaterThan(0);
  const count = animations.length;
  await act(() => oldResponse.callback?.({ finished: true }));
  expect(animations.length).toBe(count);
  await act(() => response.finish());
  await act(() => latestAnimation().finish());
  expect(spaceResult.opacity).toMatchObject({ value: 1 });
  expect(spaceResult.offset).toMatchObject({ value: 0 });
  await act(() => root!.update(<Space id="one" index={0} />));
  expect(spaceResult.offset).toMatchObject({ value: -12 });
});
