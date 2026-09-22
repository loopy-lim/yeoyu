import { afterEach, expect, mock, test } from "bun:test";
import React, { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { latestAnimation, resetAnimations } from "../chromeTestHarness";
import { FrameCoalescer } from "../../src/chrome/FrameCoalescer";
const native = await import("react-native");
const { Pressable } = require("./loadNativePressable.cjs");
mock.module("react-native", () => ({ ...native, Pressable }));
const { SidebarLayer, SidebarPressable, useSidebarActive } = await import(
  "../../src/chrome/SidebarInteraction"
);
const { DragSource } = await import("../../src/chrome/DragSource");
const { ContextPressable } = await import("../../src/chrome/ContextPressable");
const trees = new Set<ReactTestRenderer>();
afterEach(async () => {
  await act(async () => {
    trees.forEach((t) => t.unmount());
    trees.clear();
  });
  resetAnimations();
});
async function mount(node: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(node);
  });
  trees.add(tree);
  return tree;
}
const pause = () => act(() => new Promise<void>((r) => setTimeout(r, 65)));
const touch = () => ({
  persist() {},
  currentTarget: 1,
  target: 1,
  nativeEvent: { pageX: 10, pageY: 10, touches: [{}] },
});
const click = () => ({
  currentTarget: 1,
  target: 1,
  nativeEvent: {},
  stopPropagation() {},
});
const view = (t: ReactTestRenderer, id: string) =>
  t.root.findAllByProps({ testID: id }).at(-1)!;
const layer = (
  active: boolean,
  children: React.ReactNode,
  visible = active
) => (
  <SidebarLayer visible={visible} active={active}>
    {children}
  </SidebarLayer>
);

test("cold-hidden heavy content is lazy; warm show preserves heavy rows and resets only the button on hide", async () => {
  const mounts = { heavy: 0, button: 0 };
  function Heavy() {
    const [id] = useState(() => ++mounts.heavy);
    return React.createElement("View", { testID: "heavy", id });
  }
  function ButtonContent() {
    const [id] = useState(() => ++mounts.button);
    return React.createElement("View", { testID: "button-content", id });
  }
  const body = (
    <>
      <Heavy />
      <SidebarPressable>
        <ButtonContent />
      </SidebarPressable>
    </>
  );
  const tree = await mount(layer(false, body));
  expect(mounts).toEqual({ heavy: 0, button: 0 });
  await act(async () => tree.update(layer(true, body)));
  expect(mounts).toEqual({ heavy: 1, button: 1 });
  await act(async () => tree.update(layer(false, body)));
  expect(mounts).toEqual({ heavy: 1, button: 2 });
  await act(async () => tree.update(layer(true, body)));
  expect(mounts).toEqual({ heavy: 1, button: 2 });
});

test("inactive outgoing fade keeps its children but actual RN pending long-press is cancelled", async () => {
  const long = mock(() => {});
  const body = (
    <SidebarPressable testID="press" delayLongPress={20} onLongPress={long} />
  );
  const tree = await mount(layer(true, body, true));
  await act(async () => view(tree, "press").props.onResponderGrant(touch()));
  await act(async () => tree.update(layer(false, body, true)));
  expect(view(tree, "press")).toBeDefined();
  await pause();
  expect(long).not.toHaveBeenCalled();
});

test("rapid show cancels old delayed activation but fresh gesture and accessibility click still work", async () => {
  const press = mock(() => {}),
    long = mock(() => {});
  const body = (
    <SidebarPressable
      testID="press"
      unstable_pressDelay={20}
      delayLongPress={20}
      onPress={press}
      onLongPress={long}
    />
  );
  const tree = await mount(layer(true, body, true));
  const old = view(tree, "press").props;
  await act(async () => old.onResponderGrant(touch()));
  await act(async () => tree.update(layer(false, body, true)));
  await act(async () => tree.update(layer(true, body, true)));
  await pause();
  expect(long).not.toHaveBeenCalled();
  await act(async () => old.onResponderRelease(touch()));
  expect(press).not.toHaveBeenCalled();
  await act(async () => view(tree, "press").props.onClick(click()));
  expect(press).toHaveBeenCalledTimes(1);
  await act(async () => view(tree, "press").props.onResponderGrant(touch()));
  await pause();
  expect(long).toHaveBeenCalledTimes(1);
});

