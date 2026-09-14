import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppState, NativeEventEmitter } from "react-native";
import { platform } from "../platform";

export interface ExternalPictureInPictureState {
  supported: boolean;
  allowed: boolean;
  active: boolean;
  transitioning: boolean;
  tabId: string | null;
  sequence: number;
  reason?: string;
  returnTabId?: string;
  returnToken?: number;
}

export interface ExternalPictureInPictureRuntime {
  configureExternalPictureInPicture?(
    enabled: boolean,
    visibleTabIdsJson: string,
    blocked: boolean
  ): void;
  getExternalPictureInPictureState?(): Promise<string>;
  acknowledgeExternalPictureInPictureReturn?(token: number): void;
  addListener?(name: string): void;
  removeListeners?(count: number): void;
}

const unavailable: ExternalPictureInPictureState = {
  supported: false,
  allowed: false,
  active: false,
  transitioning: false,
  tabId: null,
  sequence: 0,
  reason: "unavailable",
};
const safeCounter = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function parseState(payload: unknown): ExternalPictureInPictureState {
  const value: unknown =
    typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid external picture-in-picture state");
  const state = value as Record<string, unknown>;
  if (
    typeof state.supported !== "boolean" ||
    typeof state.allowed !== "boolean" ||
    typeof state.active !== "boolean" ||
    typeof state.transitioning !== "boolean" ||
    (state.tabId !== null && typeof state.tabId !== "string") ||
    !safeCounter(state.sequence) ||
    (state.reason !== undefined && typeof state.reason !== "string") ||
    ((state.returnTabId !== undefined || state.returnToken !== undefined) &&
      (typeof state.returnTabId !== "string" ||
        !state.returnTabId ||
        !safeCounter(state.returnToken)))
  ) {
    throw Error("Invalid external picture-in-picture state");
  }
  return {
    supported: state.supported,
    allowed: state.allowed,
    active: state.active,
    transitioning: state.transitioning,
    tabId: state.tabId,
    sequence: state.sequence,
    ...(typeof state.reason === "string" ? { reason: state.reason } : {}),
    ...(typeof state.returnTabId === "string" && safeCounter(state.returnToken)
      ? { returnTabId: state.returnTabId, returnToken: state.returnToken }
      : {}),
  };
}

// The native coordinator owns the only playback view. Observing an external
// window must not freeze the main browser's layout or create another Surface.
export function useExternalPictureInPicture({
  runtime = platform,
  enabled,
  visibleTabIds,
  blocked,
  onReturn,
  onState,
  onError,
}: {
  runtime?: ExternalPictureInPictureRuntime;
  enabled: boolean;
  visibleTabIds: ReadonlyArray<string | undefined>;
  blocked: boolean;
  onReturn(tabId: string, token: number): Promise<unknown>;
  onState?(state: ExternalPictureInPictureState): void;
  onError?(message: string): void;
}) {
  const [state, setState] = useState(unavailable);
  const callbacks = useRef({ onReturn, onState, onError });
  const consumedReturn = useRef({ runtime, token: -1 });
  useLayoutEffect(() => {
    callbacks.current = { onReturn, onState, onError };
  }, [onReturn, onState, onError]);
  const paneIdsJson = JSON.stringify(
    visibleTabIds.filter((id): id is string => !!id)
  );

  useEffect(() => {
    setState(unavailable);
    if (typeof runtime?.getExternalPictureInPictureState !== "function") return;
    let live = true;
    let query = 0;
    let sequence = -1;
    if (consumedReturn.current.runtime !== runtime)
      consumedReturn.current = { runtime, token: -1 };
    const report = (error: unknown) => {
      if (live) callbacks.current.onError?.(String(error));
    };
    const publish = (payload: unknown) => {
      if (!live) return;
      const next = parseState(payload);
      if (next.sequence < sequence) return;
      sequence = next.sequence;
      query++;
      callbacks.current.onState?.(next);
      setState(next);
      if (
        next.returnTabId !== undefined &&
        next.returnToken !== undefined &&
        next.returnToken > consumedReturn.current.token
      ) {
        const { returnToken, returnTabId } = next;
        consumedReturn.current.token = returnToken;
        // Consume before awaiting activation: duplicate events and resume reads
        // must never reselect the tab. Native ignores stale acknowledgments.
        void (async () => {
          try {
            await callbacks.current.onReturn(returnTabId, returnToken);
          } catch (error) {
            report(error);
          } finally {
            try {
              runtime.acknowledgeExternalPictureInPictureReturn?.(returnToken);
            } catch (error) {
              report(error);
            }
          }
        })();
      }
    };
    const refresh = async () => {
      const request = ++query;
      try {
        const payload = await runtime.getExternalPictureInPictureState!();
        if (live && request === query) publish(payload);
      } catch (error) {
        if (request === query) report(error);
      }
    };
    const nativeModule =
      typeof runtime.addListener === "function" &&
      typeof runtime.removeListeners === "function"
        ? {
            addListener: runtime.addListener.bind(runtime),
            removeListeners: runtime.removeListeners.bind(runtime),
          }
        : undefined;
    const events = new NativeEventEmitter(nativeModule).addListener(
      "BrowserExternalPictureInPicture",
      (payload: unknown) => {
        try {
          publish(payload);
        } catch (error) {
          report(error);
        }
      }
    );
    const lifecycle = AppState.addEventListener("change", (next) => {
      if (next === "active") void refresh();
    });
    void refresh();
    return () => {
      live = false;
      events.remove();
      lifecycle.remove();
      try {
        runtime.configureExternalPictureInPicture?.(false, "[]", true);
      } catch {
        /* No UI remains for cleanup errors. */
      }
    };
  }, [runtime]);

  useEffect(() => {
    try {
      runtime?.configureExternalPictureInPicture?.(
        enabled,
        paneIdsJson,
        blocked
      );
    } catch (error) {
      callbacks.current.onError?.(String(error));
    }
  }, [runtime, enabled, paneIdsJson, blocked]);
  return { state };
}
