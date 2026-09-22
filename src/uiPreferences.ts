import { clampSidebarWidth } from "./sidebarSizing";

export type Appearance = "lavender" | "warm";
export type ColorSource = "appearance" | "space" | "custom";
export type ColorMode = "system" | "light" | "dark";
export type ResolvedColorMode = Exclude<ColorMode, "system">;
export type LanguagePreference = "system" | "ko" | "en";

export function normalizeLanguage(value: unknown): LanguagePreference {
  return value === "ko" || value === "en" ? value : "system";
}

export function normalizeColorMode(value: unknown): ColorMode {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveColorMode(
  mode: ColorMode | undefined,
  systemScheme?: ResolvedColorMode | null
): ResolvedColorMode {
  return mode === "light" || mode === "dark" ? mode : systemScheme === "dark" ? "dark" : "light";
}

export function normalizeCustomColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex))
    return `#${hex.split("").map((digit) => digit + digit).join("").toLowerCase()}`;
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
}
export type SearchEngine = "google" | "naver" | "duckduckgo";

export interface SiteBoost {
  host: string;
  css: string;
  enabled: boolean;
}

// Site permission kinds the chrome can grant. camera/microphone/geolocation/
// notifications additionally require the matching Android runtime permission;
// the chrome requests it before the toggle turns on.
export type PermissionKind =
  | "geolocation"
  | "notifications"
  | "persistent-storage"
  | "autoplay"
  | "camera"
  | "microphone";

export type PermissionMap = Record<PermissionKind, boolean>;;
export const PERMISSION_KINDS: PermissionKind[] = [
  "geolocation",
  "notifications",
  "persistent-storage",
  "autoplay",
  "camera",
  "microphone",
];

// Kinds that additionally need the matching Android runtime permission
// before a site request can be granted.
export const PERMISSION_RUNTIME_KINDS: ReadonlySet<PermissionKind> = new Set([
  "geolocation",
  "notifications",
  "camera",
  "microphone",
]);

export const PERMISSION_LABELS: Record<PermissionKind, string> = {
  geolocation: "Location",
  notifications: "Notifications",
  "persistent-storage": "Persistent storage",
  autoplay: "Autoplay",
  camera: "Camera",
  microphone: "Microphone",
};

// Frame padding is stored per side in physical px (the unit the user tunes
// in Settings) and divided by PixelRatio at render time; each side clamps
// to 0..64. The left side defaults to none: next to the sidebar's own
// padding it reads as dead space.
export type FrameSide = "left" | "right" | "top" | "bottom";
export const FRAME_SIDES: FrameSide[] = ["left", "right", "top", "bottom"];
export interface FramePadding {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export const FRAME_PX_MIN = 0;
export const FRAME_PX_MAX = 64;
export const FRAME_PX_STEP = 4;
export const FRAME_PX_DEFAULT = 20;
export const defaultFramePadding: FramePadding = {
  left: 0,
  right: FRAME_PX_DEFAULT,
  top: FRAME_PX_DEFAULT,
  bottom: FRAME_PX_DEFAULT,
};

export interface UiPreferences {
  sidebarCollapsed: boolean;
  // Expanded sidebar width in dp; user-draggable (Arc's resizable sidebar).
  sidebarWidth: number;
  appearance: Appearance;
  language?: LanguagePreference;
  // Optional for legacy callers and archives; missing means follow the system.
  colorMode?: ColorMode;
  // Missing fields preserve the original behavior: follow the current Space.
  colorSource?: ColorSource;
  customColor?: string;
  fullscreen: boolean;
  autoPictureInPicture: boolean;
  searchEngine: SearchEngine;
  boosts: SiteBoost[];
  framePx: FramePadding;
}

export type UiPreferenceAction =
  | { type: "toggleSidebar" }
  | { type: "setSidebarCollapsed"; collapsed: boolean }
  | { type: "setSidebarWidth"; width: number }
  | { type: "setAppearance"; appearance: Appearance }
  | { type: "setLanguage"; language: LanguagePreference }
  | { type: "setColorMode"; colorMode: ColorMode }
  | { type: "setColorSource"; source: ColorSource }
  | { type: "setCustomColor"; color: string }
  | { type: "resetColors" }
  | { type: "resetLayout" }
  | { type: "setFullscreen"; fullscreen: boolean }
  | { type: "setAutoPictureInPicture"; enabled: boolean }
  | { type: "setSearchEngine"; searchEngine: SearchEngine }
  | { type: "setBoosts"; boosts: SiteBoost[] }
  | { type: "setFramePx"; side: FrameSide; value: number }
  | { type: "restore"; preferences: UiPreferences };

export const defaultUiPreferences: UiPreferences = {
  sidebarCollapsed: false,
  sidebarWidth: 240,
  appearance: "lavender",
  language: "system",
  colorMode: "system",
  fullscreen: true,
  autoPictureInPicture: true,
  searchEngine: "google",
  boosts: [],
  framePx: { ...defaultFramePadding },
};

// Empty means invalid; keep the original draft so its editor can explain why.
function parseBoostHostname(host: string): string {
  const value = host.trim();
  if (!value || /[\u0000-\u0020\u007f\\]/.test(value)) return "";
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    const hostname = url.hostname.toLowerCase();
    const dnsName = hostname.replace(/\.$/, "");
    if (!hostname.startsWith("[") && (dnsName.length > 253 || !dnsName.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))) return "";
    return hostname;
  } catch { return ""; }
}

