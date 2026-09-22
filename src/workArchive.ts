import type { UiPreferences } from "./uiPreferences";
import { normalizeCustomColor } from "./uiPreferences";

export const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
const MAX_ITEMS = 10_000;
interface PortableBookmark { title: string; url: string; folderIndex: number | null }
interface PortableSpace {
  name: string; color: string; tabs: unknown[];
  bookmarks: PortableBookmark[]; folders: { title: string }[];
}
const invalid = () => new Error("This file is not a supported bookmark or Yeoyu work archive.");
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
function decodeHtml(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    const name = entity.toLowerCase();
    if (!name.startsWith("#")) return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[name] ?? match;
    const point = name.startsWith("#x") ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : "\ufffd";
  });
}
function portableUrl(value: string): string {
  if (!value || utf8Size(value) > 8192 || /[\s\u0000-\u0020\u007f-\u009f\\]/.test(value)) throw invalid();
  try {
    const parsed = new URL(value);
    if (!["https:", "http:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw invalid();
  } catch { throw invalid(); }
  return value;
}
function utf8Size(value: string): number {
  let bytes = 0;
  for (const c of value) { const n = c.codePointAt(0)!; bytes += n < 0x80 ? 1 : n < 0x800 ? 2 : n < 0x10000 ? 3 : 4; }
  return bytes;
}
export function checkArchiveSize(value: string): void {
  // UTF-8 byte count without Buffer/TextEncoder, which are not guaranteed in Hermes.
  let bytes = 0;
  for (const c of value) {
    const point = c.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes > MAX_ARCHIVE_BYTES) throw new Error("The file exceeds the 8 MB import limit.");
  }
}

/** Reads the inert Netscape bookmark interchange format; no DOM, scripts or URL fetches. */
export function bookmarkHtmlToArchive(html: string): string {
  checkArchiveSize(html);
  if (!/<dl[\s>]/i.test(html)) throw invalid();
  if (html.replace(/<!--[\s\S]*?-->/g, "").includes("<!--")) throw invalid();
  const space: PortableSpace = { name: "Imported Space", color: "", tabs: [], bookmarks: [], folders: [] };
  const stack: { title: string; index: number | null }[] = [];
  let pendingFolder: string | null = null;
  let capture: { kind: "a" | "h3"; url?: string; text: string } | null = null;
  let ignored: string | null = null;
  let sawList = false;
  const tokens = html.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>]*>|[^<]+/gi);
  for (const [token] of tokens) {
    if (token.startsWith("<!--") || token.startsWith("<!")) continue;
    const tag = /^<(\/)?([a-z][\w:-]*)\b/i.exec(token);
    if (!tag) {
      if (capture && !ignored) {
        capture.text += token;
        if (capture.text.length > 32768) throw invalid();
      }
      continue;
    }
    const closing = !!tag[1], name = tag[2].toLowerCase();
    if (ignored) { if (closing && name === ignored) ignored = null; continue; }
    if (!closing && ["script", "style", "template"].includes(name)) { ignored = name; continue; }
    if (name === "dl") {
      if (capture) throw invalid();
      if (closing) { if (!stack.length) throw invalid(); stack.pop(); }
      else {
        sawList = true;
        if (stack.length >= 64) throw invalid();
        const parent = stack.at(-1);
        let folder = parent ?? { title: "", index: null };
        if (pendingFolder !== null) {
          const title = [parent?.title, pendingFolder].filter(Boolean).join(" / ");
          if (utf8Size(title) > 4096) throw invalid();
          folder = { title, index: space.folders.length };
          space.folders.push({ title });
          pendingFolder = null;
        }
        stack.push(folder);
      }
    } else if (name === "a" || name === "h3") {
      if (closing) {
        if (capture?.kind !== name) throw invalid();
        const label = decodeHtml(capture.text).trim();
        if (utf8Size(label) > 4096) throw invalid();
        if (name === "h3") pendingFolder = label || "Untitled folder";
        else space.bookmarks.push({ title: label || capture.url!, url: capture.url!, folderIndex: stack.at(-1)?.index ?? null });
        capture = null;
      } else {
        if (capture || !stack.length) throw invalid();
        const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(token);
        capture = { kind: name, text: "", ...(name === "a" ? { url: portableUrl(decodeHtml(href?.[1] ?? href?.[2] ?? href?.[3] ?? "").trim()) } : {}) };
      }
    }
    if (space.bookmarks.length + space.folders.length > MAX_ITEMS) throw invalid();
  }
  if (!sawList || capture || ignored || stack.length || !space.bookmarks.length && !space.folders.length) throw invalid();
  return JSON.stringify({ format: "yeoyu-work", version: 1, spaces: [space], keyBindings: [], presentation: null });
}

