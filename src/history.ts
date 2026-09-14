export interface HistoryEntry {
  url: string;
  title: string;
  at: number;
}

const LIMIT = 500;
const STORAGE_KEY = "entries";

// Storage is injected (favicons.attach pattern) so this module stays
// importable outside react-native (bun tests); the app wires the real
// native platform in App.tsx.
interface HistoryStorage {
  read?: () => Promise<string | null>;
  save?: (json: string) => Promise<void>;
}

export class History {
  entries: HistoryEntry[] = [];
  private storage: HistoryStorage;
  private loadPromise: Promise<void> | null = null;
  // Bumped by every mutation so an in-flight load can never clobber a
  // visit or clear that happened while the persisted list was being read.
  private generation = 0;
  private clearGeneration = 0;
  private loadFailed = false;
  private saveQueue: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  lastSaveOk: boolean | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private changed() {
    this.listeners.forEach((listener) => listener());
  }

  constructor(storage: HistoryStorage = {}) {
    this.storage = storage;
  }

  attach(storage: HistoryStorage) {
    this.storage = storage;
  }

  load(): Promise<void> {
    if (!this.loadPromise) {
      this.loadFailed = false;
      const generation = this.generation;
      const read = this.storage.read;
      this.loadPromise = (
        typeof read === "function" ? read() : Promise.resolve(null)
      )
        .then((json) => {
          const persisted = readPersistedHistory(json);
          if (generation === 0 && this.generation === 0) {
            this.entries = persisted;
          } else if (this.clearGeneration === 0) {
            const currentUrls = new Set(this.entries.map((entry) => entry.url));
            this.entries = [
              ...this.entries,
              ...persisted.filter((entry) => !currentUrls.has(entry.url)),
            ].slice(0, LIMIT);
          }
          this.changed();
        })
        .catch(() => {
          this.loadFailed = true;
          this.loadPromise = null;
        });
    }
    return this.loadPromise;
  }

  record(url: string, title: string): boolean {
    const clean = url.trim();
    const cleanTitle = title.trim();
    if (!clean || clean === "about:blank") return false;
    const current = this.entries[0];
    if (current?.url === clean && current.title === cleanTitle) {
      // Metadata/loading signals repeat without another visit. Failed writes
      // remain retryable even when the in-memory destination did not change.
      if (this.lastSaveOk === false) void this.persist();
      return false;
    }
    this.generation++;
    this.entries = [
      { url: clean, title: cleanTitle, at: Date.now() },
      ...this.entries.filter((entry) => entry.url !== clean),
    ].slice(0, LIMIT);
    this.changed();
    void this.persist();
    return true;
  }

  clear(): Promise<boolean> {
    this.generation++;
    this.clearGeneration = this.generation;
    this.entries = [];
    this.changed();
    return this.persist();
  }

  private async persist(): Promise<boolean> {
    const save = this.storage.save;
    if (typeof save !== "function") {
      this.lastSaveOk = null;
      return true;
    }
    if (this.loadPromise) await this.loadPromise;
    if (this.loadFailed) {
      await this.load();
      if (this.loadFailed) {
        this.lastSaveOk = false;
        return false;
      }
    }
    const json = JSON.stringify({ [STORAGE_KEY]: this.entries });
    const operation = this.saveQueue.then(() => save(json));
    const result = operation.then(
      () => {
        this.lastSaveOk = true;
        return true;
      },
      () => {
        this.lastSaveOk = false;
        return false;
      }
    );
    this.saveQueue = result.then(() => undefined);
    return result;
  }
}

export const history = new History();

// Persisted entries are fully normalized: junk titles become "", junk
// timestamps fall back to epoch, duplicates keep the newest visit, and the
// list stays capped — a bad value must never crash the history dialog.
export function readPersistedHistory(json: string | null): HistoryEntry[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    const entries =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)[STORAGE_KEY]
        : parsed;
    if (!Array.isArray(entries)) return [];
    const normalized: HistoryEntry[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      const record = entry as Partial<HistoryEntry> | null;
      if (typeof record?.url !== "string" || !record.url.trim()) continue;
      if (seen.has(record.url)) continue;
      seen.add(record.url);
      normalized.push({
        url: record.url,
        title: typeof record.title === "string" ? record.title : "",
        at:
          typeof record.at === "number" &&
          Number.isFinite(record.at) &&
          record.at > 0
            ? record.at
            : 0,
      });
    }
    return normalized.slice(0, LIMIT);
  } catch {
    return [];
  }
}
