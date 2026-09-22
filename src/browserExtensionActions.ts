import { useEffect, useState } from "react";
import { AppState, DeviceEventEmitter } from "react-native";
import {
  browserExtensions,
  parseBrowserExtensions,
  type InstalledBrowserExtension,
} from "./browserExtensions";

export interface ExtensionToolbarAction {
  id: string;
  name: string;
  badge: string;
  badgeBackgroundColor: string;
  badgeTextColor: string;
  icon: string;
  actionEnabled: boolean;
}

export function toolbarActions(
  extensions: InstalledBrowserExtension[],
  privateTab: boolean
): ExtensionToolbarAction[] {
  return extensions
    .filter(
      (extension) =>
        extension.enabled &&
        extension.hasAction &&
        (!privateTab || extension.privateAllowed)
    )
    .map((extension) => ({
      id: extension.id,
      name: extension.name,
      badge: extension.badge,
      badgeBackgroundColor: extension.badgeBackgroundColor,
      badgeTextColor: extension.badgeTextColor,
      icon: extension.icon,
      actionEnabled: extension.actionEnabled,
    }));
}

/** Chrome-style toolbar actions track engine state. The native side emits only
 * real serialized-state changes (diff-guarded), so a refresh here cannot loop
 * the event back into another refresh. */
export function useExtensionActions(
  privateTab: boolean
): ExtensionToolbarAction[] {
  const [actions, setActions] = useState<ExtensionToolbarAction[]>([]);
  useEffect(() => {
    const native = browserExtensions;
    if (!native) return;
    let live = true;
    let inFlight = false;
    let queued = false;
    const load = () => {
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      void native
        .list()
        .then((json) => {
          if (live)
            setActions(
              toolbarActions(
                parseBrowserExtensions(json).extensions,
                privateTab
              )
            );
        })
        .catch(() => {
          // An unreadable list must never leave stale action buttons armed.
          if (live) setActions([]);
        })
        .finally(() => {
          inFlight = false;
          if (queued && live) {
            queued = false;
            load();
          }
        });
    };
    load();
    const changed = DeviceEventEmitter.addListener(
      "BrowserExtensionsChanged",
      load
    );
    const state = AppState.addEventListener("change", (value) => {
      if (value === "active") load();
    });
    return () => {
      live = false;
      changed.remove();
      state.remove();
    };
  }, [privateTab]);
  return actions;
}
