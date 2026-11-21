// Receive-only history engine unit tests: wire-cleartext parsing
// (PRTime microsecond visit dates, defensive), ordering and the retained cap.

import { describe, expect, test } from "bun:test";
import {
  orderSyncedHistory,
  parseHistoryCleartext,
} from "../src/sync/history";
import type { SyncedHistoryVisit } from "../src/sync/model";

function wireHistory(
  histUri: unknown,
  visits: unknown,
  title?: unknown,
  deleted?: boolean
): string {
  return JSON.stringify({
    id: "hist00000001",
    histUri,
    ...(title !== undefined ? { title } : {}),
    visits,
    ...(deleted ? { deleted } : {}),
  });
}

describe("parseHistoryCleartext", () => {
  test("newest visit date wins and converts microseconds to ms", () => {
    const parsed = parseHistoryCleartext(
      "hist00000001",
      wireHistory("https://docs.example", [
        { date: 1_700_000_000_000_000, type: 1 },
        { date: 1_700_000_050_000_000, type: 2 },
        { date: 1_700_000_020_000_000, type: 1 },
      ])
    );
    expect(parsed?.visitedAtMs).toBe(1_700_000_050_000);
    expect(parsed?.url).toBe("https://docs.example");
    expect(parsed?.id).toBe("hist00000001");
  });

  test("falls back to the url as title; junk visit entries are ignored", () => {
    const parsed = parseHistoryCleartext(
      "hist00000001",
      wireHistory(
        "https://x.example",
        [{ date: "nope" }, null, "not-an-object", { date: 1_700_000_000_000_000 }],
        42
      )
    );
    expect(parsed?.title).toBe("https://x.example");
    expect(parsed?.visitedAtMs).toBe(1_700_000_000_000);
  });

  test("tombstones and records without visits or a usable url parse to null", () => {
    expect(
      parseHistoryCleartext("h1", wireHistory("https://gone.example", [], "Gone", true))
    ).toBeNull();
    expect(
      parseHistoryCleartext("h2", wireHistory("https://never.example", []))
    ).toBeNull();
    expect(parseHistoryCleartext("h3", wireHistory(42, []))).toBeNull();
    expect(parseHistoryCleartext("h4", wireHistory("", []))).toBeNull();
  });

  test("junk cleartext and non-object payloads parse to null", () => {
    expect(parseHistoryCleartext("h1", "notjson")).toBeNull();
    expect(parseHistoryCleartext("h2", "42")).toBeNull();
  });
});

describe("orderSyncedHistory", () => {
  const visit = (id: string, atMs: number): SyncedHistoryVisit => ({
    id,
    url: `https://${id}.example`,
    title: id,
    visitedAtMs: atMs,
  });

  test("sorts newest-first and caps the retained list at 100", () => {
    const many = Array.from({ length: 150 }, (_, index) =>
      visit(`h${String(index).padStart(4, "0")}`, index)
    );
    const ordered = orderSyncedHistory(many);
    expect(ordered).toHaveLength(100);
    expect(ordered[0]!.visitedAtMs).toBe(149);
    expect(ordered[99]!.visitedAtMs).toBe(50);
  });
});
