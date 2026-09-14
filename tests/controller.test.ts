import { test, expect } from "bun:test";
import type { Snapshot } from "../generated/types";
import type { BrowserCommands, BrowserStorage } from "../src/BrowserController";

test("private-only navigation skips equivalent durable writes but ordinary navigation still flushes", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const seed = initial(); seed.tabs[1].private = true; seed.activeTabId = "b";
  const ports = fixture(seed);
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.initialize(); await controller.flush();
  const writes = ports.writes.length;
  await controller.navigated({ tabId: "b", url: "https://private-canary.example", title: "private", loading: false, canGoBack: false, canGoForward: false });
  await controller.flush();
  expect(ports.writes).toHaveLength(writes);
  await controller.navigated({ tabId: "a", url: "https://ordinary.example/new", title: "ordinary", loading: false, canGoBack: true, canGoForward: false });
  await controller.flush();
  expect(ports.writes).toHaveLength(writes + 1);
  expect(ports.writes.at(-1)?.tabs[0].url).toBe("https://ordinary.example/new");
});

test("an uncertain import freezes mutations already waiting in the controller queue", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const ports = fixture();
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.initialize(); await controller.flush();
  const before = controller.snapshot!;
  ports.commands.workArchivePrepare = async () => ({ ...before, revision: before.revision + 1 });
  ports.commands.workArchiveImport = async () => { throw Error("bridge unavailable"); };
  ports.commands.browserSnapshot = async () => { throw Error("bridge unavailable"); };
  const pendingImport = controller.importArchive("{}", false, false);
  const pendingMutation = controller.createTab("https://should-not-open.example/");
  const results = await Promise.allSettled([pendingImport, pendingMutation]);
  expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
  expect(controller.snapshot).toBe(before);
});

test("archive disk failure never commits or publishes imported tabs", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const ports = fixture();
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.initialize(); await controller.flush();
  const before = controller.snapshot!;
  let commits = 0;
  ports.commands.workArchivePrepare = async () => ({ ...before, revision: before.revision + 1, workspaces: [...before.workspaces, { id: "imported", name: "Imported" }] });
  ports.commands.workArchiveImport = async () => { commits++; throw Error("must not commit"); };
  ports.storage.saveSnapshot = async () => { throw Error("disk full"); };
  await expect(controller.importArchive("{}", false, false)).rejects.toThrow("disk full");
  expect(controller.snapshot).toBe(before);
  expect(commits).toBe(0);
});

test("archive import persists private-free candidate before commit and publication", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const seed = initial();
  seed.tabs.push({ ...seed.tabs[0], id: "private", private: true, url: "https://private-canary.example/" });
  const ports = fixture(seed);
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.initialize(); await controller.flush();
  const before = controller.snapshot!;
  const candidate = { ...before, revision: before.revision + 1, workspaces: [...before.workspaces, { id: "imported", name: "Imported" }] };
  const order: string[] = [];
  ports.commands.workArchivePrepare = async () => candidate;
  ports.storage.saveSnapshot = async (json) => { expect(json).not.toContain("private-canary"); order.push("write"); expect(controller.snapshot).toBe(before); };
  ports.commands.workArchiveImport = async (input) => { expect(input.expectedRevision).toBe(before.revision); order.push("commit"); return candidate; };
  controller.subscribe(() => order.push("publish"));
  await controller.importArchive("{}", true, false);
  await controller.flush();
  expect(order).toEqual(["write", "commit", "publish"]);
  expect(controller.snapshot?.tabs.some((tab) => tab.id === "private")).toBe(true);
});

test("ambiguous archive commit recovers committed state without erasing the durable import", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const ports = fixture();
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.initialize(); await controller.flush();
  const candidate = { ...controller.snapshot!, revision: controller.snapshot!.revision + 1 };
  ports.commands.workArchivePrepare = async () => candidate;
  ports.commands.workArchiveImport = async () => { throw Error("bridge reply lost"); };
  ports.commands.browserSnapshot = async () => candidate;
  await controller.importArchive("{}", false, false);
  expect(controller.snapshot?.revision).toBe(candidate.revision);
  expect(ports.writes.at(-1)?.revision).toBe(candidate.revision);
});

type FixtureSnapshot = Snapshot & {
  bookmarks: NonNullable<Snapshot["bookmarks"]>;
};
const initial = (): FixtureSnapshot => ({
  version: 1,
  revision: 0,
  workspaces: [{ id: "workspace-1", name: "Default" }],
  tabs: ["a", "b"].map((id) => ({
    id,
    workspaceId: "workspace-1",
    url: `https://${id}.example`,
    title: id,
  })),
  activeWorkspaceId: "workspace-1",
  activeTabId: "a",
  keyBindings: [],
  bookmarks: [
    {
      id: "bookmark-a",
      title: "A",
      url: "https://a.example/",
      workspaceId: "workspace-1",
    },
    {
      id: "bookmark-new",
      title: "New",
      url: "https://new.example",
      workspaceId: "workspace-1",
    },
  ],
});

test("tab selection lets native claim the outgoing view before publishing its removal", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const ports = fixture();
  const transitions: Array<[string | null, string | null]> = [];
  let release!: () => void;
  ports.storage.prepareTabTransition = async (previous, next) => {
    transitions.push([previous, next]);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.initialize();
  let publications = 0;
  controller.subscribe(() => publications++);
  const selection = controller.activate("b");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(transitions).toEqual([["a", "b"]]);
  expect(controller.snapshot!.activeTabId).toBe("a");
  expect(publications).toBe(0);
  release();
  await selection;
  expect(controller.snapshot!.activeTabId).toBe("b");
  expect(publications).toBe(1);
  await controller.flush();
});

test("unavailable external PiP never rolls back an already committed tab selection", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const ports = fixture();
  let calls = 0;
  ports.storage.prepareTabTransition = async () => {
    calls++;
    throw Error("PiP denied");
  };
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.activate("b");
  expect(calls).toBe(1);
  expect(controller.snapshot!.activeTabId).toBe("b");
  await controller.flush();
  expect(ports.writes.at(-1)!.activeTabId).toBe("b");
});

test("closing the active source restores the next tab without leasing a retired session", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const ports = fixture();
  const transitions: Array<[string | null, string | null]> = [];
  ports.storage.prepareTabTransition = async (previous, next) => {
    transitions.push([previous, next]);
  };
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.close("a");
  expect(transitions).toEqual([[null, "b"]]);
  expect(controller.snapshot!.tabs.map((tab) => tab.id)).toEqual(["b"]);
  await controller.flush();
});

test("queued tab changes prepare in publication order while selecting the same tab is silent", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const ports = fixture();
  const transitions: Array<[string | null, string | null]> = [];
  ports.storage.prepareTabTransition = async (previous, next) => {
    transitions.push([previous, next]);
  };
  const controller = new BrowserController(ports.commands, ports.storage);
  await Promise.all([
    controller.activate("b"),
    controller.activate("b"),
    controller.activate("a"),
  ]);
  expect(transitions).toEqual([
    ["a", "b"],
    ["b", "a"],
  ]);
  expect(controller.snapshot!.activeTabId).toBe("a");
  await controller.flush();
});