/** The input is an archive exported by Rust, never an unvalidated external file. */
export function bookmarksToHtml(archiveJson: string): string {
  const archive = JSON.parse(archiveJson) as { spaces: PortableSpace[] };
  const lines = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Yeoyu bookmarks</TITLE>', '<H1>Yeoyu bookmarks</H1>', '<DL><p>'];
  const bookmark = (b: PortableBookmark) => lines.push(`<DT><A HREF="${escapeHtml(b.url)}">${escapeHtml(b.title)}</A>`);
  for (const space of archive.spaces) {
    lines.push(`<DT><H3>${escapeHtml(space.name)}</H3>`, '<DL><p>');
    space.bookmarks.filter((b) => b.folderIndex === null).forEach(bookmark);
    space.folders.forEach((folder, index) => {
      lines.push(`<DT><H3>${escapeHtml(folder.title)}</H3>`, '<DL><p>');
      space.bookmarks.filter((b) => b.folderIndex === index).forEach(bookmark);
      lines.push('</DL><p>');
    });
    lines.push('</DL><p>');
  }
  lines.push('</DL><p>');
  return lines.join("\n");
}

export type PortablePresentation = Pick<UiPreferences, "appearance" | "colorMode" | "colorSource" | "customColor" | "sidebarCollapsed" | "sidebarWidth" | "framePx"> & { schema: 1 };
export function portablePresentation(ui: UiPreferences): string {
  return JSON.stringify({ schema: 1, appearance: ui.appearance, colorMode: ui.colorMode ?? "system", colorSource: ui.colorSource, customColor: ui.customColor, sidebarCollapsed: ui.sidebarCollapsed, sidebarWidth: ui.sidebarWidth, framePx: ui.framePx } satisfies PortablePresentation);
}
export function parsePresentation(raw: string | null): PortablePresentation | null {
  if (raw === null) return null;
  if (raw.length > 4096) throw invalid();
  const v = JSON.parse(raw);
  if (!v || v.schema !== 1 || !["lavender", "warm"].includes(v.appearance) || typeof v.sidebarCollapsed !== "boolean" || !Number.isInteger(v.sidebarWidth) || v.sidebarWidth < 200 || v.sidebarWidth > 320 || !v.framePx) throw invalid();
  for (const side of ["left", "right", "top", "bottom"])
    if (!Number.isInteger(v.framePx[side]) || v.framePx[side] < 0 || v.framePx[side] > 64) throw invalid();
  if (v.colorSource !== undefined && !["appearance", "space", "custom"].includes(v.colorSource)) throw invalid();
  if (v.colorMode !== undefined && !["system", "light", "dark"].includes(v.colorMode)) throw invalid();
  const customColor = normalizeCustomColor(v.customColor);
  if ((v.customColor !== undefined && !customColor) || (v.colorSource === "custom" && !customColor)) throw invalid();
  // Reconstruct an allowlist, excluding executable/site-specific and unknown fields.
  return { schema: 1, appearance: v.appearance,
    colorMode: v.colorMode ?? "system",
    ...(v.colorSource !== undefined ? { colorSource: v.colorSource } : {}),
    ...(customColor ? { customColor } : {}),
    sidebarCollapsed: v.sidebarCollapsed, sidebarWidth: v.sidebarWidth,
    framePx: { left: v.framePx.left, right: v.framePx.right, top: v.framePx.top, bottom: v.framePx.bottom } };
}
