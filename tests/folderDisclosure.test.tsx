import { afterEach, beforeEach, expect, test } from "bun:test";
import React, { Profiler } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  animations,
  latestAnimation,
  resetAnimations,
  setReduceMotion,
  type TestValue,
} from "./chromeTestHarness";

const { FolderDisclosure } = await import("../src/chrome/FolderDisclosure");
const trees: ReactTestRenderer[] = [];
const mount = async (element: React.ReactElement) => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  trees.push(tree);
  return tree;
};
const viewProps = (tree: ReactTestRenderer) =>
  tree.root.findByType("View" as React.ElementType).props;
const progress = (tree: ReactTestRenderer) =>
  viewProps(tree).style.opacity as TestValue;

beforeEach(() => {
  resetAnimations();
  setReduceMotion(false);
});
afterEach(async () => {
  await act(() => trees.splice(0).forEach((tree) => tree.unmount()));
});

test("a closed folder does not mount hidden rows or start an animation", async () => {
  const tree = await mount(
    <FolderDisclosure open={false}>
      <span>hidden row</span>
    </FolderDisclosure>
  );
  expect(tree.toJSON()).toBeNull();
  expect(animations).toHaveLength(0);
});

test("opening rows fades and slides with the native driver without animating height", async () => {
  const tree = await mount(
    <FolderDisclosure open reducedMotion={false}>
      <span>row</span>
    </FolderDisclosure>
  );
  expect(progress(tree).value).toBe(0);
  expect(viewProps(tree).style.height).toBeUndefined();
  expect(
    viewProps(tree).style.transform[0].translateY.config.outputRange
  ).toEqual([-4, 0]);
  expect(latestAnimation().config).toMatchObject({
    toValue: 1,
    duration: 170,
    useNativeDriver: true,
  });
  await act(() => latestAnimation().finish());
  expect(progress(tree).value).toBe(1);
  expect(tree.root.findByType("span").children).toEqual(["row"]);
});

test("closing retains the latest rows without input or accessibility until exit completes", async () => {
  const tree = await mount(
    <FolderDisclosure open reducedMotion={false}>
      <span>first</span>
    </FolderDisclosure>
  );
  await act(() =>
    tree.update(
      <FolderDisclosure open reducedMotion={false}>
        <span>latest</span>
      </FolderDisclosure>
    )
  );
  await act(() =>
    tree.update(
      <FolderDisclosure open={false} reducedMotion={false}>
        {null}
      </FolderDisclosure>
    )
  );
  const exit = latestAnimation();
  expect(exit.config).toMatchObject({
    toValue: 0,
    duration: 120,
    useNativeDriver: true,
  });
  expect(tree.root.findByType("span").children).toEqual(["latest"]);
  expect(viewProps(tree).pointerEvents).toBe("none");
  expect(viewProps(tree).accessibilityElementsHidden).toBe(true);
  expect(viewProps(tree).importantForAccessibility).toBe("no-hide-descendants");
  await act(() => exit.callback?.({ finished: false }));
  expect(tree.toJSON()).not.toBeNull();
  await act(() => exit.finish());
  expect(tree.toJSON()).toBeNull();
});

test("rapid reopen preserves the visible pose and ignores a late exit callback", async () => {
  const render = (open: boolean) => (
    <FolderDisclosure open={open} reducedMotion={false}>
      {open && <span>current row</span>}
    </FolderDisclosure>
  );
  const tree = await mount(render(true));
  await act(() => latestAnimation().finish());
  await act(() => tree.update(render(false)));
  const exit = latestAnimation();
  const pose = progress(tree);
  pose.setValue(0.6);
  await act(() => tree.update(render(true)));
  expect(exit.stopped).toBe(true);
  expect(pose.value).toBe(0.6);
  await act(() => exit.callback?.({ finished: true }));
  expect(tree.root.findByType("span").children).toEqual(["current row"]);
  expect(viewProps(tree).pointerEvents).toBe("auto");
  expect(viewProps(tree).importantForAccessibility).toBe("auto");
  await act(() => latestAnimation().finish());
  expect(pose.value).toBe(1);
});