test("Space changes still prepare a single pane when the selected Favorite stays the same", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const seed = initial();
  seed.tabs[0].favorite = true;
  seed.workspaces.push({ id: "work", name: "Work" });
  const ports = fixture(seed);
  ports.commands.workspaceActivate = async ({ workspaceId }) => ({
    ...seed,
    activeWorkspaceId: workspaceId,
  });
  const transitions: Array<[string | null, string | null, string | null]> = [];
  ports.storage.prepareTabTransition = async (...args) => {
    transitions.push(args);
  };
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.activateWorkspace("work");
  expect(transitions).toEqual([["a", "a", '["a"]']]);
  await controller.flush();
});

test("opening an already active bookmark explicitly retires the other split pane", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const ports = fixture();
  const transitions: Array<[string | null, string | null, string | null]> = [];
  ports.storage.prepareTabTransition = async (...args) => {
    transitions.push(args);
  };
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.openBookmark("bookmark-a");
  expect(transitions).toEqual([["a", "a", '["a"]']]);
  await controller.flush();
});

test("popup publication waits for native adoption of its allocated domain ID", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const ports = fixture();
  let release!: () => void;
  let adopted = "";
  ports.storage.resolveNewSession = async (requestId, tabId) => {
    expect(requestId).toBe(7);
    adopted = tabId;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  };
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.initialize();
  const popup = controller.openWindow({
    requestId: 7,
    openerTabId: "a",
    uri: "about:blank",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(adopted).toBe("created-1");
  expect(controller.snapshot!.tabs.some((tab) => tab.id === adopted)).toBe(
    false
  );
  expect(ports.reconciled.some((ids) => ids.includes(adopted))).toBe(false);
  release();
  const snapshot = await popup;
  expect(snapshot.activeTabId).toBe(adopted);
  expect(controller.isPopupTab(adopted)).toBe(true);
  expect(snapshot.tabs.find((tab) => tab.id === adopted)!.url).toBe(
    "about:blank"
  );
  await controller.close(adopted);
  expect(controller.isPopupTab(adopted)).toBe(false);
  await controller.flush();
});

test("popup adoption failure rolls back the hidden tab and restores the selected tab", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const ports = fixture();
  const cancelled: number[] = [];
  ports.storage.resolveNewSession = async () => {
    throw Error("Popup request expired");
  };
  ports.storage.cancelNewSession = (id) => {
    cancelled.push(id);
  };
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.initialize();
  await expect(
    controller.openWindow({
      requestId: 8,
      openerTabId: "a",
      uri: "https://popup.example",
    })
  ).rejects.toThrow("Popup request expired");
  expect(controller.snapshot!.tabs.map((tab) => tab.id)).toEqual(["a", "b"]);
  expect(controller.snapshot!.activeTabId).toBe("a");
  expect(cancelled).toEqual([8]);
  expect(ports.reconciled.some((ids) => ids.includes("created-1"))).toBe(false);
  await controller.flush();
});

test("popup from an already closed opener is cancelled without allocating a tab", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const ports = fixture();
  let adoptions = 0;
  const cancelled: number[] = [];
  ports.storage.resolveNewSession = async () => {
    adoptions++;
  };
  ports.storage.cancelNewSession = (id) => {
    cancelled.push(id);
  };
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.initialize();
  await controller.close("a");
  await expect(
    controller.openWindow({
      requestId: 9,
      openerTabId: "a",
      uri: "about:blank",
    })
  ).rejects.toThrow("opener");
  expect(adoptions).toBe(0);
  expect(cancelled).toEqual([9]);
  expect(controller.snapshot!.tabs.map((tab) => tab.id)).toEqual(["b"]);
  await controller.flush();
});

test("popup follows its opener's Space even if another Space is selected", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const seed = initial();
  seed.workspaces.push({ id: "work", name: "Work" });
  seed.tabs[1].workspaceId = "work";
  const ports = fixture(seed);
  ports.storage.resolveNewSession = async () => undefined;
  const controller = new BrowserController(ports.commands, ports.storage);
  const snapshot = await controller.openWindow({
    requestId: 10,
    openerTabId: "b",
    uri: "https://popup.example",
  });
  expect(snapshot.activeWorkspaceId).toBe("work");
  expect(
    snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId)!.workspaceId
  ).toBe("work");
  await controller.flush();
});

