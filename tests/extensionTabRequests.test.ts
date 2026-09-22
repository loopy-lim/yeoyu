import { expect, test } from "bun:test";
import type { Snapshot } from "../generated/types";
import { BrowserController, type BrowserCommands, type BrowserStorage } from "../src/BrowserController";
import { focusBrowserWindow } from "../src/browserFocus";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function initial(): Snapshot {
  return {
    version: 1,
    revision: 0,
    workspaces: [{ id: "one", name: "One" }],
    activeWorkspaceId: "one",
    activeTabId: "a",
    tabs: ["a", "b"].map((id) => ({ id, workspaceId: "one", title: id, url: `https://${id}.example/` })),
    keyBindings: [],
  };
}

// The real controller owns authorization ordering and publication. This narrow
// domain port records commands; it does not claim to exercise Rust or Gecko.
async function fixture(seed = initial()) {
  let domain = seed;
  const events: string[] = [];
  const writes: string[] = [];
  const transitions: Array<[string | null, string | null, string | null]> = [];
  const unsupported = async (): Promise<never> => { throw new Error("Unexpected domain command"); };
  const commands: BrowserCommands = {
    ready: async () => undefined,
    browserSnapshot: async () => domain,
    snapshotRestore: unsupported,
    workspaceCreate: unsupported,
    workspaceActivate: unsupported,
    tabCreate: unsupported,
    tabActivate: async ({ tabId }) => {
      events.push(`activate:${tabId}`);
      domain = { ...domain, revision: domain.revision + 1, activeTabId: tabId };
      return domain;
    },
    tabClose: async ({ tabId }) => {
      events.push(`close:${tabId}`);
      const tabs = domain.tabs.filter((tab) => tab.id !== tabId);
      domain = { ...domain, revision: domain.revision + 1, tabs,
        activeTabId: domain.activeTabId === tabId ? tabs[0]?.id ?? null : domain.activeTabId };
      return domain;
    },
    tabReset: unsupported,
    tabNavigated: unsupported,
    tabSetFavorite: unsupported,
    tabSetPinned: unsupported,
    tabMove: unsupported,
    tabSetWorkspace: unsupported,
    keymapSet: unsupported,
    bookmarkOpen: unsupported,
    bookmarkCreate: unsupported,
    bookmarkUpdate: unsupported,
    bookmarkRemove: unsupported,
    bookmarkMove: unsupported,
    bookmarkFolderCreate: unsupported,
    bookmarkFolderRename: unsupported,
    bookmarkFolderRemove: unsupported,
    bookmarkSetFolder: unsupported,
  };
  const storage: BrowserStorage = {
    readSnapshot: async () => null,
    saveSnapshot: async (json) => { writes.push(json); },
    reconcileTabs: () => undefined,
    configureKeys: () => undefined,
    prepareTabTransition: async (...args) => { transitions.push(args); },
  };
  const controller = new BrowserController(commands, storage);
  await controller.initialize();
  await controller.flush();
  writes.length = 0;
  controller.subscribe(() => events.push(`publish:${controller.snapshot?.activeTabId}`));
  return { controller, storage, events, writes, transitions };
}

const actions: Array<"close" | "activate"> = ["close", "activate"];
test.each(actions)("a denied %s claim cannot mutate, publish or persist the target tab", async (action) => {
  const { controller, events, writes, transitions } = await fixture();
  const before = controller.snapshot;
  let claims = 0;
  await expect(controller.applyExtensionTabRequest("b", action, async () => {
    claims++;
    return false;
  })).rejects.toThrow("permission changed");
  await controller.flush();
  expect(claims).toBe(1);
  expect(controller.snapshot).toBe(before);
  expect(events).toEqual([]);
  expect(transitions).toEqual([]);
  expect(writes).toEqual([]);
});

test("a failed claim transport leaves the controller queue usable without applying the extension close", async () => {
  const { controller, events } = await fixture();
  await expect(controller.applyExtensionTabRequest("a", "close", async () => {
    throw new Error("claim transport unavailable");
  })).rejects.toThrow("claim transport unavailable");
  expect(events).toEqual([]);
  await controller.activate("b");
  await controller.flush();
  expect(controller.snapshot?.tabs.map((tab) => tab.id)).toEqual(["a", "b"]);
  expect(controller.snapshot?.activeTabId).toBe("b");
  expect(events).toEqual(["activate:b", "publish:b"]);
});

