import { describe, expect, test } from "bun:test";
import type { Snapshot } from "../generated/types";
import {
  applySyncedSpacesTree,
  emptySpacesBindings,
  isNumberedNameVariant,
  sameBrowseTarget,
  sameFavoriteSite,
  uniqueWorkspaceName,
  type SpacesApplyHost,
} from "../src/sync/spacesApply";
import type { SyncedSpacesTree } from "../src/sync/model";

describe("uniqueWorkspaceName", () => {
  test("keeps the desired name when free", () => {
    expect(uniqueWorkspaceName("Work", new Set(["Personal"]))).toBe("Work");
  });

  test("allows the workspace to keep its current name", () => {
    expect(
      uniqueWorkspaceName("Work", new Set(["Work", "Personal"]), "Work")
    ).toBe("Work");
  });

  test("suffixes when the name is taken by another workspace", () => {
    expect(uniqueWorkspaceName("Work", new Set(["Work"]))).toBe("Work 2");
    expect(uniqueWorkspaceName("Work", new Set(["Work", "Work 2"]))).toBe(
      "Work 3"
    );
  });

  test("falls back when the desired name is blank", () => {
    expect(uniqueWorkspaceName("   ", new Set())).toBe("Space");
  });
});

describe("isNumberedNameVariant", () => {
  test("detects collision suffixes", () => {
    expect(isNumberedNameVariant("base 2", "base")).toBe(true);
    expect(isNumberedNameVariant("base 10", "base")).toBe(true);
    expect(isNumberedNameVariant("base", "base")).toBe(false);
    expect(isNumberedNameVariant("basement", "base")).toBe(false);
  });
});

describe("sameFavoriteSite", () => {
  test("treats www and deep links as the same essential site", () => {
    expect(
      sameFavoriteSite("https://www.youtube.com/watch?v=1", "https://youtube.com")
    ).toBe(true);
    expect(
      sameFavoriteSite("https://youtube.com/", "https://www.youtube.com")
    ).toBe(true);
    expect(
      sameFavoriteSite("https://music.youtube.com", "https://youtube.com")
    ).toBe(false);
  });
});

describe("sameBrowseTarget", () => {
  test("ignores query strings that login redirects add", () => {
    expect(
      sameBrowseTarget(
        "https://id.atlassian.com/login?continue=%2F",
        "https://id.atlassian.com/login"
      )
    ).toBe(true);
    expect(
      sameBrowseTarget(
        "https://app.slack.com/client/T1/C1",
        "https://app.slack.com/client/T1/C2"
      )
    ).toBe(false);
  });
});

describe("emptySpacesBindings", () => {
  test("starts with empty maps", () => {
    expect(emptySpacesBindings()).toEqual({
      workspaceByRemote: {},
      folderByRemote: {},
      tabByRemote: {},
      bookmarkByRemote: {},
    });
  });
});

