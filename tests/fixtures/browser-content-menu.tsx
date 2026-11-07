// Runs in its own Bun process so native module mocks cannot affect other tests.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
mock.module("react-native", () => ({
  Modal: ({ visible, children }: { visible?: boolean; children?: React.ReactNode }) =>
    visible === false ? null : children,
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  View: "View",
}));
mock.module("../../src/chrome/useReducedMotion", () => ({ useReducedMotion: () => true }));
const { BrowserContentMenu } = await import("../../src/components/BrowserContentMenu");
const { I18nContext } = await import("../../src/i18nContext");

const request = {
  requestId: "r1",
  tabId: "t1",
  linkUri: "https://example.com/page",
  imageUri: "https://example.com/pic.png",
  title: "Example",
};
function rowLabels(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((node) => node.props.accessibilityRole === "button")
    .map((node) => {
      const text = node.children.filter((child) => typeof child === "object");
      return text.map((child: any) => child.props.children).join("");
    });
}
function renderMenu(sourcePrivate: boolean, onChoose: (id: string, target: "link" | "image", action: any) => Promise<void>) {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      React.createElement(
        I18nContext.Provider,
        { value: "en" },
        React.createElement(BrowserContentMenu, {
          request: request as never,
          sourcePrivate,
          onClose: () => {},
          onChoose,
        })
      )
    );
  });
  return renderer;
}

// Non-private source: the Chrome-parity item set for both targets.
{
  const calls: Array<[string, "link" | "image", unknown]> = [];
  const renderer = renderMenu(false, async (id, target, action) => {
    calls.push([id, target, action]);
  });
  assert.deepEqual(rowLabels(renderer), [
    "Open link in new tab",
    "Open in new private tab",
    "Download link",
    "Copy link address",
    "Share link",
    "Open image in new tab",
    "Download image",
    "Copy image address",
    "Share image",
    "Cancel",
  ]);
  act(() => {
    renderer.root
      .findAll((node) => node.props.accessibilityRole === "button")
      .find((node) => JSON.stringify(node.children.map((c: any) => c?.props?.children)).includes("Download link"))!
      .props.onPress();
  });
  assert.deepEqual(calls, [["r1", "link", "download"]]);
}

// Private source keeps the private-open affordance out entirely.
{
  const renderer = renderMenu(true, async () => {});
  const labels = rowLabels(renderer);
  assert.equal(labels.includes("Open in new private tab"), false);
  assert.equal(labels.includes("Download image"), true);
}

process.stdout.write(JSON.stringify({ menuRowsVerified: true }) + "\n");
