import type { Snapshot } from "../generated/types";

/** The persisted snapshot must never carry private tabs: strip them from the
 * save payload and repair the active pointers that referenced them. The
 * in-memory snapshot keeps private tabs; only disk copies pass through here.
 * Restore drops them independently (Rust), so a stale copy can never revive. */
export function persistableSnapshot(snapshot: Snapshot): Snapshot {
  if (!snapshot.tabs.some((tab) => tab.private)) return snapshot;
  const tabs = snapshot.tabs.filter((tab) => !tab.private);
  const survives = (id: string | null | undefined): boolean =>
    !!id && tabs.some((tab) => tab.id === id);
  return {
    ...snapshot,
    tabs,
    activeTabId: survives(snapshot.activeTabId) ? snapshot.activeTabId : null,
    workspaces: snapshot.workspaces.map((workspace) =>
      survives(workspace.lastActiveTabId)
        ? workspace
        : { ...workspace, lastActiveTabId: null }
    ),
  };
}
