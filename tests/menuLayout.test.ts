import { expect, test } from "bun:test";
import { menuPosition } from "../src/menuLayout";

test("an anchored menu remains reachable at the lower right of a small window", () => {
  const result = menuPosition(
    { x: 390, y: 470 },
    { width: 400, height: 480 },
    280,
    360
  );
  expect(result.left).toBe(108);
  expect(result.top).toBe(108);
  expect(result.width).toBe(280);
});

test("a menu fits a narrow window and centers when no source is supplied", () => {
  expect(
    menuPosition(undefined, { width: 240, height: 320 }, 280, 400)
  ).toEqual({ left: 12, top: 12, width: 216, maxHeight: 296 });
});