function fixture(seed: Snapshot = initial()) {
  let state: FixtureSnapshot = { ...seed, bookmarks: seed.bookmarks ?? [] };
  const writes: Snapshot[] = [];
  const reconciled: string[][] = [];
  const reconcilePayloads: { id: string; private: boolean }[][] = [];
  let holdWrite: Promise<void> | undefined;
  const requireTab = (id: string) => {
    const tab = state.tabs.find((item) => item.id === id);
    if (!tab) throw Error("Unknown tab");
    return tab;
  };
  const result = () => structuredClone(state);
  const unsupported = async (): Promise<Snapshot> => {
    throw Error("Not used by this scenario");
  };
  const commands: BrowserCommands = {
    ready: async () => undefined,
    browserSnapshot: async () => result(),
    snapshotRestore: unsupported,
    tabReset: unsupported,
    workspaceCreate: unsupported,
    tabCreate: async ({ workspaceId, url, private: isPrivate }) => {
      const id = `created-${state.revision + 1}`;
      state = {
        ...state,
        revision: state.revision + 1,
        activeWorkspaceId: workspaceId,
        activeTabId: id,
        tabs: [
          ...state.tabs,
          {
            id,
            workspaceId,
            url,
            title: "",
            ...(isPrivate ? { private: true } : {}),
          },
        ],
      };
      return result();
    },
    bookmarkOpen: async ({ bookmarkId, reuseTabId, private: inPrivate }) => {
      const bookmark = state.bookmarks.find((item) => item.id === bookmarkId)!;
      // Private opens never adopt an ordinary owned or reusable session.
      let tab = inPrivate
        ? undefined
        : state.tabs.find(
            (item) =>
              item.bookmarkId === bookmarkId &&
              item.workspaceId === state.activeWorkspaceId
          );
      if (!tab) {
        const reusable =
          inPrivate || !reuseTabId
            ? undefined
            : state.tabs.find(
                (item) =>
                  item.id === reuseTabId &&
                  !item.bookmarkId &&
                  !item.favorite &&
                  item.workspaceId === state.activeWorkspaceId
              );
        tab = inPrivate
          ? {
              id: `created-${state.revision + 1}`,
              workspaceId: state.activeWorkspaceId,
              url: bookmark.url,
              title: bookmark.title,
              private: true,
            }
          : {
              ...(reusable ?? {
                id: `created-${state.revision + 1}`,
                workspaceId: state.activeWorkspaceId,
                url: bookmark.url,
                title: bookmark.title,
              }),
              pinned: true,
              bookmarkId,
              homeUrl: bookmark.url,
              homeTitle: bookmark.title,
              suspended: false,
            };
        state.tabs = reusable
          ? state.tabs.map((item) => (item.id === tab!.id ? tab! : item))
          : [...state.tabs, tab];
      }
      state = {
        ...state,
        revision: state.revision + 1,
        activeTabId: tab.id,
        tabs: state.tabs.map((item) =>
          item.id === tab!.id ? { ...item, suspended: false } : item
        ),
      };
      return result();
    },
    bookmarkCreate: async ({ title, url }) => {
      state = {
        ...state,
        revision: state.revision + 1,
        bookmarks: [
          ...state.bookmarks,
          {
            id: `bookmark-${state.revision + 1}`,
            title,
            url,
            workspaceId: state.activeWorkspaceId,
          },
        ],
      };
      return result();
    },
    bookmarkUpdate: async ({ bookmarkId, title, url }) => {
      if (!state.bookmarks.some((item) => item.id === bookmarkId))
        throw Error("Unknown bookmark");
      state = {
        ...state,
        revision: state.revision + 1,
        bookmarks: state.bookmarks.map((item) =>
          item.id === bookmarkId ? { ...item, title, url } : item
        ),
      };
      return result();
    },
    bookmarkRemove: async ({ bookmarkId }) => {
      if (!state.bookmarks.some((item) => item.id === bookmarkId))
        throw Error("Unknown bookmark");
      state = {
        ...state,
        revision: state.revision + 1,
        bookmarks: state.bookmarks.filter((item) => item.id !== bookmarkId),
        tabs: state.tabs
          .filter(
            (tab) =>
              tab.bookmarkId !== bookmarkId || !tab.suspended || tab.favorite
          )
          .map((tab) =>
            tab.bookmarkId === bookmarkId
              ? {
                  ...tab,
                  bookmarkId: "",
                  ...(tab.pinned
                    ? { pinned: false, homeUrl: "", homeTitle: "" }
                    : {}),
                }
              : tab
          ),
      };
      return result();
    },
    bookmarkMove: async ({ bookmarkId, index }) => {
      const bookmark = state.bookmarks.find((item) => item.id === bookmarkId);
      if (!bookmark || index < 0 || index >= state.bookmarks.length)
        throw Error("Invalid bookmark move");
      const bookmarks = state.bookmarks.filter(
        (item) => item.id !== bookmarkId
      );
      bookmarks.splice(index, 0, bookmark);
      state = { ...state, revision: state.revision + 1, bookmarks };
      return result();
    },
    bookmarkFolderCreate: async ({ title }) => {
      const id = `folder-${state.revision + 1}`;
      state = {
        ...state,
        revision: state.revision + 1,
        bookmarkFolders: [...(state.bookmarkFolders ?? []), { id, title }],
      };
      return result();
    },
    bookmarkFolderRename: async ({ folderId, title }) => {
      state = {
        ...state,
        revision: state.revision + 1,
        bookmarkFolders: (state.bookmarkFolders ?? []).map((folder) =>
          folder.id === folderId ? { ...folder, title } : folder
        ),
      };
      return result();
    },
    bookmarkFolderRemove: async ({ folderId }) => {
      state = {
        ...state,
        revision: state.revision + 1,
        bookmarkFolders: (state.bookmarkFolders ?? []).filter(
          (folder) => folder.id !== folderId
        ),
        bookmarks: state.bookmarks.map((bookmark) =>
          bookmark.folderId === folderId
            ? { ...bookmark, folderId: "" }
            : bookmark
        ),
      };
      return result();
    },
    bookmarkSetFolder: async ({ bookmarkId, folderId }) => {
      state = {
        ...state,
        revision: state.revision + 1,
        bookmarks: state.bookmarks.map((bookmark) =>
          bookmark.id === bookmarkId ? { ...bookmark, folderId } : bookmark
        ),
      };
      return result();
    },
    keymapSet: unsupported,
    tabClose: async ({ tabId }) => {
      requireTab(tabId);
      state = {
        ...state,
        revision: state.revision + 1,
        tabs: state.tabs.filter((tab) => tab.id !== tabId),
        activeTabId: "b",
      };
      return result();
    },
    tabActivate: async ({ tabId }) => {
      const tab = requireTab(tabId);
      state = {
        ...state,
        revision: state.revision + 1,
        activeTabId: tabId,
        activeWorkspaceId: tab.workspaceId,
      };
      return result();
    },
    tabSetPinned: async ({ tabId, pinned }) => {
      requireTab(tabId);
      state = {
        ...state,
        revision: state.revision + 1,
        tabs: state.tabs.map((tab) =>
          tab.id === tabId ? { ...tab, pinned } : tab
        ),
      };
      return result();
    },
    tabMove: async ({ tabId, index }) => {
      requireTab(tabId);
      const from = state.tabs.findIndex((tab) => tab.id === tabId);
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(index, 0, moved);
      state = { ...state, revision: state.revision + 1, tabs };
      return result();
    },
    tabSetWorkspace: async ({ tabId, workspaceId }) => {
      requireTab(tabId);
      state = {
        ...state,
        revision: state.revision + 1,
        tabs: state.tabs.map((tab) =>
          tab.id === tabId ? { ...tab, workspaceId } : tab
        ),
      };
      return result();
    },
    workspaceActivate: async ({ workspaceId }) => {
      state = {
        ...state,
        revision: state.revision + 1,
        activeWorkspaceId: workspaceId,
        activeTabId:
          state.tabs.find((tab) => tab.workspaceId === workspaceId)?.id ?? null,
      };
      return result();
    },
    tabSetFavorite: async ({ tabId, favorite }) => {
      requireTab(tabId);
      state = {
        ...state,
        revision: state.revision + 1,
        tabs: state.tabs.map((tab) =>
          tab.id === tabId ? { ...tab, favorite } : tab
        ),
      };
      return result();
    },
    tabNavigated: async ({ tabId, url, title }) => {
      requireTab(tabId);
      state = {
        ...state,
        revision: state.revision + 1,
        tabs: state.tabs.map((tab) =>
          tab.id === tabId ? { ...tab, url, title } : tab
        ),
      };
      return result();
    },
  };
  const storage: BrowserStorage = {
    readSnapshot: async () => null,
    configureKeys: () => undefined,
    reconcileTabs: (tabs) => {
      reconciled.push(tabs.map((tab) => tab.id));
      reconcilePayloads.push(tabs.map((tab) => ({ ...tab })));
    },
    saveSnapshot: async (json) => {
      await holdWrite;
      writes.push(JSON.parse(json));
    },
  };
  return {
    commands,
    storage,
    writes,
    reconciled,
    reconcilePayloads,
    hold: (promise: Promise<void>) => {
      holdWrite = promise;
    },
  };
}

async function setup(seed?: Snapshot) {
  // The pure controller must import without starting a React Native or JSI runtime.
  const module = await import("../src/BrowserController").catch((error) => ({
    error,
  }));
  expect(module).toHaveProperty("BrowserController");
  if (!("BrowserController" in module))
    throw Error("Controller cannot load independently");
  const ports = fixture(seed);
  // A short trailing-save window keeps burst tests fast while preserving
  // the coalescing behavior.
  const controller = new module.BrowserController(
    ports.commands,
    ports.storage
  );
  await controller.initialize();
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
  await settle();
  ports.writes.length = 0;
  ports.reconciled.length = 0;
  ports.reconcilePayloads.length = 0;
  return { controller, settle, ...ports };
}

