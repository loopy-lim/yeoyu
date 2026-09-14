import { test, expect } from "bun:test";
import type { Snapshot } from "../generated/types";
import { persistableSnapshot } from "../src/privateTabs";

const base = (tabs: Snapshot["tabs"]): Snapshot => ({
  version: 1,
  revision: 7,
  workspaces: [{ id: "workspace-1", name: "Default" }],
  tabs,
  activeWorkspaceId: "workspace-1",
  activeTabId: tabs[0]?.id ?? null,
  keyBindings: [],
});

test("snapshots without private tabs pass through unchanged", () => {
  const snapshot = base([
    { id: "a", workspaceId: "workspace-1", url: "https://a.example", title: "A" },
  ]);
  expect(persistableSnapshot(snapshot)).toBe(snapshot);
});

test("persisted copies drop private tabs and repair the active pointers", () => {
  const snapshot = base([
    { id: "a", workspaceId: "workspace-1", url: "https://a.example", title: "A" },
    {
      id: "p",
      workspaceId: "workspace-1",
      url: "https://private.example",
      title: "Private",
      private: true,
    },
  ]);
  snapshot.workspaces[0].lastActiveTabId = "p";
  snapshot.activeTabId = "p";
  const persisted = persistableSnapshot(snapshot);
  expect(persisted.tabs.map((tab) => tab.id)).toEqual(["a"]);
  expect(persisted.activeTabId).toBeNull();
  expect(persisted.workspaces[0].lastActiveTabId).toBeNull();
  // The in-memory snapshot keeps the private tab.
  expect(snapshot.tabs).toHaveLength(2);
});

test("an ordinary active tab survives the private strip", () => {
  const snapshot = base([
    {
      id: "p",
      workspaceId: "workspace-1",
      url: "https://private.example",
      title: "",
      private: true,
    },
    { id: "a", workspaceId: "workspace-1", url: "https://a.example", title: "A" },
  ]);
  snapshot.activeTabId = "a";
  snapshot.workspaces[0].lastActiveTabId = "a";
  const persisted = persistableSnapshot(snapshot);
  expect(persisted.activeTabId).toBe("a");
  expect(persisted.workspaces[0].lastActiveTabId).toBe("a");
});
