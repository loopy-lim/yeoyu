export interface MenuAnchor {
  x: number;
  y: number;
}

export function menuPosition(
  anchor: MenuAnchor | undefined,
  window: { width: number; height: number },
  preferredWidth: number,
  measuredHeight: number
) {
  const inset = 12;
  const width = Math.min(preferredWidth, Math.max(0, window.width - inset * 2));
  const maxHeight = Math.max(0, window.height - inset * 2);
  const height = Math.min(measuredHeight, maxHeight);
  return {
    left: Math.max(
      inset,
      Math.min(
        anchor?.x ?? (window.width - width) / 2,
        window.width - width - inset
      )
    ),
    top: Math.max(
      inset,
      Math.min(
        anchor?.y ?? (window.height - height) / 2,
        window.height - height - inset
      )
    ),
    width,
    maxHeight,
  };
}
