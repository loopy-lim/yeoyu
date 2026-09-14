import { useLayoutEffect, useRef } from "react";

/** Keep the last committed normal presentation while native PiP owns its view. */
export function usePipLayout<T>(live: T, retain: boolean): T {
  const lastNormal = useRef(live);
  useLayoutEffect(() => {
    // Render-time writes would let an abandoned render replace the view that
    // native PiP is moving. Exit resumes live immediately, without extra state.
    if (!retain) lastNormal.current = live;
  }, [live, retain]);
  return retain ? lastNormal.current : live;
}

/** PiP resize and background events must not overwrite the sidebar preference. */
export function shouldApplySidebarWindowChange(
  previousCompact: boolean,
  nextCompact: boolean,
  appState: string | null,
  pipVisible: boolean
): boolean {
  return (
    previousCompact !== nextCompact && appState === "active" && !pipVisible
  );
}

export interface SidebarWindowState {
  acceptedCompact: boolean;
  recovering: boolean;
}

/** Resume resize inference only after native and React agree on the restored window. */
export function advanceSidebarWindow(
  state: SidebarWindowState,
  input: {
    width: number;
    appState: string | null;
    pipVisible: boolean;
    restoredWindowWidth?: number;
  }
): { state: SidebarWindowState; collapsed?: boolean } {
  if (input.pipVisible) {
    return {
      state: state.recovering ? state : { ...state, recovering: true },
    };
  }
  if (input.appState !== "active") return { state };
  const compact = input.width < 840;
  if (state.recovering) {
    const restoredWidth = input.restoredWindowWidth;
    if (
      restoredWidth === undefined ||
      !Number.isFinite(restoredWidth) ||
      restoredWidth <= 0 ||
      !Number.isFinite(input.width) ||
      Math.abs(input.width - restoredWidth) > 0.5
    )
      return { state };
    // Even rotation during PiP only establishes a baseline. It must not
    // overwrite the user's sidebar choice on the way back to the app.
    return { state: { acceptedCompact: compact, recovering: false } };
  }
  if (
    !shouldApplySidebarWindowChange(
      state.acceptedCompact,
      compact,
      input.appState,
      input.pipVisible
    )
  )
    return { state };
  return {
    state: { acceptedCompact: compact, recovering: false },
    collapsed: compact,
  };
}
