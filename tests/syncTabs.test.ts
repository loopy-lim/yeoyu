// Receive-only tabs engine unit tests: wire-cleartext parsing (defensive),
// device/tab ordering, and the publish-side record builders.

import { describe, expect, test } from "bun:test";
import {
  buildClientsRecordCleartext,
  buildTabsRecordCleartext,
  orderSyncedTabs,
  parseTabsCleartext,
} from "../src/sync/tabs";

function wireTabs(tabs: unknown[], clientName?: unknown): string {
  return JSON.stringify({ id: "dev01", clientName, tabs });
}

describe("parseTabsCleartext", () => {
  test("current url is the last urlHistory entry; back-history is kept", () => {
    const parsed = parseTabsCleartext(
      "dev01",
      2.0,
      wireTabs([
        {
          title: "Docs",
          urlHistory: ["https://a.example", "https://b.example", "https://c.example"],
          lastUsed: 1234,
          icon: "https://icon.example/x.png",
        },
      ])
    );
    expect(parsed?.clientName).toBe("dev01");
    expect(parsed?.tabs).toHaveLength(1);
    expect(parsed?.tabs[0]?.url).toBe("https://c.example");
    expect(parsed?.tabs[0]?.urlHistory).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
    expect(parsed?.tabs[0]?.icon).toBe("https://icon.example/x.png");
    expect(parsed?.tabs[0]?.lastUsedMs).toBe(1234);
  });

  test("falls back to the url as title; missing clientName uses the BSO id", () => {
    const parsed = parseTabsCleartext(
      "dev02",
      2.0,
      wireTabs([{ urlHistory: ["https://x.example"] }], undefined)
    );
    expect(parsed?.clientName).toBe("dev02");
    expect(parsed?.tabs[0]?.title).toBe("https://x.example");
  });

  test("entries without a usable url are skipped, not fatal", () => {
    const parsed = parseTabsCleartext(
      "dev01",
      2.0,
      wireTabs([
        { title: "No history", urlHistory: [] },
        { title: "Junk history", urlHistory: ["ok", 42, null] },
        "not-an-object",
        { title: "Good", urlHistory: ["https://good.example"] },
      ])
    );
    // "Junk history" survives: the one string entry is its current url.
    expect(parsed?.tabs.map((tab) => tab.url)).toEqual([
      "ok",
      "https://good.example",
    ]);
  });

  test("junk cleartext and non-object payloads parse to null", () => {
    expect(parseTabsCleartext("dev01", 1.0, "notjson")).toBeNull();
    expect(parseTabsCleartext("dev01", 1.0, "42")).toBeNull();
    expect(parseTabsCleartext("dev01", 1.0, JSON.stringify({ id: "x" }))).toBeNull();
  });
});

describe("orderSyncedTabs", () => {
  test("tabs sort by recency inside a device; devices by their newest tab", () => {
    const ordered = orderSyncedTabs([
      {
        clientId: "old-device",
        clientName: "Old",
        modifiedSeconds: 1.0,
        tabs: [
          { title: "a", url: "https://a.example", urlHistory: [], lastUsedMs: 100 },
        ],
      },
      {
        clientId: "fresh-device",
        clientName: "Fresh",
        modifiedSeconds: 2.0,
        tabs: [
          { title: "y", url: "https://y.example", urlHistory: [], lastUsedMs: 300 },
          { title: "x", url: "https://x.example", urlHistory: [], lastUsedMs: 500 },
        ],
      },
    ]);
    expect(ordered.map((device) => device.clientId)).toEqual([
      "fresh-device",
      "old-device",
    ]);
    expect(ordered[0]!.tabs.map((tab) => tab.title)).toEqual(["x", "y"]);
  });

  test("null lastUsed sorts as oldest", () => {
    const ordered = orderSyncedTabs([
      {
        clientId: "d",
        clientName: "D",
        modifiedSeconds: 1.0,
        tabs: [
          { title: "undated", url: "https://u.example", urlHistory: [], lastUsedMs: null },
          { title: "dated", url: "https://d.example", urlHistory: [], lastUsedMs: 1 },
        ],
      },
    ]);
    expect(ordered[0]!.tabs.map((tab) => tab.title)).toEqual(["dated", "undated"]);
  });
});

describe("publish record builders", () => {
  test("clients record carries the device essentials", () => {
    const payload = JSON.parse(buildClientsRecordCleartext("dev01", "yeoyu"));
    expect(payload.id).toBe("dev01");
    expect(payload.name).toBe("yeoyu");
    expect(payload.type).toBe("mobile");
  });

  test("tabs record is capped, recency-first, current url as urlHistory", () => {
    const tabs = Array.from({ length: 30 }, (_, i) => ({
      title: `T${i}`,
      url: `https://t${i}.example`,
      lastUsedMs: i,
    }));
    const cleartext = buildTabsRecordCleartext("dev01", "yeoyu", tabs);
    expect(cleartext).not.toBeNull();
    const payload = JSON.parse(cleartext!);
    expect(payload.tabs).toHaveLength(25);
    expect(payload.tabs[0]?.title).toBe("T29"); // newest first
    expect(payload.tabs[0]?.urlHistory).toEqual(["https://t29.example"]);
  });

  test("empty or url-less tab lists publish nothing", () => {
    expect(buildTabsRecordCleartext("dev01", "yeoyu", [])).toBeNull();
    expect(
      buildTabsRecordCleartext("dev01", "yeoyu", [
        { title: "x", url: "", lastUsedMs: 1 },
      ])
    ).toBeNull();
  });
});