// Removing the controller's late-event guard makes this reject or revive stale metadata.
test("controller ignores navigation queued behind closing that tab", async () => {
  const { controller, settle, writes, reconciled } = await setup();
  const close = controller.close("a");
  const late = controller.navigated({
    tabId: "a",
    url: "https://late.example",
    title: "Late",
    loading: false,
    canGoBack: false,
    canGoForward: false,
  });
  await Promise.all([close, late]);
  await settle();
  expect(controller.getSnapshot()?.tabs.map((tab) => tab.id)).toEqual(["b"]);
  expect(controller.getSnapshot()?.revision).toBe(1);
  expect(writes.map((snapshot) => snapshot.revision)).toEqual([1]);
  expect(reconciled).toEqual([["b"]]);
});

// Commands resolve WITHOUT waiting for disk; the trailing save is enqueued
// behind the burst and writes the latest snapshot once.
test("commands resolve without waiting for the trailing save, which covers the burst", async () => {
  const { controller, settle, writes, reconciled, hold } = await setup();
  let release!: () => void;
  hold(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  const first = controller.activate("b");
  const second = controller.close("a");
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Both mutations applied immediately; the queued save is stuck on the
  // held write and neither command waited on it.
  expect(controller.getSnapshot()?.tabs.map((tab) => tab.id)).toEqual(["b"]);
  expect(controller.getSnapshot()?.activeTabId).toBe("b");
  expect(writes).toEqual([]);
  // activate("b") hits the unchanged-reconcile skip; close("a") reconciles.
  expect(reconciled).toEqual([["b"]]);
  release();
  await controller.flush();
  await settle();
  expect(
    writes.map((snapshot) => ({
      revision: snapshot.revision,
      ids: snapshot.tabs.map((tab) => tab.id),
    }))
  ).toEqual([{ revision: 2, ids: ["b"] }]);
  expect(controller.getSnapshot()).toEqual(writes[0]);
});

// Publishing before command success, or failing queue recovery, breaks these assertions.
test("rejected command preserves snapshot and later navigation still succeeds", async () => {
  const { controller, settle, writes, reconciled } = await setup();
  const before = controller.getSnapshot();
  await expect(controller.close("missing")).rejects.toThrow("Unknown tab");
  expect(controller.getSnapshot()).toBe(before);
  expect(writes).toEqual([]);
  expect(reconciled).toEqual([]);
  await controller.navigated({
    tabId: "b",
    url: "https://updated.example",
    title: "Updated",
    loading: false,
    canGoBack: true,
    canGoForward: false,
  });
  await settle();
  expect(
    controller.getSnapshot()?.tabs.find((tab) => tab.id === "b")?.url
  ).toBe("https://updated.example");
  expect(writes[0]).toEqual(controller.getSnapshot()!);
});

test("startup blocks mutations until persisted state has been read", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const ports = fixture();
  let finishRead!: (value: string | null) => void;
  ports.storage.readSnapshot = () =>
    new Promise((resolve) => {
      finishRead = resolve;
    });
  const controller = new BrowserController(ports.commands, ports.storage);
  const startup = controller.initialize();
  const close = controller.close("a");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(controller.getSnapshot()).toBeNull();
  expect(ports.writes).toEqual([]);
  expect(ports.reconciled).toEqual([]);
  finishRead(null);
  await Promise.all([startup, close]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  // The trailing save always persists at least the post-close state.
  expect(ports.writes.at(-1)?.tabs.map((tab) => tab.id)).toEqual(["b"]);
  expect(controller.getSnapshot()?.revision).toBe(1);
});

test("repeated initialization shares startup and does not restore again after mutations", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const ports = fixture();
  const controller = new BrowserController(ports.commands, ports.storage);
  await Promise.all([controller.initialize(), controller.initialize()]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(ports.writes.length).toBe(1);
  await controller.close("a");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const beforeRemount = controller.getSnapshot();
  await controller.initialize();
  expect(controller.getSnapshot()).toBe(beforeRemount);
  expect(ports.writes.length).toBe(2);
  expect(ports.reconciled).toEqual([["a", "b"], ["b"]]);
});

test("startup rejection prevents later commands from publishing uninitialized state", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const ports = fixture();
  ports.storage.readSnapshot = async () => {
    throw Error("Cannot read persisted state");
  };
  const controller = new BrowserController(ports.commands, ports.storage);
  await expect(controller.initialize()).rejects.toThrow(
    "Cannot read persisted state"
  );
  await expect(controller.close("a")).rejects.toThrow(
    "Cannot read persisted state"
  );
  await expect(controller.initialize()).rejects.toThrow(
    "Cannot read persisted state"
  );
  expect(controller.getSnapshot()).toBeNull();
  expect(ports.writes).toEqual([]);
  expect(ports.reconciled).toEqual([]);
});

test("empty startup creates its first ordinary tab inside the startup transaction", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const ports = fixture();
  const empty: Snapshot = { ...initial(), tabs: [], activeTabId: null };
  ports.commands = {
    ...ports.commands,
    browserSnapshot: async () => empty,
    tabCreate: async ({ workspaceId, url, private: isPrivate }) => {
      if (isPrivate !== false) {
        throw new TypeError(
          "Exception in HostFunction: Value is undefined, expected a boolean"
        );
      }
      return {
        ...empty,
        revision: 1,
        activeTabId: "seed",
        tabs: [{ id: "seed", workspaceId, url, title: "" }],
      };
    },
  };
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.initialize();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(controller.getSnapshot()?.tabs).toEqual([
    {
      id: "seed",
      workspaceId: "workspace-1",
      url: "about:blank",
      title: "",
    },
  ]);
  // The last trailing write is the seeded startup state.
  expect(ports.writes.at(-1)?.tabs.map((tab) => tab.id)).toEqual(["seed"]);
  // The empty pre-seed publish hits the unchanged-reconcile skip.
  expect(ports.reconciled).toEqual([["seed"]]);
});

test("opening a bookmark reuses its current-workspace tab with equivalent origin URL", async () => {
  const { controller, settle, writes } = await setup();
  await controller.activate("b");
  const opened = await controller.openBookmark("bookmark-a");
  await settle();
  expect(opened.activeTabId).toBe("a");
  expect(opened.tabs.map((tab) => tab.id)).toEqual(["a", "b"]);
  expect(writes.at(-1)).toEqual(opened);
});

test("two queued opens create only one bookmark tab", async () => {
  const { controller, settle, writes } = await setup();
  const [first, second] = await Promise.all([
    controller.openBookmark("bookmark-new"),
    controller.openBookmark("bookmark-new"),
  ]);
  expect(first.activeTabId).toBe(second.activeTabId);
  expect(
    second.tabs.filter((tab) => tab.url === "https://new.example")
  ).toHaveLength(1);
  expect(second.tabs).toHaveLength(3);
  // The burst coalesces into one trailing write of the latest snapshot.
  await settle();
  expect(writes.map((snapshot) => snapshot.tabs.length)).toEqual([3]);
});

