export type DropZone = "left" | "right" | "top" | "bottom";
export type SplitOrientation = "horizontal" | "vertical";

export interface Point {
  x: number;
  y: number;
}
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface SplitLayout {
  orientation: SplitOrientation;
  first: string;
  second: string;
  ratio: number;
}

export function dropZoneAt(point: Point, bounds: Bounds): DropZone | null {
  const rx = (point.x - bounds.x) / bounds.width;
  const ry = (point.y - bounds.y) / bounds.height;
  if (rx < 0 || rx > 1 || ry < 0 || ry > 1) return null;
  if (rx <= 0.3) return "left";
  if (rx >= 0.7) return "right";
  if (ry <= 0.22) return "top";
  if (ry >= 0.78) return "bottom";
  return null;
}

export function clampSplitRatio(ratio: number): number {
  return Math.max(0.25, Math.min(0.75, ratio));
}

export function commitSplitDrop(
  current: SplitLayout | null,
  dragged: string,
  target: string,
  zone: DropZone
): SplitLayout | null {
  const other =
    dragged !== target
      ? target
      : current?.first === dragged
      ? current.second
      : current?.second === dragged
      ? current.first
      : null;
  if (!other || other === dragged) return null;
  const leading = zone === "left" || zone === "top";
  return {
    orientation:
      zone === "left" || zone === "right" ? "horizontal" : "vertical",
    first: leading ? dragged : other,
    second: leading ? other : dragged,
    ratio: current?.ratio ?? 0.5,
  };
}
