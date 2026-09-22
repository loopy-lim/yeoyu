import { mock } from "bun:test";
import assert from "node:assert/strict";
import React, { useState, useSyncExternalStore } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { defaultUiPreferences, reduceUiPreferences, type UiPreferenceAction, type UiPreferences } from "../../src/uiPreferences";
import { resolveTheme } from "../../src/theme";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let systemScheme: "light" | "dark" = "light";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const useScheme = () => useSyncExternalStore(subscribe, () => systemScheme);
mock.module("react-native", () => ({
  View: "View", Text: "Text", TextInput: "TextInput", Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles }, useColorScheme: useScheme,
}));
mock.module("react-native-svg", () => ({ default: "Svg", Path: "Path" }));
const { AppearanceSettings } = await import("../../src/components/AppearanceSettings");
const { ThemeContext } = await import("../../src/themeContext");
const actions: UiPreferenceAction[] = [];
let current: UiPreferences;
let renderer: ReactTestRenderer;
function Scene({ hydrated = true }: { hydrated?: boolean }) {
  const [ui, setUi] = useState<UiPreferences>({ ...defaultUiPreferences, colorSource: "custom", customColor: "#7d94d4" });
  const scheme = useScheme();
  current = ui;
  return <ThemeContext.Provider value={resolveTheme(ui, "", scheme)}>
    <AppearanceSettings ui={ui} hydrated={hydrated} spaceColor="" spaceName="Home" onChange={(action) => {
      actions.push(action); setUi((previous) => reduceUiPreferences(previous, action));
    }} />
  </ThemeContext.Provider>;
}
const input = () => renderer.root.findByType("TextInput" as React.ElementType);
const choice = (label: string) => renderer.root.findByProps({ accessibilityLabel: label });
const button = (label: string) => renderer.root.findAllByType("Pressable" as React.ElementType).find((node) => node.findAllByType("Text" as React.ElementType).some((text) => text.props.children === label))!;
const previewBackground = () => {
  const label = renderer.root.findAllByType("Text" as React.ElementType).find((node) => typeof node.props.children === "string" && node.props.children.startsWith("Preview · "))!;
  return label.parent!.props.style[1].backgroundColor;
};
const previousError = console.error;
console.error = (...args: unknown[]) => {
  if (!String(args[0]).includes("react-test-renderer is deprecated")) previousError(...args);
};
try {
  await act(async () => { renderer = create(<Scene />); });
  assert.equal(choice("System").props.accessibilityState.checked, true);
  await act(() => input().props.onChangeText("#0f0"));
  assert.equal(actions.length, 0, "typing cannot persist a custom seed");
  await act(() => choice("Dark").props.onPress());
  assert.equal(current!.colorMode, "dark");
  assert.equal(current!.customColor, "#7d94d4");
  assert.equal(input().props.value, "#0f0", "mode changes preserve the unsaved HEX draft");
  assert.equal(previewBackground(), resolveTheme({ appearance: "lavender", colorMode: "dark", colorSource: "custom", customColor: "#00ff00" }).sidebar);
  await act(() => choice("System").props.onPress());
  assert.equal(previewBackground(), resolveTheme({ appearance: "lavender", colorMode: "light", colorSource: "custom", customColor: "#00ff00" }).sidebar);
  const count = actions.length;
  await act(() => { systemScheme = "dark"; listeners.forEach((listener) => listener()); });
  assert.equal(actions.length, count, "system updates must not persist a new preference");
  assert.equal(previewBackground(), resolveTheme({ appearance: "lavender", colorMode: "dark", colorSource: "custom", customColor: "#00ff00" }).sidebar);
  assert.equal(input().props.value, "#0f0");
  await act(() => button("Apply custom color").props.onPress());
  assert.equal(current!.customColor, "#00ff00");
  assert.equal(current!.colorMode, "system");
  await act(() => input().props.onChangeText("invalid"));
  assert.equal(button("Apply custom color").props.disabled, true);
  assert.equal(renderer!.root.findAllByProps({ accessibilityRole: "alert" }).length, 1);
  await act(() => renderer.update(<Scene hydrated={false} />));
  assert.equal(choice("Light").props.disabled, true);
  assert.equal(input().props.editable, false);
  await act(() => renderer.unmount());
} finally { console.error = previousError; }