test("bookmark open reads updated metadata after earlier queued edit", async () => {
  const { controller } = await setup();
  const edit = controller.bookmarkUpdate(
    "bookmark-new",
    "Updated",
    "https://updated.example"
  );
  const open = controller.openBookmark("bookmark-new");
  await edit;
  const snapshot = await open;
  expect(
    snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId)?.url
  ).toBe("https://updated.example");
});

test("bookmark open rejects a queued deletion without opening a stale tab", async () => {
  const { controller, settle, writes } = await setup();
  const removal = controller.bookmarkRemove("bookmark-new");
  const open = controller.openBookmark("bookmark-new");
  await removal;
  await expect(open).rejects.toThrow("Bookmark no longer exists");
  expect(controller.getSnapshot()?.tabs).toHaveLength(2);
  await settle();
  expect(writes).toHaveLength(1);
});

test("bookmark creation and ordering publish the Rust-returned snapshots", async () => {
  const { controller, settle, writes } = await setup();
  const created = await controller.bookmarkCreate(
    "Created",
    "https://created.example"
  );
  const added = created.bookmarks?.find(
    (bookmark) => bookmark.title === "Created"
  )!;
  const moved = await controller.bookmarkMove(added.id, 0);
  expect(moved.bookmarks?.map((bookmark) => bookmark.title)).toEqual([
    "Created",
    "A",
    "New",
  ]);
  await settle();
  expect(writes.at(-1)).toEqual(moved);
});

test("bookmark open rejects a stale item after a queued Space switch", async () => {
  const seed = initial();
  seed.workspaces.push({ id: "workspace-2", name: "Other" });
  seed.tabs.push({
    id: "other",
    workspaceId: "workspace-2",
    url: "https://other.example",
    title: "Other",
  });
  const { controller } = await setup(seed);
  const switching = controller.activate("other");
  const opening = controller.openBookmark("bookmark-a");
  await switching;
  await expect(opening).rejects.toThrow("Bookmark belongs to another Space");
  expect(controller.snapshot!.activeWorkspaceId).toBe("workspace-2");
  expect(controller.snapshot!.activeTabId).toBe("other");
  expect(controller.snapshot!.tabs).toEqual(seed.tabs);
  await controller.flush();
});

test("bookmark reuse does not collapse distinct path trailing slashes", async () => {
  const seed = initial();
  seed.tabs[0].url = "https://a.example/docs";
  seed.bookmarks[0].url = "https://a.example/docs/";
  const { controller } = await setup(seed);
  const snapshot = await controller.openBookmark("bookmark-a");
  expect(snapshot.tabs).toHaveLength(3);
  expect(
    snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId)?.url
  ).toBe("https://a.example/docs/");
});

test("favoriting a tab publishes the flag on that tab only", async () => {
  const { controller, settle, writes } = await setup();
  const favorited = await controller.setFavorite("b", true);
  await settle();
  expect(favorited.tabs.map((tab) => [tab.id, tab.favorite ?? false])).toEqual([
    ["a", false],
    ["b", true],
  ]);
  expect(writes.at(-1)).toEqual(favorited);
  const cleared = await controller.setFavorite("b", false);
  expect(cleared.tabs.every((tab) => !tab.favorite)).toBe(true);
});

test("a corrupt snapshot falls back to the quarantined last-good copy", async () => {
  const module = await import("../src/BrowserController");
  const { BrowserController } = module;
  const good = initial();
  const quarantined: { json: string | null } = { json: null };
  const commands = {
    ready: async () => undefined,
    snapshotRestore: async ({ json }: { json: string }) =>
      JSON.parse(json) as Snapshot,
    browserSnapshot: async () => {
      throw Error("must not fall through to defaults");
    },
  } as unknown as BrowserCommands;
  const storage: BrowserStorage = {
    configureKeys: () => undefined,
    reconcileTabs: () => undefined,
    readSnapshot: async () => "{corrupt",
    saveSnapshot: async () => undefined,
    readLastGoodSnapshot: async () => JSON.stringify(good),
    quarantineSnapshot: async (json) => {
      quarantined.json = json;
    },
  };
  const controller = new module.BrowserController(commands, storage);
  await controller.initialize();
  expect(quarantined.json).toBe("{corrupt");
  expect(controller.snapshot?.tabs.map((tab) => tab.id)).toEqual(["a", "b"]);
});

test("a corrupt snapshot without a backup still surfaces the error", async () => {
  const module = await import("../src/BrowserController");
  const { BrowserController } = module;
  const commands = {
    ready: async () => undefined,
    snapshotRestore: async () => {
      throw Error("corrupt snapshot JSON");
    },
    browserSnapshot: async () => initial(),
  } as unknown as BrowserCommands;
  let quarantined = false;
  const storage: BrowserStorage = {
    configureKeys: () => undefined,
    reconcileTabs: () => undefined,
    readSnapshot: async () => "{corrupt",
    saveSnapshot: async () => undefined,
    readLastGoodSnapshot: async () => null,
    quarantineSnapshot: async () => {
      quarantined = true;
    },
  };
  const controller = new module.BrowserController(commands, storage);
  await expect(controller.initialize()).rejects.toThrow(
    "corrupt snapshot JSON"
  );
  expect(quarantined).toBe(false);
});

test("a failed last-good restore leaves the primary snapshot available for retry", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const good = initial();
  const primary = "{corrupt";
  let persistedPrimary: string | null = primary;
  let backupAttempts = 0;
  const quarantined: string[] = [];
  const defaults: Snapshot = {
    ...good,
    tabs: [
      {
        id: "default",
        workspaceId: "workspace-1",
        url: "about:blank",
        title: "",
      },
    ],
    activeTabId: "default",
  };
  const commands = {
    ready: async () => undefined,
    snapshotRestore: async ({ json }: { json: string }) => {
      if (json === primary) throw Error("corrupt primary snapshot");
      backupAttempts++;
      if (backupAttempts === 1) throw Error("restore runtime unavailable");
      return JSON.parse(json) as Snapshot;
    },
    browserSnapshot: async () => defaults,
  } as unknown as BrowserCommands;
  const storage: BrowserStorage = {
    configureKeys: () => undefined,
    reconcileTabs: () => undefined,
    readSnapshot: async () => persistedPrimary,
    saveSnapshot: async () => undefined,
    readLastGoodSnapshot: async () => JSON.stringify(good),
    quarantineSnapshot: async (json) => {
      quarantined.push(json);
      if (persistedPrimary === json) persistedPrimary = null;
    },
  };
  const controller = new BrowserController(commands, storage);

  await expect(controller.initialize()).rejects.toThrow(
    "restore runtime unavailable"
  );
  expect(persistedPrimary).toBe(primary);
  expect(quarantined).toEqual([]);

  await controller.initialize();
  expect(controller.snapshot?.tabs.map((tab) => tab.id)).toEqual(["a", "b"]);
  expect(quarantined).toEqual([primary]);
});