// Apply this matching transform once to each original hostname, on both sides.
// Stored hosts retain www so repeated normalization cannot broaden their scope.
export function normalizeBoostHost(host: string): string {
  return parseBoostHostname(host).replace(/^www\./, "");
}

export interface BoostDraftError {
  host?: string;
  css?: string;
  hostCode?: "required" | "invalid" | "duplicate";
  cssCode?: "required";
}

/** Validate the complete replacement before Save; never silently remove an unfinished row. */
export function validateBoostDrafts(drafts: readonly SiteBoost[]): {
  valid: boolean;
  boosts: SiteBoost[];
  errors: BoostDraftError[];
} {
  const errors: BoostDraftError[] = drafts.map(() => ({}));
  const hosts = new Map<string, number>();
  const boosts = drafts.map((draft, index) => {
    const host = parseBoostHostname(draft.host);
    const matchHost = host.replace(/^www\./, "");
    if (!host || !matchHost) {
      errors[index].hostCode = draft.host.trim() ? "invalid" : "required";
      errors[index].host = draft.host.trim() ? "Enter a valid hostname or HTTP(S) address without login details." : "Enter a site hostname.";
    }
    if (!draft.css.trim()) {
      errors[index].cssCode = "required";
      errors[index].css = "Enter CSS or remove this boost.";
    }
    const previous = hosts.get(matchHost);
    if (host && previous !== undefined) {
      errors[previous].hostCode = errors[index].hostCode = "duplicate";
      errors[previous].host = errors[index].host = `Duplicate host: ${matchHost}. Keep one boost for this host.`;
    } else if (host) hosts.set(matchHost, index);
    return { ...draft, host };
  });
  return { valid: errors.every((error) => !error.host && !error.css), boosts, errors };
}

export function reduceUiPreferences(
  preferences: UiPreferences,
  action: UiPreferenceAction
): UiPreferences {
  if (action.type === "restore") return action.preferences;
  if (action.type === "setLanguage") return { ...preferences, language: action.language };
  if (action.type === "setColorMode") return { ...preferences, colorMode: action.colorMode };
  if (action.type === "setCustomColor") {
    const color = normalizeCustomColor(action.color);
    return color ? { ...preferences, colorSource: "custom", customColor: color } : preferences;
  }
  if (action.type === "setColorSource") {
    if (action.source === "custom" && !normalizeCustomColor(preferences.customColor)) return preferences;
    return { ...preferences, colorSource: action.source };
  }
  if (action.type === "resetColors") {
    const { colorSource: _source, customColor: _color, ...rest } = preferences;
    return { ...rest, appearance: defaultUiPreferences.appearance, colorMode: "system" };
  }
  if (action.type === "resetLayout") {
    return { ...preferences, sidebarWidth: defaultUiPreferences.sidebarWidth,
      sidebarCollapsed: defaultUiPreferences.sidebarCollapsed, framePx: { ...defaultFramePadding } };
  }
  if (action.type === "toggleSidebar") {
    return {
      ...preferences,
      sidebarCollapsed: !preferences.sidebarCollapsed,
    };
  }
  if (action.type === "setSidebarCollapsed") {
    return { ...preferences, sidebarCollapsed: action.collapsed };
  }
  if (action.type === "setSidebarWidth") {
    if (!Number.isFinite(action.width)) return preferences;
    return {
      ...preferences,
      sidebarWidth: clampSidebarWidth(action.width),
    };
  }
  if (action.type === "setFullscreen") {
    return { ...preferences, fullscreen: action.fullscreen };
  }
  if (action.type === "setAutoPictureInPicture") {
    return { ...preferences, autoPictureInPicture: action.enabled };
  }
  if (action.type === "setSearchEngine") {
    return { ...preferences, searchEngine: action.searchEngine };
  }
  if (action.type === "setBoosts") {
    return { ...preferences, boosts: action.boosts };
  }
  if (action.type === "setFramePx") {
    return {
      ...preferences,
      framePx: {
        ...preferences.framePx,
        [action.side]: Math.max(
          FRAME_PX_MIN,
          Math.min(FRAME_PX_MAX, Math.round(action.value))
        ),
      },
    };
  }
  return { ...preferences, appearance: action.appearance };
}

