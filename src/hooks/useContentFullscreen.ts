import { useCallback, useEffect, useRef } from "react";

export interface ContentFullscreenInput {
  navigation: Record<string, { fullscreen?: boolean }>;
  visibleTabIds: readonly (string | undefined)[];
  focusedTabId: string | undefined;
  exit: (id: string) => void;
}

/** Gecko owns fullscreen state; React only changes the existing pane's presentation. */
export function useContentFullscreen({
  navigation,
  visibleTabIds,
  focusedTabId,
  exit,
}: ContentFullscreenInput) {
  const requestedExits = useRef(new Set<string>());
  const tabId =
    focusedTabId &&
    visibleTabIds.includes(focusedTabId) &&
    navigation[focusedTabId]?.fullscreen
      ? focusedTabId
      : visibleTabIds.find(
          (id) => id !== undefined && navigation[id]?.fullscreen
        );

  useEffect(() => {
    for (const id of requestedExits.current)
      if (!navigation[id]?.fullscreen) requestedExits.current.delete(id);
    for (const [id, state] of Object.entries(navigation)) {
      if (
        !state.fullscreen ||
        visibleTabIds.includes(id) ||
        requestedExits.current.has(id)
      )
        continue;
      requestedExits.current.add(id);
      exit(id);
    }
  }, [navigation, visibleTabIds, exit]);

  const dismiss = useCallback(
    (closeModal: () => boolean) => {
      if (closeModal()) return true;
      if (!tabId) return false;
      exit(tabId);
      return true;
    },
    [tabId, exit]
  );
  return { tabId, dismiss };
}
