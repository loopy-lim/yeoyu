import { expect, test } from "bun:test";
import { ContextPressGuard } from "../src/pressIntent";

test("secondary mouse press opens a menu and suppresses the following responder release", () => {
  const guard = new ContextPressGuard();
  expect(guard.pointerDown("mouse", 2)).toBe(true);
  expect(guard.allowPress()).toBe(false);
  expect(guard.allowPress()).toBe(false);
  guard.reset(); // Menu dismissed: accessibility activation works without a pointer event.
  expect(guard.allowPress()).toBe(true);
});

test("primary mouse and touch contacts retain normal activation", () => {
  const guard = new ContextPressGuard();
  guard.pointerDown("mouse", 2);
  expect(guard.pointerDown("mouse", 0)).toBe(false);
  expect(guard.allowPress()).toBe(true);
  guard.pointerDown("mouse", 2);
  expect(guard.pointerDown("touch", 0)).toBe(false);
  expect(guard.allowPress()).toBe(true);
});
