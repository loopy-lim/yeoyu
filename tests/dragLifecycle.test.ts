import { expect, test } from "bun:test";
import { DragLifecycle } from "../src/dragLifecycle";

test("a release sees a just-started gesture before a React render", () => {
  const gesture = new DragLifecycle<{ tabId: string }>();
  gesture.begin({ tabId: "a" });
  expect(gesture.release()?.value.tabId).toBe("a");
  expect(gesture.release()).toBeNull();
});

test("an old exit animation cannot clear a newer drag", () => {
  const gesture = new DragLifecycle<string>();
  gesture.begin("a");
  const old = gesture.release()!;
  gesture.begin("b");
  expect(gesture.finish(old.id)).toBe(false);
  const current = gesture.release()!;
  expect(current.value).toBe("b");
  expect(gesture.finish(current.id)).toBe(true);
  expect(gesture.release()).toBeNull();
});

test("cancellation prevents both drop and delayed cleanup", () => {
  const gesture = new DragLifecycle<string>();
  gesture.begin("a");
  const current = gesture.release()!;
  gesture.cancel();
  expect(gesture.release()).toBeNull();
  expect(gesture.finish(current.id)).toBe(false);
});
