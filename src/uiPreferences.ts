export type Appearance = "lavender" | "warm";
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
  fullscreen: true,
  autoPictureInPicture: true,
  searchEngine: "google",
  boosts: [],
  framePx: { ...defaultFramePadding },
};

// Boost hosts are bare hostnames: scheme, path, and the www. prefix are
// stripped so user input and the native matcher agree.
export function normalizeBoostHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

export function reduceUiPreferences(
  preferences: UiPreferences,
  action: UiPreferenceAction
): UiPreferences {
  if (action.type === "restore") return action.preferences;
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
    return {
      ...preferences,
      sidebarWidth: Math.max(200, Math.min(320, Math.round(action.width))),
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
    ? Math.max(200, Math.min(320, Math.round(value)))
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
      return {
        ...prefs,
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
