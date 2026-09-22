import { expect, test } from "bun:test";
import { parseKeymap, shortcutLabel } from "../src/keyboardEditor";
const row = {
  key: "l",
  command: "location.focus",
  meta: false,
  ctrl: true,
  alt: false,
  shift: false,
};
test("normalizes drafts and preserves unknown action IDs for compatibility", () => {
  expect(
    parseKeymap(
      JSON.stringify([{ ...row, key: " L ", command: " future.action " }])
    )[0]
  ).toEqual({ ...row, key: "L", command: "future.action" });
  expect(shortcutLabel(row)).toBe("Ctrl + L");
});
test("rejects ambiguous chords, missing keys and truthy non-boolean modifiers", () => {
  for (const rows of [
    [row, { ...row, key: "L" }],
    [{ ...row, key: " " }],
    [{ ...row, ctrl: "true" }],
    [null],
    {},
  ]) {
    expect(() => parseKeymap(JSON.stringify(rows))).toThrow();
  }
  expect(
    parseKeymap(JSON.stringify([row, { ...row, shift: true }]))
  ).toHaveLength(2);
});
