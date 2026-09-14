import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import type { Snapshot, Tab } from "../../generated/types";
import type { BrowserController } from "../BrowserController";
import type { SplitLayout } from "../splitLayout";
import type { ExternalPictureInPictureState } from "./useExternalPictureInPicture";

type Origin = {
  layout: SplitLayout | null;
  workspaceId: string | undefined;
  tabs: Tab[];
  departing: string[];
  invalid: Set<string>;
  splitValid: boolean;
  source?: string;
  returnToken?: number;
  requestedLayout?: { layout: SplitLayout | null };
};
type Restoration = {
  token: number;
  layout: SplitLayout;
  workspaceId: string | undefined;
};

function sameLayout(a: SplitLayout | null, b: SplitLayout | null): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.first === b.first &&
      a.second === b.second &&
      a.orientation === b.orientation &&
      a.ratio === b.ratio)
  );
}

function sameTab(before: Tab, now: Tab | undefined): boolean {
  return (
    !!now &&
    !now.suspended &&
    before.workspaceId === now.workspaceId &&
    before.url === now.url &&
    before.bookmarkId === now.bookmarkId
  );
}

function visible(tab: Tab, workspaceId: string | undefined): boolean {
  return !tab.suspended && (tab.favorite || tab.workspaceId === workspaceId);
}

