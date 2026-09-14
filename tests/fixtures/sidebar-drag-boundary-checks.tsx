import { afterEach, expect, mock, test } from "bun:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import "../chromeTestHarness";
const { SidebarLayer } = await import("../../src/chrome/SidebarInteraction");
const { DragSource } = await import("../../src/chrome/DragSource");

const trees: ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => trees.splice(0).forEach((t) => t.unmount()));
});
const touch = (identifier: number, x = 10) => ({
  nativeEvent: {
    identifier,
    timestamp: identifier * 1000,
    pageX: x,
    pageY: 10,
    touches: [{ identifier }],
    changedTouches: [{ identifier }],
  },
});
const pointer = (pointerId: number) => ({
  nativeEvent: {
    pointerId,
    pointerType: "touch",
    button: 0,
    buttons: 1,
    pageX: 10,
    pageY: 10,
  },
});
async function setup(scoped = true) {
  const cb = {
    onPress: mock(() => {}),
    onLongPress: mock(() => {}),
    onDragStart: mock(() => {}),
    onDragMove: mock(() => {}),
    onDragRelease: mock(() => {}),
    onDragCancel: mock(() => {}),
  };
  const body = (
    <DragSource accessibilityLabel="source" {...cb}>
      <></>
    </DragSource>
  );
  const node = (active: boolean) =>
    scoped ? (
      <SidebarLayer visible active={active}>
        {body}
      </SidebarLayer>
    ) : (
      body
    );
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(node(true));
  });
  trees.push(tree);
  const handlers = () =>
    tree.root.findAllByProps({ accessibilityLabel: "source" }).at(-1)!.props;
  const update = (active: boolean) =>
    act(async () => tree.update(node(active)));
  return { cb, handlers, update };
}
const hold = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 265)));

test("unscoped touchStart followed by the same ACTION_DOWN pointerDown still arms a long hold", async () => {
  const d = await setup(false);
  await act(async () => {
    d.handlers().onTouchStart(touch(1));
    d.handlers().onPointerDown(pointer(1));
  });
  await hold();
  await act(async () => d.handlers().onTouchEnd(touch(1)));
  expect(d.cb.onLongPress).toHaveBeenCalledTimes(1);
  expect(d.cb.onPress).not.toHaveBeenCalled();
});

for (const stale of [
  "onPanResponderRelease",
  "onPanResponderTerminate",
  "onTouchCancel",
] as const) {
  test(`old ${stale} after hide/show must not finish or cancel a new gesture`, async () => {
    const d = await setup();
    const old = d.handlers();
    await act(async () => old.onTouchStart(touch(1)));
    await hold();
    await act(async () => {
      old.onTouchMove(touch(1, 40));
      old.onPanResponderGrant(touch(1, 40));
    });
    expect(d.cb.onDragStart).toHaveBeenCalledTimes(1);
    await d.update(false);
    expect(d.cb.onDragCancel).toHaveBeenCalledTimes(1);
    await d.update(true);
    await act(async () => d.handlers().onTouchStart(touch(2)));
    await hold();
    await act(async () => d.handlers().onTouchMove(touch(2, 50)));
    expect(d.cb.onDragStart).toHaveBeenCalledTimes(2);
    await act(async () => old[stale](touch(1, 40)));
    expect(d.cb.onDragRelease).not.toHaveBeenCalled();
    expect(d.cb.onDragCancel).toHaveBeenCalledTimes(1);
    await act(async () => {
      d.handlers().onPanResponderGrant(touch(2, 50));
      d.handlers().onPanResponderRelease(touch(2, 50));
    });
    expect(d.cb.onDragRelease).toHaveBeenCalledTimes(1);
  });
}

for (const stale of [
  "onPanResponderRelease",
  "onPanResponderTerminate",
  "onTouchCancel",
] as const) {
  test(`latest ${stale} rejects an old contact event after a fresh gesture`, async () => {
    const d = await setup();
    await act(async () => d.handlers().onTouchStart(touch(1)));
    await hold();
    await act(async () => d.handlers().onTouchMove(touch(1, 40)));
    await d.update(false);
    await d.update(true);
    await act(async () => d.handlers().onTouchStart(touch(2)));
    await hold();
    await act(async () => d.handlers().onTouchMove(touch(2, 50)));
    await act(async () => d.handlers()[stale](touch(1, 40)));
    expect(d.cb.onDragRelease).not.toHaveBeenCalled();
    expect(d.cb.onDragCancel).toHaveBeenCalledTimes(1);
    await act(async () => d.handlers().onPanResponderRelease(touch(2, 50)));
    expect(d.cb.onDragRelease).toHaveBeenCalledTimes(1);
  });
}

// Android PointerEvent exposes native timestamp, and its pointerId is the
// MotionEvent pointer ID: consecutive mouse gestures can reuse the same ID.
const mouse = (timestamp: number, x: number, buttons = 1) => ({
  nativeEvent: {
    pointerType: "mouse",
    pointerId: 0,
    timestamp,
    button: 0,
    buttons,
    pageX: x,
    pageY: 10,
  },
});
for (const terminal of ["onPointerUp", "onPointerCancel"] as const) {
  test(`latest ${terminal} rejects an old timestamp even when Android reuses mouse pointerId`, async () => {
    const cb = {
      onPress: mock(() => {}),
      onDragStart: mock(() => {}),
      onDragMove: mock(() => {}),
      onDragRelease: mock(() => {}),
      onDragCancel: mock(() => {}),
    };
    const body = (
      <DragSource accessibilityLabel="mouse" {...cb}>
        <></>
      </DragSource>
    );
    const node = (active: boolean) => (
      <SidebarLayer visible active={active}>
        {body}
      </SidebarLayer>
    );
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(node(true));
    });
    trees.push(tree);
    const h = () =>
      tree.root.findAllByProps({ accessibilityLabel: "mouse" }).at(-1)!.props;
    await act(async () => {
      h().onPointerDown(mouse(1000, 10));
      h().onPointerMove(mouse(1100, 40));
    });
    await act(async () => tree.update(node(false)));
    expect(cb.onDragCancel).toHaveBeenCalledTimes(1);
    await act(async () => tree.update(node(true)));
    await act(async () => {
      h().onPointerDown(mouse(2000, 10));
      h().onPointerMove(mouse(2100, 50));
    });
    expect(cb.onDragStart).toHaveBeenCalledTimes(2);
    await act(async () => h()[terminal](mouse(1200, 40, 0)));
    expect(cb.onDragRelease).not.toHaveBeenCalled();
    expect(cb.onDragCancel).toHaveBeenCalledTimes(1);
    await act(async () => h().onPointerUp(mouse(2200, 50, 0)));
    expect(cb.onDragRelease).toHaveBeenCalledTimes(1);
  });
}
