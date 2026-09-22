import type { PermissionKind } from "./uiPreferences";

export const ANDROID_PERMISSION_KINDS = [
  "camera",
  "microphone",
  "geolocation",
  "notifications",
] as const;

export type AndroidPermissionKind = (typeof ANDROID_PERMISSION_KINDS)[number];
export type AndroidPermissionStatus =
  | "allowed"
  | "approximate"
  | "not-allowed"
  | "unknown";
export type AndroidPermissionSnapshot = Readonly<
  Record<AndroidPermissionKind, AndroidPermissionStatus>
>;

export interface ConsentRuntime {
  getAndroidPermissionStatus?(): Promise<string>;
  requestAndroidPermission?(kind: AndroidPermissionKind): Promise<boolean>;
  openAndroidPermissionSettings?(): Promise<void>;
}

export const UNKNOWN_ANDROID_PERMISSIONS: AndroidPermissionSnapshot = {
  camera: "unknown",
  microphone: "unknown",
  geolocation: "unknown",
  notifications: "unknown",
};

export function parseAndroidPermissionStatus(
  json: string
): AndroidPermissionSnapshot {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("Android permission status could not be read");
  const values = parsed as Record<string, unknown>;
  const result = { ...UNKNOWN_ANDROID_PERMISSIONS };
  for (const kind of ANDROID_PERMISSION_KINDS) {
    const value = values[kind];
    if (value === "allowed" || value === "not-allowed") result[kind] = value;
    else if (kind === "geolocation" && value === "approximate")
      result[kind] = value;
  }
  return result;
}

export const ANDROID_PERMISSION_STATUS_LABELS: Record<
  AndroidPermissionStatus,
  string
> = {
  allowed: "Allowed in Android",
  approximate: "Approximate location allowed in Android",
  "not-allowed": "Not allowed in Android",
  unknown: "Android status unavailable",
};

export const SITE_PERMISSION_PURPOSES: Record<PermissionKind, string> = {
  camera: "Share camera video with a site, for example during a video call.",
  microphone:
    "Share microphone audio with a site, for example during a voice call.",
  geolocation:
    "Share your location with a site. Android lets you choose approximate or precise access.",
  notifications:
    "Let a site request notifications. Permission alone does not enable notification delivery.",
  autoplay:
    "Let a site start media without another play action. No Android runtime permission is needed.",
  "persistent-storage":
    "Let a site retain stored data. This permission cannot be undone by forgetting its saved choice; stored site data is managed separately.",
};
