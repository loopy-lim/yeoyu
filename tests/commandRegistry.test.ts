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