test("startup restores last-good state left behind by an interrupted quarantine", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const good = initial();
  const defaults: Snapshot = {
    ...good,
    tabs: [
      {
        id: "default",
        workspaceId: "workspace-1",
        url: "about:blank",
        title: "",
      },
    ],
    activeTabId: "default",
  };
  const commands = {
    ready: async () => undefined,
    snapshotRestore: async ({ json }: { json: string }) =>
      JSON.parse(json) as Snapshot,
    browserSnapshot: async () => defaults,
  } as unknown as BrowserCommands;
  const storage: BrowserStorage = {
    configureKeys: () => undefined,
    reconcileTabs: () => undefined,
    readSnapshot: async () => null,
    saveSnapshot: async () => undefined,
    readLastGoodSnapshot: async () => JSON.stringify(good),
  };
  const controller = new BrowserController(commands, storage);

  await controller.initialize();

  expect(controller.snapshot?.tabs.map((tab) => tab.id)).toEqual(["a", "b"]);
});

test("flush waits for a write that already started", async () => {
  const { controller, hold, settle, writes } = await setup();
  let release!: () => void;
  hold(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  await controller.activate("b");
  await settle();
  let flushed = false;
  const flushing = controller.flush().then(() => {
    flushed = true;
  });
  await settle();
  const flushedBeforeWrite = flushed;
  release();
  await flushing;
  expect(flushedBeforeWrite).toBe(false);
  expect(writes.at(-1)?.activeTabId).toBe("b");
});

test("input proceeds during a slow save and flush persists the latest mutation", async () => {
  const { controller, hold, settle, writes } = await setup();
  let release!: () => void;
  hold(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  await controller.activate("b");
  await settle();
  const closing = controller.close("a");
  await settle();
  const beforeDiskCompletes = controller.snapshot?.tabs.map((tab) => tab.id);
  release();
  await closing;
  await controller.flush();
  expect(beforeDiskCompletes).toEqual(["b"]);
  expect(writes.at(-1)?.tabs.map((tab) => tab.id)).toEqual(["b"]);
});

test("a mutation arriving as a write finishes still receives its trailing save", async () => {
  const { controller, hold, settle, writes } = await setup();
  let release!: () => void;
  hold(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  await controller.activate("b");
  await settle();
  release();
  await controller.close("a");
  await settle();
  const savedBeforeFlush = writes.at(-1)?.tabs.map((tab) => tab.id);
  await controller.flush();
  expect(savedBeforeFlush).toEqual(["b"]);
});

test("failed saves remain retryable and observable until the latest state reaches disk", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const ports = fixture();
  let fail = true;
  ports.storage.saveSnapshot = async (json) => {
    if (fail) throw new Error("Disk unavailable");
    ports.writes.push(JSON.parse(json));
  };
  const controller = new BrowserController(ports.commands, ports.storage);
  const errors: (Error | null)[] = [];
  controller.subscribePersistenceError((error) => errors.push(error));
  await controller.initialize();
  await expect(controller.flush()).rejects.toThrow("Disk unavailable");
  expect(errors.at(-1)?.message).toBe("Disk unavailable");
  await controller.close("a");
  fail = false;
  await controller.flush();
  expect(ports.writes.at(-1)?.tabs.map((tab) => tab.id)).toEqual(["b"]);
  expect(errors.at(-1)).toBeNull();
});

test("a newer mutation published during a failed write gets its own save attempt", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const ports = fixture();
  const attempts: Snapshot[] = [];
  let rejectFirst!: (error: Error) => void;
  ports.storage.saveSnapshot = async (json) => {
    const snapshot = JSON.parse(json) as Snapshot;
    attempts.push(snapshot);
    if (attempts.length === 1)
      await new Promise<void>((_, reject) => {
        rejectFirst = reject;
      });
    else ports.writes.push(snapshot);
  };
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.initialize();
  await new Promise((resolve) => setTimeout(resolve, 0));

  await controller.close("a");
  rejectFirst(new Error("Disk unavailable"));
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(attempts.map((snapshot) => snapshot.revision)).toEqual([0, 1]);
  expect(ports.writes.at(-1)?.tabs.map((tab) => tab.id)).toEqual(["b"]);
  await controller.flush();
});

test("bookmark identity preserves path case, scheme, host, query and fragment", async () => {
  const { bookmarkUrlKey } = await import("../src/BrowserController");
  expect(bookmarkUrlKey("example.com")).toBe(
    bookmarkUrlKey("https://EXAMPLE.com/")
  );
  expect(bookmarkUrlKey("localhost:8080/Docs")).toBe(
    "https://localhost:8080/Docs"
  );
  expect(bookmarkUrlKey("example.com:8443/Docs")).toBe(
    "https://example.com:8443/Docs"
  );
  for (const [left, right] of [
    ["https://a.example/Docs", "https://a.example/docs"],
    ["http://a.example", "https://a.example"],
    ["https://www.a.example", "https://a.example"],
    ["https://a.example?q=A", "https://a.example?q=a"],
    ["https://a.example#A", "https://a.example#a"],
  ])
    expect(bookmarkUrlKey(left)).not.toBe(bookmarkUrlKey(right));
});

test("closed saved sessions are reconciled out and ignore late navigation", async () => {
  const seed = initial();
  seed.tabs[0] = {
    ...seed.tabs[0],
    pinned: true,
    suspended: true,
    homeUrl: seed.tabs[0].url,
  };
  seed.activeTabId = "b";
  const { controller, reconciled, writes } = await setup(seed);
  await controller.navigated({
    tabId: "a",
    url: "https://late.example",
    title: "Late",
    loading: false,
    canGoBack: false,
    canGoForward: false,
  });
  expect(controller.snapshot?.tabs[0].url).toBe("https://a.example");
  expect(writes).toEqual([]);
  // A resumed native snapshot reintroduces its session exactly once.
  await controller.mutate(async () => ({
    ...seed,
    revision: 1,
    tabs: seed.tabs.map((tab) => ({ ...tab, suspended: false })),
  }));
  expect(reconciled).toEqual([["a", "b"]]);
});

test("a bookmark reuses a saved home even while that session is at another address", async () => {
  const seed = initial();
  seed.tabs[0] = {
    ...seed.tabs[0],
    pinned: true,
    homeUrl: "https://a.example/",
    url: "https://a.example/away",
  };
  const { controller } = await setup(seed);
  const opened = await controller.openBookmark("bookmark-a");
  expect(opened.tabs).toHaveLength(2);
  expect(opened.activeTabId).toBe("a");
});

test("reordering rows does not reconcile unchanged browser sessions", async () => {
  const { controller, reconciled } = await setup();
  await controller.moveTab("a", 1);
  expect(controller.snapshot?.tabs.map((tab) => tab.id)).toEqual(["b", "a"]);
  expect(reconciled).toEqual([]);
});

test("startup with only closed saved rows seeds a page without removing them", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const seed = initial();
  seed.activeTabId = null;
  seed.tabs = [
    {
      ...seed.tabs[0],
      pinned: true,
      suspended: true,
      homeUrl: seed.tabs[0].url,
    },
  ];
  const ports = fixture(seed);
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.initialize();
  await controller.flush();
  expect(controller.snapshot?.tabs).toHaveLength(2);
  expect(controller.snapshot?.tabs[0]).toMatchObject({
    id: "a",
    pinned: true,
    suspended: true,
  });
  expect(
    controller.snapshot?.tabs.find(
      (tab) => tab.id === controller.snapshot?.activeTabId
    )?.url
  ).toBe("about:blank");
  expect(ports.reconciled).toEqual([["created-1"]]);
});

