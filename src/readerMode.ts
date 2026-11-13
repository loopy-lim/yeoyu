import type { Theme } from "@/theme";

export interface ReaderTabState {
  readerable: boolean;
  active: boolean;
}

export interface ReaderStylePayload {
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  border: string;
  sunken: string;
  fontSizePx: number;
  readTimeFormat: string;
}

export function fontSizeForTextScale(textScale: number | undefined): number {
  const safe =
    typeof textScale === "number" && Number.isFinite(textScale)
      ? Math.min(2, Math.max(0.5, textScale))
      : 1;
  return Math.min(36, Math.max(12, Math.round(18 * safe)));
}

export function deriveReaderStyle(
  theme: Pick<
    Theme,
    "surface" | "ink" | "inkMuted" | "accentStrong" | "hairline" | "sunken"
  >,
  textScale: number | undefined,
  readTimeFormat = "{n} min read"
): ReaderStylePayload {
  return {
    bg: theme.surface,
    fg: theme.ink,
    muted: theme.inkMuted,
    accent: theme.accentStrong,
    border: theme.hairline,
    sunken: theme.sunken,
    fontSizePx: fontSizeForTextScale(textScale),
    readTimeFormat: readTimeFormat.includes("{n}")
      ? readTimeFormat
      : "{n} min read",
  };
}

export function isEligibleReaderUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim().toLowerCase();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

export function canToggleReaderMode(
  tab: { id: string; url: string; suspended?: boolean } | null | undefined,
  state: ReaderTabState | undefined
): boolean {
  if (!tab || tab.suspended || !isEligibleReaderUrl(tab.url)) return false;
  return Boolean(state?.readerable || state?.active);
}