type ReadPreferences = () => Promise<string | null>;
type SavePreferences = (json: string) => Promise<void>;

const isBoost = (boost: unknown): boost is SiteBoost =>
  typeof boost === "object" &&
  boost !== null &&
  typeof (boost as SiteBoost).host === "string" &&
  typeof (boost as SiteBoost).css === "string";

const sanitizeBoosts = (value: unknown): SiteBoost[] =>
  Array.isArray(value)
    ? value.filter(isBoost).map((boost) => ({
        host: boost.host,
        css: boost.css,
        enabled: boost.enabled !== false,
      }))
    : [];

const sanitizeFramePadding = (value: unknown): FramePadding => {
  const frame = { ...defaultFramePadding };
  if (typeof value === "object" && value !== null)
    for (const side of FRAME_SIDES) {
      const raw = (value as Record<string, unknown>)[side];
      if (typeof raw === "number" && Number.isFinite(raw))
        frame[side] = Math.max(FRAME_PX_MIN, Math.min(FRAME_PX_MAX, Math.round(raw)));
    }
  return frame;
};

const sanitizeSidebarWidth = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value)
    ? clampSidebarWidth(value)
    : 240;

export async function loadUiPreferences(
  read: ReadPreferences | undefined
): Promise<UiPreferences> {
  if (!read) return defaultUiPreferences;
  // A failed read is not an empty store. Keep hydration blocked so the
  // caller cannot overwrite unread preferences with defaults.
  const raw = await read();
  try {
    if (!raw) return defaultUiPreferences;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      typeof (value as UiPreferences).sidebarCollapsed === "boolean" &&
      ["lavender", "warm"].includes((value as UiPreferences).appearance)
    ) {
      // Stored preferences from before a field existed load with its default
      // rather than failing the whole restore.
      const prefs = value as UiPreferences;
      const customColor = normalizeCustomColor(prefs.customColor);
      const colorSource = ["appearance", "space", "custom"].includes(prefs.colorSource ?? "") &&
        (prefs.colorSource !== "custom" || customColor) ? prefs.colorSource : undefined;
      // Reconstruct color fields: malformed optional values must not reach rendering.
      const { colorSource: _source, customColor: _color, ...existing } = prefs;
      return {
        ...existing,
        colorMode: normalizeColorMode(prefs.colorMode),
        language: normalizeLanguage(prefs.language),
        ...(colorSource ? { colorSource } : {}),
        ...(customColor ? { customColor } : {}),
        fullscreen: typeof prefs.fullscreen === "boolean" ? prefs.fullscreen : true,
        autoPictureInPicture:
          typeof prefs.autoPictureInPicture === "boolean"
            ? prefs.autoPictureInPicture
            : true,
        searchEngine: ["google", "naver", "duckduckgo"].includes(prefs.searchEngine)
          ? prefs.searchEngine
          : "google",
        boosts: sanitizeBoosts(prefs.boosts),
        framePx: sanitizeFramePadding(prefs.framePx),
        sidebarWidth: sanitizeSidebarWidth(prefs.sidebarWidth),
      };
    }
  } catch {
    // A corrupt preference file should never prevent the browser from opening.
  }
  return defaultUiPreferences;
}

export async function saveUiPreferences(
  save: SavePreferences | undefined,
  preferences: UiPreferences
): Promise<void> {
  if (save) await save(JSON.stringify(preferences));
}
