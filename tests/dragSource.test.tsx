import { afterEach, expect, mock, test } from "bun:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { GestureResponderEvent } from "react-native";
import {
  animations,
  latestAnimation,
  resetAnimations,
  setReduceMotion,
  type TestValue,
} from "./chromeTestHarness";
const { DragSource } = await import("../src/chrome/DragSource");
const mounted = new Set<ReactTestRenderer>();
afterEach(async () => {
  await act(async () => {
    mounted.forEach((tree) => tree.unmount());
    mounted.clear();
  });
  resetAnimations();
  setReduceMotion(false);
});
const event = (x = 10, count = 1) =>
  ({
    nativeEvent: {
      pageX: x,
      pageY: 10,
      touches: Array.from({ length: count }, () => ({})),
    },
  } as unknown as GestureResponderEvent);
const mouseEvent = (x = 10, button = 0, buttons = 1) =>
  ({
    nativeEvent: { pageX: x, pageY: 10, pointerType: "mouse", button, buttons },
  } as unknown as GestureResponderEvent);
async function setup() {
  const callbacks = {
    onPress: mock(() => {}),
    onLongPress: mock(() => {}),
    onDragStart: mock(() => {}),
    onDragMove: mock(() => {}),
    onDragRelease: mock(() => {}),
    onDragCancel: mock(() => {}),
  };
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(
      <DragSource accessibilityLabel="Test tab" {...callbacks}>
        <></>
      </DragSource>
    );
  });
  mounted.add(tree!);
  const view = () => tree!.root.findByType("View" as React.ElementType);
  const send = async (name: string, value = event()) => {
    await act(() => view().props[name](value));
  };
  const hold = async () => {
    await send("onTouchStart");
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 270)));
  };
  const close = async () => {
    await act(async () => tree!.unmount());
    mounted.delete(tree!);
    resetAnimations();
    setReduceMotion(false);
  };
  return { ...callbacks, send, hold, close, view };
}
test("short tap activates; scroll before hold does not activate or arm", async () => {
  const g = await setup();
  await g.send("onTouchStart");
  await g.send("onTouchEnd", event(10, 0));
  expect(g.onPress).toHaveBeenCalledTimes(1);
  await g.send("onTouchStart");
  await g.send("onTouchMove", event(40));
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 270)));
  await g.send("onTouchEnd", event(40, 0));
  expect(g.onPress).toHaveBeenCalledTimes(1);
  expect(g.onDragStart).not.toHaveBeenCalled();
  await g.close();
});
test("holding still without movement opens the long-press action", async () => {
  const g = await setup();
  await g.hold();
  await g.send("onTouchEnd", event(10, 0));
  expect(g.onLongPress).toHaveBeenCalledTimes(1);
  expect(g.onDragStart).not.toHaveBeenCalled();
  expect(g.onDragCancel).not.toHaveBeenCalled();
  expect(g.onDragRelease).not.toHaveBeenCalled();
  expect(g.onPress).not.toHaveBeenCalled();
  await g.close();
});
test("holding then moving drags; release drops; second finger stays silent", async () => {
  const g = await setup();
  await g.hold();
  await g.send("onTouchMove", event(40));
  expect(g.onDragStart).toHaveBeenCalledTimes(1);
  await g.send("onPanResponderGrant");
  await g.send("onPanResponderMove", event(60));
  await g.send("onTouchEnd", event(60, 0));
  await g.send("onPanResponderRelease", event(60, 0));
  expect(g.onDragRelease).toHaveBeenCalledTimes(1);
  expect(g.onDragCancel).not.toHaveBeenCalled();
  await g.hold();
  await g.send("onTouchStart", event(10, 2));
  await g.send("onTouchEnd", event(10, 0));
  expect(g.onPress).not.toHaveBeenCalled();
  expect(g.onLongPress).not.toHaveBeenCalled();
  expect(g.onDragCancel).not.toHaveBeenCalled();
  await g.close();
});
test("unmount while dragging cancels the drop", async () => {
  const g = await setup();
  await g.hold();
  await g.send("onPanResponderGrant");
  await g.send("onPanResponderMove", event(40));
  await g.close();
  expect(g.onDragCancel).toHaveBeenCalledTimes(1);
  expect(g.onDragRelease).not.toHaveBeenCalled();
});
test("touch-end before responder release preserves the drop", async () => {
  const g = await setup();
  await g.hold();
  await g.send("onPanResponderGrant");
  await g.send("onPanResponderMove", event(40));
  await g.send("onTouchEnd", event(40, 0));
  await g.send("onPanResponderRelease", event(40, 0));
  expect(g.onDragRelease).toHaveBeenCalledTimes(1);
  expect(g.onDragCancel).not.toHaveBeenCalled();
  expect(g.onPress).not.toHaveBeenCalled();
  await g.close();
});
test("right click opens the source menu without activating the tab", async () => {
  const g = await setup();
  await g.send("onPointerDown", mouseEvent(30, 2, 2));
  await g.send("onPointerUp", mouseEvent(30, 2, 0));
  expect(g.onLongPress).toHaveBeenCalledWith(30, 10);
  expect(g.onPress).not.toHaveBeenCalled();
  await g.close();
});
test("mouse drag starts without a touch hold and releases only once", async () => {
  const g = await setup();
  await g.send("onPointerDown", mouseEvent(10));
  await g.send("onPointerMove", mouseEvent(25));
  expect(g.onDragStart).toHaveBeenCalledTimes(1);
  await g.send("onPointerUp", mouseEvent(40, 0, 0));
  await g.send("onTouchEnd", event(40, 0));
  await g.send("onPanResponderRelease", event(40, 0));
  expect(g.onDragRelease).toHaveBeenCalledTimes(1);
  expect(g.onDragCancel).not.toHaveBeenCalled();
  expect(g.onPress).not.toHaveBeenCalled();
  await g.close();
});

