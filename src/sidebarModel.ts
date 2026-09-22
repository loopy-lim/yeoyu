export interface TileBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Restored native snapshots always carry an explicit Space for saved items. */
export function libraryItemsForSpace<T extends { workspaceId?: string }>(
  items: readonly T[],
  workspaceId: string
): T[] {
  return items.filter((item) => item.workspaceId === workspaceId);
}

export function liveSplitLayout<T extends { first: string; second: string }>(
  layout: T | null,
  tabs: readonly { id: string; suspended?: boolean }[]
): T | null {
  return layout &&
    tabs.some((tab) => tab.id === layout.first && !tab.suspended) &&
    tabs.some((tab) => tab.id === layout.second && !tab.suspended)
    ? layout
    : null;
}

export function sidebarTabMoveIndex(
  tabs: readonly { id: string }[],
  tabId: string,
  y: number,
  rows: readonly { id: string; y: number; height: number }[]
): number | null {
  const from = tabs.findIndex((tab) => tab.id === tabId);
  const others = rows
    .filter((row) => row.id !== tabId)
    .sort((a, b) => a.y - b.y);
  if (from < 0 || !others.length) return null;
  const next = others.find((row) => y < row.y + row.height / 2);
  const anchor = next ?? others[others.length - 1];
  const anchorIndex = tabs.findIndex((tab) => tab.id === anchor.id);
  if (anchorIndex < 0) return null;
  return anchorIndex - (from < anchorIndex ? 1 : 0) + (next ? 0 : 1);
}

export function sidebarDropChange(
  tab: { favorite?: boolean; pinned?: boolean },
  region: "favorites" | "pinned" | "ordinary"
): "favorite" | "pin" | "unfavorite" | "unpin" | null {
  if (region === "favorites") return tab.favorite ? null : "favorite";
  if (region === "pinned") return tab.pinned ? null : "pin";
  if (tab.favorite) return "unfavorite";
  if (tab.pinned) return "unpin";
  return null;
}

/** Resolve an insertion slot from the actual wrapped favorite tile layout. */
export function favoriteDropIndex(
  x: number,
  y: number,
  tiles: readonly TileBounds[]
): number {
  if (!tiles.length) return 0;
  const nearest = tiles.reduce((best, tile) =>
    Math.abs(y - tile.y - tile.height / 2) <
    Math.abs(y - best.y - best.height / 2)
      ? tile
      : best
  );
  const row = tiles
    .map((tile, index) => ({ tile, index }))
    .filter(({ tile }) => Math.abs(tile.y - nearest.y) < 1);
  return (
    row.find(({ tile }) => x < tile.x + tile.width / 2)?.index ??
    row[row.length - 1].index + 1
  );
}

/** Native move indices refer to the array after removing the dragged tab. */
export function favoriteMoveIndex(
  tabs: readonly { id: string; favorite?: boolean }[],
  tabId: string,
  slot: number,
  visibleFavoriteIds?: readonly string[]
): number | null {
  const from = tabs.findIndex((tab) => tab.id === tabId);
  if (from < 0) return null;
  const favorites = tabs.filter((tab) => tab.favorite);
  if (visibleFavoriteIds) {
    const visible = new Set(visibleFavoriteIds);
    const shown = favorites.filter((tab) => visible.has(tab.id));
    const next = shown[Math.max(0, Math.min(shown.length, slot))];
    const last = shown.at(-1);
    slot = next
      ? favorites.indexOf(next)
      : last
      ? favorites.indexOf(last) + 1
      : favorites.length;
  }
  const oldSlot = favorites.findIndex((tab) => tab.id === tabId);
  const targetSlot = Math.max(0, Math.min(favorites.length, slot));
  if (oldSlot >= 0 && (targetSlot === oldSlot || targetSlot === oldSlot + 1))
    return from;
  const remaining = tabs.filter((tab) => tab.id !== tabId);
  const next = favorites.slice(targetSlot).find((tab) => tab.id !== tabId);
  if (next) return remaining.findIndex((tab) => tab.id === next.id);
  const last = favorites.filter((tab) => tab.id !== tabId).at(-1);
  return last ? remaining.findIndex((tab) => tab.id === last.id) + 1 : from;
}

export function sidebarAddressLabel(url: string): string {
  if (!url || url === "about:blank") return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:")
      return parsed.host.replace(/^www\./i, "");
    if (parsed.protocol === "file:")
      return decodeURIComponent(parsed.pathname.split("/").at(-1) || "File");
  } catch {
    /* A non-URL input stays readable until navigation resolves. */
  }
  return url;
}

/** Saved rows only resolve their owning tab within the selected Space. */
export function bookmarkTabsForSpace<
  T extends { bookmarkId?: string; workspaceId: string }
>(tabs: readonly T[], workspaceId: string): Map<string, T> {
  const owners = new Map<string, T>();
  for (const tab of tabs)
    if (tab.bookmarkId && tab.workspaceId === workspaceId)
      owners.set(tab.bookmarkId, tab);
  return owners;
}
