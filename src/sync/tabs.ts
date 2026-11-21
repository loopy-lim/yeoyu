// Sync 1.5 tabs engine, both directions: one BSO per device in the "tabs"
// collection, encrypted with the DEFAULT key bundle (tabs has no dedicated
// collection key). The receive side displays what other clients (Zen,
// Firefox desktop/mobile) published; the publish side uploads this device's
// tabs plus our clients-collection device record (see buildClientsRecordCleartext).

import type { KeyBundle } from "./crypto";
import type { SyncedDeviceTabs, SyncedTab } from "./model";
import {
  StorageContext,
  decryptRecordCleartext,
  fetchCollection,
} from "./sync15";

/** Page size for the tabs collection fetch (a device BSO per page-full). */
const TABS_PAGE_RECORDS = 100;

/** Cap on the retained back-history per tab — the wire can carry the whole
 * session history; only the newest slice is useful for pick-up display. */
const MAX_URL_HISTORY = 10;

/** Cap on tabs published per device (Fenix sends at most 25). */
const MAX_PUBLISHED_TABS = 25;

/** Local tab view the host app supplies for publishing (PLAN: the store
 *  never touches the controller — App.tsx adapts the controller snapshot). */
export interface LocalTabForSync {
  title: string;
  url: string;
  lastUsedMs: number | null;
}

/** Wire cleartext of one tabs BSO (desktop services-sync tabs.js / a-s
 * TabsRecord, unknown fields ignored). */
interface TabsWirePayload {
  id?: unknown;
  clientName?: unknown;
  tabs?: unknown;
}

interface TabWireEntry {
  title?: unknown;
  urlHistory?: unknown;
  icon?: unknown;
  lastUsed?: unknown;
}

/** Parse one decrypted tabs cleartext; null when it is not a usable record
 * (junk from a broken client must not poison the whole panel). */
export function parseTabsCleartext(
  clientId: string,
  modifiedSeconds: number,
  cleartext: string
): SyncedDeviceTabs | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleartext);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const raw = parsed as TabsWirePayload;
  const clientName =
    typeof raw.clientName === "string" && raw.clientName.length > 0
      ? raw.clientName
      : clientId;
  if (!Array.isArray(raw.tabs)) return null;

  const tabs: SyncedTab[] = [];
  for (const entry of raw.tabs as TabWireEntry[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const history = Array.isArray(entry.urlHistory)
      ? entry.urlHistory.filter((url): url is string => typeof url === "string" && url.length > 0)
      : [];
    // Current url is the LAST urlHistory entry; without one there is
    // nothing to open.
    const current = history.at(-1);
    if (current === undefined) continue;
    const back = history.slice(0, -1).slice(-MAX_URL_HISTORY);
    tabs.push({
      title: typeof entry.title === "string" ? entry.title : current,
      url: current,
      urlHistory: back,
      lastUsedMs:
        typeof entry.lastUsed === "number" && Number.isFinite(entry.lastUsed)
          ? entry.lastUsed
          : null,
      ...(typeof entry.icon === "string" && entry.icon.length > 0
        ? { icon: entry.icon }
        : {}),
    });
  }
  return { clientId, clientName, tabs, modifiedSeconds };
}

/** Parse + order a fetched tabs collection: tabs by recency inside a device,
 * devices by their most recent tab. */
export function orderSyncedTabs(devices: SyncedDeviceTabs[]): SyncedDeviceTabs[] {
  const tabTime = (tab: SyncedTab): number => tab.lastUsedMs ?? 0;
  return devices
    .map((device) => ({
      ...device,
      tabs: [...device.tabs].sort((a, b) => tabTime(b) - tabTime(a)),
    }))
    .sort(
      (a, b) =>
        Math.max(0, ...b.tabs.map(tabTime)) - Math.max(0, ...a.tabs.map(tabTime))
    );
}

/** Fetch and decrypt the tabs collection (pagination-aware). Devices whose
 * cleartext fails to parse are dropped, not fatal. */
export async function fetchSyncedTabs(
  context: StorageContext,
  defaultBundle: KeyBundle
): Promise<SyncedDeviceTabs[]> {
  const collection = await fetchCollection(context, "tabs", {
    limit: TABS_PAGE_RECORDS,
  });
  if (collection.status !== 200) {
    throw new Error(`tabs ${collection.status}`);
  }
  const devices: SyncedDeviceTabs[] = [];
  for (const bso of collection.records) {
    let cleartext: string;
    try {
      cleartext = decryptRecordCleartext(defaultBundle, bso);
    } catch {
      continue;
    }
    const parsed = parseTabsCleartext(bso.id, bso.modified, cleartext);
    if (parsed && parsed.tabs.length > 0) devices.push(parsed);
  }
  return orderSyncedTabs(devices);
}

// ---------------------------------------------------------------------------
// Publish side — our own device's records in the clients/tabs collections.

/** Wire cleartext of the clients-collection device record (a-s client record;
 * unknown fields are ignored by readers, the essentials are name + type). */
export function buildClientsRecordCleartext(
  clientId: string,
  clientName: string
): string {
  return JSON.stringify({
    id: clientId,
    name: clientName,
    type: "mobile",
    version: "128.0",
    protocols: ["1.5"],
    formfactor: "tablet",
  });
}

/** Wire cleartext of our tabs BSO — capped, most recently used first, the
 * current url as the single urlHistory entry (matches the reader above:
 * last entry = current url). Returns null when there is nothing worth
 * publishing (an empty tab list would blank the record on other clients). */
export function buildTabsRecordCleartext(
  clientId: string,
  clientName: string,
  tabs: LocalTabForSync[]
): string | null {
  const usable = tabs
    .filter((tab) => typeof tab.url === "string" && tab.url.length > 0)
    .sort((a, b) => (b.lastUsedMs ?? 0) - (a.lastUsedMs ?? 0))
    .slice(0, MAX_PUBLISHED_TABS);
  if (usable.length === 0) return null;
  return JSON.stringify({
    id: clientId,
    clientName,
    tabs: usable.map((tab) => ({
      title: typeof tab.title === "string" && tab.title.length > 0 ? tab.title : tab.url,
      urlHistory: [tab.url],
      lastUsed: tab.lastUsedMs ?? 0,
    })),
  });
}