test("retrying initialization reapplies a native configuration that previously threw", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  for (const failingPort of ["reconcileTabs", "configureKeys", "setTabMetadataCount"] as const) {
    const ports = fixture();
    let attempted = 0;
    let applied = 0;
    ports.storage[failingPort] = () => {
      attempted++;
      if (attempted === 1) throw new Error("Native configuration unavailable");
      applied++;
    };
    const controller = new BrowserController(ports.commands, ports.storage);
    await expect(controller.initialize()).rejects.toThrow(
      "Native configuration unavailable"
    );
    await controller.initialize();
    await controller.flush();
    expect(applied).toBe(1);
  }
});

test("reset restores both visible and detached live saved sessions", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const seed = initial();
  seed.tabs = seed.tabs.map((tab) => ({
    ...tab,
    pinned: true,
    homeUrl: tab.url,
    url: `${tab.url}/away`,
  }));
  const ports = fixture(seed);
  ports.commands.tabReset = async ({ tabId }) => ({
    ...seed,
    tabs: seed.tabs.map((tab) =>
      tab.id === tabId ? { ...tab, url: tab.homeUrl! } : tab
    ),
  });
  const sessions = new Map(seed.tabs.map((tab) => [tab.id, tab.url]));
  ports.storage.loadTabUrl = (id, url) => {
    if (sessions.has(id)) sessions.set(id, url);
  };
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.initialize();
  await controller.reset("a");
  await controller.reset("b");
  expect(sessions.get("a")).toBe("https://a.example");
  expect(sessions.get("b")).toBe("https://b.example");
  await controller.flush();
});

test("resetting a suspended saved row never creates or navigates a native session", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const seed = initial();
  seed.tabs[0] = {
    ...seed.tabs[0],
    pinned: true,
    suspended: true,
    homeUrl: seed.tabs[0].url,
  };
  seed.activeTabId = "b";
  const ports = fixture(seed);
  ports.commands.tabReset = async () => seed;
  let nativeLoads = 0;
  ports.storage.loadTabUrl = () => {
    nativeLoads++;
  };
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.initialize();
  const reset = await controller.reset("a");
  expect(reset.tabs[0].suspended).toBe(true);
  expect(nativeLoads).toBe(0);
  await controller.flush();
});

test("a sidebar pin opens as its own saved tab rather than an ordinary tab", async () => {
  const { controller } = await setup();
  const opened = await controller.openBookmark("bookmark-new");
  const tab = opened.tabs.find((item) => item.id === opened.activeTabId)!;
  expect(tab.pinned).toBe(true);
  expect(tab.bookmarkId).toBe("bookmark-new");
  expect(tab.homeUrl).toBe("https://new.example");
  expect(
    opened.tabs.filter((item) => !item.pinned && !item.favorite)
  ).toHaveLength(2);
});

test("a sidebar pin keeps its tab identity after redirects and navigation", async () => {
  const { controller } = await setup();
  const first = await controller.openBookmark("bookmark-new");
  const id = first.activeTabId!;
  await controller.navigated({
    tabId: id,
    url: "https://new.example/en-US/docs",
    title: "Documentation",
    loading: false,
    canGoBack: true,
    canGoForward: false,
  });
  await controller.activate("a");
  const reopened = await controller.openBookmark("bookmark-new");
  expect(reopened.activeTabId).toBe(id);
  expect(reopened.tabs).toHaveLength(first.tabs.length);
  expect(reopened.tabs.find((tab) => tab.id === id)?.url).toBe(
    "https://new.example/en-US/docs"
  );
});

test("unpinning a sidebar-owned tab removes its source row while preserving the live page", async () => {
  const { controller } = await setup();
  const opened = await controller.openBookmark("bookmark-new");
  const id = opened.activeTabId!;
  const unpinned = await controller.setPinned(id, false);
  expect(unpinned.activeTabId).toBe(id);
  expect(unpinned.bookmarks?.some((item) => item.id === "bookmark-new")).toBe(
    false
  );
  expect(unpinned.tabs.find((tab) => tab.id === id)).toMatchObject({
    pinned: false,
    bookmarkId: "",
    url: "https://new.example",
  });
});


test("Space cover is installed before external preparation and snapshot publication", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const seed=initial();seed.workspaces.push({id:"work",name:"Work"});seed.tabs[1].workspaceId="work";
  const ports=fixture(seed);const calls:string[]=[];let release:()=>void=()=>{};
  ports.storage.prepareSpaceTransition=async (from,to)=>{
    calls.push(`cover:${from}:${to}`);await new Promise<void>(resolve=>{release=resolve;});
  };
  ports.storage.prepareTabTransition=async()=>{calls.push("external");};
  const controller=new BrowserController(ports.commands,ports.storage);await controller.initialize();
  controller.subscribe(()=>calls.push("published"));
  const switching=controller.activateWorkspace("work");await new Promise(resolve=>setTimeout(resolve,0));
  expect(calls).toEqual(["cover:a:b"]);expect(controller.snapshot!.activeTabId).toBe("a");
  release();await switching;expect(calls).toEqual(["cover:a:b","external","published"]);
  expect(controller.snapshot!.activeTabId).toBe("b");await controller.flush();
});

test("Space capture rejection still prepares external ownership and publishes the committed change", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const seed=initial();seed.workspaces.push({id:"work",name:"Work"});seed.tabs[1].workspaceId="work";
  const ports=fixture(seed);const calls:string[]=[];
  ports.storage.prepareSpaceTransition=async()=>{calls.push("cover");throw Error("source unavailable");};
  ports.storage.prepareTabTransition=async()=>{calls.push("external");};
  const controller=new BrowserController(ports.commands,ports.storage);await controller.initialize();
  controller.subscribe(()=>calls.push("published"));await controller.activateWorkspace("work");
  expect(calls).toEqual(["cover","external","published"]);expect(controller.snapshot!.activeTabId).toBe("b");
  await controller.flush();
});

test("same Space tab selection and same Favorite Space selection never copy old pixels", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const ports=fixture();const copied:string[]=[];ports.storage.prepareSpaceTransition=async()=>{copied.push("copy");};
  const controller=new BrowserController(ports.commands,ports.storage);await controller.activate("b");
  const current=controller.snapshot!;ports.commands.workspaceActivate=async()=>({...current,activeWorkspaceId:"other"});
  await controller.activateWorkspace("other");expect(copied).toEqual([]);await controller.flush();
});


