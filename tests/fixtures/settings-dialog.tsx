import { mock } from "bun:test";
import assert from "node:assert/strict";
import React, { useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { defaultUiPreferences } from "../../src/uiPreferences";
import { resolveTheme } from "../../src/theme";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let dimensions = { width: 960, height: 700, fontScale: 1 };
mock.module("react-native", () => ({
  Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View",
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  useWindowDimensions: () => dimensions,
}));
mock.module("react-native-svg", () => ({ default: "Svg", Path: "Path" }));
const { SettingsDialog } = await import("../../src/components/SettingsDialog");
const { SettingsRow } = await import("../../src/components/SettingsRow");
const { ThemeContext } = await import("../../src/themeContext");
const { I18nContext } = await import("../../src/i18nContext");

function Draft() {
  const [value, setValue] = useState("unsaved");
  return React.createElement("TextInput", { accessibilityLabel: "draft", value, onChangeText: setValue });
}
function Scene({ language = "en" as "en" | "ko", failed = false }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  return <I18nContext.Provider value={language}>
    <ThemeContext.Provider value={resolveTheme(defaultUiPreferences, "", "light")}>
      <SettingsDialog
        sections={[{ id: "browsing", title: language === "ko" ? "탐색" : "Browsing", description: language === "ko" ? "기본값 설명" : "Default description", keywords: "search 검색", content: <Draft /> }]}
        query={query} onQueryChange={setQuery} selectedId={selectedId} onSelect={setSelectedId}
        onClose={() => {}} saveStatus={failed ? "failed" : "saved"} onRetrySave={() => {}}
      />
    </ThemeContext.Provider>
  </I18nContext.Provider>;
}
const previousError = console.error;
console.error = (...args: unknown[]) => {
  if (!String(args[0]).includes("react-test-renderer is deprecated")) previousError(...args);
};
try {
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<Scene />); });
  const allText = () => renderer.root.findAllByType("Text" as React.ElementType).map((node) => node.props.children).filter((value) => typeof value === "string");
  assert.equal(allText().filter((value) => value === "Default description").length, 1, "wide navigation does not repeat section descriptions");
  await act(() => renderer.root.findByProps({ accessibilityLabel: "draft" }).props.onChangeText("kept"));
  await act(() => renderer.update(<Scene language="ko" failed />));
  assert.equal(renderer.root.findByProps({ accessibilityLabel: "draft" }).props.value, "kept", "language change keeps the panel draft");
  assert(allText().includes("설정"));
  assert(allText().includes("저장 다시 시도"));
  assert.equal(renderer.root.findByProps({ accessibilityLabel: "설정 닫기" }).props.accessibilityRole, "button");
  dimensions = { width: 400, height: 640, fontScale: 1.6 };
  await act(() => renderer.update(<Scene language="ko" failed />));
  assert.equal(renderer.root.findAllByProps({ accessibilityLabel: "draft" }).length, 0, "narrow screen starts in category navigation");
  const category = renderer.root.findAllByType("Pressable" as React.ElementType).find((node) =>
    node.findAllByType("Text" as React.ElementType).some((text) => {
      const children = text.props.children;
      return typeof children === "string"
        ? children === "탐색"
        : Array.isArray(children) && children.includes("탐색");
    }))!;
  await act(() => category.props.onPress());
  assert.equal(renderer.root.findAllByProps({ accessibilityLabel: "draft" }).length, 1);
  assert.equal(renderer.root.findByProps({ accessibilityLabel: "설정 분류로 돌아가기" }).props.accessibilityRole, "button");
  await act(() => renderer.unmount());

  dimensions = { width: 960, height: 700, fontScale: 1 };
  await act(() => { renderer = create(<SettingsRow title="Theme" summary="Choose a theme"><TextControl /></SettingsRow>); });
  const row = () => renderer.root.findAllByType("View" as React.ElementType)[0];
  assert.equal(typeof row().props.onLayout, "function", "settings rows measure their available panel width");
  await act(() => row().props.onLayout({ nativeEvent: { layout: { width: 430 } } }));
  assert.equal(row().props.style.flexDirection, "column", "narrow panel stacks controls even in a wide window");
  await act(() => row().props.onLayout({ nativeEvent: { layout: { width: 800 } } }));
  assert.equal(row().props.style.flexDirection, "row", "wide panel places controls beside labels");
  dimensions = { ...dimensions, fontScale: 1.6 };
  await act(() => renderer.update(<SettingsRow title="Theme"><TextControl /></SettingsRow>));
  assert.equal(row().props.style.flexDirection, "column", "large text keeps controls below labels");
  await act(() => renderer.unmount());
} finally {
  console.error = previousError;
}

function TextControl() {
  return React.createElement("Text", {}, "System");
}
