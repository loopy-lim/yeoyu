import { afterEach, expect, mock, test } from "bun:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
mock.module("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  useWindowDimensions: () => ({ width: 2560, height: 1600 }),
}));
mock.module("@/i18nContext", () => ({
  useI18n: () => ({ tr: (key: string) => String(key) }),
}));
mock.module("@/chrome/ChromeIcon", () => ({
  ChromeIcon: "ChromeIcon",
}));

const ActionMenu = (await import("../src/components/ActionMenu")).ActionMenu;

const items: Parameters<typeof ActionMenu>[0]["items"] = [
  { id: "a", label: "Alpha", onPress: () => {} },
  { id: "b", label: "Beta", onPress: () => {} },
];

let tree: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
});

const renderMenu = async (props: {
  title: string;
  items: Parameters<typeof ActionMenu>[0]["items"];
  anchor?: { x: number; y: number };
  onClose: () => void;
}) => {
  await act(async () => {
    tree = create(<ActionMenu {...props} />);
  });
  return tree!;
};

test("anchorless ActionMenu renders every item row (split-picker sheet shape)", async () => {
  const instance = await renderMenu({
    title: "Choose a tab to split with",
    items,
    onClose: () => {},
  });
  const rows = instance.root.findAll(
    (node) =>
      node.props.accessibilityLabel === "Alpha" ||
      node.props.accessibilityLabel === "Beta"
  );
  expect(rows.length).toBe(2);
});

test("anchored ActionMenu keeps the same row structure", async () => {
  const instance = await renderMenu({
    title: "Menu",
    anchor: { x: 100, y: 100 },
    items,
    onClose: () => {},
  });
  const rows = instance.root.findAll(
    (node) => node.props.accessibilityLabel === "Alpha"
  );
  expect(rows.length).toBe(1);
});