test("cold Space preparation receives the exact committed target URL before publication", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const seed = initial();
  seed.workspaces.push({ id: "work", name: "Work" });
  seed.tabs[1].workspaceId = "work";
  const ports = fixture(seed);
  const calls: string[] = [];
  let release = () => {};
  ports.storage.prepareColdSpaceTransition = async (from, to, url) => {
    calls.push(`${from}:${to}:${url}`);
    await new Promise<void>((resolve) => { release = resolve; });
  };
  ports.storage.prepareSpaceTransition = async () => { calls.push("legacy"); };
  ports.storage.prepareTabTransition = async () => { calls.push("ownership"); };
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.initialize();
  const switching = controller.activateWorkspace("work");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toEqual(["a:b:https://b.example"]);
  expect(controller.snapshot!.activeTabId).toBe("a");
  // Detached native navigation queues behind publication; it must not be awaited by preparation.
  const navigation = controller.navigated({ tabId: "b", url: "https://b.example/redirect", title: "Loaded", loading: false, canGoBack: false, canGoForward: false });
  release();
  await switching;
  await navigation;
  expect(calls).toEqual(["a:b:https://b.example", "ownership"]);
  expect(controller.snapshot!.activeWorkspaceId).toBe("work");
  expect(controller.snapshot!.tabs.find((tab) => tab.id === "b")!.url).toBe("https://b.example/redirect");
  await controller.flush();
});

test("cold preparation failure still publishes the successful Space command once", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const seed = initial();
  seed.workspaces.push({ id: "work", name: "Work" });
  seed.tabs[1].workspaceId = "work";
  const ports = fixture(seed);
  const calls: string[] = [];
  ports.storage.prepareColdSpaceTransition = async () => { calls.push("cold"); throw Error("deadline"); };
  ports.storage.prepareSpaceTransition = async () => { calls.push("legacy"); };
  ports.storage.prepareTabTransition = async () => { calls.push("ownership"); };
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.initialize();
  controller.subscribe(() => calls.push("publication"));
  await controller.activateWorkspace("work");
  expect(calls).toEqual(["cold", "ownership", "publication"]);
  expect(controller.snapshot!.activeTabId).toBe("b");
  await controller.flush();
});

test("saved snapshots exclude private tabs while memory keeps them", async () => {
  const { controller, settle, writes } = await setup();
  await controller.createTab("https://private.example", undefined, {
    private: true,
  });
  await settle();
  const privateTab = controller.snapshot!.tabs.find(
    (tab) => tab.url === "https://private.example"
  );
  expect(privateTab?.private).toBe(true);
  expect(controller.snapshot!.activeTabId).toBe(privateTab!.id);
  const lastWrite = writes.at(-1)!;
  expect(lastWrite.tabs.some((tab) => tab.private)).toBe(false);
  expect(
    lastWrite.tabs.some((tab) => tab.url === "https://private.example")
  ).toBe(false);
  expect(lastWrite.tabs.some((tab) => tab.id === "a")).toBe(true);
  // The active pointer referenced the stripped private tab; a dangling id
  // would fail restore, so the persisted copy clears it.
  expect(lastWrite.activeTabId).toBeNull();
});

test("a private opener adopts a private native session, an ordinary one does not", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const modes: boolean[] = [];
  const openWindowFor = async (seed: Snapshot, openerTabId: string) => {
    const ports = fixture(seed);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let adopted = "";
    ports.storage.resolveNewSession = async (
      _requestId,
      tabId,
      isPrivate
    ) => {
      modes.push(isPrivate);
      adopted = tabId;
      await gate;
    };
    const controller = new BrowserController(ports.commands, ports.storage);
    await controller.initialize();
    const popup = controller.openWindow({
      requestId: 10,
      openerTabId,
      uri: "https://popup.example",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The popup id stays unreconciled until adoption completes.
    expect(ports.reconciled.some((ids) => ids.includes(adopted))).toBe(false);
    release();
    await popup;
    expect(
      !!controller.snapshot!.tabs.find((tab) => tab.id === adopted)?.private
    ).toBe(modes.at(-1)!);
    await controller.flush();
  };
  const privateSeed = initial();
  privateSeed.tabs[1].private = true;
  await openWindowFor(privateSeed, "b");
  await openWindowFor(initial(), "a");
  expect(modes).toEqual([true, false]);
});

test("bookmark opens in private mode request a private tab without reuse", async () => {
  const seed = initial();
  seed.tabs[1].private = true;
  const ports = fixture(seed);
  const { BrowserController } = await import("../src/BrowserController");
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.initialize();
  await controller.activate("b");
  const inner = ports.commands.bookmarkOpen.bind(ports.commands);
  let captured: {
    bookmarkId: string;
    reuseTabId: string;
    private?: boolean;
  } = { bookmarkId: "", reuseTabId: "", private: false };
  ports.commands.bookmarkOpen = async (input) => {
    captured = { ...input };
    return inner(input);
  };
  // The bookmark URL matches tab "a" exactly; private mode must not adopt it.
  await controller.openBookmark("bookmark-a");
  expect(captured.private).toBe(true);
  expect(captured.reuseTabId).toBe("");
  const opened = controller.snapshot!.activeTabId!;
  expect(
    controller.snapshot!.tabs.find((tab) => tab.id === opened)?.private
  ).toBe(true);
  await controller.flush();
});

test("metadata counts imported suspended rows independently of live reconciliation", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const seed = initial();
  seed.tabs[1] = { ...seed.tabs[1], suspended: true, favorite: true };
  const ports = fixture(seed);
  const counts: number[] = [];
  Object.assign(ports.storage, { setTabMetadataCount: (count: number) => counts.push(count) });
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.initialize(); await controller.flush();
  expect(counts).toEqual([2]);
  expect(ports.reconciled).toEqual([["a"]]);
  await controller.createTab("https://new.example/");
  await controller.close("created-1");
  expect(counts).toEqual([2, 3, 2]);
  const before = controller.snapshot!;
  const candidate = { ...before, revision: before.revision + 1, tabs: [...before.tabs, { ...seed.tabs[1], id: "imported-pin", favorite: false, pinned: true }] };
  ports.commands.workArchivePrepare = async () => candidate;
  ports.commands.workArchiveImport = async () => candidate;
  ports.reconciled.length = 0;
  await controller.importArchive("{}", true, false);
  await controller.flush();
  expect(counts).toEqual([2, 3, 2, 3]);
  expect(ports.reconciled).toEqual([]);
});

test("closing a saved pin keeps its metadata count while retiring the session", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const seed = initial(); seed.tabs[0] = { ...seed.tabs[0], pinned: true };
  const ports = fixture(seed);
  const counts: number[] = [];
  ports.storage.setTabMetadataCount = (count) => counts.push(count);
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.initialize(); await controller.flush();
  ports.commands.tabClose = async () => ({ ...seed, revision: seed.revision + 1, activeTabId: "b", tabs: seed.tabs.map((tab) => tab.id === "a" ? { ...tab, suspended: true } : tab) });
  ports.reconciled.length = 0;
  await controller.close("a"); await controller.flush();
  expect(counts).toEqual([2]);
  expect(ports.reconciled).toEqual([["b"]]);
  expect(controller.snapshot?.tabs).toHaveLength(2);
});

test("metadata count is initialized even for an empty pre-seed snapshot", async () => {
  const { BrowserController } = await import("../src/BrowserController");
  const seed = initial(); seed.tabs = []; seed.activeTabId = null;
  const ports = fixture(seed);
  const counts: number[] = [];
  ports.storage.setTabMetadataCount = (count) => counts.push(count);
  const controller = new BrowserController(ports.commands, ports.storage);
  await controller.initialize(); await controller.flush();
  expect(counts[0]).toBe(0);
  expect(counts.at(-1)).toBe(controller.snapshot!.tabs.length);
});
