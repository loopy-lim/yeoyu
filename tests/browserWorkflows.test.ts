import { expect, test } from "bun:test";
import { BrowserToolsStore, resetSitePreferences, updateSitePreference, ExternalLinkDrain, retainLiveTabs, parseBrowserTools, parseExternalLinks, type BrowserToolsConfig } from "../src/browserWorkflows";

test("a failed acknowledgement retries persistence without opening another tab", async () => {
  const pending = [{ id: "one", url: "https://a.example/" }];
  const opened: string[] = [];
  let acknowledgements = 0;
  let flushes = 0;
  const drain = new ExternalLinkDrain({
    pending: async () => pending,
    reject: async () => { throw Error("unexpected rejection"); },
    open: async (url) => { opened.push(url); },
    flush: async () => { flushes++; },
    acknowledge: async () => {
      acknowledgements++;
      if (acknowledgements === 1) throw Error("bridge busy");
      pending.splice(0);
    },
  });
  await expect(drain.run()).rejects.toThrow("bridge busy");
  await drain.run();
  expect(opened).toEqual(["https://a.example/"]);
  expect(flushes).toBe(2);
  expect(pending).toEqual([]);
});

test("simultaneous queue signals serialize opens and retain a later arrival", async () => {
  const pending = [{ id: "one", url: "https://a.example/" }];
  const opened: string[] = [];
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const drain = new ExternalLinkDrain({
    pending: async () => [...pending],
    reject: async () => { throw Error("unexpected rejection"); },
    open: async (url) => { opened.push(url); if (opened.length === 1) await hold; },
    flush: async () => {},
    acknowledge: async (id) => { pending.splice(pending.findIndex((item) => item.id === id), 1); },
  });
  const first = drain.run();
  await Promise.resolve();
  pending.push({ id: "two", url: "https://b.example/" });
  const second = drain.run();
  release();
  await Promise.all([first, second]);
  expect(opened).toEqual(["https://a.example/", "https://b.example/"]);
  expect(pending).toHaveLength(0);
});

test("a snapshot write failure leaves the link pending and retries the existing tab", async () => {
  const pending = [{ id: "one", url: "https://a.example/" }];
  let opens = 0, flushes = 0;
  const drain = new ExternalLinkDrain({
    pending: async () => [...pending],
    reject: async () => { throw Error("unexpected rejection"); },
    open: async () => { opens++; },
    flush: async () => { if (++flushes === 1) throw Error("disk full"); },
    acknowledge: async () => { pending.splice(0); },
  });
  await expect(drain.run()).rejects.toThrow("disk full");
  expect(pending).toHaveLength(1);
  await drain.run();
  expect(opens).toBe(1);
});

test("invalid external queue envelopes cannot be processed", () => {
  expect(parseExternalLinks('[{"id":"a","url":"https://example.com/"}]')).toEqual([
    { id: "a", url: "https://example.com/" },
  ]);
  for (const value of [{ id: "bad id", url: "https://a.example/" }, { id: "a", url: 42 }])
    expect(() => parseExternalLinks(JSON.stringify([value]))).toThrow();
  expect(() => parseExternalLinks('[{"id":"a","url":"https://a.example/"},{"id":"a","url":"https://b.example/"}]')).toThrow();
});

test("URL parser differences are durably rejected without blocking valid neighboring links", async () => {
  const invalid = ["javascript:alert(1)", "file:///data/secret", "https://user:password@example.com", "https://a.example/\nother", "https://[fe80::1%25en0]/", "https://999.1/", "https://example.123/"];
  const pending = parseExternalLinks(JSON.stringify([
    { id: "first", url: "https://first.example/" },
    ...invalid.map((url, i) => ({ id: `bad-${i}`, url })),
    { id: "last", url: "https://last.example/" },
  ]));
  const opened: string[] = [], rejected: string[] = [];
  const consume = (id: string) => { expect(pending[0]?.id).toBe(id); pending.shift(); };
  const drain = new ExternalLinkDrain({
    pending: async () => [...pending],
    open: async (_url, id) => { opened.push(id); },
    flush: async () => {},
    acknowledge: async (id) => consume(id),
    reject: async (id) => { rejected.push(id); consume(id); },
  });
  await drain.run();
  expect(opened).toEqual(["first", "last"]);
  expect(rejected).toEqual(invalid.map((_url, i) => `bad-${i}`));
  expect(pending).toHaveLength(0);
});

test("failed quarantine preserves FIFO ordering and retries before opening a later link", async () => {
  const pending = [{ id: "bad", url: "https://999.1/" }, { id: "good", url: "https://good.example/" }];
  let attempts = 0;
  const opened: string[] = [];
  const drain = new ExternalLinkDrain({
    pending: async () => [...pending],
    open: async (_url, id) => { opened.push(id); },
    flush: async () => {},
    acknowledge: async () => { pending.shift(); },
    reject: async () => { if (++attempts === 1) throw Error("quarantine disk full"); pending.shift(); },
  });
  await expect(drain.run()).rejects.toThrow("quarantine disk full");
  expect(opened).toEqual([]);
  expect(pending).toHaveLength(2);
  await drain.run();
  expect(opened).toEqual(["good"]);
  expect(pending).toHaveLength(0);
});

