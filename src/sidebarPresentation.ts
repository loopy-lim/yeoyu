import type { Bookmark, BookmarkFolder, Tab } from "@generated/types";
import type { SplitLayout } from "@/splitLayout";
import { bookmarkTabsForSpace, libraryItemsForSpace } from "@/sidebarModel";

export interface SidebarSplit {
  key: string;
  pages: [Tab, Tab];
  focusedId: string;
  orientation: SplitLayout["orientation"];
}
export interface SidebarFolder {
  folder: BookmarkFolder;
  bookmarks: Bookmark[];
  visibleBookmarks: Bookmark[];
  containsFocused: boolean;
  children: SidebarFolder[];
}

function buildFolderTree(
  spaceFolders: readonly BookmarkFolder[],
  spaceBookmarks: readonly Bookmark[],
  owners: Map<string, Tab>,
  focusedId: string | undefined,
  visibleBookmark: (bookmark: Bookmark) => boolean,
  groupedTabs: Set<string>
): SidebarFolder[] {
  const folderIds = new Set(spaceFolders.map((folder) => folder.id));
  const byParent = new Map<string, BookmarkFolder[]>();
  for (const folder of spaceFolders) {
    const rawParent = folder.parentFolderId ?? "";
    const parent =
      rawParent && folderIds.has(rawParent) ? rawParent : "";
    const list = byParent.get(parent);
    if (list) list.push(folder);
    else byParent.set(parent, [folder]);
  }

  const buildNode = (folder: BookmarkFolder): SidebarFolder => {
    const bookmarks = spaceBookmarks.filter(
      (bookmark) => bookmark.folderId === folder.id
    );
    for (const bookmark of bookmarks) {
      const owner = owners.get(bookmark.id);
      if (owner?.pinned && !owner.favorite) groupedTabs.add(owner.id);
    }
    const children = (byParent.get(folder.id) ?? []).map(buildNode);
    const containsFocused =
      bookmarks.some((bookmark) => {
        const owner = owners.get(bookmark.id);
        return owner?.id === focusedId && !owner?.suspended;
      }) || children.some((child) => child.containsFocused);
    return {
      folder,
      bookmarks,
      visibleBookmarks: bookmarks.filter(visibleBookmark),
      containsFocused,
      children,
    };
  };

  return (byParent.get("") ?? []).map(buildNode);
}

export function findSidebarFolder(
  folders: readonly SidebarFolder[],
  id: string
): SidebarFolder | undefined {
  for (const folder of folders) {
    if (folder.folder.id === id) return folder;
    const nested = findSidebarFolder(folder.children, id);
    if (nested) return nested;
  }
  return undefined;
}

/** Hide empty same-title roots when a populated copy is already shown. */
function dedupeRootFoldersByTitle(
  folders: readonly SidebarFolder[]
): SidebarFolder[] {
  const bestByTitle = new Map<string, SidebarFolder>();
  for (const item of folders) {
    const key = item.folder.title.trim().toLowerCase();
    const prior = bestByTitle.get(key);
    if (!prior) {
      bestByTitle.set(key, item);
      continue;
    }
    const priorScore =
      prior.bookmarks.length + prior.children.length;
    const nextScore = item.bookmarks.length + item.children.length;
    if (nextScore > priorScore) bestByTitle.set(key, item);
  }
  const winners = new Set(
    [...bestByTitle.values()].map((item) => item.folder.id)
  );
  return folders.filter((item) => {
    const key = item.folder.title.trim().toLowerCase();
    if (!bestByTitle.has(key)) return true;
    return winners.has(item.folder.id);
  });
}

export function sidebarPresentation(input: {
  tabs: readonly Tab[];
  bookmarks: readonly Bookmark[];
  folders: readonly BookmarkFolder[];
  workspaceId: string;
  focusedId?: string;
  split: SplitLayout | null;
}): {
  split: SidebarSplit | null;
  favorites: Tab[];
  ordinaryTabs: Tab[];
  pinnedTabs: Tab[];
  privateTabs: Tab[];
  railTabs: Tab[];
  panelTabs: Tab[];
  folders: SidebarFolder[];
  looseBookmarks: Bookmark[];
} {
  const { tabs, workspaceId, focusedId, split: layout } = input;
  // Panels render in the sidebar's web panel area, never in the tab lists,
  // the split rotation, or the content canvas.
  const content = tabs.filter((tab) => !tab.panel);
  const available = content.filter(
    (tab) => tab.favorite || tab.workspaceId === workspaceId
  );
  const first = available.find(
    (tab) => tab.id === layout?.first && !tab.suspended
  );
  const second = available.find(
    (tab) => tab.id === layout?.second && !tab.suspended
  );
  const split: SidebarSplit | null =
    layout &&
    first &&
    second &&
    first.id !== second.id &&
    !!first.private === !!second.private
      ? {
          key: JSON.stringify([first.id, second.id]),
          pages: [first, second],
          focusedId: focusedId === second.id ? second.id : first.id,
          orientation: layout.orientation,
        }
      : null;
  const paired = new Set(split?.pages.map((tab) => tab.id));
  const owners = bookmarkTabsForSpace(content, workspaceId);
  const spaceBookmarks = libraryItemsForSpace(input.bookmarks, workspaceId);
  const spaceFolders = libraryItemsForSpace(input.folders, workspaceId);
  const folderIds = new Set(spaceFolders.map((folder) => folder.id));
  const visibleBookmark = (bookmark: Bookmark): boolean => {
    const owner = owners.get(bookmark.id);
    return (
      !owner ||
      (!owner.favorite && !!owner.pinned && !paired.has(owner.id))
    );
  };
  const groupedTabs = new Set<string>();
  const folders = dedupeRootFoldersByTitle(
    buildFolderTree(
      spaceFolders,
      spaceBookmarks,
      owners,
      focusedId,
      visibleBookmark,
      groupedTabs
    )
  );
  const remaining = content.filter((tab) => !paired.has(tab.id));
  const local = remaining.filter(
    (tab) => tab.workspaceId === workspaceId && !tab.favorite && !tab.private
  );
  return {
    split,
    favorites: remaining.filter((tab) => tab.favorite && !tab.private),
    ordinaryTabs: local.filter((tab) => !tab.pinned),
    pinnedTabs: local.filter((tab) => tab.pinned && !tab.bookmarkId),
    privateTabs: remaining.filter((tab) => tab.private),
    railTabs: local.filter((tab) => !groupedTabs.has(tab.id)),
    // Private panels vanish with the session like private tabs; ordinary
    // panels restore with the space after a restart.
    panelTabs: tabs.filter((tab) => tab.panel && tab.workspaceId === workspaceId),
    folders,
    looseBookmarks: spaceBookmarks.filter(
      (bookmark) =>
        (!bookmark.folderId || !folderIds.has(bookmark.folderId)) &&
        visibleBookmark(bookmark)
    ),
  };
}
