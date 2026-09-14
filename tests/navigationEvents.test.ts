import { expect, test } from "bun:test";
import { NavigationEventOrder } from "../src/navigationEvents";

test("a late retired-session global event cannot undo the replacement surface's fullscreen state", () => {
  const order = new NavigationEventOrder();
  let fullscreen = false;
  const receive = (event: {
    tabId: string;
    navigationSequence: number;
    fullscreen: boolean;
  }) => {
    if (order.accept(event)) fullscreen = event.fullscreen;
  };
  receive({ tabId: "video", navigationSequence: 11, fullscreen: true });
  receive({ tabId: "video", navigationSequence: 13, fullscreen: true });
  receive({ tabId: "video", navigationSequence: 12, fullscreen: false });
  expect(fullscreen).toBe(true);
  receive({ tabId: "video", navigationSequence: 14, fullscreen: false });
  expect(fullscreen).toBe(false);
});

test("duplicate navigation does not repeat persistence and histories are independent per tab", () => {
  const order = new NavigationEventOrder();
  expect(order.accept({ tabId: "a", navigationSequence: 9 })).toBe(true);
  expect(order.accept({ tabId: "a", navigationSequence: 9 })).toBe(false);
  expect(order.accept({ tabId: "b", navigationSequence: 8 })).toBe(true);
});

test("legacy events are accepted until that tab reports an ordered event", () => {
  const order = new NavigationEventOrder();
  expect(order.accept({ tabId: "a" })).toBe(true);
  expect(order.accept({ tabId: "a", navigationSequence: 2 })).toBe(true);
  expect(order.accept({ tabId: "a" })).toBe(false);
  for (const sequence of [NaN, Infinity, -1, 0, 1.5])
    expect(order.accept({ tabId: "a", navigationSequence: sequence })).toBe(
      false
    );
});

test("closing tabs releases their event order while preserving surviving tabs", () => {
  const order = new NavigationEventOrder();
  order.accept({ tabId: "a", navigationSequence: 3 });
  order.accept({ tabId: "b", navigationSequence: 4 });
  order.retain(new Set(["b"]));
  expect(order.accept({ tabId: "a", navigationSequence: 1 })).toBe(true);
  expect(order.accept({ tabId: "b", navigationSequence: 3 })).toBe(false);
});
