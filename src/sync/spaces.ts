// Receive-only Sync 1.5 Spaces engine: Zen Browser's custom "spaces"
// collection (SyncEngine name "Spaces" → collection "spaces"). Cleartexts
// are `{ id, kind, data }` with kinds container|space|tab|folder|split|layout
// (see ZenSpacesSync.sys.mjs). Yeoyu displays the tree; it never writes.

import type { KeyBundle } from "./crypto";
import type {
  SyncedSpace,
  SyncedSpaceFolderItem,
  SyncedSpaceItem,
  SyncedSpaceSplitItem,
  SyncedSpaceTabItem,
  SyncedSpacesTree,
} from "./model";
import {
  StorageContext,
  decryptRecordCleartext,
  fetchCollection,
} from "./sync15";

/** Page size for the spaces collection fetch. */
const SPACES_PAGE_RECORDS = 200;

export const SPACES_RECORD_KINDS = {
  CONTAINER: "container",
  SPACE: "space",
  TAB: "tab",
  FOLDER: "folder",
  SPLIT: "split",
  LAYOUT: "layout",
} as const;

export const SPACES_LAYOUT_RECORD_ID = "layout";

interface WireCleartext {
  id?: unknown;
  kind?: unknown;
  deleted?: unknown;
  data?: unknown;
}

interface ParsedRecord {
  id: string;
  kind: string;
  data: Record<string, unknown>;
}

/** Parse one decrypted spaces cleartext into a typed record, or null when
 * the payload is a tombstone / unusable junk (must not poison the tree). */
export function parseSpacesCleartext(
  bsoId: string,
  cleartext: string
): ParsedRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleartext);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const raw = parsed as WireCleartext;
  if (raw.deleted === true) return null;
  const id =
    typeof raw.id === "string" && raw.id.length > 0
      ? raw.id
      : bsoId.length > 0
        ? bsoId
        : null;
  if (id === null) return null;
  if (typeof raw.kind !== "string" || raw.kind.length === 0) return null;
  if (typeof raw.data !== "object" || raw.data === null) return null;
  return { id, kind: raw.kind, data: raw.data as Record<string, unknown> };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function tabFromData(id: string, data: Record<string, unknown>): SyncedSpaceTabItem | null {
  const url = asString(data.url);
  if (!url) return null;
  const title = asString(data.title) ?? asString(data.staticLabel) ?? url;
  const icon = asString(data.icon) ?? undefined;
  return {
    kind: "tab",
    id,
    title,
    url,
    ...(icon ? { icon } : {}),
    pinned: data.pinned === true,
    essential: data.essential === true,
  };
}

/** Build the display tree from a full spaces-collection dump. Unknown kinds
 * (containers, future records) are ignored; cycles in folder children are cut. */
