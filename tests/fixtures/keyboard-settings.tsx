import { mock } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { KeyBinding } from "../../generated/types";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
mock.module("react-native", () => ({
  View: "View", Text: "Text", TextInput: "TextInput", Pressable: "Pressable", ScrollView: "ScrollView",
  StyleSheet: { create: (value: unknown) => value },
}));
const { KeyboardSettings } = await import("../../src/components/KeyboardSettings");
const binding = (key: string, command: string): KeyBinding => ({ key, command, meta: true, ctrl: false, alt: false, shift: false });
const original = [binding("l", "location.focus"), binding("t", "tab.new")];
const originalJson = JSON.stringify(original);
const defaults = [binding("d", "tab.new")];
const saved: KeyBinding[][] = [];
let closed = 0;
let saveBehavior: (rows: KeyBinding[]) => Promise<unknown> = async () => {};
let defaultBehavior = async () => defaults;
let renderer: ReactTestRenderer;
const commands = [{ id: "location.focus", title: "Edit address" }, { id: "tab.new", title: "New tab" }];
const component = (bindings = original) => <KeyboardSettings bindings={bindings} commands={commands} onDefaults={() => defaultBehavior()} onSave={(rows) => { saved.push(rows); return saveBehavior(rows); }} onClose={() => { closed++; }} />;
const element = (label: string) => renderer.root.findByProps({ accessibilityLabel: label });
const press = async (label: string) => { await act(async () => { element(label).props.onPress(); }); };
const edit = async (label: string, value: string) => { await act(() => element(label).props.onChangeText(value)); };
const error = () => String(renderer.root.findByProps({ accessibilityRole: "alert" }).props.children);
const previousError = console.error;
console.error = (...args: unknown[]) => {
  if (!String(args[0]).includes("react-test-renderer is deprecated")) previousError(...args);
};
try {
  await act(async () => { renderer = create(component()); });
  switch (process.argv[2]) {
    case "draft-isolation": {
      await edit("Key for Edit address", "x");
      await act(() => renderer.update(component([binding("z", "location.focus")])));
      assert.equal(element("Key for Edit address").props.value, "x", "external snapshot updates must preserve the open draft");
      await press("Add Ctrl alternatives");
      assert.equal(renderer!.root.findAllByProps({ accessibilityLabel: "Key for Edit address" }).length, 2);
      assert.equal(saved.length, 0, "adding alternatives only changes the draft");
      await press("Restore defaults");
      assert.equal(element("Key for New tab").props.value, "d");
      assert.equal(saved.length, 0, "default restoration must wait for explicit Save");
      assert.equal(closed, 0);
      assert.equal(JSON.stringify(original), originalJson, "the caller's keymap must stay immutable");
      await press("Advanced JSON");
      assert.deepEqual(JSON.parse(element("Keymap JSON").props.value), defaults);
      await press("Cancel keyboard");
      assert.equal(closed, 1);
      assert.equal(saved.length, 0);
      break;
    }
    case "save-failure-conflicts": {
      await edit("Key for New tab", "L");
      await press("Save shortcuts");
      assert.match(error(), /duplicates/);
      assert.equal(saved.length, 0, "conflicting shortcuts cannot reach persistence");
      assert.equal(closed, 0);
      await edit("Key for New tab", "z");
      saveBehavior = async () => { throw new Error("disk unavailable"); };
      await press("Save shortcuts");
      assert.match(error(), /disk unavailable/);
      assert.equal(saved.length, 1);
      assert.equal(closed, 0, "a save failure keeps the editor open");
      assert.equal(element("Key for New tab").props.value, "z");
      saveBehavior = async () => {};
      await press("Save shortcuts");
      assert.equal(closed, 1);
      assert.deepEqual(saved[1], [original[0], binding("z", "tab.new")]);
      break;
    }
    case "pending-actions": {
      await press("Advanced JSON");
      let release: () => void = () => {};
      saveBehavior = () => new Promise((resolve) => { release = () => resolve(undefined); });
      const save = element("Save shortcuts").props.onPress;
      await act(async () => { save(); save(); });
      assert.equal(saved.length, 1, "same-tick presses must start one save");
      assert.equal(element("Keymap JSON").props.editable, false, "pending save freezes the submitted draft");
      assert.equal(element("Cancel keyboard").props.disabled, true);
      await act(async () => release());
      assert.equal(closed, 1);
      break;
    }
    case "closed-save": {
      let release: () => void = () => {};
      let completed = 0;
      saveBehavior = () => new Promise((resolve) => {
        release = () => { completed++; resolve(undefined); };
      });
      await edit("Key for New tab", "a");
      await press("Save shortcuts");
      assert.deepEqual(saved, [[original[0], binding("a", "tab.new")]]);
      // App's Back/underlay can unmount the editor while persistence is pending.
      await act(() => renderer.unmount());
      await act(() => { renderer = create(component()); });
      await edit("Key for New tab", "b");
      await act(async () => release());
      assert.equal(completed, 1, "the accepted save still completes");
      assert.equal(closed, 0, "a closed instance must not close the reopened editor");
      assert.equal(element("Key for New tab").props.value, "b");
      saveBehavior = async () => {};
      await press("Save shortcuts");
      assert.equal(closed, 1, "the current editor still closes after its own save");
      assert.deepEqual(saved[1], [original[0], binding("b", "tab.new")]);
      break;
    }
    case "advanced-draft": {
      await press("Advanced JSON");
      await edit("Keymap JSON", "unfinished {");
      await press("Use visual editor");
      assert.equal(element("Keymap JSON").props.value, "unfinished {");
      assert.equal(saved.length, 0);
      defaultBehavior = async () => { throw new Error("defaults unavailable"); };
      await press("Restore defaults");
      assert.match(error(), /defaults unavailable/);
      assert.equal(element("Keymap JSON").props.value, "unfinished {");
      await edit("Keymap JSON", JSON.stringify([binding("f", "future.action")]));
      await press("Use visual editor");
      assert.equal(element("Key for future.action").props.value, "f");
      await press("Save shortcuts");
      assert.deepEqual(saved[0], [binding("f", "future.action")]);
      break;
    }
    case "rapid-add": {
      const add = element("New tab").props.onPress;
      await act(() => { add(); add(); });
      const inputs = () => renderer.root.findAllByProps({ accessibilityLabel: "Key for New tab" });
      assert.equal(inputs().length, 3);
      await act(() => inputs()[1]!.props.onChangeText("u"));
      assert.equal(inputs()[2]!.props.value, "", "new rows must have distinct identities even in one render batch");
      break;
    }
    default: throw Error("Unknown fixture scenario");
  }
  await act(() => renderer.unmount());
} finally { console.error = previousError; }
