import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import React, { Profiler } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  animations,
  latestAnimation,
  resetAnimations,
  setReduceMotion,
  TestValue,
} from "./chromeTestHarness";

const { Overlay } = await import("../src/chrome/Overlay");
const trees: ReactTestRenderer[] = [];
const mount = async (element: React.ReactElement) => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  trees.push(tree);
  return tree;
};
const overlayProps = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.type === ("View" as React.ElementType) &&
      Array.isArray(node.props.style) &&
      node.props.style.some(
        (style: { opacity?: unknown } | undefined) =>
          style?.opacity instanceof TestValue
      )
  ).props;
const values = (tree: ReactTestRenderer) => {
  const style = overlayProps(tree).style.at(-1);
  return {
    opacity: style.opacity as TestValue,
    offset: style.transform[0].translateY as TestValue,
    scale: style.transform[1].scale as TestValue,
  };
};
beforeEach(() => {
  resetAnimations();
  setReduceMotion(false);
});
afterEach(async () => {
  await act(() => trees.splice(0).forEach((tree) => tree.unmount()));
});

test("changing open overlay content does not cause an extra React commit or restart entrance", async () => {
  let commits = 0;
  const content = (text: string) => (
    <Profiler id="overlay" onRender={() => commits++}>
      <Overlay open reducedMotion={false}>
        <span>{text}</span>
      </Overlay>
    </Profiler>
  );
  const tree = await mount(content("first"));
  const entrance = latestAnimation();
  commits = 0;
  await act(() => tree.update(content("latest")));
  expect(commits).toBe(1);
  expect(latestAnimation()).toBe(entrance);
  expect(tree.root.findByType("span").children).toEqual(["latest"]);
});

test("exit freezes the latest committed content and completes exactly once with the latest callback", async () => {
  const stale = mock(() => {});
  const latest = mock(() => {});
  const tree = await mount(
    <Overlay open reducedMotion={false}>
      <span>first</span>
    </Overlay>
  );
  await act(() =>
    tree.update(
      <Overlay open reducedMotion={false}>
        <span>latest</span>
      </Overlay>
    )
  );
  await act(() =>
    tree.update(
      <Overlay open={false} reducedMotion={false} onExited={stale}>
        {null}
      </Overlay>
    )
  );
  expect(tree.root.findByType("span").children).toEqual(["latest"]);
  const exit = latestAnimation();
  await act(() =>
    tree.update(
      <Overlay open={false} reducedMotion={false} onExited={latest}>
        {null}
      </Overlay>
    )
  );
  await act(() => exit.finish());
  await act(() => exit.callback?.({ finished: true }));
  expect(tree.toJSON()).toBeNull();
  expect(stale).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledTimes(1);
});

test("rapid reopen continues from the visible pose and ignores the cancelled exit callback", async () => {
  const onExited = mock(() => {});
  const render = (open: boolean) => (
    <Overlay
      open={open}
      pop
      lift={16}
      reducedMotion={false}
      onExited={onExited}
    >
      {open && <span>current</span>}
    </Overlay>
  );
  const tree = await mount(render(true));
  await act(() => latestAnimation().finish());
  await act(() => tree.update(render(false)));
  const exit = latestAnimation();
  const pose = values(tree);
  pose.opacity.setValue(0.6);
  pose.scale.setValue(0.985);
  pose.offset.setValue(4);
  await act(() => tree.update(render(true)));
  expect(pose.opacity.value).toBe(0.6);
  expect(pose.scale.value).toBe(0.985);
  expect(pose.offset.value).toBe(4);
  await act(() => exit.callback?.({ finished: true }));
  expect(tree.root.findByType("span").children).toEqual(["current"]);
  expect(onExited).not.toHaveBeenCalled();
  await act(() => latestAnimation().finish());
  expect(pose.opacity.value).toBe(1);
  expect(pose.scale.value).toBe(1);
  expect(pose.offset.value).toBe(0);
});

test("unmount cancels exit without reporting completion, including a late native callback", async () => {
  const onExited = mock(() => {});
  const tree = await mount(
    <Overlay open reducedMotion={false} onExited={onExited}>
      <span>content</span>
    </Overlay>
  );
  await act(() =>
    tree.update(
      <Overlay open={false} reducedMotion={false} onExited={onExited}>
        {null}
      </Overlay>
    )
  );
  const exit = latestAnimation();
  await act(() => tree.unmount());
  expect(exit.stopped).toBe(true);
  await act(() => exit.callback?.({ finished: true }));
  expect(onExited).not.toHaveBeenCalled();
});

