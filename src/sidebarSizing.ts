export const SIDEBAR_WIDTH_MIN = 200;
export const SIDEBAR_WIDTH_MAX = 320;
export const SIDEBAR_WIDTH_STEP = 8;

export function clampSidebarWidth(
  width: number,
  max = SIDEBAR_WIDTH_MAX
): number {
  return Math.max(SIDEBAR_WIDTH_MIN, Math.min(max, Math.round(width)));
}

/** Display constraint only: never persist this result on a window/split change. */
export function sidebarSizing(
  preferredWidth: number,
  availableWidth: number,
  sideBySide: boolean
): { min: number; max: number; width: number } {
  // Budget 320dp per page, the content/pane borders and the split divider.
  // On smaller windows the existing compact rail policy still applies; this
  // budget must not make a manually expanded sidebar narrower than its controls.
  const contentBudget = sideBySide ? 648 : 324;
  const max = clampSidebarWidth(Math.floor(availableWidth - contentBudget));
  return {
    min: SIDEBAR_WIDTH_MIN,
    max,
    width: clampSidebarWidth(preferredWidth, max),
  };
}
