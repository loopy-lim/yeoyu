import { test, expect } from "bun:test";
import { miniPlayerTabs, SerialQueue } from "../src/policy";
test("mini players exclude both visible split panes and dismissed tabs", () => {
  expect(
    miniPlayerTabs(["a", "b", "c", "d"], new Set(["a", "b"]), new Set(["d"]))
  ).toEqual(["c"]);
});
test("mutations execute in order even after a rejected operation", async () => {
  const queue = new SerialQueue();
  const sequence: string[] = [];
  const one = queue.run(async () => {
    await new Promise((r) => setTimeout(r, 5));
    sequence.push("close");
    throw Error("rejected");
  });
  const two = queue.run(async () => {
    sequence.push("navigate");
  });
  await one.catch(() => {});
  await two;
  expect(sequence).toEqual(["close", "navigate"]);
});