test("a queued extension claim waits for prior publication and observes revocation before its command", async () => {
  const { controller, storage, events } = await fixture();
  const entered = deferred();
  const release = deferred();
  storage.prepareTabTransition = async (_previous, next) => {
    if (next === "b") { entered.resolve(); await release.promise; }
  };
  const first = controller.activate("b");
  await entered.promise;
  let permitted = true;
  let claims = 0;
  const extension = controller.applyExtensionTabRequest("b", "close", async () => {
    claims++;
    events.push(`claim:${controller.snapshot?.activeTabId}:${permitted}`);
    return permitted;
  });
  const last = controller.activate("a");
  const results = Promise.allSettled([first, extension, last]);
  try {
    // Let initialize().then enqueue both requests while the prior publication
    // is held. A claim performed outside SerialQueue would already run here.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(claims).toBe(0);
    expect(controller.snapshot?.activeTabId).toBe("a");
    permitted = false;
  } finally {
    release.resolve();
    await results;
    await controller.flush();
  }
  expect((await results).map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  expect(events).toEqual(["activate:b", "publish:b", "claim:b:false", "activate:a", "publish:a"]);
  expect(controller.snapshot?.tabs.map((tab) => tab.id)).toEqual(["a", "b"]);
});

test("a valid activation claims before mutation and publishes the target as the sole visible pane", async () => {
  const { controller, events, transitions } = await fixture();
  await controller.applyExtensionTabRequest("b", "activate", async () => { events.push("claim"); return true; });
  await controller.flush();
  expect(events).toEqual(["claim", "activate:b", "publish:b"]);
  expect(controller.snapshot?.activeTabId).toBe("b");
  expect(transitions).toEqual([["a", "b", '["b"]']]);
});

test("a valid active-tab close claims before mutation and prepares the surviving tab without the closed source", async () => {
  const { controller, events, transitions } = await fixture();
  await controller.applyExtensionTabRequest("a", "close", async () => { events.push("claim"); return true; });
  await controller.flush();
  expect(events).toEqual(["claim", "close:a", "publish:b"]);
  expect(controller.snapshot?.tabs.map((tab) => tab.id)).toEqual(["b"]);
  expect(controller.snapshot?.activeTabId).toBe("b");
  expect(transitions).toEqual([[null, "b", null]]);
});

test("a target closed by earlier queued work is rejected without spending its claim", async () => {
  const { controller, events } = await fixture();
  let claims = 0;
  const closed = controller.close("b");
  const extension = controller.applyExtensionTabRequest("b", "activate", async () => { claims++; return true; });
  const results = await Promise.allSettled([closed, extension]);
  await controller.flush();
  expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
  expect(claims).toBe(0);
  expect(events).toEqual(["close:b", "publish:a"]);
  expect(controller.snapshot?.tabs.map((tab) => tab.id)).toEqual(["a"]);
});

test("a queued browser focus cannot resurrect a target closed before activation", async () => {
  const { controller, events } = await fixture();
  const close = controller.close("b");
  const focus = focusBrowserWindow(controller, "b", () => events.push("focus:b"));
  await Promise.all([close, focus]);
  expect(events).toEqual(["close:b", "publish:a"]);
  expect(controller.snapshot?.activeTabId).toBe("a");
});

test("a browser focus cannot resume a suspended tab", async () => {
  const seed = initial();
  seed.tabs[1].suspended = true;
  const { controller, events } = await fixture(seed);
  await focusBrowserWindow(controller, "b", () => events.push("focus:b"));
  expect(events).toEqual([]);
  expect(controller.snapshot?.tabs[1].suspended).toBe(true);
});

test("a valid browser focus commits sole-pane UI before publishing the activated tab", async () => {
  const { controller, events, transitions } = await fixture();
  await focusBrowserWindow(controller, "b", () => events.push("focus:b"));
  expect(events).toEqual(["activate:b", "focus:b", "publish:b"]);
  expect(transitions).toEqual([["a", "b", '["b"]']]);
});
