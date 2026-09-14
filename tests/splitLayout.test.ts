import { expect, test } from "bun:test";
import {
  clampSplitRatio,
  commitSplitDrop,
  dropZoneAt,
} from "../src/splitLayout";

const bounds = { x: 100, y: 50, width: 1000, height: 600 };

test("rejects points outside the content bounds", () => {
  expect(dropZoneAt({ x: 50, y: 300 }, bounds)).toBeNull();
  expect(dropZoneAt({ x: 1101, y: 300 }, bounds)).toBeNull();
});

test("broad side zones win at corners", () => {
  expect(dropZoneAt({ x: 110, y: 60 }, bounds)).toBe("left");
  expect(dropZoneAt({ x: 1090, y: 60 }, bounds)).toBe("right");
});

test("top and bottom zones occupy only the central edges", () => {
  expect(dropZoneAt({ x: 600, y: 60 }, bounds)).toBe("top");
  expect(dropZoneAt({ x: 600, y: 640 }, bounds)).toBe("bottom");
  expect(dropZoneAt({ x: 600, y: 300 }, bounds)).toBeNull();
});

test("split ratio clamps to 25 through 75 percent", () => {
  expect(clampSplitRatio(0.1)).toBe(0.25);
  expect(clampSplitRatio(0.6)).toBe(0.6);
  expect(clampSplitRatio(0.9)).toBe(0.75);
});

test("drop orientation and ordering follow the destination edge", () => {
  expect(commitSplitDrop(null, "b", "a", "left")).toEqual({
    orientation: "horizontal",
    first: "b",
    second: "a",
    ratio: 0.5,
  });
  expect(commitSplitDrop(null, "b", "a", "bottom")).toEqual({
    orientation: "vertical",
    first: "a",
    second: "b",
    ratio: 0.5,
  });
});

test("reordering visible tabs never duplicates a TabId", () => {
  const current = {
    orientation: "horizontal" as const,
    first: "a",
    second: "b",
    ratio: 0.6,
  };
  expect(commitSplitDrop(current, "a", "a", "right")).toEqual({
    orientation: "horizontal",
    first: "b",
    second: "a",
    ratio: 0.6,
  });
  expect(commitSplitDrop(null, "a", "a", "left")).toBeNull();
});