test("changing pop and lift during exit retargets the pose without a jump", async () => {
  const onExited = mock(() => {});
  const tree = await mount(
    <Overlay open pop lift={16} reducedMotion={false}>
      <span>content</span>
    </Overlay>
  );
  await act(() => latestAnimation().finish());
  await act(() =>
    tree.update(
      <Overlay
        open={false}
        pop
        lift={16}
        reducedMotion={false}
        onExited={onExited}
      >
        {null}
      </Overlay>
    )
  );
  const oldExit = latestAnimation();
  const pose = values(tree);
  pose.opacity.setValue(0.7);
  pose.scale.setValue(0.99);
  pose.offset.setValue(3);
  await act(() =>
    tree.update(
      <Overlay
        open={false}
        lift={-12}
        reducedMotion={false}
        onExited={onExited}
      >
        {null}
      </Overlay>
    )
  );
  expect(pose.opacity.value).toBe(0.7);
  expect(pose.scale.value).toBe(0.99);
  expect(pose.offset.value).toBe(3);
  await act(() => latestAnimation().finish());
  expect(pose.scale.value).toBe(1);
  expect(pose.offset.value).toBe(-6);
  await act(() => oldExit.callback?.({ finished: true }));
  expect(onExited).toHaveBeenCalledTimes(1);
});

test("turning reduced motion off on an open overlay keeps the settled pose", async () => {
  const tree = await mount(
    <Overlay open pop lift={16} reducedMotion>
      <span>content</span>
    </Overlay>
  );
  const pose = values(tree);
  expect(pose.opacity.value).toBe(1);
  expect(pose.scale.value).toBe(1);
  expect(pose.offset.value).toBe(0);
  await act(() =>
    tree.update(
      <Overlay open pop lift={16} reducedMotion={false}>
        <span>content</span>
      </Overlay>
    )
  );
  expect(pose.opacity.value).toBe(1);
  expect(pose.scale.value).toBe(1);
  expect(pose.offset.value).toBe(0);
});

test("enabling reduced motion during exit completes immediately and invalidates the old callback", async () => {
  const onExited = mock(() => {});
  const tree = await mount(
    <Overlay open pop reducedMotion={false}>
      <span>content</span>
    </Overlay>
  );
  await act(() =>
    tree.update(
      <Overlay open={false} pop reducedMotion={false} onExited={onExited}>
        {null}
      </Overlay>
    )
  );
  const exit = latestAnimation();
  await act(() =>
    tree.update(
      <Overlay open={false} pop reducedMotion onExited={onExited}>
        {null}
      </Overlay>
    )
  );
  expect(tree.toJSON()).toBeNull();
  expect(onExited).toHaveBeenCalledTimes(1);
  await act(() => exit.callback?.({ finished: true }));
  expect(onExited).toHaveBeenCalledTimes(1);
});

test("omitted reduced motion follows the system preference during a transition", async () => {
  const onExited = mock(() => {});
  const tree = await mount(
    <Overlay open pop lift={16}>
      <span>content</span>
    </Overlay>
  );
  const pose = values(tree);
  await act(() => setReduceMotion(true));
  expect(pose.opacity.value).toBe(1);
  expect(pose.scale.value).toBe(1);
  expect(pose.offset.value).toBe(0);
  await act(() =>
    tree.update(
      <Overlay open={false} pop lift={16} onExited={onExited}>
        {null}
      </Overlay>
    )
  );
  expect(tree.toJSON()).toBeNull();
  expect(onExited).toHaveBeenCalledTimes(1);
});

test("an initially closed overlay has no content, animation, or exit notification", async () => {
  const onExited = mock(() => {});
  const tree = await mount(
    <Overlay open={false} pop reducedMotion={false} onExited={onExited}>
      <span>hidden</span>
    </Overlay>
  );
  await act(() =>
    tree.update(
      <Overlay open={false} lift={10} reducedMotion onExited={onExited}>
        {null}
      </Overlay>
    )
  );
  expect(tree.toJSON()).toBeNull();
  expect(animations).toHaveLength(0);
  expect(onExited).not.toHaveBeenCalled();
});

