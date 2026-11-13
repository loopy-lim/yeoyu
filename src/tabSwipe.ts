export interface SwipeableTab {
  id: string;
  title: string;
  url: string;
  favorite?: boolean;
  workspaceId: string;
  suspended?: boolean;
}

export type ToolbarSwipeClassifier = "claim" | "reject" | "pending";

export interface TabSwipePreview {
  delta: -1 | 1;
  title: string;
  ready: boolean;
}

export function collectSwipeableTabs<T extends SwipeableTab>(
  tabs: readonly T[],
  activeWorkspaceId: string | null | undefined
): T[] {
  return tabs.filter(
    (tab) =>
      !tab.suspended &&
      (tab.favorite ||
        (activeWorkspaceId != null && tab.workspaceId === activeWorkspaceId))
  );
}

export function resolveSwipeTargetTab<T extends Pick<SwipeableTab, "id">>(
  tabs: readonly T[],
  currentTabId: string | null | undefined,
  delta: -1 | 1
): T | null {
  if (tabs.length <= 1) return null;
  const currentIndex = tabs.findIndex((tab) => tab.id === currentTabId);
  const baseIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (baseIndex + delta + tabs.length) % tabs.length;
  const next = tabs[nextIndex] ?? null;
  if (!next || next.id === currentTabId) return null;
  return next;
}

export function classifyToolbarHorizontalSwipe(
  dx: number,
  dy: number,
  slop = 12
): ToolbarSwipeClassifier {
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  if (absDy > slop && absDy > absDx * 1.1) return "reject";
  if (absDx > slop && absDx > absDy * 1.5) return "claim";
  return "pending";
}

export function resolveToolbarSwipeDelta(dx: number, minPreviewDx = 8): -1 | 1 | null {
  if (dx <= -minPreviewDx) return 1;
  if (dx >= minPreviewDx) return -1;
  return null;
}

export function resolveToolbarSwipeCommit(
  dx: number,
  vx: number,
  thresholdPx = 56,
  minFlingDistancePx = 28,
  minFlingVelocity = 0.45
): -1 | 1 | null {
  if (dx <= -thresholdPx || (dx <= -minFlingDistancePx && vx <= -minFlingVelocity)) {
    return 1;
  }
  if (dx >= thresholdPx || (dx >= minFlingDistancePx && vx >= minFlingVelocity)) {
    return -1;
  }
  return null;
}

export function clampToolbarSwipeOffset(dx: number, maxOffset = 28): number {
  return Math.max(-maxOffset, Math.min(maxOffset, dx * 0.35));
}
