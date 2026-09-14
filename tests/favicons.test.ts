import { expect, spyOn, test } from "bun:test";
import { FaviconCache } from "../src/favicons";

function pngResponse(
  bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8])
) {
  return {
    ok: true,
    headers: { get: () => "image/png" },
    arrayBuffer: async () => bytes.buffer as ArrayBuffer,
  };
}

test("resolves the first image candidate and persists it per host", async () => {
  const saved: Record<string, string> = {};
  const urls: string[] = [];
  const cache = new FaviconCache(
    {
      read: async () => null,
      save: async (host, data) => {
        saved[host] = data;
      },
    },
    async (url) => {
      urls.push(url);
      return pngResponse() as never;
    }
  );
  const icon = (await cache.forUrl("https://example.com/page?q=1"))!;
  expect(icon).toStartWith("data:image/png;base64,");
  expect(urls).toEqual(["https://example.com/apple-touch-icon.png"]);
  expect(saved["example.com"]).toBe(icon);
  expect(await cache.forUrl("https://example.com/other")).toBe(icon);
  expect(urls).toHaveLength(1);
});

test("private lookups use a placeholder and do not populate the ordinary cache", async () => {
  const saved: string[] = [];
  const cleared: string[] = [];
  const readUrls: string[] = [];
  const cache = new FaviconCache(
    {
      read: async (host) => {
        readUrls.push(host);
        return null;
      },
      save: async (host) => {
        saved.push(host);
      },
      clear: (host) => {
        cleared.push(host);
      },
    },
    async () => pngResponse() as never
  );
  const icon = (
    await cache.forUrl("https://private.example/x", { persist: false })
  )!;
  expect(icon).toBeNull();
  expect(saved).toEqual([]);
  expect(cleared).toEqual([]);
  expect(readUrls).toEqual([]);
  // An explicit ordinary visit uses its own normal cache path. The previous
  // private request contributed neither an icon nor negative cache state.
  await cache.forUrl("https://private.example/y");
  expect(saved.filter((host) => host !== "_order")).toEqual(["private.example"]);
  await cache.forUrl("https://ordinary.example/z");
  expect(saved.filter((host) => host !== "_order")).toEqual([
    "private.example",
    "ordinary.example",
  ]);
});

test("falls back to favicon.ico when the touch icon is missing", async () => {
  const urls: string[] = [];
  const cache = new FaviconCache(undefined, async (url) => {
    urls.push(url);
    if (url.endsWith("/apple-touch-icon.png"))
      return {
        ok: false,
        headers: { get: () => "" },
        arrayBuffer: async () => new ArrayBuffer(0),
      } as never;
    return pngResponse() as never;
  });
  const icon = await cache.forUrl("https://example.com/");
  expect(icon).toStartWith("data:image/png;base64,");
  expect(urls).toEqual([
    "https://example.com/apple-touch-icon.png",
    "https://example.com/favicon.ico",
  ]);
});

test("rejects non-image payloads and negative-caches the host", async () => {
  let calls = 0;
  const cache = new FaviconCache(undefined, async () => {
    calls += 1;
    return {
      ok: true,
      headers: { get: () => "text/html" },
      arrayBuffer: async () => new ArrayBuffer(16),
    } as never;
  });
  expect(await cache.forUrl("https://example.com/")).toBeNull();
  expect(await cache.forUrl("https://example.com/")).toBeNull();
  expect(calls).toBe(2);
});

test("uses the persisted value without refetching", async () => {
  const cache = new FaviconCache(
    { read: async () => "data:image/png;base64,AAAA" },
    async () => {
      throw new Error("must not fetch");
    }
  );
  expect(await cache.forUrl("https://example.com/")).toBe(
    "data:image/png;base64,AAAA"
  );
});

test("reportBroken drops the cached value and clears storage", async () => {
  const cleared: string[] = [];
  const cache = new FaviconCache(
    {
      read: async () => "data:image/png;base64,AAA",
      clear: (host) => cleared.push(host),
    },
    async () => pngResponse() as never
  );
  expect(await cache.forUrl("https://example.com/")).toBe(
    "data:image/png;base64,AAA"
  );
  cache.reportBroken("https://example.com/");
  expect(cleared).toEqual(["example.com"]);
  expect(await cache.forUrl("https://example.com/")).not.toBe(
    "data:image/png;base64,AAA"
  );
});

test("non-http(s) urls resolve to nothing", async () => {
  const cache = new FaviconCache(undefined, async () => {
    throw new Error("must not fetch");
  });
  expect(await cache.forUrl("about:blank")).toBeNull();
  expect(await cache.forUrl("not a url")).toBeNull();
});

test("queues excess hosts without losing icons or exceeding four downloads", async () => {
  let active = 0;
  let peak = 0;
  let requests = 0;
  const cache = new FaviconCache(undefined, async () => {
    requests++;
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return pngResponse();
  });
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      cache.forUrl(`https://host-${i}.example/`)
    )
  );
  expect(results.filter(Boolean)).toHaveLength(12);
  expect(peak).toBe(4);
  expect(requests).toBe(12);
  expect(await cache.forUrl("https://host-11.example/again")).toBe(results[11]);
  expect(requests).toBe(12);
});

test("times out stalled response bodies and aborts the underlying downloads", async () => {
  const schedule = globalThis.setTimeout;
  const timer = spyOn(globalThis, "setTimeout").mockImplementation(
    new Proxy(schedule, {
      apply: (target, receiver, [callback, delay, ...args]) =>
        Reflect.apply(target, receiver, [
          callback,
          delay === 5000 ? 10 : delay,
          ...args,
        ]),
    })
  );
  const signals: NonNullable<RequestInit["signal"]>[] = [];
  // The response headers arrive immediately but the body never finishes.
  const fetchBody = async (
    _url: string,
    options?: Pick<RequestInit, "signal">
  ) => {
    if (options?.signal) signals.push(options.signal);
    return {
      ...pngResponse(),
      arrayBuffer: () => new Promise<ArrayBuffer>(() => {}),
    };
  };
  const cache = new FaviconCache(undefined, fetchBody);
  try {
    const result = await Promise.race([
      cache.forUrl("https://stalled.example/"),
      new Promise<"pending">((resolve) =>
        schedule(() => resolve("pending"), 100)
      ),
    ]);
    expect(result).toBeNull();
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  } finally {
    timer.mockRestore();
  }
});

test("keeps recently read icons in memory when older hosts are evicted", async () => {
  let reads = 0;
  const cache = new FaviconCache({
    read: async () => {
      reads++;
      return "data:image/png;base64,AAAA";
    },
  });
  for (let i = 0; i < 96; i++) await cache.forUrl(`https://host-${i}.example/`);
  await cache.forUrl("https://host-0.example/again");
  await cache.forUrl("https://host-96.example/");
  expect(reads).toBe(97);
  await cache.forUrl("https://host-0.example/still-recent");
  expect(reads).toBe(97);
  await cache.forUrl("https://host-1.example/oldest");
  expect(reads).toBe(98);
});
