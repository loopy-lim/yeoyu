import { mock } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer";
import { resolveTestClassNames } from "../uniwindTestHarness";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
mock.module("react-native", () => ({
  View: "View", Text: "Text", TextInput: "TextInput", Pressable: "Pressable",
  FlatList: "FlatList", ScrollView: "ScrollView", Switch: "Switch", Image: "Image",
  useWindowDimensions: () => ({ width: 400, height: 400, fontScale: 1.6 }),
}));
mock.module("react-native-svg", () => ({ default: "Svg", Path: "Path" }));
const { SpaceSwitcherDialog } = await import("../../src/components/Dialogs");
const workspaces = Array.from({ length: 24 }, (_, index) => ({
  id: `space-${index + 1}`,
  name: `Space ${index + 1}`,
  color: "#79667d",
}));
const switched: string[] = [];
let created = 0;
let closed = 0;
function Scene() {
  return <SpaceSwitcherDialog
    workspaces={workspaces}
    activeWorkspaceId="space-24"
    counts={{ "space-24": 12 }}
    onSwitch={(id) => switched.push(id)}
    onCreate={() => created++}
    onClose={() => closed++}
  />;
}
const flatten = (value: unknown): Record<string, any> => Array.isArray(value)
  ? Object.assign({}, ...value.flat(Infinity).filter(Boolean))
  : (value as Record<string, any>) ?? {};
const styleFor = (node: ReactTestInstance) => ({
  ...resolveTestClassNames(node.props.className),
  ...flatten(node.props.style),
});
const within = (node: ReactTestInstance, ancestor: ReactTestInstance) => {
  for (let current = node.parent; current; current = current.parent)
    if (current === ancestor) return true;
  return false;
};
const previousError = console.error;
console.error = (...args: unknown[]) => {
  if (!String(args[0]).includes("react-test-renderer is deprecated")) previousError(...args);
};
let renderer!: ReactTestRenderer;
try {
  await act(() => { renderer = create(<Scene />); });
  const rows = renderer.root.findAllByType("Pressable" as React.ElementType)
    .filter((node) => node.props.accessibilityLabel?.startsWith("Switch to Space"));
  assert.equal(rows.length, 24);
  const last = rows.at(-1)!;
  const scrolls = renderer.root.findAllByType("ScrollView" as React.ElementType);
  const list = scrolls.find((node) => within(last, node));
  assert(list, "the last Space needs a scrollable viewport rather than spilling beyond the bounded dialog");
  assert.equal(styleFor(list).flexShrink, 1, "the Space viewport yields height to the fixed header and footer");
  assert.equal(list.props.keyboardShouldPersistTaps, "handled");
  const rowHeight = styleFor(last).minHeight;
  assert(rows.length * rowHeight > 400, "this scenario exceeds even the full window before dialog padding");
  const dialog = renderer.root.findAllByType("View" as React.ElementType)
    .find((node) => styleFor(node).maxHeight);
  assert.equal(styleFor(dialog!).maxHeight, "80%");
  const close = renderer.root.findByProps({ accessibilityLabel: "Close spaces" });
  const createSpace = renderer.root.findByProps({ accessibilityLabel: "New space" });
  assert.equal(within(close, list), false, "close stays visible when the Space list is scrolled");
  assert.equal(within(createSpace, list), false, "new-Space stays visible when the Space list is scrolled");
  assert.equal(last.props.accessibilityRole, "button");
  await act(() => last.props.onPress());
  assert.deepEqual(switched, ["space-24"], "the last Space remains selectable");
  await act(() => createSpace.props.onPress());
  await act(() => close.props.onPress());
  assert.equal(created, 1);
  assert.equal(closed, 1);
} finally {
  if (renderer) await act(() => renderer.unmount());
  console.error = previousError;
}
