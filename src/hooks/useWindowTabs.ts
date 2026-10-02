import { useEffect, useRef, useState } from "react";
import { AppState, DeviceEventEmitter } from "react-native";
import { platform } from "@/platform";

/** Window ownership must be known before the main root can show permissions. */
export function useWindowTabs(ready: boolean) {
  const supported = typeof platform.windowTabs === "function";
  const ref = useRef<readonly string[]>([]);
  const [tabs, setTabs] = useState<readonly string[]>([]);
  const [loaded, setLoaded] = useState(!supported);

  useEffect(() => {
    if (!ready || !supported) return;
    let live = true;
    let revision = 0;
    const apply = (json: string) => {
      if (!live) return;
      try {
        const parsed: unknown = JSON.parse(json);
        if (!Array.isArray(parsed) || !parsed.every((id): id is string => typeof id === "string")) {
          setLoaded(false);
          return;
        }
        // Imperative switch/reveal guards must see the event immediately,
        // before React commits the same ownership list to the sidebar.
        ref.current = parsed;
        setTabs(parsed);
        setLoaded(true);
      } catch {
        setLoaded(false);
      }
    };
    const read = () => {
      const requestedRevision = ++revision;
      void Promise.resolve()
        .then(() => platform.windowTabs!())
        .then(
          (json) => {
            if (live && requestedRevision === revision) apply(json);
          },
          () => {
            if (live && requestedRevision === revision) setLoaded(false);
          },
        );
    };
    const subscription = DeviceEventEmitter.addListener(
      "BrowserWindowTabsChanged",
      (event: { tabIds: string }) => {
        ++revision;
        apply(event.tabIds);
      },
    );
    const lifecycle = AppState.addEventListener("change", (state) => {
      if (state === "active") read();
    });
    read();
    return () => {
      live = false;
      ++revision;
      subscription.remove();
      lifecycle.remove();
    };
  }, [ready, supported]);

  return { tabs, ref, loaded: !supported || (ready && loaded) };
}
