// History dialog UI fixture: the receive-only "From Other Devices" section
// (issue #13). Rendered with the plain react-native string mocks (the
// sync-settings pattern); FlatList is mocked as a simple renderer so
// ListHeaderComponent/rows materialize. Assertions ride Text contents and
// accessibility props only — no style resolution involved.
import { afterEach, expect, mock, test } from "bun:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import "../uniwindTestHarness";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

class AnimatedValue {
  value: number;
  constructor(initial: number) {
    this.value = initial;
  }
  setValue(next: number) {
    this.value = next;
  }
  interpolate(config: unknown) {
    return config;
  }
}
mock.module("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  Image: "Image",
  ScrollView: "ScrollView",
  Switch: "Switch",
  TextInput: "TextInput",
  Animated: {
    View: "View",
    Value: AnimatedValue,
    timing: (value: AnimatedValue, config: { toValue: number }) => ({
      start(done?: (result: { finished: boolean }) => void) {
        value.setValue(config.toValue);
        done?.({ finished: true });
      },
      stop() {},
    }),
  },
  Easing: { bezier: () => "bezier" },
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(false),
    addEventListener: () => ({ remove: () => {} }),
  },
  // Minimal FlatList: header, empty state and data rows in order.
  FlatList: ({
    data,
    renderItem,
    ListHeaderComponent,
    ListEmptyComponent,
  }: {
    data: Array<Record<string, unknown>>;
    renderItem: (info: {
      item: Record<string, unknown>;
      index: number;
      separators?: unknown;
    }) => React.ReactElement;
    ListHeaderComponent?: React.ReactElement;
    ListEmptyComponent?: React.ReactElement;
  }) =>
    React.createElement(
      "View",
      null,
      ListHeaderComponent,
      data.length === 0 ? ListEmptyComponent : null,
      data.map((item, index) =>
        renderItem({ item, index, separators: {} as never })
      )
    ),
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ width: 800, height: 1280 }),
}));
mock.module("react-native-svg", () => ({ default: "Svg", Path: "Path" }));

const { HistoryDialog } = await import("../../src/components/Dialogs");

const trees: ReactTestRenderer[] = [];
async function mount(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  trees.push(tree);
  return tree;
}
afterEach(async () => {
  await act(() => trees.splice(0).forEach((tree) => tree.unmount()));
});

const texts = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType("Text" as React.ElementType)
    .map((node) =>
      typeof node.props.children === "number"
        ? String(node.props.children)
        : node.props.children
    )
    .filter((child): child is string => typeof child === "string");

const syncedSectionButton = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType("Pressable" as React.ElementType)
    .find((node) => node.props.accessibilityLabel === "From Other Devices");

const syncedVisits = [
  {
    id: "hist00000002",
    url: "https://newer.example",
    title: "Newer",
    visitedAtMs: new Date("2026-11-21T10:00:00Z").getTime(),
  },
  {
    id: "hist00000001",
    url: "https://older.example",
    title: "Older",
    visitedAtMs: new Date("2026-11-20T10:00:00Z").getTime(),
  },
];

const emptyProps = {
  entries: [],
  onOpen: () => {},
  onClear: () => {},
  onClose: () => {},
};

test("synced visits add a folded other-devices section that expands", async () => {
  const tree = await mount(
    <HistoryDialog {...emptyProps} syncedVisits={syncedVisits} />
  );
  const header = syncedSectionButton(tree);
  expect(header).toBeDefined();
  expect(header!.props.accessibilityState).toEqual({ expanded: false });
  // Folded by default: the local list keeps its place.
  expect(texts(tree)).not.toContain("Newer");
  await act(() => header!.props.onPress());
  expect(header!.props.accessibilityState).toEqual({ expanded: true });
  expect(texts(tree)).toContain("Newer");
  expect(texts(tree)).toContain("Older");
  expect(texts(tree)).toContain("https://newer.example");
});

test("without synced visits the section stays hidden", async () => {
  const tree = await mount(<HistoryDialog {...emptyProps} />);
  expect(syncedSectionButton(tree)).toBeUndefined();
  expect(texts(tree)).toContain("No history yet.");

  const empty = await mount(
    <HistoryDialog {...emptyProps} syncedVisits={[]} />
  );
  expect(syncedSectionButton(empty)).toBeUndefined();
});

test("synced rows open through the dialog's onOpen", async () => {
  const opened: string[] = [];
  const tree = await mount(
    <HistoryDialog
      {...emptyProps}
      syncedVisits={syncedVisits}
      onOpen={(url) => opened.push(url)}
    />
  );
  await act(() => syncedSectionButton(tree)!.props.onPress());
  const row = tree.root
    .findAllByType("Pressable" as React.ElementType)
    .find((node) => node.props.accessibilityLabel === "Open Newer");
  expect(row).toBeDefined();
  await act(() => row!.props.onPress());
  expect(opened).toEqual(["https://newer.example"]);
});