export function buildSyncedSpacesTree(records: ParsedRecord[]): SyncedSpacesTree {
  const byId = new Map<string, ParsedRecord>();
  for (const record of records) byId.set(record.id, record);

  const layout = byId.get(SPACES_LAYOUT_RECORD_ID);
  const layoutData =
    layout?.kind === SPACES_RECORD_KINDS.LAYOUT ? layout.data : null;

  const spaceOrder: string[] = [];
  if (layoutData) {
    for (const uuid of asStringList(layoutData.spaces)) {
      if (!spaceOrder.includes(uuid)) spaceOrder.push(uuid);
    }
  }
  for (const record of records) {
    if (
      record.kind === SPACES_RECORD_KINDS.SPACE &&
      !spaceOrder.includes(record.id)
    ) {
      spaceOrder.push(record.id);
    }
  }

  const resolveTab = (id: string): SyncedSpaceTabItem | null => {
    const record = byId.get(id);
    if (!record || record.kind !== SPACES_RECORD_KINDS.TAB) return null;
    return tabFromData(id, record.data);
  };

  const resolveChildren = (
    childIds: string[],
    ancestry: Set<string>
  ): SyncedSpaceItem[] => {
    const out: SyncedSpaceItem[] = [];
    for (const childId of childIds) {
      if (ancestry.has(childId)) continue;
      const record = byId.get(childId);
      if (!record) continue;
      if (record.kind === SPACES_RECORD_KINDS.TAB) {
        const tab = tabFromData(childId, record.data);
        if (tab) out.push(tab);
        continue;
      }
      if (record.kind === SPACES_RECORD_KINDS.FOLDER) {
        const next = new Set(ancestry);
        next.add(childId);
        const parentFolderId = asString(record.data.parentFolderId);
        const folder: SyncedSpaceFolderItem = {
          kind: "folder",
          id: childId,
          name: asString(record.data.name) ?? childId,
          ...(asString(record.data.icon)
            ? { icon: asString(record.data.icon)! }
            : {}),
          ...(parentFolderId ? { parentFolderId } : { parentFolderId: null }),
          children: resolveChildren(asStringList(record.data.children), next),
        };
        out.push(folder);
        continue;
      }
      if (record.kind === SPACES_RECORD_KINDS.SPLIT) {
        const memberTabs: SyncedSpaceTabItem[] = [];
        for (const tabId of asStringList(record.data.tabs)) {
          const tab = resolveTab(tabId);
          if (tab) memberTabs.push(tab);
        }
        if (memberTabs.length === 0) continue;
        const split: SyncedSpaceSplitItem = {
          kind: "split",
          id: childId,
          tabs: memberTabs,
        };
        out.push(split);
      }
    }
    return out;
  };

  const spaces: SyncedSpace[] = [];
  for (const uuid of spaceOrder) {
    const record = byId.get(uuid);
    if (!record || record.kind !== SPACES_RECORD_KINDS.SPACE) continue;
    spaces.push({
      uuid,
      name: asString(record.data.name) ?? uuid,
      ...(asString(record.data.icon)
        ? { icon: asString(record.data.icon)! }
        : {}),
      children: resolveChildren(
        asStringList(record.data.children),
        new Set([uuid])
      ),
    });
  }

  const essentials: SyncedSpaceTabItem[] = [];
  const seenEssential = new Set<string>();
  if (layoutData && typeof layoutData.essentials === "object" && layoutData.essentials) {
    for (const tabIds of Object.values(
      layoutData.essentials as Record<string, unknown>
    )) {
      for (const tabId of asStringList(tabIds)) {
        if (seenEssential.has(tabId)) continue;
        const tab = resolveTab(tabId);
        if (!tab) continue;
        seenEssential.add(tabId);
        essentials.push({ ...tab, essential: true });
      }
    }
  }
  // Fallback: any tab marked essential that the layout omitted.
  for (const record of records) {
    if (record.kind !== SPACES_RECORD_KINDS.TAB) continue;
    if (record.data.essential !== true) continue;
    if (seenEssential.has(record.id)) continue;
    const tab = tabFromData(record.id, record.data);
    if (!tab) continue;
    seenEssential.add(record.id);
    essentials.push({ ...tab, essential: true });
  }

  return { spaces, essentials };
}

/** Count openable urls in a spaces tree (tabs + split members). */
export function countSyncedSpaceTabs(tree: SyncedSpacesTree): number {
  let count = tree.essentials.length;
  const walk = (items: SyncedSpaceItem[]) => {
    for (const item of items) {
      if (item.kind === "tab") count += 1;
      else if (item.kind === "split") count += item.tabs.length;
      else walk(item.children);
    }
  };
  for (const space of tree.spaces) walk(space.children);
  return count;
}

/** Fetch and decrypt the spaces collection (pagination-aware). Missing or
 * empty collections yield an empty tree; decrypt/parse failures skip the
 * record rather than failing the flight. Uses the spaces collection key
 * when crypto/keys has one (a-s key_for_collection), else the default. */
export async function fetchSyncedSpaces(
  context: StorageContext,
  spacesBundle: KeyBundle
): Promise<SyncedSpacesTree> {
  const collection = await fetchCollection(context, "spaces", {
    limit: SPACES_PAGE_RECORDS,
  });
  if (collection.status === 404) {
    return { spaces: [], essentials: [] };
  }
  if (collection.status !== 200) {
    throw new Error(`spaces ${collection.status}`);
  }
  const parsed: ParsedRecord[] = [];
  for (const bso of collection.records) {
    let cleartext: string;
    try {
      cleartext = decryptRecordCleartext(spacesBundle, bso);
    } catch {
      continue;
    }
    const record = parseSpacesCleartext(bso.id, cleartext);
    if (record) parsed.push(record);
  }
  return buildSyncedSpacesTree(parsed);
}
