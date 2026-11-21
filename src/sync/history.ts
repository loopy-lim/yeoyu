// Sync 1.5 history engine, receive-only: one BSO per visited URL in the
// "history" collection, encrypted with the DEFAULT key bundle (history has
// no dedicated collection key). Each record's `visits` carries the visit
// events with PRTime epoch-MICROsecond dates; yeoyu surfaces the newest
// visits of the account (Zen, Firefox desktop/mobile) in the history dialog
// and never publishes local history back (see tabs.ts for the bidirectional
// counterpart of this pattern).

import type { KeyBundle } from "./crypto";
import type { SyncedHistoryVisit } from "./model";
import { StorageContext, decryptRecordCleartext, fetchCollection } from "./sync15";

/** Page size for the history collection fetch. */
const HISTORY_PAGE_RECORDS = 100;

/** Cap on fetched records — the newest-modified slice of the collection is
 * enough for display; following every page would walk the account's entire
 * browsing history. */
const HISTORY_MAX_RECORDS = 100;

/** Wire cleartext of one history BSO (a-s places history record / desktop
 * services-sync history.js, unknown fields ignored). */
interface HistoryWirePayload {
  id?: unknown;
  histUri?: unknown;
  title?: unknown;
  visits?: unknown;
  deleted?: unknown;
}

interface VisitWireEntry {
  date?: unknown;
}

/** Parse one decrypted history cleartext into a display visit: the newest
 * visit date wins. Null when it is not a usable record (tombstones, junk
 * from a broken client must not poison the whole panel). */
export function parseHistoryCleartext(
  bsoId: string,
  cleartext: string
): SyncedHistoryVisit | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleartext);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const raw = parsed as HistoryWirePayload;
  if (raw.deleted === true) return null;
  if (typeof raw.histUri !== "string" || raw.histUri.length === 0) return null;
  // Visit dates are PRTime epoch MICROseconds (desktop places convention).
  let newestDateUs = Number.NEGATIVE_INFINITY;
  if (Array.isArray(raw.visits)) {
    for (const visit of raw.visits as VisitWireEntry[]) {
      if (typeof visit !== "object" || visit === null) continue;
      if (
        typeof visit.date === "number" &&
        Number.isFinite(visit.date) &&
        visit.date > newestDateUs
      ) {
        newestDateUs = visit.date;
      }
    }
  }
  // Without a visit date the row has nothing to order or display by.
  if (!Number.isFinite(newestDateUs)) return null;
  return {
    id: bsoId,
    url: raw.histUri,
    title: typeof raw.title === "string" && raw.title.length > 0 ? raw.title : raw.histUri,
    visitedAtMs: Math.round(newestDateUs / 1000),
  };
}

/** Order visits newest-first and cap the retained list. */
export function orderSyncedHistory(
  visits: SyncedHistoryVisit[]
): SyncedHistoryVisit[] {
  return [...visits]
    .sort((a, b) => b.visitedAtMs - a.visitedAtMs)
    .slice(0, HISTORY_MAX_RECORDS);
}

/** Fetch and decrypt the history collection's newest records (pagination
 * capped). Records whose cleartext fails to parse are dropped, not fatal. */
export async function fetchSyncedHistory(
  context: StorageContext,
  defaultBundle: KeyBundle
): Promise<SyncedHistoryVisit[]> {
  const collection = await fetchCollection(context, "history", {
    limit: HISTORY_PAGE_RECORDS,
    maxRecords: HISTORY_MAX_RECORDS,
  });
  if (collection.status !== 200) {
    throw new Error(`history ${collection.status}`);
  }
  const visits: SyncedHistoryVisit[] = [];
  for (const bso of collection.records) {
    let cleartext: string;
    try {
      cleartext = decryptRecordCleartext(defaultBundle, bso);
    } catch {
      continue;
    }
    const parsed = parseHistoryCleartext(bso.id, cleartext);
    if (parsed) visits.push(parsed);
  }
  return orderSyncedHistory(visits);
}
