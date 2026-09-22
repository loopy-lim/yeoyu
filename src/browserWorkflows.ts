export interface ExternalLink { id: string; url: string }

function webUrl(raw: unknown): string {
  if (typeof raw !== "string" || /[\u0000-\u0020\u007f]/.test(raw))
    throw Error("Invalid web address");
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password)
    throw Error("Only HTTP and HTTPS links are accepted");
  return raw;
}

export function parseExternalLinks(json: string): ExternalLink[] {
  const values: unknown = JSON.parse(json);
  if (!Array.isArray(values)) throw Error("Invalid external link queue");
  const ids = new Set<string>();
  return values.map((value) => {
    if (!value || typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id) || ids.has(value.id) || typeof value.url !== "string")
      throw Error("Invalid external link identifier");
    ids.add(value.id);
    // URL validity is decided per FIFO item so one parser disagreement cannot
    // prevent valid neighbors from reaching durable acknowledgement.
    return { id: value.id, url: value.url };
  });
}

interface ExternalLinkPorts {
  pending(): Promise<ExternalLink[]>;
  open(url: string, requestId: string): Promise<unknown>;
  flush(): Promise<void>;
  acknowledge(id: string): Promise<void>;
  reject(id: string): Promise<void>;
}

/** A bridge retry must not create the same tab twice. Native owns the FIFO;
 * this coordinator retains successful opens until durable save and ack finish. */
export class ExternalLinkDrain {
  private task: Promise<void> | null = null;
  private requested = false;
  private readonly opened = new Set<string>();
  constructor(private readonly ports: ExternalLinkPorts) {}

  run(): Promise<void> {
    this.requested = true;
    if (this.task) return this.task;
    this.task = this.drain().finally(() => {
      this.task = null;
      // A signal can arrive between the drain's last await and this handoff.
      if (this.requested) return this.run();
    });
    return this.task;
  }

  private async drain(): Promise<void> {
    try {
      while (this.requested) {
        this.requested = false;
        const links = await this.ports.pending();
        for (const link of links) {
          try { webUrl(link.url); }
          catch {
            await this.ports.reject(link.id);
            continue;
          }
          if (!this.opened.has(link.id)) {
            await this.ports.open(link.url, link.id);
            this.opened.add(link.id);
          }
          await this.ports.flush();
          await this.ports.acknowledge(link.id);
          this.opened.delete(link.id);
        }
        // Re-read after draining to cover arrivals without a live event bridge.
        if (links.length) this.requested = true;
      }
    } catch (error) {
      this.requested = false;
      throw error;
    }
  }
}

export function retainLiveTabs<T>(record: Record<string, T>, live: ReadonlySet<string>): Record<string, T> {
  const keys = Object.keys(record);
  if (keys.every((key) => live.has(key))) return record;
  return Object.fromEntries(keys.filter((key) => live.has(key)).map((key) => [key, record[key]]));
}

export type TrackingProtection = "engine-default" | "standard" | "strict";
export interface SitePreference {
  keepAlive?: boolean;
  origin: string;
  desktop: boolean;
  trackingProtection: boolean | null;
}
export interface BrowserToolsConfig {
  automaticMemorySaving?: boolean;
  schema: 1;
  restoreSessions: boolean;
  trackingProtection: TrackingProtection;
  textScale: number;
  sites: SitePreference[];
}

/** No stored row means a desktop request, global protection, and no keep-alive exception. */
export function isDefaultSitePreference(site: SitePreference): boolean {
  return site.desktop && site.trackingProtection === null && !site.keepAlive;
}

export function parseBrowserTools(json: string): BrowserToolsConfig {
  const value = JSON.parse(json);
  if (!value || (value.automaticMemorySaving !== undefined && typeof value.automaticMemorySaving !== "boolean") || value.schema !== 1 || typeof value.restoreSessions !== "boolean" ||
      !["engine-default", "standard", "strict"].includes(value.trackingProtection) ||
      typeof value.textScale !== "number" || !Number.isFinite(value.textScale) || value.textScale < 0.5 || value.textScale > 2 ||
      !Array.isArray(value.sites) || value.sites.length > 256) throw Error("Browser settings could not be read");
  const origins = new Set<string>();
  const sites: SitePreference[] = value.sites.map((site: SitePreference) => {
    if (!site || (site.keepAlive !== undefined && typeof site.keepAlive !== "boolean") || new URL(webUrl(site.origin)).origin !== site.origin || origins.has(site.origin) ||
        typeof site.desktop !== "boolean" || !(site.trackingProtection === null || typeof site.trackingProtection === "boolean"))
      throw Error("Invalid site settings");
    origins.add(site.origin);
    return { origin: site.origin, desktop: site.desktop, trackingProtection: site.trackingProtection, ...(site.keepAlive !== undefined ? { keepAlive: site.keepAlive } : {}) };
  });
  return { schema: 1, automaticMemorySaving: value.automaticMemorySaving ?? false, restoreSessions: value.restoreSessions, trackingProtection: value.trackingProtection, textScale: value.textScale, sites: sites.filter((site) => !isDefaultSitePreference(site)) };
}

export type BrowserToolsUpdate = (current: BrowserToolsConfig) => BrowserToolsConfig;

/** Owned by the browser hook, so closing settings cannot reset the write queue. */
export class BrowserToolsStore {
  private committed: BrowserToolsConfig | null = null;
  private tail: Promise<void> = Promise.resolve();
  constructor(
    private readonly persist: (config: BrowserToolsConfig) => Promise<void>,
    private readonly publish: (config: BrowserToolsConfig) => void,
    private readonly readCommitted: () => Promise<BrowserToolsConfig>,
  ) {}

  initialize(config: BrowserToolsConfig): void {
    this.committed = config;
    this.publish(config);
  }

  acceptTextScale(textScale: number): void {
    if (this.committed) this.initialize({ ...this.committed, textScale });
  }

  save(update: BrowserToolsUpdate): Promise<void> {
    const task = this.tail.then(async () => {
      if (!this.committed) this.initialize(await this.readCommitted());
      if (!this.committed) throw Error("Browser settings are not ready");
      const next = parseBrowserTools(JSON.stringify(update(this.committed)));
      try { await this.persist(next); }
      catch (error) {
        // Native may have persisted consent before a cleanup/engine failure.
        // Never compute another delta from the pre-write value in that case.
        this.committed = null;
        try { this.initialize(await this.readCommitted()); }
        catch (readError) {
          throw new AggregateError([error, readError], "Settings changed but their current state could not be read. Try again.");
        }
        throw error;
      }
      // Advance the baseline synchronously before the next queued mutation starts.
      this.initialize(next);
    });
    // A failed write rejects its caller without poisoning subsequent edits.
    this.tail = task.catch(() => {});
    return task;
  }
}

export function updateSitePreference(origin: string, patch: Partial<Pick<SitePreference, "desktop" | "trackingProtection" | "keepAlive">>): BrowserToolsUpdate {
  return (current) => {
    const site = current.sites.find((entry) => entry.origin === origin);
    const next = { ...site, origin, desktop: site?.desktop ?? true, trackingProtection: site?.trackingProtection ?? null, ...patch };
    const others = current.sites.filter((entry) => entry.origin !== origin && !isDefaultSitePreference(entry));
    return { ...current, sites: isDefaultSitePreference(next) ? others : [...others, next] };
  };
}

/** Reset preferences only; cookies, permissions, and global settings have separate owners. */
export function resetSitePreferences(origin?: string): BrowserToolsUpdate {
  return (current) => ({ ...current, sites: origin === undefined ? [] : current.sites.filter((site) => site.origin !== origin) });
}