test("pressed style and children clear while inactive; non-pointer click is denied only there", async () => {
  const press = mock(() => {});
  const body = (
    <SidebarPressable
      testID="press"
      onPress={press}
      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
    >
      {({ pressed }) =>
        React.createElement("View", { testID: "pressed-child", pressed })
      }
    </SidebarPressable>
  );
  const tree = await mount(layer(true, body, true));
  await act(async () => view(tree, "press").props.onResponderGrant(touch()));
  expect(view(tree, "pressed-child").props.pressed).toBe(true);
  await act(async () => tree.update(layer(false, body, true)));
  expect(view(tree, "pressed-child").props.pressed).toBe(false);
  expect(view(tree, "press").props.style.opacity).toBe(1);
  await act(async () => view(tree, "press").props.onClick(click()));
  expect(press).not.toHaveBeenCalled();
});

const mouse = (x: number, buttons = 1) => ({
  nativeEvent: {
    pointerType: "mouse",
    button: 0,
    buttons,
    pageX: x,
    pageY: 10,
  },
});
test("retained owned drag cancels once on inactive; old release stays silent and a fresh drag works", async () => {
  const cb = {
    onPress: mock(() => {}),
    onDragStart: mock(() => {}),
    onDragMove: mock(() => {}),
    onDragRelease: mock(() => {}),
    onDragCancel: mock(() => {}),
  };
  const body = (
    <DragSource accessibilityLabel="drag" {...cb}>
      <></>
    </DragSource>
  );
  const tree = await mount(layer(true, body, true));
  const source = () =>
    tree.root.findAllByProps({ accessibilityLabel: "drag" }).at(-1)!;
  await act(async () => source().props.onPointerDown(mouse(10)));
  await act(async () => source().props.onPointerMove(mouse(30)));
  await act(async () => tree.update(layer(false, body, true)));
  expect(cb.onDragCancel).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(layer(true, body, true)));
  await act(async () => source().props.onPointerUp(mouse(30, 0)));
  expect(cb.onDragRelease).not.toHaveBeenCalled();
  await act(async () => source().props.onPointerDown(mouse(10)));
  await act(async () => source().props.onPointerMove(mouse(30)));
  await act(async () => source().props.onPointerUp(mouse(30, 0)));
  expect(cb.onDragRelease).toHaveBeenCalledTimes(1);
  expect(cb.onDragCancel).toHaveBeenCalledTimes(1);
});

test("retained hold and accessibility action cannot activate while inactive or after stale release", async () => {
  const cb = {
    onPress: mock(() => {}),
    onLongPress: mock(() => {}),
    onDragStart: mock(() => {}),
    onDragMove: mock(() => {}),
    onDragRelease: mock(() => {}),
    onDragCancel: mock(() => {}),
  };
  const body = (
    <DragSource accessibilityLabel="drag" {...cb}>
      <></>
    </DragSource>
  );
  const tree = await mount(layer(true, body, true));
  const source = () =>
    tree.root.findAllByProps({ accessibilityLabel: "drag" }).at(-1)!;
  await act(async () => source().props.onTouchStart(touch()));
  await act(async () => tree.update(layer(false, body, true)));
  await act(async () =>
    source().props.onAccessibilityAction({
      nativeEvent: { actionName: "activate" },
    })
  );
  expect(cb.onPress).not.toHaveBeenCalled();
  await act(() => new Promise<void>((r) => setTimeout(r, 270)));
  await act(async () => tree.update(layer(true, body, true)));
  await act(async () => source().props.onTouchEnd(touch()));
  expect(cb.onLongPress).not.toHaveBeenCalled();
  expect(cb.onPress).not.toHaveBeenCalled();
});

