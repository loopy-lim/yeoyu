export interface MenuAnchor {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export type OverlayPlacement = "top" | "bottom" | "left" | "right";
export type OverlayAlign = "start" | "center" | "end";

export interface AnchoredPositionOptions {
  placement?: OverlayPlacement;
  align?: OverlayAlign;
  offset?: number;
  inset?: number;
}

/**
 * Unikit `computeOverlayPosition` contract adapted for both pointer-origin
 * `{ x, y }` menus and measured element rects `{ x, y, width, height }`,
 * clamping the surface inside the visible window with consistent `inset`.
 */
export function computeAnchoredPosition(
  anchor: MenuAnchor | undefined,
  window: { width: number; height: number },
  preferredWidth: number,
  measuredHeight: number,
  options: AnchoredPositionOptions = {}
) {
  const inset = options.inset ?? 12;
  const placement = options.placement ?? "bottom";
  const align = options.align ?? "start";
  const offset = options.offset ?? 0;

  const width = Math.min(preferredWidth, Math.max(0, window.width - inset * 2));
  const maxHeight = Math.max(0, window.height - inset * 2);
  const height = Math.min(measuredHeight, maxHeight);

  if (!anchor) {
    return {
      left: Math.max(inset, Math.min((window.width - width) / 2, window.width - width - inset)),
      top: Math.max(inset, Math.min((window.height - height) / 2, window.height - height - inset)),
      width,
      maxHeight,
    };
  }

  const aw = anchor.width ?? 0;
  const ah = anchor.height ?? 0;
  let rawLeft = anchor.x;
  let rawTop = anchor.y;

  if (placement === "bottom" || placement === "top") {
    rawTop = placement === "bottom" ? anchor.y + ah + offset : anchor.y - height - offset;
    rawLeft =
      align === "start"
        ? anchor.x
        : align === "center"
        ? anchor.x + (aw - width) / 2
        : anchor.x + aw - width;
  } else {
    rawLeft = placement === "right" ? anchor.x + aw + offset : anchor.x - width - offset;
    rawTop =
      align === "start"
        ? anchor.y
        : align === "center"
        ? anchor.y + (ah - height) / 2
        : anchor.y + ah - height;
  }

  return {
    left: Math.max(inset, Math.min(rawLeft, window.width - width - inset)),
    top: Math.max(inset, Math.min(rawTop, window.height - height - inset)),
    width,
    maxHeight,
  };
}

export function menuPosition(
  anchor: MenuAnchor | undefined,
  window: { width: number; height: number },
  preferredWidth: number,
  measuredHeight: number
) {
  return computeAnchoredPosition(anchor, window, preferredWidth, measuredHeight, {
    placement: "bottom",
    align: "start",
    offset: 0,
    inset: 12,
  });
}
