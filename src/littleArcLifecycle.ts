// Decision core for the Little Arc marker safety net (App.tsx). The overlay
// stops rendering the moment focus leaves its tab, but only some dismissal
// paths clear the persisted crash marker explicitly; the net keeps the
// marker in lockstep with what can actually render. Extracted as a pure
// function so the freeze/transition edge cases stay unit-testable.

export interface LittleArcGuardState {
  littleArcTabId: string | null;
  // The presentation target. NOTE: while native PiP owns the view,
  // usePipLayout retains the last NORMAL presentation here — this value is
  // deliberately frozen, not live, for the whole PiP window.
  target: string | null | undefined;
  tabs: ReadonlyArray<{ id: string }>;
  pipVisible: boolean;
}

/**
 * True when the overlay's runtime state no longer matches what is (or can
 * be) rendered and both the card state and the persisted marker must drop.
 */
export function littleArcOrphaned(state: LittleArcGuardState): boolean {
  if (!state.littleArcTabId) return false;
  // While native PiP owns the view, `target` is the frozen pre-PiP layout:
  // an external link drained during the transition would otherwise read as
  // focus-leaving and permanently dismiss the newborn card. Suspend and
  // re-evaluate when PiP ends (pipVisible returns false).
  if (state.pipVisible) return false;
  return (
    state.target !== state.littleArcTabId ||
    !state.tabs.some((tab) => tab.id === state.littleArcTabId)
  );
}
