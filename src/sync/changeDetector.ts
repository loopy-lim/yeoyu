import type { LocalBookmarkSnapshot } from "./model";

export interface BookmarkChangeDiff {
  created: string[];
  updated: string[];
  deleted: string[];
  foldersCreated: string[];
  foldersRenamed: string[];
  foldersDeleted: string[];
}

function folderKey(folderId: string | undefined): string {
  return folderId ?? "";
}

function indexById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/** Pure snapshot diff for bookmark/folder CRUD (PLAN D4). */
export function diffBookmarks(
  prev: LocalBookmarkSnapshot,
  next: LocalBookmarkSnapshot
): BookmarkChangeDiff {
  const result: BookmarkChangeDiff = {
    created: [],
    updated: [],
    deleted: [],
    foldersCreated: [],
    foldersRenamed: [],
    foldersDeleted: [],
  };

  const prevBookmarks = indexById(prev.bookmarks);
  const nextBookmarks = indexById(next.bookmarks);
  for (const [id, bookmark] of nextBookmarks) {
    const prior = prevBookmarks.get(id);
    if (!prior) {
      result.created.push(id);
      continue;
    }
    if (
      prior.title !== bookmark.title ||
      prior.url !== bookmark.url ||
      folderKey(prior.folderId) !== folderKey(bookmark.folderId)
    ) {
      result.updated.push(id);
    }
  }
  for (const id of prevBookmarks.keys()) {
    if (!nextBookmarks.has(id)) result.deleted.push(id);
  }

  const prevFolders = indexById(prev.bookmarkFolders);
  const nextFolders = indexById(next.bookmarkFolders);
  for (const [id, folder] of nextFolders) {
    const prior = prevFolders.get(id);
    if (!prior) {
      result.foldersCreated.push(id);
      continue;
    }
    if (prior.title !== folder.title) result.foldersRenamed.push(id);
  }
  for (const id of prevFolders.keys()) {
    if (!nextFolders.has(id)) result.foldersDeleted.push(id);
  }

  return result;
}