test("ContextPressGuard resets on inactive even when its existing menu remains open", async () => {
  const press = mock(() => {}),
    menu = mock(() => {});
  const body = (
    <ContextPressable
      testID="context"
      contextOpen
      onPress={press}
      onContextMenu={menu}
    />
  );
  const tree = await mount(layer(true, body, true));
  await act(async () =>
    view(tree, "context").props.onPointerDown({
      nativeEvent: { pointerType: "mouse", button: 2, pageX: 1, pageY: 1 },
    })
  );
  expect(menu).toHaveBeenCalledTimes(1);
  await act(async () => tree.update(layer(false, body, true)));
  await act(async () => tree.update(layer(true, body, true)));
  await act(async () => view(tree, "context").props.onClick(click()));
  expect(press).toHaveBeenCalledTimes(1);
});

test("actual App IconButton resets its retained scale as its sidebar becomes inactive", async () => {
  const { loadAppIconButton } = require("./loadNativePressable.cjs");
  const { motion: motionTokens } = await import("../../src/theme");
  const { easing } = await import("../../src/chrome/motion");
  const IconButton = loadAppIconButton({
    React,
    useState: React.useState,
    useEffect: React.useEffect,
    Animated: native.Animated,
    useReducedMotion: () => false,
    useSidebarActive,
    SidebarPressable,
    motionTokens,
    easing,
    useThemedStyles: () => ({ iconButton: {}, disabled: {} }),
    ChromeIcon: () => React.createElement("View"),
  });
  const body = (
    <IconButton label="icon-probe" icon="sidebar" onPress={() => {}} />
  );
  const tree = await mount(layer(true, body, true));
  const icon = tree.root
    .findAllByProps({ accessibilityLabel: "icon-probe" })
    .at(-1)!;
  await act(async () => icon.props.onResponderGrant(touch()));
  const animation = latestAnimation();
  await act(async () => animation.finish());
  expect(animation.value!.value).toBe(motionTokens.press.scale);
  await act(async () => tree.update(layer(false, body, true)));
  expect(animation.value!.value).toBe(1);
});

function dropBoundary(active: boolean) {
  const { loadAppDropHandlers } = require("./loadNativePressable.cjs");
  const callbacks: Array<(...values: number[]) => void> = [];
  const nativeRef = () => ({
    current: {
      measureInWindow: mock((cb: (...values: number[]) => void) =>
        callbacks.push(cb)
      ),
    },
  });
  const pane = { x: 300, y: 0, width: 800, height: 800 };
  const box = { x: 0, y: 0, width: 250, height: 250 };
  const bound = () => ({ current: null as null | typeof box });
  const refs = {
    panesRef: nativeRef(),
    favoritesRowRef: nativeRef(),
    tabListRef: nativeRef(),
    pinnedSectionRef: nativeRef(),
    ordinarySectionRef: nativeRef(),
  };
  const bounds = {
    favoritesRowBounds: bound(),
    tabListBounds: bound(),
    pinnedSectionBounds: bound(),
    ordinarySectionBounds: bound(),
  };
  const sidebarRowRefs = { current: new Map([["a", nativeRef().current]]) };
  const sidebarRowBounds = { current: new Map() };
  const sidebarDropActive = { current: active },
    sidebarDropEpoch = { current: 0 };
  let preview: any = { tabId: "a", zone: null, reorderIndex: null };
  const favorite = mock(() => Promise.resolve());
  const dragFrames = new FrameCoalescer<{x: number; y: number}>(() => {}, {
    request: () => 1,
    cancel: () => {},
  });
  const handlers = loadAppDropHandlers({
    dragFrames,
    useLayoutEffect: (effect: () => void) => effect(),
    ...refs,
    ...bounds,
    sidebarRowRefs,
    sidebarRowBounds,
    sidebarDropActive,
    sidebarDropEpoch,
    paneBounds: { current: pane },
    ghostPosition: { setValue() {} },
    ghostCenter: (x: number, y: number) => ({ x, y }),
    dropZoneAt: () => null,
    setDrag: (update: any) => {
      preview = typeof update === "function" ? update(preview) : update;
    },
    sidebar: { favorites: [{ id: "a" }] },
    favoriteLayouts: { current: new Map([["a", box]]) },
    favoriteDropIndex: () => 1,
    favoriteScrollOffset: { current: 0 },
    dragLifecycle: {
      release: () => ({ id: 1, value: preview }),
      finish: () => false,
    },
    state: {
      tabs: [{ id: "a", workspaceId: "w", favorite: false, pinned: false }],
      activeWorkspaceId: "w",
    },
    sidebarDropChange: () => "favorite",
    haptic() {},
    controller: { setFavorite: favorite },
    favoriteMoveIndex: () => null,
    sidebarTabMoveIndex: () => null,
    run() {},
    Animated: { parallel: () => ({ start() {} }), timing: () => ({}) },
    ghostOpacity: {},
    ghostScale: {},
    reducedMotion: true,
    motionTokens: { micro: 0 },
  });
  return {
    ...handlers,
    ...refs,
    ...bounds,
    sidebarRowRefs,
    sidebarRowBounds,
    sidebarDropActive,
    sidebarDropEpoch,
    callbacks,
    favorite,
    box,
    getPreview: () => preview,
    flushDragFrame: () => dragFrames.flush(),
  };
}