test("fresh presentations use a subtle pop and reset after a completed exit", async () => {
  const render = (open: boolean) => (
    <Overlay open={open} pop lift={16} reducedMotion={false}>
      <span>content</span>
    </Overlay>
  );
  const tree = await mount(render(true));
  const pose = values(tree);
  expect(pose.opacity.value).toBe(0);
  expect(pose.scale.value).toBeGreaterThanOrEqual(0.96);
  expect(pose.scale.value).toBeLessThan(1);
  expect(pose.offset.value).toBe(16);
  await act(() => latestAnimation().finish());
  await act(() => tree.update(render(false)));
  await act(() => latestAnimation().finish());
  expect(tree.toJSON()).toBeNull();
  await act(() => tree.update(render(true)));
  expect(pose.opacity.value).toBe(0);
  expect(pose.scale.value).toBeGreaterThanOrEqual(0.96);
  expect(pose.scale.value).toBeLessThan(1);
  expect(pose.offset.value).toBe(16);
});

test("opening and reopening mount the animated subtree before starting the native animation", async () => {
  const startsBeforeMount: number[] = [];
  function Content() {
    React.useLayoutEffect(() => {
      startsBeforeMount.push(animations.length);
    }, []);
    return <span>content</span>;
  }
  const render = (open: boolean) => (
    <Overlay open={open} pop reducedMotion={false}>
      <Content />
    </Overlay>
  );
  const tree = await mount(render(false));
  expect(startsBeforeMount).toEqual([]);
  await act(() => tree.update(render(true)));
  expect(startsBeforeMount).toEqual([0]);
  expect(animations).toHaveLength(4);
  await act(() => latestAnimation().finish());
  await act(() => tree.update(render(false)));
  await act(() => latestAnimation().finish());
  resetAnimations();
  await act(() => tree.update(render(true)));
  expect(startsBeforeMount).toEqual([0, 0]);
  expect(animations).toHaveLength(4);
});

test("an exiting overlay blocks its frozen controls and hides them from accessibility", async () => {
  const tree = await mount(
    <Overlay open pop reducedMotion={false}>
      <span>action</span>
    </Overlay>
  );
  expect(overlayProps(tree).pointerEvents).toBe("auto");
  await act(() =>
    tree.update(
      <Overlay open={false} pop reducedMotion={false}>
        {null}
      </Overlay>
    )
  );
  const props = overlayProps(tree);
  expect(props.pointerEvents).toBe("box-only");
  expect(props.onStartShouldSetResponder()).toBe(true);
  expect(props.accessibilityElementsHidden).toBe(true);
  expect(props.importantForAccessibility).toBe("no-hide-descendants");
});

test("touch-through notices keep the page interactive and disable frozen content during exit", async () => {
  const tree = await mount(
    <Overlay open touchThrough reducedMotion={false}>
      <span>notice</span>
    </Overlay>
  );
  expect(overlayProps(tree).pointerEvents).toBe("box-none");
  await act(() =>
    tree.update(
      <Overlay open={false} touchThrough reducedMotion={false}>
        {null}
      </Overlay>
    )
  );
  expect(overlayProps(tree).pointerEvents).toBe("none");
  expect(overlayProps(tree).onStartShouldSetResponder).toBeUndefined();
  expect(overlayProps(tree).importantForAccessibility).toBe(
    "no-hide-descendants"
  );
});

test("closing a transformed overlay shields the full parent until the visual exit completes", async () => {
  const tree = await mount(
    <Overlay open pop lift={16} reducedMotion={false} style={{ zIndex: 30 }}>
      <span>action</span>
    </Overlay>
  );
  await act(() =>
    tree.update(
      <Overlay
        open={false}
        pop
        lift={16}
        reducedMotion={false}
        style={{ zIndex: 30 }}
      >
        {null}
      </Overlay>
    )
  );
  // The moving content's hit area can shrink or slide away from the edges.
  // A separate, untransformed surface must still receive those touches.
  const guard = tree.root
    .findAllByType("View" as React.ElementType)
    .find(
      (node) =>
        node.props.pointerEvents === "box-only" &&
        node.props.style?.some(
          (style: { position?: string }) => style?.position === "absolute"
        )
    );
  expect(guard).toBeDefined();
  const style = Object.assign({}, ...guard!.props.style);
  expect(style).toMatchObject({
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 30,
  });
  expect(style.transform).toBeUndefined();
  expect(guard!.props.onStartShouldSetResponder()).toBe(true);
  expect(guard!.props.importantForAccessibility).toBe("no-hide-descendants");
  await act(() => latestAnimation().finish());
  expect(tree.toJSON()).toBeNull();
});