test("scroll cancellation restores the pressed source immediately without waiting for touch end", async () => {
  const g = await setup();
  await g.send("onTouchStart");
  await act(() => latestAnimation().finish());
  await g.send("onTouchMove", event(40));
  const feedback = g.view().props.style.at(-1);
  expect((feedback.opacity as TestValue).value).toBe(1);
  const scale = feedback.transform?.[0]?.scale as TestValue | undefined;
  expect(scale?.value).toBe(1);
  await g.send("onTouchEnd", event(40, 0));
  expect(g.onPress).not.toHaveBeenCalled();
  await g.close();
});

test("press feedback stops and resets when the OS enables reduced motion while pressed", async () => {
  const g = await setup();
  await g.send("onTouchStart");
  const pressing = latestAnimation();
  await act(() => pressing.finish());
  await act(() => setReduceMotion(true));
  const feedback = g.view().props.style.at(-1);
  expect(pressing.stopped).toBe(true);
  expect((feedback.opacity as TestValue).value).toBe(1);
  expect((feedback.transform?.[0]?.scale as TestValue | undefined)?.value).toBe(
    1
  );
  resetAnimations();
  await g.send("onTouchEnd", event(10, 0));
  expect(animations).toHaveLength(0);
  expect(g.onPress).toHaveBeenCalledTimes(1);
  await g.close();
});

test("omitting the prop honors the OS preference and unmount stops active feedback", async () => {
  setReduceMotion(true);
  const quiet = await setup();
  await quiet.send("onTouchStart");
  expect(animations).toHaveLength(0);
  await quiet.close();
  const active = await setup();
  await active.send("onPointerDown", mouseEvent());
  const pressing = latestAnimation();
  await active.close();
  expect(pressing.stopped).toBe(true);
});

