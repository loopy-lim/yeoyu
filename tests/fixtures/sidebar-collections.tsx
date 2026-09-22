import { afterEach, expect, mock, test } from "bun:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
mock.module("react-native", () => ({
  View: "View",
  Pressable: "Pressable",
  Animated: { View: "View" },
  Text: "Text",
  Image: "Image",
  ScrollView: "ScrollView",
  FlatList: (props: any) =>
    React.createElement(
      "NativeList",
      props,
      props.data
        .slice(0, props.initialNumToRender)
        .map((item: unknown, index: number) =>
          props.renderItem({ item, index })
        ),
      props.data.length ? null : props.ListEmptyComponent,
      props.ListFooterComponent
    ),
  StyleSheet: { create: (styles: unknown) => styles },
  useWindowDimensions: () => ({ width: 320, height: 700 }),
}));
mock.module("react-native-svg", () => ({ default: "Svg", Path: "Path" }));
const { SplitSidebarItem, SidebarFolderItem, SidebarPageMenu } = await import(
  "../../src/components/SidebarCollections"
);
const { SidebarLayer } = await import("../../src/chrome/SidebarInteraction");
const { Favicon } = await import("../../src/components/Favicon");
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
const pair = {
  key: "pair",
  orientation: "horizontal" as const,
  focusedId: "b",
  pages: [
    {
      id: "a",
      title: "First page",
      url: "about:blank",
      workspaceId: "work",
      private: true,
    },
    {
      id: "b",
      title: "Second page",
      url: "about:blank",
      workspaceId: "work",
      private: true,
    },
  ] as [
    {
      id: string;
      title: string;
      url: string;
      workspaceId: string;
      private: boolean;
    },
    {
      id: string;
      title: string;
      url: string;
      workspaceId: string;
      private: boolean;
    }
  ],
};
const buttons = (tree: ReactTestRenderer) =>
  tree.root.findAllByType("Pressable" as React.ElementType);

test("collapsed pair has one target, places focused favicon in front, and never persists private favicons", async () => {
  let opens = 0;
  const tree = await mount(
    <SplitSidebarItem split={pair} collapsed onOpen={() => opens++} />
  );
  expect(buttons(tree)).toHaveLength(1);
  expect(buttons(tree)[0]!.props.accessibilityLabel).toContain("First page");
  expect(buttons(tree)[0]!.props.accessibilityLabel).toContain("Second page");
  const icons = tree.root.findAllByType(Favicon);
  expect(icons.map((icon) => icon.props.persist)).toEqual([false, false]);
  expect(
    tree.root.findByProps({ testID: "split-favicon-front" }).props
      .accessibilityLabel
  ).toBe("Second page");
  await act(() =>
    buttons(tree)[0]!.props.onPress({ nativeEvent: { pageX: 40, pageY: 90 } })
  );
  expect(opens).toBe(1);
  await act(() =>
    tree.update(
      <SplitSidebarItem
        split={{ ...pair, focusedId: "a" }}
        collapsed
        onOpen={() => opens++}
      />
    )
  );
  expect(
    tree.root.findByProps({ testID: "split-favicon-front" }).props
      .accessibilityLabel
  ).toBe("First page");
});

test("expanded pair keeps both readable titles in one target and exposes no tiny pane buttons", async () => {
  const tree = await mount(
    <SplitSidebarItem split={pair} collapsed={false} onOpen={() => {}} />
  );
  expect(buttons(tree)).toHaveLength(1);
  const text = tree.root
    .findAllByType("Text" as React.ElementType)
    .map((node) => node.children.join(""));
  expect(text).toContain("First page");
  expect(text).toContain("Second page");
});

test("a retained inactive sidebar pair cannot open a picker", async () => {
  let opens = 0;
  const tree = await mount(
    <SidebarLayer active={false} visible>
      <SplitSidebarItem split={pair} collapsed onOpen={() => opens++} />
    </SidebarLayer>
  );
  await act(() =>
    buttons(tree)[0]!.props.onPress({ nativeEvent: { pageX: 1, pageY: 1 } })
  );
  expect(opens).toBe(0);
});

test("folder icon reflects disclosure and count is bounded without losing its accessible value", async () => {
  const props = {
    title: "Documents",
    count: 123,
    containsFocused: true,
    onPress: () => {},
    onContextMenu: () => {},
    contextOpen: false,
  };
  const tree = await mount(<SidebarFolderItem {...props} open={false} />);
  const closedPath = tree.root.findAllByType("Path" as React.ElementType)[0]!
    .props.d;
  expect(buttons(tree)[0]!.props.accessibilityLabel).toContain("123");
  expect(buttons(tree)[0]!.props.accessibilityState.expanded).toBe(false);
  await act(() => tree.update(<SidebarFolderItem {...props} open />));
  expect(
    tree.root.findAllByType("Path" as React.ElementType)[0]!.props.d
  ).not.toBe(closedPath);
  await act(() =>
    tree.update(<SidebarFolderItem {...props} open={false} collapsed />)
  );
  expect(
    tree.root
      .findAllByType("Text" as React.ElementType)
      .map((node) => node.children.join(""))
  ).toContain("99+");
});

test("page picker keeps position and selected state, selects only that page, then closes", async () => {
  const events: string[] = [];
  const tree = await mount(
    <SidebarPageMenu
      title="Split view"
      pages={pair.pages.map((page, index) => ({
        ...page,
        detail: index ? "Right" : "Left",
        selected: index === 1,
        onPress: () => events.push(page.id),
      }))}
      onClose={() => events.push("close")}
    />
  );
  const row = buttons(tree).find((button) =>
    button.props.accessibilityLabel?.includes("First page")
  )!;
  expect(row).toBeDefined();
  expect(row.props.accessibilityLabel).toContain("Left");
  const selected = buttons(tree).find((button) =>
    button.props.accessibilityLabel?.includes("Second page")
  )!;
  expect(selected.props.accessibilityState.selected).toBe(true);
  expect(
    tree.root.findAllByType(Favicon).map((icon) => icon.props.persist)
  ).toEqual([false, false]);
  await act(() => row.props.onPress());
  expect(events).toEqual(["close", "a"]);
});

test("large folders do not eagerly create every page's favicon and controls", async () => {
  const pages = Array.from({ length: 1000 }, (_, index) => ({
    id: String(index),
    title: `Page ${index}`,
    url: "about:blank",
    onPress: () => {},
  }));
  const tree = await mount(
    <SidebarPageMenu title="Large folder" pages={pages} onClose={() => {}} />
  );
  expect(tree.root.findAllByType(Favicon).length).toBeLessThan(20);
  expect(
    tree.root.findByType("NativeList" as React.ElementType).props.data
  ).toHaveLength(1000);
});