test("a completed close starts a fresh entrance when reopened", async () => {
  const render = (open: boolean) => (
    <FolderDisclosure open={open} reducedMotion={false}>
      <span>row</span>
    </FolderDisclosure>
  );
  const tree = await mount(render(true));
  await act(() => latestAnimation().finish());
  await act(() => tree.update(render(false)));
  await act(() => latestAnimation().finish());
  expect(tree.toJSON()).toBeNull();
  await act(() => tree.update(render(true)));
  expect(progress(tree).value).toBe(0);
  expect(tree.root.findByType("span").children).toEqual(["row"]);
});

test("opening and reopening mount rows before their native animation starts", async () => {
  const startsBeforeMount: number[] = [];
  function Row() {
    React.useLayoutEffect(() => {
      startsBeforeMount.push(animations.length);
    }, []);
    return <span>row</span>;
  }
  const render = (open: boolean) => (
    <FolderDisclosure open={open} reducedMotion={false}>
      <Row />
    </FolderDisclosure>
  );
  const tree = await mount(render(false));
  expect(startsBeforeMount).toEqual([]);
  await act(() => tree.update(render(true)));
  expect(startsBeforeMount).toEqual([0]);
  expect(animations).toHaveLength(1);
  await act(() => latestAnimation().finish());
  await act(() => tree.update(render(false)));
  await act(() => latestAnimation().finish());
  resetAnimations();
  await act(() => tree.update(render(true)));
  expect(startsBeforeMount).toEqual([0, 0]);
  expect(animations).toHaveLength(1);
});

test("system reduced motion interrupts a transition and closes rows immediately", async () => {
  const render = (open: boolean) => (
    <FolderDisclosure open={open}>
      <span>row</span>
    </FolderDisclosure>
  );
  const tree = await mount(render(false));
  await act(() => tree.update(render(true)));
  const entering = latestAnimation();
  await act(() => setReduceMotion(true));
  expect(entering.stopped).toBe(true);
  expect(progress(tree).value).toBe(1);
  await act(() => tree.update(render(false)));
  expect(tree.toJSON()).toBeNull();
});

test("enabling reduced motion during exit settles immediately and rejects the old completion", async () => {
  const render = (open: boolean, reducedMotion: boolean) => (
    <FolderDisclosure open={open} reducedMotion={reducedMotion}>
      <span>row</span>
    </FolderDisclosure>
  );
  const tree = await mount(render(true, false));
  await act(() => tree.update(render(false, false)));
  const exit = latestAnimation();
  await act(() => tree.update(render(false, true)));
  expect(exit.stopped).toBe(true);
  expect(tree.toJSON()).toBeNull();
  await act(() => tree.update(render(true, true)));
  await act(() => exit.callback?.({ finished: true }));
  expect(tree.root.findByType("span").children).toEqual(["row"]);
  expect(progress(tree).value).toBe(1);
});

test("updating open rows does not restart entrance or schedule another layout commit", async () => {
  let commits = 0;
  const render = (text: string) => (
    <Profiler id="folder" onRender={() => commits++}>
      <FolderDisclosure open reducedMotion={false}>
        <span>{text}</span>
      </FolderDisclosure>
    </Profiler>
  );
  const tree = await mount(render("first"));
  const entrance = latestAnimation();
  commits = 0;
  await act(() => tree.update(render("updated")));
  expect(commits).toBe(1);
  expect(latestAnimation()).toBe(entrance);
  expect(tree.root.findByType("span").children).toEqual(["updated"]);
});

test("unmount invalidates pending native callbacks", async () => {
  const tree = await mount(
    <FolderDisclosure open reducedMotion={false}>
      <span>row</span>
    </FolderDisclosure>
  );
  await act(() =>
    tree.update(
      <FolderDisclosure open={false} reducedMotion={false}>
        {null}
      </FolderDisclosure>
    )
  );
  const exit = latestAnimation();
  await act(() => tree.unmount());
  expect(exit.stopped).toBe(true);
  await act(() => exit.callback?.({ finished: true }));
  expect(tree.toJSON()).toBeNull();
});
