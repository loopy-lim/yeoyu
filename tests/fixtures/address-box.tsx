import { mock } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import "../uniwindTestHarness";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const listeners = new Map<string, (event: unknown) => void>();
const scrolls: Array<{ y: number; animated: boolean }> = [];
const submissions: string[] = [];
const focusEvents: string[] = [];
const Input = React.forwardRef((props: any, ref) => {
  React.useImperativeHandle(ref, () => ({
    focus: () => {
      focusEvents.push("focus");
      props.onFocus?.();
    },
    blur: () => {
      focusEvents.push("blur");
      props.onBlur?.();
    },
  }));
  return React.createElement("TextInput", props);
});
const Scroll = React.forwardRef((props: any, ref) => {
  React.useImperativeHandle(ref, () => ({
    scrollTo: (position: { y: number; animated: boolean }) =>
      scrolls.push(position),
  }));
  return React.createElement("ScrollView", props, props.children);
});
mock.module("react-native", () => ({
  AppState: { addEventListener: () => ({ remove() {} }) },
  DeviceEventEmitter: {
    addListener: (name: string, callback: (event: unknown) => void) => {
      listeners.set(name, callback);
      return { remove: () => listeners.delete(name) };
    },
  },
  View: "View",
  Text: "Text",
  TextInput: Input,
  Pressable: "Pressable",
  ScrollView: Scroll,
}));
mock.module("../../src/platform", () => ({
  platform: { setAddressInputActive() {} },
}));
mock.module("../../src/chrome/ChromeIcon", () => ({
  ChromeIcon: "ChromeIcon",
}));
mock.module("../../src/components/Favicon", () => ({ Favicon: "Favicon" }));
const { AddressBox } = await import("../../src/components/AddressBox");
const previousError = console.error;
console.error = (...args: unknown[]) => {
  if (!String(args[0]).includes("react-test-renderer is deprecated"))
    previousError(...args);
};
let tree!: ReactTestRenderer;
const addressRef = React.createRef<React.ComponentRef<typeof AddressBox>>();
const scene = (presentation?: number, autoFocus = false) => (
  <AddressBox
    key={presentation}
    ref={addressRef}
    autoFocus={autoFocus}
    engine="google"
    value="page"
    reducedMotion
    suggestions={{
      favorites: Array.from({ length: 8 }, (_, index) => ({
        url: `https://example${index}.com/`,
        title: `Page ${index + 1}`,
      })),
      bookmarks: [],
      tabs: [],
      history: [],
    }}
    onSubmit={(url) => submissions.push(url)}
  />
);
try {
  if (process.argv[2] === "presentation") {
    await act(() => {
      tree = create(scene(1, true));
    });
    assert.deepEqual(focusEvents, ["focus"]);
    await act(() =>
      tree.root
        .findByType("TextInput" as React.ElementType)
        .props.onChangeText("page 2")
    );
    await act(() => listeners.get("BrowserInputKey")?.({ key: "ArrowDown" }));
    assert.equal(
      tree.root.findAllByType("Pressable" as React.ElementType)[0].props
        .accessibilityState.selected,
      true
    );
    await act(() => addressRef.current?.blur());
    await act(() => tree.update(scene(1, true)));
    assert.deepEqual(
      focusEvents,
      ["focus", "blur"],
      "retaining a blurred AddressBox does not re-run autoFocus"
    );
    assert.equal(listeners.has("BrowserInputKey"), false);
    await act(() => tree.update(scene(2, true)));
    assert.deepEqual(
      focusEvents,
      ["focus", "blur", "focus"],
      "a fresh presentation mounts and focuses the exact new native input"
    );
    assert.equal(
      tree.root.findByType("TextInput" as React.ElementType).props.value,
      "page",
      "a new presentation resets the previous query"
    );
    assert.equal(
      tree.root
        .findAllByType("Pressable" as React.ElementType)
        .some((row) => row.props.accessibilityState.selected),
      false,
      "a new presentation resets the previous selection"
    );
    await act(() => listeners.get("BrowserInputKey")?.({ key: "ArrowDown" }));
    assert.equal(
      tree.root.findAllByType("Pressable" as React.ElementType)[0].props
        .accessibilityState.selected,
      true,
      "the reopened input owns a live native keyboard listener"
    );
    const previousInput = addressRef.current;
    await act(() => {
      addressRef.current?.blur();
      tree.update(scene(3, true));
    });
    assert.notEqual(addressRef.current, previousInput);
    assert.deepEqual(
      focusEvents,
      ["focus", "blur", "focus", "blur", "focus"],
      "closing and reopening in one commit focuses a fresh native input"
    );
    assert.equal(listeners.has("BrowserInputKey"), true);
  } else {
    await act(() => {
      tree = create(scene());
    });
    await act(() =>
      tree.root.findByType("TextInput" as React.ElementType).props.onFocus()
    );
    const scroll = tree.root.findByType("ScrollView" as React.ElementType);
    const rows = tree.root.findAllByType("Pressable" as React.ElementType);
    assert.equal(rows.length, 6);
    assert.equal(
      typeof scroll.props.onLayout,
      "function",
      "a short viewport needs measured bounds to reveal keyboard selections"
    );
    await act(() =>
      scroll.props.onLayout({
        nativeEvent: { layout: { width: 400, height: 100, x: 0, y: 0 } },
      })
    );
    for (const [index, row] of rows.entries()) {
      assert.equal(
        typeof row.props.onLayout,
        "function",
        "result heights follow actual layout and font scale"
      );
      await act(() =>
        row.props.onLayout({
          nativeEvent: {
            layout: { y: index * 56, height: 56, width: 400, x: 0 },
          },
        })
      );
    }
    if (process.argv[2] === "rapid") {
      await act(() => {
        for (let step = 0; step < 6; step++)
          listeners.get("BrowserInputKey")?.({ key: "ArrowDown" });
        listeners.get("BrowserInputKey")?.({ key: "Enter" });
      });
      assert.deepEqual(
        submissions,
        ["https://example5.com/"],
        "Enter in the same native event batch submits the sixth selected result"
      );
    } else {
      for (let step = 0; step < 6; step++)
        await act(() =>
          listeners.get("BrowserInputKey")?.({ key: "ArrowDown" })
        );
    }
    assert.equal(rows.at(-1)!.props.accessibilityState.selected, true);
    assert.equal(
      scrolls.at(-1)!.y,
      236,
      "the last result's bottom remains within a 100dp visible list"
    );
    assert.equal(
      scrolls.at(-1)!.animated,
      false,
      "reduced motion applies to keyboard result scrolling"
    );
    await act(() => tree.update(scene()));
    assert.equal(
      tree.root.findAllByType("Pressable" as React.ElementType).at(-1)!.props
        .accessibilityState.selected,
      true
    );
    assert.equal(
      scrolls.at(-1)!.y,
      236,
      "a background source refresh keeps retained result geometry and the selected row visible"
    );
    await act(() =>
      scroll.props.onScroll({ nativeEvent: { contentOffset: { y: 236 } } })
    );
    for (let step = 0; step < 5; step++)
      await act(() => listeners.get("BrowserInputKey")?.({ key: "ArrowUp" }));
    assert.equal(
      scrolls.at(-1)!.y,
      0,
      "moving back to the first result reveals its top"
    );
    if (process.argv[2] === "rapid") {
      await act(() => {
        for (let step = 0; step < 5; step++)
          listeners.get("BrowserInputKey")?.({ key: "ArrowDown" });
        for (let step = 0; step < 2; step++)
          listeners.get("BrowserInputKey")?.({ key: "ArrowUp" });
        listeners.get("BrowserInputKey")?.({ key: "Enter" });
      });
      assert.equal(
        tree.root.findAllByType("Pressable" as React.ElementType)[3].props
          .accessibilityState.selected,
        true,
        "opposite directions accumulate within one render batch"
      );
      assert.equal(submissions.at(-1), "https://example3.com/");
      await act(() => {
        listeners.get("BrowserInputKey")?.({ key: "ArrowDown" });
        tree.root
          .findByType("TextInput" as React.ElementType)
          .props.onSubmitEditing();
      });
      assert.equal(
        submissions.at(-1),
        "https://example4.com/",
        "native submit editing also reads the pending keyboard selection"
      );
      await act(() =>
        tree.root
          .findByType("TextInput" as React.ElementType)
          .props.onChangeText("another query")
      );
      await act(() => listeners.get("BrowserInputKey")?.({ key: "Enter" }));
      assert.equal(
        submissions.at(-1),
        "https://www.google.com/search?q=another%20query",
        "editing the query clears the previous keyboard selection"
      );
    }
  }
} finally {
  if (tree) await act(() => tree.unmount());
  console.error = previousError;
}
