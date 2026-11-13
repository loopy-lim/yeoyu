import { expect, test } from "bun:test";
import { computeAnchoredPosition, menuPosition } from "../src/menuLayout";

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

test("computeAnchoredPosition supports top/bottom/left/right placements and start/center/end alignments for rect anchors", () => {
  const win = { width: 800, height: 600 };
  const rect = { x: 300, y: 250, width: 80, height: 40 };

  expect(
    computeAnchoredPosition(rect, win, 200, 120, {
      placement: "bottom",
      align: "start",
      offset: 6,
    })
  ).toEqual({ left: 300, top: 296, width: 200, maxHeight: 576 });

  expect(
    computeAnchoredPosition(rect, win, 200, 120, {
      placement: "top",
      align: "center",
      offset: 8,
    })
  ).toEqual({ left: 240, top: 122, width: 200, maxHeight: 576 });

  expect(
    computeAnchoredPosition(rect, win, 200, 120, {
      placement: "bottom",
      align: "end",
    })
  ).toEqual({ left: 180, top: 290, width: 200, maxHeight: 576 });

  expect(
    computeAnchoredPosition(rect, win, 200, 120, {
      placement: "right",
      align: "center",
      offset: 10,
    })
  ).toEqual({ left: 390, top: 210, width: 200, maxHeight: 576 });

  expect(
    computeAnchoredPosition(rect, win, 200, 120, {
      placement: "left",
      align: "end",
      offset: 10,
    })
  ).toEqual({ left: 90, top: 170, width: 200, maxHeight: 576 });
});

test("computeAnchoredPosition clamps overflowing left/top/right/bottom positions to custom inset", () => {
  const win = { width: 400, height: 300 };

  expect(
    computeAnchoredPosition({ x: 4, y: 10, width: 20, height: 20 }, win, 200, 100, {
      placement: "left",
      align: "start",
      offset: 10,
      inset: 16,
    })
  ).toEqual({ left: 16, top: 16, width: 200, maxHeight: 268 });

  expect(
    computeAnchoredPosition({ x: 350, y: 280, width: 40, height: 20 }, win, 200, 100, {
      placement: "right",
      align: "end",
      offset: 8,
      inset: 16,
    })
  ).toEqual({ left: 184, top: 184, width: 200, maxHeight: 268 });
});

test("computeAnchoredPosition centers inside window when anchor is omitted", () => {
  expect(
    computeAnchoredPosition(undefined, { width: 600, height: 400 }, 200, 100)
  ).toEqual({ left: 200, top: 150, width: 200, maxHeight: 376 });
});

