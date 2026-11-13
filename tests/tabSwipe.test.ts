import { expect, test } from "bun:test";
import {
  clampToolbarSwipeOffset,
  classifyToolbarHorizontalSwipe,
  collectSwipeableTabs,
  resolveSwipeTargetTab,
  resolveToolbarSwipeCommit,
  resolveToolbarSwipeDelta,
  type SwipeableTab,
} from "../src/tabSwipe";

const sampleTabs: SwipeableTab[] = [
  { id: "fav", title: "Fav", url: "https://fav.example", favorite: true, workspaceId: "space-2" },
  { id: "t1", title: "One", url: "https://one.example", workspaceId: "space-1" },
  { id: "t2", title: "Two", url: "https://two.example", workspaceId: "space-1" },
  { id: "susp", title: "Suspended", url: "https://s.example", workspaceId: "space-1", suspended: true },
  { id: "other", title: "Other", url: "https://other.example", workspaceId: "space-2" },
];

test("collectSwipeableTabs includes active space tabs and favorites while excluding suspended or foreign tabs", () => {
  expect(collectSwipeableTabs(sampleTabs, "space-1").map((t) => t.id)).toEqual([
    "fav",
    "t1",
    "t2",
  ]);
});

test("resolveSwipeTargetTab wraps around active tabs and ignores single-tab lists", () => {
  const active = collectSwipeableTabs(sampleTabs, "space-1");
  expect(resolveSwipeTargetTab(active, "t1", 1)?.id).toBe("t2");
  expect(resolveSwipeTargetTab(active, "t2", 1)?.id).toBe("fav");
  expect(resolveSwipeTargetTab(active, "fav", -1)?.id).toBe("t2");
  expect(resolveSwipeTargetTab([active[0]!], "fav", 1)).toBeNull();
  expect(resolveSwipeTargetTab([], "fav", 1)).toBeNull();
});

test("classifyToolbarHorizontalSwipe preserves vertical gestures and taps", () => {
  expect(classifyToolbarHorizontalSwipe(4, 2)).toBe("pending");
  expect(classifyToolbarHorizontalSwipe(8, 22)).toBe("reject");
  expect(classifyToolbarHorizontalSwipe(24, 6)).toBe("claim");
  expect(classifyToolbarHorizontalSwipe(-26, 8)).toBe("claim");
});

test("resolveToolbarSwipeCommit commits on sufficient distance or fling velocity", () => {
  expect(resolveToolbarSwipeDelta(-12)).toBe(1);
  expect(resolveToolbarSwipeDelta(12)).toBe(-1);
  expect(resolveToolbarSwipeDelta(4)).toBeNull();

  expect(resolveToolbarSwipeCommit(-60, 0)).toBe(1);
  expect(resolveToolbarSwipeCommit(60, 0)).toBe(-1);
  expect(resolveToolbarSwipeCommit(-34, -0.6)).toBe(1);
  expect(resolveToolbarSwipeCommit(34, 0.6)).toBe(-1);

  expect(resolveToolbarSwipeCommit(-20, -0.9)).toBeNull();
  expect(resolveToolbarSwipeCommit(-40, -0.2)).toBeNull();
  expect(clampToolbarSwipeOffset(200)).toBe(28);
  expect(clampToolbarSwipeOffset(-200)).toBe(-28);
});
