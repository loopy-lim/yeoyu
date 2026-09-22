import type { Snapshot } from "../generated/types";
import type { BrowserController } from "./BrowserController";

/** Native focus is a request to an existing live tab, never permission to resume it. */
export function focusBrowserWindow(
  controller: BrowserController,
  tabId: string,
  onPublished: () => void
) {
  const liveTarget = (snapshot: Snapshot) =>
    snapshot.tabs.some((tab) => tab.id === tabId && !tab.suspended);
  return controller.activate(tabId, [tabId], liveTarget, (snapshot) => {
    if (snapshot.activeTabId === tabId && liveTarget(snapshot)) onPublished();
  });
}
