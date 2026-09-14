// Candidate paths are ordered so the first hit is usually a PNG that the
// image pipeline decodes reliably; classic .ico is the fallback.
const CANDIDATES = ["/apple-touch-icon.png", "/favicon.ico"];
const MAX_BYTES = 200_000;
const CAP = 128;
const MEMORY_CAP = 96;
const ORDER_KEY = "_order";
const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export interface FaviconStore {
  read(host: string): Promise<string | null>;
  save(host: string, data: string): Promise<void>;
  clear(host: string): void;
}

export type FaviconResponse = {
  ok: boolean;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
};
export type FaviconFetch = (
  url: string,
  options?: Pick<RequestInit, "signal">
) => Promise<FaviconResponse>;

export class FaviconCache {
  private memory = new Map<string, string | null>();
  private inFlight = new Map<string, Promise<string | null>>();
  // Index mutations are serialized: concurrent evictions used to read the
  // same order list and the last writer erased every other host's entry.
  private evictChain: Promise<void> = Promise.resolve();
  private inFlightFetches = 0;
  private fetchWaiters: Array<() => void> = [];

  constructor(
    private store?: Partial<FaviconStore>,
    private fetchImpl?: FaviconFetch
  ) {}

  // The app wires the native store/fetch in once at startup so this module
  // stays free of react-native imports and unit-testable.
  attach(store?: Partial<FaviconStore>, fetchImpl?: FaviconFetch) {
    if (store) this.store = store;
    if (fetchImpl) this.fetchImpl = fetchImpl;
  }

  // Render-time lookup only: do not fetch or change LRU order here.
  peekForUrl(url: string): string | null {
    const host = hostOf(url);
    return host ? this.memory.get(host) ?? null : null;
  }

  // React Native fetch is outside Gecko's private cookie/storage context.
  // Private tabs use a local fallback without ordinary network/cache access.
  forUrl(
    url: string,
    options?: { persist?: boolean }
  ): Promise<string | null> {
    if (options?.persist === false) return Promise.resolve(null);
    const host = hostOf(url);
    if (!host) return Promise.resolve(null);
    if (this.memory.has(host)) {
      const cached = this.memory.get(host)!;
      this.touchMemory(host, cached);
      return Promise.resolve(cached);
    }
    const pending = this.inFlight.get(host);
    if (pending) return pending;
    const load = this.load(host).finally(() =>
      this.inFlight.delete(host)
    );
    this.inFlight.set(host, load);
    return load;
  }

  // Called when the image pipeline cannot decode the stored payload so the
  // same broken bytes are not restored on the next launch.
  reportBroken(url: string) {
    const host = hostOf(url);
    if (!host) return;
    this.touchMemory(host, null);
    this.store?.clear?.(host);
  }

  private async load(host: string, persist = true): Promise<string | null> {
    const persisted = await this.readPersisted(host);
    if (persisted) {
      this.touchMemory(host, persisted);
      return persisted;
    }
    for (const path of CANDIDATES) {
      const data = await this.fetchCandidate(host, path);
      if (data) {
        this.touchMemory(host, data);
        if (persist) {
          await this.store?.save?.(host, data).catch(() => undefined);
          this.evictChain = this.evictChain
            .then(() => this.evict(host))
            .catch(() => undefined);
        }
        return data;
      }
    }
    this.touchMemory(host, null);
    return null;
  }

  // Bounded LRU for the in-memory copy: negative results included, so a
  // long session cannot grow the map without limit.
  private touchMemory(host: string, data: string | null) {
    this.memory.delete(host);
    this.memory.set(host, data);
    while (this.memory.size > MEMORY_CAP) {
      const oldest = this.memory.keys().next().value;
      if (oldest === undefined) break;
      this.memory.delete(oldest);
    }
  }

  // Keeps the persisted set bounded (LRU-ish via an order index key) so the
  // preferences file cannot grow without limit.
  private async evict(host: string) {
    const store = this.store;
    if (!store?.read || !store?.save || !store?.clear) return;
    try {
      const raw = await store.read(ORDER_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      const list = Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
      const next = [...list.filter((item) => item !== host), host];
      while (next.length > CAP) {
        const oldest = next.shift();
        if (oldest) store.clear(oldest);
      }
      await store.save(ORDER_KEY, JSON.stringify(next));
    } catch {
      // Eviction is best effort; a failed trim never blocks loading.
    }
  }

  private async readPersisted(host: string): Promise<string | null> {
    if (!this.store?.read) return null;
    try {
      return await this.store.read(host);
    } catch {
      return null;
    }
  }

  private async fetchCandidate(
    host: string,
    path: string
  ): Promise<string | null> {
    if (!this.fetchImpl) return null;
    // Queue excess requests: returning null here would cache a missing
    // icon for every host that happened to arrive after the first four.
    await this.acquireFetch();
    const abort = new globalThis.AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await this.fetchImpl!(`https://${host}${path}`, {
            // RN and Bun declare different onabort nullability for the
            // same runtime AbortSignal; keep that type boundary here.
            signal: abort.signal as NonNullable<RequestInit["signal"]>,
          });
          if (!response.ok) return null;
          const type = (response.headers.get("content-type") ?? "")
            .split(";")[0]
            .trim();
          if (!type.startsWith("image/")) return null;
          const declared = Number(response.headers.get("content-length") ?? "");
          if (Number.isFinite(declared) && declared > MAX_BYTES) return null;
          const buffer = await response.arrayBuffer();
          if (buffer.byteLength < 8 || buffer.byteLength > MAX_BYTES)
            return null;
          return `data:${type};base64,${toBase64(buffer)}`;
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("favicon fetch timeout")),
            5000
          );
        }),
      ]);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      // Covers both headers and body, and cancels rejected/oversize bodies
      // before handing the slot to the next waiting host.
      abort.abort();
      const next = this.fetchWaiters.shift();
      if (next) next();
      else this.inFlightFetches--;
    }
  }

  private acquireFetch(): Promise<void> {
    if (this.inFlightFetches < 4) {
      this.inFlightFetches++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.fetchWaiters.push(resolve));
  }
}

function hostOf(url: string): string | null {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url.trim());
  return match ? match[1] : null;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  let encoded = "";
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i);
    const b = binary.charCodeAt(i + 1);
    const c = binary.charCodeAt(i + 2);
    encoded += BASE64[a >> 2];
    encoded += BASE64[((a & 3) << 4) | (b >> 4) || 0];
    encoded += BASE64[((b & 15) << 2) | (c >> 6) || 0];
    encoded += BASE64[c & 63];
  }
  const padding = (3 - (bytes.length % 3)) % 3;
  return encoded.slice(0, encoded.length - padding) + "=".repeat(padding);
}

export const favicons = new FaviconCache();
