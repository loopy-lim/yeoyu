import { DeviceEventEmitter } from "react-native";
import { SitePermissions, type PermissionDecision } from "@/permissions";
import { platform } from "@/platform";
import {
  PermissionRequests,
  answerPermission,
  type PermissionChoice,
  type PermissionRequest,
} from "@/permissionRequests";
import type { PermissionKind } from "@/uiPreferences";

// All React roots share one ledger and durable store. A native request must
// never be answered twice or overwrite another window's saved site choices.
export const sitePermissions = new SitePermissions(platform);
export const permissionRequests = new PermissionRequests();
const ruleListeners = new Set<() => void>();
let hosts = 0;
let stopListening: (() => void) | undefined;
let initialization: Promise<void> | null = null;

function publishRules() {
  platform.setSitePermissionRules?.(
    JSON.stringify(
      sitePermissions
        .all()
        .map((rule) => ({
          origin: rule.origin,
          kind: rule.kind,
          allow: rule.decision === "allow",
        }))
    )
  );
  ruleListeners.forEach((listener) => listener());
}

export function initializeBrowserPermissions(): Promise<void> {
  if (!initialization) {
    initialization = sitePermissions
      .load()
      .then(publishRules)
      .catch((failure) => {
        initialization = null;
        throw failure;
      });
  }
  return initialization;
}

export function subscribeSitePermissionChanges(listener: () => void) {
  ruleListeners.add(listener);
  return () => {
    ruleListeners.delete(listener);
  };
}

export function listenBrowserPermissions() {
  if (++hosts === 1) {
    const requested = DeviceEventEmitter.addListener(
      "BrowserPermissionRequest",
      (request: PermissionRequest) => permissionRequests.enqueue(request)
    );
    const cancelled = DeviceEventEmitter.addListener(
      "BrowserPermissionCancelled",
      (event: { requestId: number }) =>
        permissionRequests.cancel(event.requestId)
    );
    stopListening = () => {
      requested.remove();
      cancelled.remove();
    };
  }
  let listening = true;
  return () => {
    if (!listening) return;
    listening = false;
    if (--hosts !== 0) return;
    stopListening?.();
    stopListening = undefined;
    permissionRequests
      .cancelAll()
      .forEach((id) => platform.resolvePermission?.(id, false, false));
  };
}

async function requestAndroid(kind: PermissionKind) {
  if (
    kind !== "geolocation" &&
    kind !== "notifications" &&
    kind !== "camera" &&
    kind !== "microphone"
  )
    return true;
  return platform.requestAndroidPermission?.(kind).catch(() => false) ?? false;
}

async function save(
  origin: string,
  kinds: PermissionKind[],
  decision: PermissionDecision
) {
  await sitePermissions.decideMany(origin, kinds, decision);
  publishRules();
}

export function answerBrowserPermission(id: number, choice: PermissionChoice) {
  return answerPermission(permissionRequests, id, choice, {
    requestAndroid,
    save,
    resolve: (requestId, allow, rememberDenial) =>
      platform.resolvePermission?.(requestId, allow, rememberDenial),
  });
}