async function setupRetainedRows(count: number) {
  const { SidebarLayer } = await import("../src/chrome/SidebarInteraction");
  const callbacks = {
    onPress: mock(() => {}),
    onDragStart: mock(() => {}),
    onDragMove: mock(() => {}),
    onDragRelease: mock(() => {}),
    onDragCancel: mock(() => {}),
  };
  const children = Array.from({ length: count }, (_, index) => (
    <DragSource key={index} accessibilityLabel={`Row ${index}`} {...callbacks}>
      <></>
    </DragSource>
  ));
  const node = (active: boolean) => (
    <SidebarLayer visible active={active}>
      {children}
    </SidebarLayer>
  );
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(node(true));
  });
  mounted.add(tree);
  const row = (index: number) =>
    tree.root
      .findAllByProps({
        accessibilityLabel: `Row ${index}`,
      })
      .at(-1)!;
  const feedback = (index: number) => {
    const style = row(index).props.style.at(-1);
    return [style.opacity, style.transform[0].scale] as TestValue[];
  };
  const values = Array.from({ length: count }, (_, index) => feedback(index));
  // Count calls crossing into Animated.Value while keeping their state effects.
  const writes: number[][] = values.flat().map((value) => {
    const calls: number[] = [];
    const original = value.setValue.bind(value);
    value.setValue = (next) => {
      calls.push(next);
      original(next);
    };
    return calls;
  });
  return {
    values,
    writes,
    update: (active: boolean) => act(async () => tree.update(node(active))),
    send: (index: number, name: string) =>
      act(async () => row(index).props[name](event())),
    close: async () => {
      await act(async () => tree.unmount());
      mounted.delete(tree);
    },
  };
}

test("hiding and unmounting 100 untouched retained rows sends no redundant Animated.Value writes", async () => {
  const rows = await setupRetainedRows(100);
  await rows.update(false);
  expect(rows.writes.flat()).toHaveLength(0);
  await rows.update(true);
  await rows.update(false);
  await rows.close();
  expect(rows.writes.flat()).toHaveLength(0);
  expect(rows.values.flat().every((value) => value.value === 1)).toBe(true);
});

test("hiding resets only the touched row, once, and a later press still resets under reduced motion", async () => {
  const rows = await setupRetainedRows(4);
  await rows.send(2, "onTouchStart");
  const firstPress = latestAnimation();
  await act(() => firstPress.finish());
  expect(rows.values[2][0].value).toBeLessThan(1);
  expect(rows.values[2][1].value).toBeLessThan(1);
  rows.writes.forEach((calls) => {
    calls.length = 0;
  });
  await rows.update(false);
  expect(firstPress.stopped).toBe(true);
  expect(rows.values[2].map((value) => value.value)).toEqual([1, 1]);
  expect(rows.writes).toEqual([[], [], [], [], [1], [1], [], []]);
  await rows.update(true);
  await rows.update(false);
  expect(rows.writes).toEqual([[], [], [], [], [1], [1], [], []]);
  await rows.update(true);
  await rows.send(2, "onTouchStart");
  const secondPress = latestAnimation();
  await act(() => secondPress.finish());
  rows.writes.forEach((calls) => {
    calls.length = 0;
  });
  await act(() => setReduceMotion(true));
  expect(secondPress.stopped).toBe(true);
  expect(rows.values[2].map((value) => value.value)).toEqual([1, 1]);
  expect(rows.writes).toEqual([[], [], [], [], [1], [1], [], []]);
  await rows.close();
  expect(rows.writes).toEqual([[], [], [], [], [1], [1], [], []]);
});

test("unmounting a touched retained row stops feedback and restores both values", async () => {
  const rows = await setupRetainedRows(1);
  await rows.send(0, "onTouchStart");
  const pressing = latestAnimation();
  await act(() => pressing.finish());
  rows.writes.forEach((calls) => {
    calls.length = 0;
  });
  await rows.close();
  expect(pressing.stopped).toBe(true);
  expect(rows.values[0].map((value) => value.value)).toEqual([1, 1]);
  expect(rows.writes).toEqual([[1], [1]]);
});
