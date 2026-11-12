// Sync bookmarks records → display tree. Pure; mirrors the record schema of
// application-services components/places/src/bookmark_sync/record.rs.
// Folder `children` arrays are the source of truth for ordering; tombstones
// are dropped; nodes with unresolvable parents land in a pseudo-folder so no
// data silently disappears.

import { ROOT_GUIDS, ROOT_ORDER, SyncNode, SyncTree, UNRESOLVED_PARENT_GUID } from "./model";

/** Decrypted bookmark payload (only fields Phase 1 consumes). */
export interface BookmarkRecord {
  id: string;
  parentid?: string;
  parentName?: string;
  dateAdded?: string | number;
  hasDupe?: boolean;
  title?: string;
  bmkUri?: string;
  keyword?: string;
  tags?: unknown[];
  folderName?: string;
  feedUri?: string;
  siteUri?: string;
  pos?: number;
  children?: string[];
  type?: string;
  deleted?: boolean;
  [key: string]: unknown;
}

export interface DecryptedRecord {
  guid: string;
  payload: BookmarkRecord;
}

function nodeType(payload: BookmarkRecord): SyncNode["type"] | null {
  switch (payload.type) {
    case "bookmark":
    case "query":
    case "folder":
    case "livemark":
    case "separator":
      return payload.type;
    default:
      return null;
  }
}

function isRootGuid(guid: string): boolean {
  return ROOT_ORDER.includes(guid);
}

/**
 * Build the display tree. Same input → same output (idempotent by
 * construction: records are keyed by guid and the tree is rebuilt whole).
 */
export function buildSyncTree(
  records: DecryptedRecord[],
  bookmarksModified: number | null
): SyncTree {
  const byGuid = new Map<string, BookmarkRecord>();
  for (const { guid, payload } of records) {
    if (payload.deleted === true) continue; // tombstone
    if (isRootGuid(guid) && payload.type !== "folder") continue;
    if (!nodeType(payload) && payload.type !== undefined) continue;
    byGuid.set(guid, payload);
  }

  // Materialize nodes with their children lists; guard against cycles.
  const building = new Set<string>();
  const built = new Map<string, SyncNode>();

  const buildNode = (guid: string): SyncNode | null => {
    const existing = built.get(guid);
    if (existing) return existing;
    const payload = byGuid.get(guid);
    if (!payload) return null;
    if (building.has(guid)) return null; // cycle — drop this edge
    building.add(guid);
    const type = payload.type === undefined ? null : nodeType(payload);
    const node: SyncNode = {
      guid,
      type: type ?? "bookmark",
      title: payload.title,
      url: payload.bmkUri,
      dateAdded:
        payload.dateAdded === undefined || typeof payload.dateAdded === "number"
          ? String(payload.dateAdded ?? "")
          : payload.dateAdded,
    };
    if (payload.type === "folder") {
      node.children = [];
      for (const childGuid of payload.children ?? []) {
        const child = buildNode(childGuid);
        if (child) node.children.push(child);
      }
    }
    building.delete(guid);
    built.set(guid, node);
    return node;
  };

  const roots: SyncNode[] = [];
  const seen = new Set<string>();
  for (const rootGuid of ROOT_ORDER) {
    const root = byGuid.get(rootGuid);
    if (!root) continue;
    const node = buildNode(rootGuid);
    if (node) {
      roots.push(node);
      seen.add(rootGuid);
    }
  }

  // Anything not reachable from the standard roots goes to the pseudo-folder
  // (`built` is exactly the reachable set after the root pass).
  const orphans: SyncNode[] = [];
  for (const guid of byGuid.keys()) {
    if (seen.has(guid) || built.has(guid)) continue;
    const node = buildNode(guid);
    if (node) orphans.push(node);
  }
  if (orphans.length > 0) {
    roots.push({
      guid: UNRESOLVED_PARENT_GUID,
      type: "folder",
      title: "unresolved",
      children: orphans,
    });
  }

  return {
    roots,
    fetchedAt: Date.now(),
    bookmarksModified,
  };
}

export function countBookmarkNodes(tree: SyncTree): number {
  let count = 0;
  const visit = (node: SyncNode) => {
    if (node.type === "bookmark" || node.type === "query") count += 1;
    node.children?.forEach(visit);
  };
  tree.roots.forEach(visit);
  return count;
}
