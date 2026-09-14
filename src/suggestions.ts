import type { HistoryEntry } from "./history";

export type SearchEngineId = "google" | "naver" | "duckduckgo";

export const SEARCH_ENGINES: Record<
  SearchEngineId,
  { label: string; query: (q: string) => string }
> = {
  google: {
    label: "Google",
    query: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  },
  naver: {
    label: "Naver",
    query: (q) =>
      `https://search.naver.com/search.naver?query=${encodeURIComponent(q)}`,
  },
  duckduckgo: {
    label: "DuckDuckGo",
    query: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
  },
};

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const DOMAINISH = /^\S+[.\u3001]\S+$/;

// Typed text becomes a URL when it carries a scheme or looks like a bare
// domain; anything else goes to the selected search engine.
export function normalizeInput(input: string, engine: SearchEngineId): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  // A hostname followed by a numeric port is not a URI scheme. Bracketed
  // IPv6 and localhost also remain addresses without needing a dot.
  const hostWithPort =
    /^(?:\[[0-9a-f:.]+\]|localhost|[^\s/:?#]+\.[^\s/:?#]+):\d+(?:[/?#]|$)/i.test(
      trimmed
    );
  const localAddress = /^(?:localhost|\[[0-9a-f:.]+\])(?:[/:?#]|$)/i.test(
    trimmed
  );
  if (SCHEME.test(trimmed) && !hostWithPort) return trimmed;
  if (
    (hostWithPort || localAddress || DOMAINISH.test(trimmed)) &&
    !/\s/.test(trimmed)
  ) {
    const url = `https://${trimmed}`;
    try {
      return new URL(url).toString();
    } catch {
      return url;
    }
  }
  return SEARCH_ENGINES[engine].query(trimmed);
}

export interface Suggestion {
  url: string;
  title: string;
  source: "favorite" | "history" | "bookmark" | "tab";
  tabId?: string;
}

export function suggest(
  query: string,
  sources: {
    favorites: { id?: string; url: string; title: string }[];
    bookmarks: { url: string; title: string }[];
    tabs: { id?: string; url: string; title: string }[];
    history: HistoryEntry[];
  },
  limit = 6
): Suggestion[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  const push = (
    url: string,
    title: string,
    source: Suggestion["source"],
    tabId?: string
  ) => {
    if (out.length >= limit || seen.has(url)) return;
    const haystack = `${title} ${url}`.toLowerCase();
    if (!haystack.includes(needle)) return;
    seen.add(url);
    out.push({ url, title: title || url, source, ...(tabId ? { tabId } : {}) });
  };
  sources.favorites.forEach((item) =>
    push(item.url, item.title, "favorite", item.id)
  );
  sources.tabs.forEach((item) => push(item.url, item.title, "tab", item.id));
  sources.bookmarks.forEach((item) => push(item.url, item.title, "bookmark"));
  sources.history.forEach((entry) => push(entry.url, entry.title, "history"));
  return out;
}
