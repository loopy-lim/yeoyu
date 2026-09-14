import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { AppState, NativeEventEmitter } from "react-native";
import { platform } from "../platform";

export interface PictureInPictureState {
  supported: boolean;
  allowed: boolean;
  active: boolean;
  transitioning: boolean;
  autoEnterEnabled: boolean;
  tabId: string | null;
  reason?: string;
  sequence?: number;
  restoredWindowWidth?: number;
}

// Optional methods preserve compatibility with an already-installed old binary.
export interface PictureInPictureRuntime {
  getPictureInPictureState?(): Promise<string>;
  configurePictureInPicture?(
    enabled: boolean,
    tabId: string | null,
    blocked: boolean
  ): void;
  enterPictureInPicture?(): Promise<string>;
  openPictureInPictureSettings?(): Promise<void>;
  addListener?(name: string): void;
  removeListeners?(count: number): void;
}

const unavailable: PictureInPictureState = {
  supported: false,
  allowed: false,
  active: false,
  transitioning: false,
  autoEnterEnabled: false,
  tabId: null,
  reason: "unavailable",
};

function parseState(payload: unknown): PictureInPictureState {
  const value: unknown =
    typeof payload === "string" ? JSON.parse(payload) : payload;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw Error("Invalid picture-in-picture state");
  const state = value as Record<string, unknown>;
  if (
    typeof state.supported !== "boolean" ||
    typeof state.allowed !== "boolean" ||
    typeof state.active !== "boolean" ||
    typeof state.transitioning !== "boolean" ||
    typeof state.autoEnterEnabled !== "boolean" ||
    (state.tabId !== null && typeof state.tabId !== "string") ||
    (state.reason !== undefined && typeof state.reason !== "string") ||
    (state.sequence !== undefined &&
      (typeof state.sequence !== "number" ||
        !Number.isSafeInteger(state.sequence) ||
        state.sequence < 0)) ||
    (state.restoredWindowWidth !== undefined &&
      (typeof state.restoredWindowWidth !== "number" ||
        !Number.isFinite(state.restoredWindowWidth) ||
        state.restoredWindowWidth <= 0))
  )
    throw Error("Invalid picture-in-picture state");
  return {
    supported: state.supported,
    allowed: state.allowed,
    active: state.active,
    transitioning: state.transitioning,
    autoEnterEnabled: state.autoEnterEnabled,
    tabId: state.tabId,
    ...(state.reason !== undefined ? { reason: state.reason } : {}),
    ...(state.sequence !== undefined ? { sequence: state.sequence } : {}),
    ...(state.restoredWindowWidth !== undefined
      ? { restoredWindowWidth: state.restoredWindowWidth }
      : {}),
  };
}

interface Actions {
  enter(): Promise<PictureInPictureState | null>;
  openSettings(): Promise<void>;
}

// Android owns the existing GeckoView and PiP window. This hook only observes
// native state and configures eligibility; it never mounts a second player.
export function usePictureInPicture({
  runtime = platform,
  enabled,
  tabId,
  blocked,
  onError,
}: {
  runtime?: PictureInPictureRuntime;
  enabled: boolean;
  tabId: string | null;
  blocked: boolean;
  onError?(message: string): void;
}) {
  const [state, setState] = useState(unavailable);
  const actions = useRef<Actions | null>(null);
  const errorCallback = useRef(onError);
  useLayoutEffect(() => {
    errorCallback.current = onError;
  }, [onError]);

  useEffect(() => {
    setState(unavailable);
    if (typeof runtime?.getPictureInPictureState !== "function") return;
    let live = true;
    let query = 0;
    let entry = 0;
    let revision = 0;
    let current = unavailable;
    let lastSequence: number | undefined;
    const report = (error: unknown) => {
      if (live) errorCallback.current?.(String(error));
    };
    const publish = (next: PictureInPictureState) => {
      if (!live) return current;
      if (
        next.sequence !== undefined &&
        lastSequence !== undefined &&
        next.sequence < lastSequence
      )
        return current;
      // A fresh query with the same sequence may reflect changed OS permission.
      if (next.sequence !== undefined) lastSequence = next.sequence;
      current = next;
      revision++;
      query++;
      setState(next);
      return next;
    };
    const refresh = async () => {
      if (!live) return;
      const request = ++query;
      try {
        const payload = await runtime.getPictureInPictureState!();
        if (live && request === query) publish(parseState(payload));
      } catch (error) {
        if (request === query) report(error);
      }
    };
    const handlers: Actions = {
      enter: async () => {
        if (!live || typeof runtime.enterPictureInPicture !== "function")
          return null;
        const request = ++entry;
        // A snapshot requested before this action no longer describes its
        // outcome, including binaries that do not provide sequence numbers.
        query++;
        const observedRevision = revision;
        try {
          const next = parseState(await runtime.enterPictureInPicture());
          if (!live || request !== entry) return null;
          // An action response can follow its own native event. Only a strictly
          // newer native sequence can supersede state observed while it waited.
          if (
            revision !== observedRevision &&
            !(
              next.sequence !== undefined &&
              lastSequence !== undefined &&
              next.sequence > lastSequence
            )
          )
            return current;
          return publish(next);
        } catch (error) {
          if (request === entry) report(error);
          return null;
        }
      },
      openSettings: async () => {
        if (!live || typeof runtime.openPictureInPictureSettings !== "function")
          return;
        try {
          await runtime.openPictureInPictureSettings();
        } catch (error) {
          report(error);
        }
      },
    };
    actions.current = handlers;

    const nativeModule =
      typeof runtime.addListener === "function" &&
      typeof runtime.removeListeners === "function"
        ? {
            addListener: runtime.addListener.bind(runtime),
            removeListeners: runtime.removeListeners.bind(runtime),
          }
        : undefined;
    const events = new NativeEventEmitter(nativeModule).addListener(
      "BrowserPictureInPicture",
      (payload: unknown) => {
        if (!live) return;
        try {
          publish(parseState(payload));
        } catch (error) {
          report(error);
        }
      }
    );
    const lifecycle = AppState.addEventListener("change", (next) => {
      if (next === "active") void refresh();
    });
    // Subscription must precede this call: native may emit before resolving it.
    void refresh();
    return () => {
      live = false;
      events.remove();
      lifecycle.remove();
      if (actions.current === handlers) actions.current = null;
      // Disarm stale targets during unmount/runtime replacement. An Activity
      // transition keeps the React root mounted, so this does not end active PiP.
      try {
        runtime.configurePictureInPicture?.(false, null, true);
      } catch {
        /* No UI remains to receive cleanup errors. */
      }
    };
  }, [runtime]);

  useEffect(() => {
    if (typeof runtime?.configurePictureInPicture !== "function") return;
    try {
      runtime.configurePictureInPicture(enabled, tabId, blocked);
    } catch (error) {
      errorCallback.current?.(String(error));
    }
  }, [runtime, enabled, tabId, blocked]);

  const enter = useCallback(
    () => actions.current?.enter() ?? Promise.resolve(null),
    []
  );
  const openSettings = useCallback(
    () => actions.current?.openSettings() ?? Promise.resolve(),
    []
  );
  return { state, enter, openSettings };
}