test("actual App never queries retained expanded drop refs while collapsed", () => {
  const d = dropBoundary(false);
  d.measurePanes();
  expect(d.panesRef.current.measureInWindow).toHaveBeenCalledTimes(1);
  expect(d.favoritesRowRef.current.measureInWindow).not.toHaveBeenCalled();
  expect(
    d.sidebarRowRefs.current.get("a")!.measureInWindow
  ).not.toHaveBeenCalled();
});

test("actual App accepts fresh expanded bounds but rejects callbacks crossing hide and reveal", () => {
  const d = dropBoundary(true);
  d.measurePanes();
  const old = d.callbacks.slice();
  old[1](0, 0, 250, 250);
  expect(d.favoritesRowBounds.current).toEqual(d.box);
  d.favoritesRowBounds.current = null;
  d.sidebarDropActive.current = false;
  d.sidebarDropEpoch.current++;
  d.sidebarDropActive.current = true;
  d.sidebarDropEpoch.current++;
  old[1](0, 0, 250, 250);
  old.at(-1)!(0, 0, 250, 20);
  expect(d.favoritesRowBounds.current).toBeNull();
  expect(d.sidebarRowBounds.current.size).toBe(0);
});

test("actual App rejects an older measurement batch and a replaced row owner", () => {
  const d = dropBoundary(true);
  d.measurePanes();
  const old = d.callbacks.slice();
  d.measurePanes();
  old[1](0, 0, 250, 250);
  expect(d.favoritesRowBounds.current).toBeNull();
  d.sidebarRowRefs.current.set("a", { measureInWindow: mock(() => {}) });
  d.callbacks.at(-1)!(0, 0, 250, 20);
  expect(d.sidebarRowBounds.current.size).toBe(0);
});

test("actual App move and release ignore stale sidebar rectangles when rail is active", () => {
  const d = dropBoundary(false);
  d.favoritesRowBounds.current = d.box;
  d.tabListBounds.current = d.box;
  d.pinnedSectionBounds.current = d.box;
  d.ordinarySectionBounds.current = d.box;
  d.moveDrag(20, 20);
  d.flushDragFrame();
  expect(d.getPreview().reorderIndex).toBeNull();
  d.finishDrag(20, 20);
  expect(d.favorite).not.toHaveBeenCalled();
});

test("actual App queued drag preview observes sidebar deactivation before its frame", () => {
  const d = dropBoundary(true);
  d.favoritesRowBounds.current = d.box;
  d.moveDrag(20, 20);
  d.flushDragFrame();
  expect(d.getPreview().reorderIndex).toBe(1);
  d.moveDrag(25, 25);
  d.sidebarDropActive.current = false;
  d.flushDragFrame();
  expect(d.getPreview().reorderIndex).toBeNull();
});
