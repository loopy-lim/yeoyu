import { expect, test } from "bun:test";
import {
  withCtrlAlternatives,
  withCtrlAlternativesFromDraft,
} from "../src/keyboardProfiles";
const meta = {
  key: "l",
  meta: true,
  ctrl: false,
  alt: false,
  shift: false,
  command: "location.focus",
};
test("adds a Ctrl alternative without changing the Cmd binding", () => {
  const result = withCtrlAlternatives([meta]);
  expect(result).toEqual([meta, { ...meta, meta: false, ctrl: true }]);
});
test("preserves an existing custom Ctrl chord and stays idempotent", () => {
  const custom = { ...meta, meta: false, ctrl: true, command: "tab.new" };
  expect(withCtrlAlternatives([meta, custom])).toEqual([meta, custom]);
});
test("adds Ctrl alternatives to the current editor draft", () => {
  const draft = JSON.stringify([{ ...meta, command: "tab.close" }]);
  expect(withCtrlAlternativesFromDraft(draft)).toEqual([
    { ...meta, command: "tab.close" },
    { ...meta, meta: false, ctrl: true, command: "tab.close" },
  ]);
});
test("rejects an invalid editor draft instead of using saved bindings", () => {
  expect(() => withCtrlAlternativesFromDraft("{")).toThrow();
});