describe("applySyncedSpacesTree", () => {
  test("creates workspaces, favorites, folders and pinned tabs", async () => {
    let nextWorkspace = 2;
    let nextTab = 2;
    let nextFolder = 1;
    let nextBookmark = 1;
    let snap: Snapshot = {
      version: 1,
      revision: 1,
      workspaces: [{ id: "workspace-1", name: "Default" }],
      tabs: [
        {
          id: "tab-1",
          workspaceId: "workspace-1",
          url: "about:blank",
          title: "",
        },
      ],
      bookmarks: [],
      bookmarkFolders: [],
      activeWorkspaceId: "workspace-1",
      activeTabId: "tab-1",
      keyBindings: [],
    };

    const host: SpacesApplyHost = {
      getSnapshot: () => snap,
      createWorkspace: async (name) => {
        const id = `workspace-${nextWorkspace++}`;
        const tabId = `tab-${nextTab++}`;
        snap = {
          ...snap,
          revision: snap.revision + 1,
          workspaces: [...snap.workspaces, { id, name }],
          tabs: [
            ...snap.tabs,
            { id: tabId, workspaceId: id, url: "about:blank", title: "" },
          ],
          activeWorkspaceId: id,
          activeTabId: tabId,
        };
        return snap;
      },
      renameWorkspace: async (workspaceId, name) => {
        snap = {
          ...snap,
          revision: snap.revision + 1,
          workspaces: snap.workspaces.map((workspace) =>
            workspace.id === workspaceId ? { ...workspace, name } : workspace
          ),
        };
        return snap;
      },
      removeWorkspace: async (workspaceId) => {
        snap = {
          ...snap,
          revision: snap.revision + 1,
          workspaces: snap.workspaces.filter(
            (workspace) => workspace.id !== workspaceId
          ),
          tabs: snap.tabs.filter((tab) => tab.workspaceId !== workspaceId),
          activeWorkspaceId:
            snap.activeWorkspaceId === workspaceId
              ? snap.workspaces.find((workspace) => workspace.id !== workspaceId)
                  ?.id ?? snap.activeWorkspaceId
              : snap.activeWorkspaceId,
        };
        return snap;
      },
      moveWorkspace: async (workspaceId, index) => {
        const list = [...snap.workspaces];
        const from = list.findIndex((workspace) => workspace.id === workspaceId);
        if (from < 0) return snap;
        const [item] = list.splice(from, 1);
        list.splice(index, 0, item!);
        snap = { ...snap, revision: snap.revision + 1, workspaces: list };
        return snap;
      },
      activateWorkspace: async (workspaceId) => {
        snap = {
          ...snap,
          revision: snap.revision + 1,
          activeWorkspaceId: workspaceId,
        };
        return snap;
      },
      createTab: async (url, workspaceId) => {
        const id = `tab-${nextTab++}`;
        snap = {
          ...snap,
          revision: snap.revision + 1,
          tabs: [...snap.tabs, { id, workspaceId, url, title: "" }],
          activeTabId: id,
        };
        return snap;
      },
      closeTab: async (tabId) => {
        snap = {
          ...snap,
          revision: snap.revision + 1,
          tabs: snap.tabs.filter((tab) => tab.id !== tabId),
        };
        return snap;
      },
      renameTab: async (tabId, title) => {
        snap = {
          ...snap,
          revision: snap.revision + 1,
          tabs: snap.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, title } : tab
          ),
        };
        return snap;
      },
      setFavorite: async (tabId, favorite) => {
        snap = {
          ...snap,
          revision: snap.revision + 1,
          tabs: snap.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, favorite, pinned: favorite ? false : tab.pinned } : tab
          ),
        };
        return snap;
      },
      setPinned: async (tabId, pinned) => {
        snap = {
          ...snap,
          revision: snap.revision + 1,
          tabs: snap.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, pinned, favorite: pinned ? false : tab.favorite } : tab
          ),
        };
        return snap;
      },
      bookmarkFolderCreate: async (title, parentFolderId = "") => {
        const id = `folder-${nextFolder++}`;
        snap = {
          ...snap,
          revision: snap.revision + 1,
          bookmarkFolders: [
            ...(snap.bookmarkFolders ?? []),
            {
              id,
              title,
              workspaceId: snap.activeWorkspaceId,
              parentFolderId,
            },
          ],
        };
        return snap;
      },
      bookmarkFolderRename: async (folderId, title) => {
        snap = {
          ...snap,
          revision: snap.revision + 1,
          bookmarkFolders: (snap.bookmarkFolders ?? []).map((folder) =>
            folder.id === folderId ? { ...folder, title } : folder
          ),
        };
        return snap;
      },
      bookmarkFolderSetParent: async (folderId, parentFolderId) => {
        snap = {
          ...snap,
          revision: snap.revision + 1,
          bookmarkFolders: (snap.bookmarkFolders ?? []).map((folder) =>
            folder.id === folderId ? { ...folder, parentFolderId } : folder
          ),
        };
        return snap;
      },
      bookmarkFolderRemove: async (folderId) => {
        snap = {
          ...snap,
          revision: snap.revision + 1,
          bookmarkFolders: (snap.bookmarkFolders ?? []).filter(
            (folder) => folder.id !== folderId
          ),
        };
        return snap;
      },
      bookmarkCreate: async (title, url, folderId) => {
        const id = `bookmark-${nextBookmark++}`;
        snap = {
          ...snap,
          revision: snap.revision + 1,
          bookmarks: [
            ...(snap.bookmarks ?? []),
            {
              id,
              title,
              url,
              folderId,
              workspaceId: snap.activeWorkspaceId,
            },
          ],
        };
        return snap;
      },
      bookmarkUpdate: async (bookmarkId, title, url) => {
        snap = {
          ...snap,
          revision: snap.revision + 1,
          bookmarks: (snap.bookmarks ?? []).map((bookmark) =>
            bookmark.id === bookmarkId ? { ...bookmark, title, url } : bookmark
          ),
        };
        return snap;
      },
      bookmarkRemove: async (bookmarkId) => {
        snap = {
          ...snap,
          revision: snap.revision + 1,
          bookmarks: (snap.bookmarks ?? []).filter(
            (bookmark) => bookmark.id !== bookmarkId
          ),
        };
        return snap;
      },
      skipLocalId: () => {},
    };

    const tree: SyncedSpacesTree = {
      essentials: [
        {
          kind: "tab",
          id: "ess-1",
          title: "YouTube",
          url: "https://youtube.com",
          pinned: true,
          essential: true,
        },
      ],
      spaces: [
        {
          uuid: "space-base",
          name: "base",
          children: [
            {
              kind: "folder",
              id: "folder-hobby",
              name: "취미",
              children: [
                {
                  kind: "folder",
                  id: "folder-nested",
                  name: "nested",
                  children: [
                    {
                      kind: "tab",
                      id: "tab-nested-1",
                      title: "Nested",
                      url: "https://nested.example",
                      pinned: true,
                      essential: false,
                    },
                  ],
                },
                {
                  kind: "tab",
                  id: "tab-hobby-1",
                  title: "Score",
                  url: "https://score.example",
                  pinned: true,
                  essential: false,
                },
              ],
            },
            {
              kind: "tab",
              id: "tab-pin-1",
              title: "Pinned",
              url: "https://pin.example",
              pinned: true,
              essential: false,
            },
            {
              kind: "tab",
              id: "tab-ord-1",
              title: "Ordinary",
              url: "https://ordinary.example",
              pinned: false,
              essential: false,
            },
          ],
        },
      ],
    };

    const bindings = await applySyncedSpacesTree(
      tree,
      host,
      emptySpacesBindings()
    );

    expect(bindings.workspaceByRemote["space-base"]).toBeTruthy();
    expect(snap.workspaces.map((workspace) => workspace.name)).toContain("base");
    expect(snap.tabs.some((tab) => tab.favorite && tab.url === "https://youtube.com")).toBe(
      true
    );
    expect(
      snap.bookmarkFolders?.some(
        (folder) =>
          folder.title === "취미" &&
          folder.workspaceId === bindings.workspaceByRemote["space-base"]
      )
    ).toBe(true);
    expect(
      snap.bookmarks?.some(
        (bookmark) =>
          bookmark.url === "https://score.example" &&
          bookmark.folderId === bindings.folderByRemote["folder-hobby"]
      )
    ).toBe(true);
    const nested = snap.bookmarkFolders?.find(
      (folder) => folder.id === bindings.folderByRemote["folder-nested"]
    );
    expect(nested?.title).toBe("nested");
    expect(nested?.parentFolderId).toBe(
      bindings.folderByRemote["folder-hobby"]
    );
    expect(
      snap.bookmarks?.some(
        (bookmark) =>
          bookmark.url === "https://nested.example" &&
          bookmark.folderId === bindings.folderByRemote["folder-nested"]
      )
    ).toBe(true);
    expect(
      snap.tabs.some(
        (tab) =>
          tab.pinned &&
          tab.url === "https://pin.example" &&
          tab.workspaceId === bindings.workspaceByRemote["space-base"]
      )
    ).toBe(true);
    expect(
      snap.tabs.some(
        (tab) =>
          !tab.pinned &&
          !tab.favorite &&
          tab.url === "https://ordinary.example" &&
          tab.workspaceId === bindings.workspaceByRemote["space-base"]
      )
    ).toBe(true);
    // Seed about:blank in the synced space is closed once real tabs exist.
    expect(
      snap.tabs.filter(
        (tab) =>
          tab.workspaceId === bindings.workspaceByRemote["space-base"] &&
          tab.url === "about:blank"
      )
    ).toHaveLength(0);
  });

  test("adopts an exact-name workspace and removes Name 2 leftovers", async () => {
    let snap: Snapshot = {
      version: 1,
      revision: 1,
      workspaces: [
        { id: "workspace-1", name: "Default" },
        { id: "workspace-base", name: "base" },
        { id: "workspace-base-2", name: "base 2" },
      ],
      tabs: [
        {
          id: "tab-1",
          workspaceId: "workspace-1",
          url: "about:blank",
          title: "",
        },
        {
          id: "tab-base",
          workspaceId: "workspace-base",
          url: "about:blank",
          title: "",
        },
        {
          id: "tab-base-2",
          workspaceId: "workspace-base-2",
          url: "about:blank",
          title: "",
        },
      ],
      bookmarks: [],
      bookmarkFolders: [],
      activeWorkspaceId: "workspace-1",
      activeTabId: "tab-1",
      keyBindings: [],
    };
    const host: SpacesApplyHost = {
      getSnapshot: () => snap,
      createWorkspace: async () => snap,
      renameWorkspace: async (workspaceId, name) => {
        snap = {
          ...snap,
          workspaces: snap.workspaces.map((workspace) =>
            workspace.id === workspaceId ? { ...workspace, name } : workspace
          ),
        };
        return snap;
      },
      removeWorkspace: async (workspaceId) => {
        snap = {
          ...snap,
          workspaces: snap.workspaces.filter(
            (workspace) => workspace.id !== workspaceId
          ),
          tabs: snap.tabs.filter((tab) => tab.workspaceId !== workspaceId),
        };
        return snap;
      },
      moveWorkspace: async () => snap,
      activateWorkspace: async () => snap,
      createTab: async () => snap,
      closeTab: async () => snap,
      renameTab: async () => snap,
      setFavorite: async () => snap,
      setPinned: async () => snap,
      bookmarkFolderCreate: async () => snap,
      bookmarkFolderRename: async () => snap,
      bookmarkFolderSetParent: async () => snap,
      bookmarkFolderRemove: async () => snap,
      bookmarkCreate: async () => snap,
      bookmarkUpdate: async () => snap,
      bookmarkRemove: async () => snap,
      skipLocalId: () => {},
    };

    const bindings = await applySyncedSpacesTree(
      {
        essentials: [],
        spaces: [{ uuid: "space-base", name: "base", children: [] }],
      },
      host,
      {
        ...emptySpacesBindings(),
        workspaceByRemote: { "space-base": "workspace-base-2" },
      }
    );

    expect(bindings.workspaceByRemote["space-base"]).toBe("workspace-base");
    expect(snap.workspaces.map((workspace) => workspace.name)).toEqual([
      "Default",
      "base",
    ]);
  });

  test("discards Name 2 without merging its folders into the canonical space", async () => {
    let snap: Snapshot = {
      version: 1,
      revision: 1,
      workspaces: [
        { id: "workspace-1", name: "Default" },
        { id: "workspace-base", name: "base" },
        { id: "workspace-base-2", name: "base 2" },
      ],
      tabs: [
        {
          id: "tab-1",
          workspaceId: "workspace-1",
          url: "about:blank",
          title: "",
        },
        {
          id: "tab-base",
          workspaceId: "workspace-base",
          url: "about:blank",
          title: "",
        },
        {
          id: "tab-base-2",
          workspaceId: "workspace-base-2",
          url: "about:blank",
          title: "",
        },
      ],
      bookmarks: [
        {
          id: "bm-1",
          title: "A",
          url: "https://a.example",
          folderId: "folder-1",
          workspaceId: "workspace-base",
        },
        {
          id: "bm-1-dup",
          title: "A",
          url: "https://a.example",
          folderId: "folder-1-dup",
          workspaceId: "workspace-base-2",
        },
      ],
      bookmarkFolders: [
        {
          id: "folder-1",
          title: "취미",
          workspaceId: "workspace-base",
        },
        {
          id: "folder-1-dup",
          title: "취미",
          workspaceId: "workspace-base-2",
        },
        {
          id: "folder-foreign",
          title: "Expo",
          workspaceId: "workspace-base-2",
        },
      ],
      activeWorkspaceId: "workspace-1",
      activeTabId: "tab-1",
      keyBindings: [],
    };

    const host: SpacesApplyHost = {
      getSnapshot: () => snap,
      createWorkspace: async () => snap,
      renameWorkspace: async () => snap,
      removeWorkspace: async (workspaceId) => {
        // Mirror native: content moves to the previous neighbor.
        const from = snap.workspaces.findIndex(
          (workspace) => workspace.id === workspaceId
        );
        const destination =
          snap.workspaces[from > 0 ? from - 1 : 1]?.id ?? snap.activeWorkspaceId;
        snap = {
          ...snap,
          workspaces: snap.workspaces.filter(
            (workspace) => workspace.id !== workspaceId
          ),
          tabs: snap.tabs.map((tab) =>
            tab.workspaceId === workspaceId
              ? { ...tab, workspaceId: destination }
              : tab
          ),
          bookmarks: (snap.bookmarks ?? []).map((bookmark) =>
            bookmark.workspaceId === workspaceId
              ? { ...bookmark, workspaceId: destination }
              : bookmark
          ),
          bookmarkFolders: (snap.bookmarkFolders ?? []).map((folder) =>
            folder.workspaceId === workspaceId
              ? { ...folder, workspaceId: destination }
              : folder
          ),
        };
        return snap;
      },
      moveWorkspace: async () => snap,
      activateWorkspace: async (workspaceId) => {
        snap = { ...snap, activeWorkspaceId: workspaceId };
        return snap;
      },
      createTab: async () => snap,
      closeTab: async (tabId) => {
        snap = {
          ...snap,
          tabs: snap.tabs.filter((tab) => tab.id !== tabId),
        };
        return snap;
      },
      renameTab: async () => snap,
      setFavorite: async () => snap,
      setPinned: async () => snap,
      bookmarkFolderCreate: async (title) => {
        const id = `folder-${snap.revision + 1}`;
        snap = {
          ...snap,
          revision: snap.revision + 1,
          bookmarkFolders: [
            ...(snap.bookmarkFolders ?? []),
            { id, title, workspaceId: snap.activeWorkspaceId },
          ],
        };
        return snap;
      },
      bookmarkFolderRename: async () => snap,
      bookmarkFolderSetParent: async () => snap,
      bookmarkFolderRemove: async (folderId) => {
        snap = {
          ...snap,
          bookmarkFolders: (snap.bookmarkFolders ?? []).filter(
            (folder) => folder.id !== folderId
          ),
          bookmarks: (snap.bookmarks ?? []).map((bookmark) =>
            bookmark.folderId === folderId
              ? { ...bookmark, folderId: "" }
              : bookmark
          ),
        };
        return snap;
      },
      bookmarkCreate: async (title, url, folderId) => {
        const id = `bookmark-${snap.revision + 1}`;
        snap = {
          ...snap,
          revision: snap.revision + 1,
          bookmarks: [
            ...(snap.bookmarks ?? []),
            {
              id,
              title,
              url,
              folderId,
              workspaceId: snap.activeWorkspaceId,
            },
          ],
        };
        return snap;
      },
      bookmarkUpdate: async () => snap,
      bookmarkRemove: async (bookmarkId) => {
        snap = {
          ...snap,
          bookmarks: (snap.bookmarks ?? []).filter(
            (bookmark) => bookmark.id !== bookmarkId
          ),
        };
        return snap;
      },
      skipLocalId: () => {},
    };

    await applySyncedSpacesTree(
      {
        essentials: [],
        spaces: [
          {
            uuid: "space-base",
            name: "base",
            children: [
              {
                kind: "folder",
                id: "remote-hobby",
                name: "취미",
                children: [
                  {
                    kind: "tab",
                    id: "remote-a",
                    title: "A",
                    url: "https://a.example",
                    pinned: true,
                    essential: false,
                  },
                ],
              },
            ],
          },
        ],
      },
      host,
      {
        ...emptySpacesBindings(),
        workspaceByRemote: { "space-base": "workspace-base" },
        folderByRemote: { "remote-hobby": "folder-1" },
        bookmarkByRemote: { "remote-a": "bm-1" },
      }
    );

    const baseFolders = (snap.bookmarkFolders ?? []).filter(
      (folder) => folder.workspaceId === "workspace-base"
    );
    expect(baseFolders.map((folder) => folder.title).sort()).toEqual(["취미"]);
    expect(snap.workspaces.map((workspace) => workspace.name)).toEqual([
      "Default",
      "base",
    ]);
  });

  test("dedupes YouTube favorite tiles spawned after navigation URL drift", async () => {
    let snap: Snapshot = {
      version: 1,
      revision: 1,
      workspaces: [{ id: "workspace-1", name: "Default" }],
      tabs: [
        {
          id: "tab-1",
          workspaceId: "workspace-1",
          url: "about:blank",
          title: "",
        },
        {
          id: "yt-1",
          workspaceId: "workspace-1",
          url: "https://www.youtube.com/watch?v=abc",
          title: "YouTube",
          favorite: true,
        },
        {
          id: "yt-2",
          workspaceId: "workspace-1",
          url: "https://youtube.com",
          title: "YouTube",
          favorite: true,
        },
        {
          id: "naver",
          workspaceId: "workspace-1",
          url: "https://naver.com",
          title: "NAVER",
          favorite: true,
        },
      ],
      bookmarks: [],
      bookmarkFolders: [],
      activeWorkspaceId: "workspace-1",
      activeTabId: "tab-1",
      keyBindings: [],
    };
    const host: SpacesApplyHost = {
      getSnapshot: () => snap,
      createWorkspace: async () => snap,
      renameWorkspace: async () => snap,
      removeWorkspace: async () => snap,
      moveWorkspace: async () => snap,
      activateWorkspace: async () => snap,
      createTab: async (url) => {
        const id = `tab-${snap.revision + 1}`;
        snap = {
          ...snap,
          revision: snap.revision + 1,
          tabs: [
            ...snap.tabs,
            { id, workspaceId: snap.activeWorkspaceId, url, title: "" },
          ],
        };
        return snap;
      },
      closeTab: async (tabId) => {
        snap = {
          ...snap,
          tabs: snap.tabs.filter((tab) => tab.id !== tabId),
        };
        return snap;
      },
      renameTab: async () => snap,
      setFavorite: async (tabId, favorite) => {
        snap = {
          ...snap,
          tabs: snap.tabs.map((tab) =>
            tab.id === tabId
              ? {
                  ...tab,
                  favorite,
                  // Mirror native: demoting a favorite clears home + suspend.
                  ...(favorite
                    ? {}
                    : { suspended: false, homeUrl: undefined, homeTitle: undefined }),
                }
              : tab
          ),
        };
        return snap;
      },
      setPinned: async () => snap,
      bookmarkFolderCreate: async () => snap,
      bookmarkFolderRename: async () => snap,
      bookmarkFolderSetParent: async () => snap,
      bookmarkFolderRemove: async () => snap,
      bookmarkCreate: async () => snap,
      bookmarkUpdate: async () => snap,
      bookmarkRemove: async () => snap,
      skipLocalId: () => {},
    };

    await applySyncedSpacesTree(
      {
        essentials: [
          {
            kind: "tab",
            id: "ess-yt",
            title: "YouTube",
            url: "https://youtube.com",
            pinned: true,
            essential: true,
          },
          {
            kind: "tab",
            id: "ess-yt-2",
            title: "YouTube",
            url: "https://www.youtube.com/",
            pinned: true,
            essential: true,
          },
          {
            kind: "tab",
            id: "ess-yt-3",
            title: "YouTube",
            url: "https://youtube.com/",
            pinned: true,
            essential: true,
          },
        ],
        spaces: [],
      },
      host,
      emptySpacesBindings()
    );

    const youtubeFavorites = snap.tabs.filter(
      (tab) => tab.favorite && sameFavoriteSite(tab.url, "https://youtube.com")
    );
    expect(youtubeFavorites).toHaveLength(1);
    expect(snap.tabs.some((tab) => tab.id === "naver" && tab.favorite)).toBe(
      true
    );
  });

  test("dedupes pinned space tabs that closeTab only suspended", async () => {
    let snap: Snapshot = {
      version: 1,
      revision: 1,
      workspaces: [
        { id: "workspace-1", name: "Default" },
        { id: "workspace-k", name: "krafton jungle" },
      ],
      tabs: [
        {
          id: "tab-1",
          workspaceId: "workspace-1",
          url: "about:blank",
          title: "",
        },
        {
          id: "pin-a",
          workspaceId: "workspace-k",
          url: "https://id.atlassian.com/login?continue=%2F",
          title: "Atlassian",
          pinned: true,
          homeUrl: "https://id.atlassian.com/login",
        },
        {
          id: "pin-a2",
          workspaceId: "workspace-k",
          url: "https://id.atlassian.com/login",
          title: "Atlassian",
          pinned: true,
          homeUrl: "https://id.atlassian.com/login",
          suspended: true,
        },
        {
          id: "pin-a3",
          workspaceId: "workspace-k",
          url: "https://id.atlassian.com/login",
          title: "Atlassian",
          pinned: true,
          homeUrl: "https://id.atlassian.com/login",
          suspended: true,
        },
        {
          id: "pin-slack",
          workspaceId: "workspace-k",
          url: "https://app.slack.com/client/T1/C1",
          title: "Slack",
          pinned: true,
          homeUrl: "https://app.slack.com/client/T1/C1",
        },
      ],
      bookmarks: [],
      bookmarkFolders: [],
      activeWorkspaceId: "workspace-k",
      activeTabId: "pin-a",
      keyBindings: [],
    };
    const host: SpacesApplyHost = {
      getSnapshot: () => snap,
      createWorkspace: async () => snap,
      renameWorkspace: async () => snap,
      removeWorkspace: async () => snap,
      moveWorkspace: async () => snap,
      activateWorkspace: async (workspaceId) => {
        snap = { ...snap, activeWorkspaceId: workspaceId };
        return snap;
      },
      createTab: async (url, workspaceId) => {
        const id = `tab-${snap.revision + 1}`;
        snap = {
          ...snap,
          revision: snap.revision + 1,
          tabs: [...snap.tabs, { id, workspaceId, url, title: "" }],
        };
        return snap;
      },
      closeTab: async (tabId) => {
        const target = snap.tabs.find((tab) => tab.id === tabId);
        if (target?.pinned || target?.favorite) {
          snap = {
            ...snap,
            tabs: snap.tabs.map((tab) =>
              tab.id === tabId
                ? {
                    ...tab,
                    suspended: true,
                    url: tab.homeUrl || tab.url,
                  }
                : tab
            ),
          };
        } else {
          snap = {
            ...snap,
            tabs: snap.tabs.filter((tab) => tab.id !== tabId),
          };
        }
        return snap;
      },
      renameTab: async () => snap,
      setFavorite: async () => snap,
      setPinned: async (tabId, pinned) => {
        snap = {
          ...snap,
          tabs: snap.tabs.map((tab) =>
            tab.id === tabId
              ? {
                  ...tab,
                  pinned,
                  ...(pinned
                    ? { homeUrl: tab.homeUrl || tab.url }
                    : { suspended: false, homeUrl: undefined }),
                }
              : tab
          ),
        };
        return snap;
      },
      bookmarkFolderCreate: async () => snap,
      bookmarkFolderRename: async () => snap,
      bookmarkFolderSetParent: async () => snap,
      bookmarkFolderRemove: async () => snap,
      bookmarkCreate: async () => snap,
      bookmarkUpdate: async () => snap,
      bookmarkRemove: async () => snap,
      skipLocalId: () => {},
    };

    await applySyncedSpacesTree(
      {
        essentials: [],
        spaces: [
          {
            uuid: "space-k",
            name: "krafton jungle",
            children: [
              {
                kind: "tab",
                id: "remote-a",
                title: "Atlassian",
                url: "https://id.atlassian.com/login",
                pinned: true,
                essential: false,
              },
              {
                kind: "tab",
                id: "remote-slack",
                title: "Slack",
                url: "https://app.slack.com/client/T1/C1",
                pinned: true,
                essential: false,
              },
            ],
          },
        ],
      },
      host,
      {
        ...emptySpacesBindings(),
        workspaceByRemote: { "space-k": "workspace-k" },
      }
    );

    const atlassian = snap.tabs.filter(
      (tab) =>
        tab.workspaceId === "workspace-k" &&
        sameBrowseTarget(tab.url, "https://id.atlassian.com/login")
    );
    const slack = snap.tabs.filter(
      (tab) =>
        tab.workspaceId === "workspace-k" &&
        sameBrowseTarget(tab.url, "https://app.slack.com/client/T1/C1")
    );
    expect(atlassian).toHaveLength(1);
    expect(slack).toHaveLength(1);
  });
});