test("closed tab state is removed while live state keeps its object identity", () => {
  const record = { open: { error: "timeout" }, closed: { error: "old" } };
  const retained = retainLiveTabs(record, new Set(["open"]));
  expect(retained).toEqual({ open: { error: "timeout" } });
  expect(retained.open).toBe(record.open);
  expect(retainLiveTabs(retained, new Set(["open"]))).toBe(retained);
});

test("tool configuration preserves per-site policy and rejects unsafe replacements", () => {
  const config: BrowserToolsConfig = {
    schema: 1, automaticMemorySaving: false, restoreSessions: false, trackingProtection: "engine-default", textScale: 1,
    sites: [{ origin: "https://a.example:8443", desktop: false, trackingProtection: null }],
  };
  expect(parseBrowserTools(JSON.stringify(config))).toEqual(config);
  for (const patch of [{ schema: 2 }, { textScale: Infinity }, { restoreSessions: "yes" }, { sites: [{ origin: "https://a.example/path", desktop: true, trackingProtection: null }] }])
    expect(() => parseBrowserTools(JSON.stringify({ ...config, ...patch }))).toThrow();
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const initialTools: BrowserToolsConfig = {
  schema: 1, automaticMemorySaving: false, restoreSessions: true, trackingProtection: "engine-default", textScale: 1, sites: [],
};

test("returning every site preference to its default removes the exception", () => {
  let config = updateSitePreference("https://a.example", { desktop: false, keepAlive: true, trackingProtection: false })(initialTools);
  config = updateSitePreference("https://a.example", { desktop: true, trackingProtection: null })(config);
  expect(config.sites).toHaveLength(1);
  config = updateSitePreference("https://a.example", { keepAlive: false })(config);
  expect(config.sites).toEqual([]);
  expect(updateSitePreference("https://a.example", { desktop: true })(initialTools).sites).toEqual([]);
});

test("loading compacts legacy default rows but preserves explicit protection choices", () => {
  const config = parseBrowserTools(JSON.stringify({ ...initialTools, sites: [
    { origin: "https://default.example", desktop: true, trackingProtection: null, keepAlive: false },
    { origin: "https://protected.example", desktop: true, trackingProtection: true },
  ] }));
  expect(config.sites).toEqual([{ origin: "https://protected.example", desktop: true, trackingProtection: true }]);
  expect(() => parseBrowserTools(JSON.stringify({ ...initialTools, sites: [
    { origin: "https://a.example", desktop: true, trackingProtection: null },
    { origin: "https://a.example", desktop: false, trackingProtection: null },
  ] }))).toThrow("Invalid site settings");
});

test("site resets preserve global settings and other origins across queued saves", async () => {
  let committed = { ...initialTools, textScale: 1.4 };
  const store = new BrowserToolsStore(async () => {}, (next) => { committed = next; }, async () => committed);
  store.initialize(committed);
  await Promise.all([
    store.save(updateSitePreference("https://a.example", { desktop: false })),
    store.save(updateSitePreference("https://a.example:8443", { keepAlive: true })),
    store.save(resetSitePreferences("https://a.example")),
  ]);
  expect(committed.sites.map(({ origin }) => origin)).toEqual(["https://a.example:8443"]);
  await store.save(resetSitePreferences());
  expect(committed).toEqual({ ...initialTools, textScale: 1.4 });
});

test("reopened settings enqueue a delta after durable restore-off without re-enabling restoration", async () => {
  const firstWrite = deferred();
  const writes: BrowserToolsConfig[] = [];
  const published: BrowserToolsConfig[] = [];
  const store = new BrowserToolsStore(async (next) => {
    writes.push(next);
    if (writes.length === 1) await firstWrite.promise;
    else expect(published.at(-1)?.restoreSessions).toBe(false);
  }, (next) => published.push(next), async () => initialTools);
  store.initialize(initialTools);
  const mountPanel = () => (update: (current: BrowserToolsConfig) => BrowserToolsConfig) => store.save(update);
  const firstPanel = mountPanel();
  const saveA = firstPanel((current) => ({ ...current, restoreSessions: false }));
  await Promise.resolve();
  const reopenedPanel = mountPanel();
  const saveB = reopenedPanel((current) => ({ ...current, trackingProtection: "strict" }));
  await Promise.resolve();
  expect(writes).toHaveLength(1);
  expect(published.at(-1)?.restoreSessions).toBe(true);
  firstWrite.resolve();
  await Promise.all([saveA, saveB]);
  expect(writes.map(({ restoreSessions, trackingProtection }) => ({ restoreSessions, trackingProtection }))).toEqual([
    { restoreSessions: false, trackingProtection: "engine-default" },
    { restoreSessions: false, trackingProtection: "strict" },
  ]);
  expect(published.at(-1)).toEqual({ ...initialTools, restoreSessions: false, trackingProtection: "strict" });
});

test("a failed save leaves committed settings intact and the next queued edit can retry", async () => {
  const firstWrite = deferred();
  const writes: BrowserToolsConfig[] = [];
  const published: BrowserToolsConfig[] = [];
  const store = new BrowserToolsStore(async (next) => {
    writes.push(next);
    if (writes.length === 1) await firstWrite.promise;
  }, (next) => published.push(next), async () => initialTools);
  store.initialize(initialTools);
  const saveA = store.save((current) => ({ ...current, restoreSessions: false }));
  const failedA = saveA.catch((error: Error) => error);
  await Promise.resolve();
  const saveB = store.save((current) => ({ ...current, trackingProtection: "strict" }));
  firstWrite.reject(Error("disk full"));
  expect(await failedA).toEqual(Error("disk full"));
  await saveB;
  expect(writes[1]).toEqual({ ...initialTools, trackingProtection: "strict" });
  expect(published.at(-1)).toEqual({ ...initialTools, trackingProtection: "strict" });
  await store.save((current) => ({ ...current, restoreSessions: false }));
  expect(published.at(-1)).toEqual({ ...initialTools, restoreSessions: false, trackingProtection: "strict" });
});

test("queued site edits retain their captured origin and merge with later committed site rules", async () => {
  const firstWrite = deferred();
  let writes = 0;
  let committed = initialTools;
  const store = new BrowserToolsStore(async () => { if (++writes === 1) await firstWrite.promise; }, (next) => { committed = next; }, async () => initialTools);
  store.initialize(initialTools);
  const first = store.save(updateSitePreference("https://a.example", { desktop: false }));
  let currentOrigin = "https://a.example";
  const capturedEdit = updateSitePreference(currentOrigin, { trackingProtection: false });
  currentOrigin = "https://b.example";
  const other = store.save(updateSitePreference(currentOrigin, { desktop: false }));
  const last = store.save(capturedEdit);
  firstWrite.resolve();
  await Promise.all([first, other, last]);
  expect(committed.sites).toEqual([
    { origin: "https://b.example", desktop: false, trackingProtection: null },
    { origin: "https://a.example", desktop: false, trackingProtection: false },
  ]);
});

test("a native partial commit is reread before queued edits can re-enable session restoration", async () => {
  let native = initialTools;
  const writes: BrowserToolsConfig[] = [], published: BrowserToolsConfig[] = [];
  const store = new BrowserToolsStore(async (next) => {
    writes.push(next);
    native = next;
    if (writes.length === 1) throw Error("session cleanup failed after config saved");
  }, (next) => published.push(next), async () => native);
  store.initialize(initialTools);
  const first = store.save((current) => ({ ...current, restoreSessions: false }));
  const failed = first.catch((error: Error) => error);
  const next = store.save((current) => ({ ...current, textScale: 1.25 }));
  expect(String(await failed)).toContain("cleanup failed");
  await next;
  expect(writes.map((value) => value.restoreSessions)).toEqual([false, false]);
  expect(published.at(-1)).toEqual({ ...initialTools, restoreSessions: false, textScale: 1.25 });
});

test("failed authoritative settings read blocks writes until the current state is known", async () => {
  let native = initialTools, readsFail = true;
  const writes: BrowserToolsConfig[] = [];
  const store = new BrowserToolsStore(async (next) => {
    writes.push(next); native = next;
    if (writes.length === 1) throw Error("apply failed after save");
  }, () => {}, async () => {
    if (readsFail) throw Error("bridge unavailable");
    return native;
  });
  store.initialize(initialTools);
  await expect(store.save((current) => ({ ...current, restoreSessions: false }))).rejects.toThrow();
  await expect(store.save((current) => ({ ...current, textScale: 1.5 }))).rejects.toThrow("bridge unavailable");
  expect(writes).toHaveLength(1);
  readsFail = false;
  await store.save((current) => ({ ...current, textScale: 1.5 }));
  expect(writes[1]).toEqual({ ...initialTools, restoreSessions: false, textScale: 1.5 });
});


test("memory saving defaults off and rejects malformed authorization", () => {
  const base = { schema: 1, automaticMemorySaving: false, restoreSessions: false, trackingProtection: "standard", textScale: 1, sites: [] };
  expect(parseBrowserTools(JSON.stringify(base)).automaticMemorySaving).toBe(false);
  expect(() => parseBrowserTools(JSON.stringify({ ...base, automaticMemorySaving: "yes" }))).toThrow();
  expect(parseBrowserTools(JSON.stringify({ ...base, automaticMemorySaving: true, sites: [{ origin: "https://example.com", desktop: true, trackingProtection: null, keepAlive: true }] })).sites[0].keepAlive).toBe(true);
});

test("changing desktop preference retains the site's keep-alive exception", () => {
  const changed = updateSitePreference("https://a.example", { desktop: false })({
    ...initialTools,
    sites: [{ origin: "https://a.example", desktop: true, trackingProtection: null, keepAlive: true }],
  });
  expect(changed.sites[0].keepAlive).toBe(true);
});
