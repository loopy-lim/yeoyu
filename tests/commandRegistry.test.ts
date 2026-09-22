import { expect, test } from "bun:test";
import { CommandRegistry } from "../src/commandRegistry";

test("commands expose readable titles, preserve execution and omit compatibility aliases", () => {
  const registry = new CommandRegistry();
  let executions = 0;
  registry.register("pins.toggle", () => executions++);
  registry.register("favorites.addCurrent", () => {});
  expect(registry.entries()).toEqual([
    {
      id: "pins.toggle",
      title: "Pin or unpin tab",
      keywords: "save bookmark space",
    },
  ]);
  expect(registry.execute("pins.toggle")).toBe(true);
  expect(executions).toBe(1);
  expect(registry.execute("missing")).toBe(false);
});

test("translated command titles keep stable executable IDs and English search words", () => {
  const registry = new CommandRegistry();
  let called = false;
  registry.register("pins.toggle", () => { called = true; });
  const [entry] = registry.entries("ko");
  expect(entry.id).toBe("pins.toggle");
  expect(entry.title).toBe("탭 고정 또는 해제");
  expect(entry.keywords).toContain("Pin or unpin tab");
  expect(registry.execute(entry.id)).toBe(true);
  expect(called).toBe(true);
});
