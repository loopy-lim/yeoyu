import { useEffect, useState } from "react";
import { AppState, DeviceEventEmitter } from "react-native";
import { platform } from "@/platform";

export interface InputViewport {
  keyboardInset: number;
  visibleHeight: number;
}
interface OwnedViewport extends InputViewport {
  scope: string;
}
const emptyViewport: InputViewport = { keyboardInset: 0, visibleHeight: 0 };

function parseViewport(value: unknown, scope: string): OwnedViewport | null {
  try {
    const payload = typeof value === "string" ? JSON.parse(value) : value;
    if (
      !payload ||
      payload.scope !== scope ||
      typeof payload.keyboardInset !== "number" ||
      !Number.isFinite(payload.keyboardInset) ||
      payload.keyboardInset < 0 ||
      typeof payload.visibleHeight !== "number" ||
      !Number.isFinite(payload.visibleHeight) ||
      payload.visibleHeight < 0
    )
      return null;
    return {
      scope,
      keyboardInset: payload.keyboardInset,
      visibleHeight: payload.visibleHeight,
    };
  } catch {
    return null;
  }
}

/** Sheet geometry belongs to its Activity; shared currentActivity cannot identify it. */
export function useInputViewport(scope: "main" | string): InputViewport {
  const [viewport, setViewport] = useState<OwnedViewport>({
    scope,
    ...emptyViewport,
  });
  useEffect(() => {
    let live = true;
    let revision = 0;
    setViewport({ scope, ...emptyViewport });
    const read = () => {
      const query = platform.getInputViewport;
      if (!query) return;
      const ticket = ++revision;
      void Promise.resolve()
        .then(() => query.call(platform, scope))
        .then((value) => {
          if (!live || ticket !== revision) return;
          const parsed = parseViewport(value, scope);
          if (parsed) setViewport(parsed);
        })
        .catch(() => {
          /* Keep the last owner-confirmed geometry until an event or retry. */
        });
    };
    const events = DeviceEventEmitter.addListener(
      "BrowserInputViewportChanged",
      (value: unknown) => {
        const parsed = parseViewport(value, scope);
        if (!live || !parsed) return;
        ++revision;
        setViewport(parsed);
      }
    );
    const activation = AppState.addEventListener("change", (state) => {
      if (state === "active") read();
    });
    read();
    return () => {
      live = false;
      ++revision;
      events.remove();
      activation.remove();
    };
  }, [scope]);
  return viewport.scope === scope ? viewport : emptyViewport;
}