export function useExternalPipReturnLayout({
  controller,
  layoutRef,
  workspaceRef,
  setSplitLayout,
  setFocused,
}: {
  controller: BrowserController;
  layoutRef: RefObject<SplitLayout | null>;
  workspaceRef: RefObject<string | undefined>;
  setSplitLayout(layout: SplitLayout | null): void;
  setFocused(id: string | null): void;
}) {
  const callbacks = useRef({ setSplitLayout, setFocused });
  useLayoutEffect(() => {
    callbacks.current = { setSplitLayout, setFocused };
  }, [setSplitLayout, setFocused]);
  const session = useMemo(() => {
    let attached = false;
    let pending: Origin | null = null;
    let cycle: Origin | null = null;
    // Native ACK can clear the lease before React commits. This marker belongs
    // to the matching UI commit and is consumed only after geometry settles.
    let restoration: Restoration | null = null;
    function matchingRestoration(
      layout: SplitLayout | null,
      workspaceId: string | undefined
    ): Restoration | null {
      if (
        restoration &&
        restoration.workspaceId === workspaceId &&
        sameLayout(restoration.layout, layout)
      )
        return restoration;
      return null;
    }
    const validate = (origin: Origin, snapshot: Snapshot) => {
      // Invalidity is sticky for this lease: closing and reopening an id, or
      // visiting another Space and coming back, cannot resurrect an old split.
      if (snapshot.activeWorkspaceId !== origin.workspaceId)
        origin.splitValid = false;
      for (const old of origin.tabs) {
        const now = snapshot.tabs.find((tab) => tab.id === old.id);
        if (!sameTab(old, now)) origin.invalid.add(old.id);
        if (!now || !visible(now, origin.workspaceId))
          origin.splitValid = false;
      }
    };
    const observeSnapshot = () => {
      const snapshot = controller.getSnapshot();
      if (!snapshot) return;
      if (pending) validate(pending, snapshot);
      if (cycle && cycle !== pending) validate(cycle, snapshot);
    };
    const capture = (
      before: Snapshot,
      after: Snapshot,
      ids: readonly string[]
    ) => {
      restoration = null;
      if (cycle) {
        validate(cycle, after);
        return;
      }
      pending = null;
      const layout = layoutRef.current;
      if (!layout || workspaceRef.current !== before.activeWorkspaceId) return;
      const pair = [layout.first, layout.second];
      const departing = pair.filter((id) => !ids.includes(id));
      if (!departing.length) return;
      pending = {
        layout: { ...layout },
        workspaceId: before.activeWorkspaceId,
        tabs: before.tabs
          .filter((tab) => pair.includes(tab.id))
          .map((tab) => ({ ...tab })),
        departing,
        invalid: new Set(),
        splitValid: true,
      };
      validate(pending, after);
    };
    const bind = (tabId: string) => {
      if (cycle?.source === tabId) return cycle;
      if (pending?.departing.includes(tabId)) cycle = pending;
      else {
        // A cold JS observer can honor native's exact-session return, but has
        // no evidence of the old split and must not invent one.
        const snapshot = controller.getSnapshot();
        const tab = snapshot?.tabs.find((item) => item.id === tabId);
        cycle = {
          layout: null,
          workspaceId: snapshot?.activeWorkspaceId,
          tabs: tab ? [{ ...tab }] : [],
          departing: [tabId],
          invalid: new Set(tab ? [] : [tabId]),
          splitValid: false,
        };
      }
      cycle.source = tabId;
      pending = null;
      observeSnapshot();
      return cycle;
    };
    const plan = (origin: Origin, token: number, snapshot: Snapshot) => {
      validate(origin, snapshot);
      if (
        !attached ||
        cycle !== origin ||
        origin.returnToken !== token ||
        !origin.source ||
        origin.invalid.has(origin.source) ||
        (origin.requestedLayout &&
          !sameLayout(layoutRef.current, origin.requestedLayout.layout))
      )
        return undefined;
      const source = snapshot.tabs.find((tab) => tab.id === origin.source);
      if (!source || source.suspended) return undefined;
      const layout = origin.layout;
      return layout &&
        origin.splitValid &&
        !origin.invalid.has(layout.first) &&
        !origin.invalid.has(layout.second)
        ? layout
        : null;
    };
    return {
      attach() {
        attached = true;
        const unsubscribe = controller.subscribe(observeSnapshot);
        const unlisten = controller.subscribeBeforeTabTransition(capture);
        return () => {
          attached = false;
          unsubscribe();
          unlisten();
        };
      },
      observeNative(state: ExternalPictureInPictureState) {
        if (
          state.returnTabId !== undefined &&
          state.returnToken !== undefined
        ) {
          bind(state.returnTabId).returnToken = state.returnToken;
        } else if ((state.active || state.transitioning) && state.tabId) {
          bind(state.tabId);
        } else if (cycle) {
          cycle = null;
          pending = null;
        }
        // An idle startup query can arrive while native is still measuring the
        // outgoing video. Keep its unconfirmed departure until the next claim.
      },
      settleTokenFor(
        layout: SplitLayout | null,
        workspaceId: string | undefined
      ) {
        return matchingRestoration(layout, workspaceId)?.token;
      },
      didCommitSplit(
        layout: SplitLayout | null,
        workspaceId: string | undefined,
        token: number | undefined
      ) {
        if (
          restoration &&
          restoration.token === token &&
          matchingRestoration(layout, workspaceId)
        )
          restoration = null;
      },
      navigationStarted(tabId: string) {
        // Navigation can retain a domain id while replacing its native session
        // document. Native still owns the final session/lease identity check.
        for (const origin of [pending, cycle])
          if (origin?.tabs.some((tab) => tab.id === tabId))
            origin.invalid.add(tabId);
      },
      async onReturn(tabId: string, token: number) {
        const origin = cycle;
        const current = controller.getSnapshot();
        if (origin)
          origin.requestedLayout = {
            layout: layoutRef.current ? { ...layoutRef.current } : null,
          };
        if (
          !origin ||
          origin.source !== tabId ||
          !current ||
          plan(origin, token, current) === undefined
        )
          return;
        await controller.activate(
          tabId,
          (after) => {
            const layout = plan(origin, token, after);
            return layout ? [layout.first, layout.second] : [tabId];
          },
          (before) => plan(origin, token, before) !== undefined,
          (snapshot) => {
            // Native has prepared the return, but useSyncExternalStore has not
            // published yet. Queue the matching UI state before that render.
            const layout = plan(origin, token, snapshot);
            if (layout === undefined || snapshot.activeTabId !== tabId) return;
            restoration = layout
              ? {
                  token,
                  layout: { ...layout },
                  workspaceId: snapshot.activeWorkspaceId,
                }
              : null;
            callbacks.current.setSplitLayout(layout);
            callbacks.current.setFocused(tabId);
          }
        );
      },
    };
  }, [controller, layoutRef, workspaceRef]);
  useLayoutEffect(() => session.attach(), [session]);
  return session;
}
