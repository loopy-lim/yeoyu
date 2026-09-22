import type { Snapshot } from "../generated/types";
import type { Navigation } from "../modules/browser-surface/src/BrowserSurfaceNativeComponent";
import { SerialQueue } from "./policy";
import { persistableSnapshot } from "./privateTabs";
import { BrowserPerformance, utf8Bytes } from "./browserPerformance";

type GeneratedCommands = Pick<
  typeof import("../generated/commands"),
  | "browserSnapshot"
  | "snapshotRestore"
  | "workspaceCreate"
  | "tabCreate"
  | "tabActivate"
  | "tabClose"
  | "tabReset"
  | "tabNavigated"
  | "tabSetFavorite"
  | "tabSetPinned"
  | "tabMove"
  | "tabSetWorkspace"
  | "workspaceActivate"
  | "keymapSet"
  | "bookmarkOpen"
  | "bookmarkCreate"
  | "bookmarkUpdate"
  | "bookmarkRemove"
  | "bookmarkMove"
  | "bookmarkFolderCreate"
  | "bookmarkFolderRename"
  | "bookmarkFolderRemove"
  | "bookmarkSetFolder"
>;
type ArchiveCommands = Pick<
  typeof import("../generated/commands"),
  | "workArchiveExport"
  | "workArchivePreview"
  | "workArchivePrepare"
  | "workArchiveImport"
>;
export type BrowserCommands = {
  [Name in keyof GeneratedCommands]: (
    ...args: Parameters<GeneratedCommands[Name]>
  ) => ReturnType<GeneratedCommands[Name]>;
} & {
  ready(): Promise<unknown>;
  keymapDefaults?: typeof import("../generated/commands").keymapDefaults;
  tabOpenExternal?: typeof import("../generated/commands").tabOpenExternal;
} & {
  [Name in keyof ArchiveCommands]?: (
    ...args: Parameters<ArchiveCommands[Name]>
  ) => ReturnType<ArchiveCommands[Name]>;
};

export interface BrowserStorage {
  reconcileTabs(tabs: { id: string; private: boolean }[]): void;
  setTabMetadataCount?(count: number): void;
  configureKeys(json: string): void;
  readSnapshot(): Promise<string | null>;
  saveSnapshot(json: string): Promise<void>;
  // Optional: older native binaries (hot reload) may not provide the
  // corrupt-snapshot recovery bucket yet.
  readLastGoodSnapshot?(): Promise<string | null>;
  quarantineSnapshot?(json: string): Promise<void>;
  // Address a live detached session too; absent sessions stay lazy.
  loadTabUrl?(id: string, url: string): void;
  resolveNewSession?(
    requestId: number,
    tabId: string,
    isPrivate: boolean
  ): Promise<void>;
  cancelNewSession?(requestId: number): void;
  prepareColdSpaceTransition?(
    previousTabId: string,
    nextTabId: string,
    nextUrl: string
  ): Promise<void>;
  prepareSpaceTransition?(
    previousTabId: string | null,
    nextTabId: string | null
  ): Promise<void>;
  prepareTabTransition?(
    previousTabId: string | null,
    nextTabId: string | null,
    nextVisibleTabIdsJson: string | null
  ): Promise<void>;
}

type TabTransitionListener = (
  before: Snapshot,
  after: Snapshot,
  visibleAfter: readonly string[]
) => void;

export interface NewWindowRequest {
  requestId: number;
  openerTabId: string;
  uri: string;
}

// A pristine tab shows the centered new-tab page instead of web content.
export const NEW_TAB_URL = "about:blank";
const singleVisibleTab = (snapshot: Snapshot): readonly string[] =>
  snapshot.activeTabId ? [snapshot.activeTabId] : [];

export class BrowserController {
  constructor(
    private commands: BrowserCommands,
    private platform: BrowserStorage,
    readonly performance = new BrowserPerformance()
  ) {}
  snapshot: Snapshot | null = null;
  private queue = new SerialQueue();
  private initialization: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private transitionListeners = new Set<TabTransitionListener>();
  private pendingSave: Snapshot | null = null;
  private saveTask: Promise<void> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private persistenceError: Error | null = null;
  private persistenceListeners = new Set<(error: Error | null) => void>();
  private lastReconciled = "[]";
  private lastMetadataCount: number | null = null;
  private lastKeymap = "";
  private lastDurableContent: string | null = null;
  private popupTabs = new Set<string>();
  private importRecoveryRequired: Error | null = null;
  isPopupTab = (id: string) => this.popupTabs.has(id);
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.snapshot;
  // UI subscribers can retain presentation before native takes the outgoing
  // view. The controller never stores pane order, orientation, or ratio.
  subscribeBeforeTabTransition = (fn: TabTransitionListener) => {
    this.transitionListeners.add(fn);
    return () => {
      this.transitionListeners.delete(fn);
    };
  };
  subscribePersistenceError = (fn: (error: Error | null) => void) => {
    this.persistenceListeners.add(fn);
    fn(this.persistenceError);
    return () => {
      this.persistenceListeners.delete(fn);
    };
  };
  private reportPersistenceError(error: Error | null) {
    this.persistenceError = error;
    this.persistenceListeners.forEach((fn) => fn(error));
  }
  private async publish(
    snapshot: Snapshot,
    visibleAfter?: (snapshot: Snapshot) => readonly string[],
    beforePublication?: (snapshot: Snapshot) => void,
    alreadyDurable = false
  ): Promise<Snapshot> {
    const publicationStarted = this.performance.enabled ? performance.now() : 0;
    const previous = this.snapshot?.activeTabId;
    const next = snapshot.activeTabId ?? null;
    const presentation =
      visibleAfter ??
      (this.snapshot &&
      this.snapshot.activeWorkspaceId !== snapshot.activeWorkspaceId
        ? singleVisibleTab
        : undefined);
    if (previous && (previous !== next || presentation)) {
      // Claim the live GeckoView before React removes the outgoing pane. A
      // closed or suspended source must never be transferred to another window.
      const retained = snapshot.tabs.some(
        (tab) => tab.id === previous && !tab.suspended
      );
      const afterIds = (presentation ?? singleVisibleTab)(snapshot).filter(
        (id) => snapshot.tabs.some((tab) => tab.id === id && !tab.suspended)
      );
      for (const listener of this.transitionListeners) {
        // Observation cannot make a successful domain mutation fail to publish.
        try {
          listener(this.snapshot!, snapshot, afterIds);
        } catch {}
      }
      if (
        retained &&
        next &&
        previous !== next &&
        afterIds.length === 1 &&
        this.snapshot?.activeWorkspaceId !== snapshot.activeWorkspaceId
      ) {
        try {
          const target = snapshot.tabs.find(
            (tab) => tab.id === next && !tab.suspended
          );
          if (target && this.platform.prepareColdSpaceTransition)
            await this.platform.prepareColdSpaceTransition(
              previous,
              next,
              target.url
            );
          else await this.platform.prepareSpaceTransition?.(previous, next);
        } catch {
          /* A visual fallback must not suppress native ownership preparation. */
        }
      }
      try {
        await this.platform.prepareTabTransition?.(
          retained ? previous : null,
          next,
          presentation ? JSON.stringify(afterIds) : null
        );
      } catch {
        // The domain mutation has succeeded. Unsupported or rejected external
        // PiP falls back to Home PiP and must not prevent publication.
      }
    }
    // A presentation observer must not suppress an already committed mutation.
    try {
      beforePublication?.(snapshot);
    } catch {}
    this.snapshot = snapshot;
    // Native side effects re-run only on real changes: navigations used to
    // re-parse and rebind the keymap and reconcile every tab on each event.
    const ids = snapshot.tabs
      .filter((tab) => !tab.suspended)
      .map((tab) => tab.id);
    for (const id of this.popupTabs)
      if (!ids.includes(id)) this.popupTabs.delete(id);
    this.reconcileNative(snapshot);
    const keymap = JSON.stringify(snapshot.keyBindings);
    if (keymap !== this.lastKeymap) {
      this.platform.configureKeys(keymap);
      this.lastKeymap = keymap;
    }
    this.listeners.forEach((fn) => fn());
    // Saves own a separate serial pipeline. New input never waits behind
    // disk, and one trailing write covers all mutations in the same turn.
    if (!alreadyDurable) {
      this.pendingSave = snapshot;
      this.scheduleSave();
    }
    if (this.performance.enabled)
      this.performance.record(
        "publication",
        performance.now() - publicationStarted
      );
    return snapshot;
  }
  /** Native sessions need the live id set AND each tab's browsing mode before
   * a session can be created: a private popup must adopt a private GeckoSession.
   * Popups call this directly ahead of resolveNewSession; publish calls it for
   * every snapshot and the change key keeps the calls deduplicated. */
  private reconcileNative(snapshot: Snapshot) {
    // Saved/suspended rows are metadata even when they cannot own live sessions.
    // Record success only after the bridge call so initialization can retry.
    if (snapshot.tabs.length !== this.lastMetadataCount) {
      this.platform.setTabMetadataCount?.(snapshot.tabs.length);
      this.lastMetadataCount = snapshot.tabs.length;
    }
    const tabs = snapshot.tabs
      .filter((tab) => !tab.suspended)
      .map((tab) => ({ id: tab.id, private: !!tab.private }));
    const sessionKey = JSON.stringify(
      tabs.map((tab) => [tab.id, tab.private ? 1 : 0]).sort()
    );
    if (sessionKey !== this.lastReconciled) {
      this.platform.reconcileTabs(tabs);
      this.lastReconciled = sessionKey;
    }
  }
  private scheduleSave() {
    if (!this.saveTask && !this.saveTimer) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        // Failures stay pending and are reported. A later mutation or
        // explicit flush retries; there is no unbounded retry loop.
        void this.drainSaves().catch(() => undefined);
      }, 0);
    }
  }
  private drainSaves(): Promise<void> {
    if (this.saveTask) return this.saveTask;
    let failedSnapshot: Snapshot | null = null;
    const write = async () => {
      while (this.pendingSave) {
        const latest = this.pendingSave;
        this.pendingSave = null;
        try {
          const started = this.performance.enabled ? performance.now() : 0;
          const { revision, ...content } = persistableSnapshot(latest);
          const serializedContent = JSON.stringify(content);
          if (this.performance.enabled)
            this.performance.record(
              "serialization",
              performance.now() - started
            );
          // Revision alone carries no user data. Private-only mutations can
          // change it without changing the ordinary persisted document.
          if (serializedContent !== this.lastDurableContent) {
            const json = `{"revision":${revision},${serializedContent.slice(
              1
            )}`;
            const writing = this.performance.enabled ? performance.now() : 0;
            await this.platform.saveSnapshot(json);
            this.lastDurableContent = serializedContent;
            if (this.performance.enabled)
              this.performance.record(
                "write",
                performance.now() - writing,
                utf8Bytes(json)
              );
          } else this.performance.record("skippedWrite", 0);
          if (this.persistenceError) this.reportPersistenceError(null);
        } catch (cause) {
          failedSnapshot = latest;
          // A newer snapshot supersedes this one but still needs writing.
          if (!this.pendingSave) this.pendingSave = latest;
          const error =
            cause instanceof Error ? cause : new Error(String(cause));
          this.reportPersistenceError(error);
          throw error;
        }
      }
    };
    this.saveTask = write().finally(() => {
      this.saveTask = null;
      // Cover a publication at the write-completion handoff without
      // retrying the same failed snapshot in an unbounded loop. A newer
      // publication still receives its own write attempt.
      if (this.pendingSave && this.pendingSave !== failedSnapshot)
        this.scheduleSave();
    });
    return this.saveTask;
  }
  /** Wait for prior input, the write in flight, and its newest successor.
   * A rejected flush remains retryable and never discards the snapshot. */
  async flush(): Promise<void> {
    await this.initialize();
    await this.queue.run(async () => undefined);
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.drainSaves();
  }
  initialize(): Promise<void> {
    if (this.importRecoveryRequired)
      return Promise.reject(this.importRecoveryRequired);
    if (!this.initialization) {
      const run = this.queue.run(async () => {
        await this.commands.ready();
        const saved = await this.platform.readSnapshot();
        let snapshot: Snapshot;
        if (!saved) {
          // Quarantine removes the primary before the recovered snapshot's
          // trailing save. A restart in that interval must resume from the
          // still-intact last-good copy rather than seed default state.
          const lastGood = this.platform.readLastGoodSnapshot
            ? await this.platform.readLastGoodSnapshot()
            : null;
          snapshot = lastGood
            ? await this.commands.snapshotRestore({ json: lastGood })
            : await this.commands.browserSnapshot({});
        } else {
          try {
            snapshot = await this.commands.snapshotRestore({ json: saved });
          } catch (error) {
            // A damaged snapshot falls back to the rolling last-good copy;
            // validate the fallback before removing the primary so a
            // transient restore failure remains retryable.
            const lastGood = this.platform.readLastGoodSnapshot
              ? await this.platform.readLastGoodSnapshot()
              : null;
            if (!lastGood) throw error;
            const recovered = await this.commands.snapshotRestore({
              json: lastGood,
            });
            if (this.platform.quarantineSnapshot)
              await this.platform.quarantineSnapshot(saved);
            snapshot = recovered;
          }
        }
        await this.publish(snapshot);
        if (
          !snapshot.tabs.some(
            (tab) => tab.id === snapshot.activeTabId && !tab.suspended
          )
        ) {
          // Already inside the queue: do not await another queued mutation.
          await this.publish(
            await this.commands.tabCreate({
              workspaceId: snapshot.activeWorkspaceId,
              url: NEW_TAB_URL,
              private: false,
            })
          );
        }
      });
      // A transient storage failure must not poison every later command:
      // drop the memo so the next command retries. Re-running is safe —
      // publish applies live state before saving, and the blank-tab seed
      // only runs when no tabs exist.
      this.initialization = run.catch((error: unknown) => {
        this.initialization = null;
        throw error;
      });
    }
    return this.initialization;
  }
  mutate(
    operation: () => Promise<Snapshot>,
    visibleAfter?: (snapshot: Snapshot) => readonly string[]
  ) {
    return this.initialize().then(() =>
      this.queue.run(async () => {
        this.assertMutable();
        const started = this.performance.enabled ? performance.now() : 0;
        const snapshot = await operation();
        if (this.performance.enabled)
          this.performance.record("command", performance.now() - started);
        return this.publish(snapshot, visibleAfter);
      })
    );
  }
  private assertMutable() {
    if (this.importRecoveryRequired) throw this.importRecoveryRequired;
  }
  exportArchive(presentation: string | null) {
    return this.initialize().then(() =>
      this.queue.run(async () => {
        if (!this.commands.workArchiveExport)
          throw new Error("Rebuild the browser to export data");
        return this.commands.workArchiveExport({ presentation });
      })
    );
  }
  previewArchive(json: string) {
    return this.initialize().then(() =>
      this.queue.run(async () => {
        if (!this.commands.workArchivePreview)
          throw new Error("Rebuild the browser to import data");
        return this.commands.workArchivePreview({ json });
      })
    );
  }
  importArchive(
    json: string,
    includeFavorites: boolean,
    restoreKeymap: boolean
  ) {
    return this.initialize().then(() =>
      this.queue.run(async () => {
        if (this.importRecoveryRequired) throw this.importRecoveryRequired;
        const prepare = this.commands.workArchivePrepare,
          commit = this.commands.workArchiveImport;
        if (!prepare || !commit)
          throw new Error("Rebuild the browser to import data");
        if (this.saveTimer) {
          clearTimeout(this.saveTimer);
          this.saveTimer = null;
        }
        await this.drainSaves();
        const before = this.snapshot!;
        const input = { json, includeFavorites, restoreKeymap };
        const candidate = await prepare(input);
        // No domain mutation, reconciliation or publication until the append is durable.
        await this.platform.saveSnapshot(
          JSON.stringify(persistableSnapshot(candidate))
        );
        let committed: Snapshot;
        try {
          committed = await commit({
            ...input,
            expectedRevision: before.revision,
          });
        } catch (failure) {
          // A failed bridge reply does not prove the native command failed. Read
          // state before deciding whether to publish or restore the previous file.
          let actual: Snapshot;
          try {
            actual = await this.commands.browserSnapshot({});
          } catch {
            this.importRecoveryRequired = new Error(
              "Import recovery needs an app restart. Saved data has been kept; further changes are paused."
            );
            this.reportPersistenceError(this.importRecoveryRequired);
            throw this.importRecoveryRequired;
          }
          if (JSON.stringify(actual) === JSON.stringify(candidate))
            committed = actual;
          else if (JSON.stringify(actual) === JSON.stringify(before)) {
            try {
              const previous = JSON.stringify(persistableSnapshot(before));
              // Restore primary and rolling fallback, so a later recovery cannot
              // resurrect a transaction whose native commit was rejected.
              await this.platform.saveSnapshot(previous);
              await this.platform.saveSnapshot(previous);
            } catch {
              this.importRecoveryRequired = new Error(
                "Import recovery needs an app restart. Further changes are paused to protect saved data."
              );
              this.reportPersistenceError(this.importRecoveryRequired);
              throw this.importRecoveryRequired;
            }
            throw failure;
          } else {
            this.importRecoveryRequired = new Error(
              "Browser state changed during import. Restart before making further changes."
            );
            this.reportPersistenceError(this.importRecoveryRequired);
            throw this.importRecoveryRequired;
          }
        }
        const { revision: _revision, ...content } =
          persistableSnapshot(committed);
        this.lastDurableContent = JSON.stringify(content);
        return this.publish(committed, undefined, undefined, true);
      })
    );
  }
  createTab(
    url = NEW_TAB_URL,
    workspaceId?: string,
    options?: { private?: boolean }
  ) {
    return this.mutate(() =>
      this.commands.tabCreate({
        workspaceId: workspaceId ?? this.snapshot!.activeWorkspaceId,
        url,
        // The JSI encoder requires the field; never rely on the optional type.
        private: !!options?.private,
      })
    );
  }
  openExternal(requestId: string, url: string) {
    return this.mutate(() => {
      if (!this.commands.tabOpenExternal)
        throw new Error("Rebuild the browser to open external links");
      return this.commands.tabOpenExternal({ requestId, url });
    }, singleVisibleTab);
  }
  /** Gecko must adopt the Rust ID before React can mount a surface for it.
   * The supplied URI is metadata; only Gecko loads the popup browsing context. */
  openWindow(request: NewWindowRequest): Promise<Snapshot> {
    return this.initialize()
      .then(() =>
        this.queue.run(async () => {
          this.assertMutable();
          const before = this.snapshot!;
          const opener = before.tabs.find(
            (tab) => tab.id === request.openerTabId && !tab.suspended
          );
          if (!opener) throw new Error("Popup opener is no longer available");
          if (!this.platform.resolveNewSession)
            throw new Error("Native popup adoption is unavailable");
          let createdId: string | undefined;
          try {
            const candidate = await this.commands.tabCreate({
              workspaceId: opener.favorite
                ? before.activeWorkspaceId
                : opener.workspaceId,
              url: request.uri || NEW_TAB_URL,
              // A popup inherits the opener's browsing mode.
              private: !!opener.private,
            });
            const allocatedId = candidate.activeTabId ?? undefined;
            if (
              !allocatedId ||
              before.tabs.some((tab) => tab.id === allocatedId)
            )
              throw new Error("Popup tab allocation did not return a new tab");
            createdId = allocatedId;
            // The popup id stays unreconciled until adoption completes; the
            // browsing mode rides the adoption call so a private opener gets
            // a private engine session even though publish happens later.
            await this.platform.resolveNewSession(
              request.requestId,
              createdId,
              !!opener.private
            );
            this.popupTabs.add(createdId);
            return await this.publish(candidate);
          } catch (error) {
            if (createdId) {
              this.popupTabs.delete(createdId);
              try {
                let restored = await this.commands.tabClose({
                  tabId: createdId,
                });
                if (restored.activeWorkspaceId !== before.activeWorkspaceId)
                  restored = await this.commands.workspaceActivate({
                    workspaceId: before.activeWorkspaceId,
                  });
                if (
                  before.activeTabId &&
                  restored.tabs.some(
                    (tab) => tab.id === before.activeTabId && !tab.suspended
                  )
                )
                  restored = await this.commands.tabActivate({
                    tabId: before.activeTabId,
                  });
                await this.publish(restored);
              } catch (rollbackError) {
                throw new Error(
                  `Popup failed: ${String(error)}; tab cleanup failed: ${String(
                    rollbackError
                  )}`
                );
              }
            }
            throw error;
          }
        })
      )
      .catch((error) => {
        this.platform.cancelNewSession?.(request.requestId);
        throw error;
      });
  }
  activate(
    tabId: string,
    visibleAfter?:
      | readonly string[]
      | ((snapshot: Snapshot) => readonly string[]),
    shouldActivate?: (snapshot: Snapshot) => boolean,
    beforePublication?: (snapshot: Snapshot) => void
  ) {
    return this.initialize().then(() =>
      this.queue.run(async () => {
        this.assertMutable();
        // An OS return may wait behind close/move input already in the queue.
        if (shouldActivate && !shouldActivate(this.snapshot!))
          return this.snapshot!;
        return this.publish(
          await this.commands.tabActivate({ tabId }),
          typeof visibleAfter === "function"
            ? visibleAfter
            : visibleAfter
            ? () => visibleAfter
            : undefined,
          beforePublication
        );
      })
    );
  }
  close(tabId: string) {
    return this.mutate(() => this.commands.tabClose({ tabId }));
  }
  applyExtensionTabRequest(
    tabId: string,
    action: "close" | "activate",
    claim: () => Promise<boolean>
  ) {
    return this.initialize().then(() =>
      this.queue.run(async () => {
        this.assertMutable();
        if (
          !this.snapshot!.tabs.some((tab) => tab.id === tabId && !tab.suspended)
        )
          throw new Error("Extension target tab is no longer available");
        if (!(await claim()))
          throw new Error(
            "Extension request expired or its permission changed"
          );
        const next =
          action === "close"
            ? await this.commands.tabClose({ tabId })
            : await this.commands.tabActivate({ tabId });
        return this.publish(
          next,
          action === "activate" ? singleVisibleTab : undefined
        );
      })
    );
  }
  reset(tabId: string) {
    return this.mutate(() => this.commands.tabReset({ tabId })).then(
      (snapshot) => {
        const tab = snapshot.tabs.find((item) => item.id === tabId);
        if (tab && !tab.suspended) this.platform.loadTabUrl?.(tabId, tab.url);
        return snapshot;
      }
    );
  }
  setFavorite(tabId: string, favorite: boolean) {
    return this.mutate(() => this.commands.tabSetFavorite({ tabId, favorite }));
  }
  setPinned(tabId: string, pinned: boolean) {
    return this.mutate(() => {
      const tab = this.snapshot!.tabs.find((item) => item.id === tabId);
      return !pinned && tab?.bookmarkId
        ? this.commands.bookmarkRemove({ bookmarkId: tab.bookmarkId })
        : this.commands.tabSetPinned({ tabId, pinned });
    });
  }
  moveTab(tabId: string, index: number) {
    return this.mutate(() => this.commands.tabMove({ tabId, index }));
  }
  setTabWorkspace(
    tabId: string,
    workspaceId: string,
    visibleAfter: (snapshot: Snapshot) => readonly string[] = singleVisibleTab
  ) {
    return this.mutate(
      () => this.commands.tabSetWorkspace({ tabId, workspaceId }),
      visibleAfter
    );
  }
  activateWorkspace(workspaceId: string) {
    return this.mutate(
      () => this.commands.workspaceActivate({ workspaceId }),
      singleVisibleTab
    );
  }
  workspace(name: string) {
    return this.mutate(() => this.commands.workspaceCreate({ name }));
  }
  async defaultKeymap() {
    if (!this.commands.keymapDefaults)
      throw new Error("Update the app to restore default shortcuts");
    return (await this.commands.keymapDefaults({})).bindings;
  }
  keymap(bindings: Snapshot["keyBindings"]) {
    return this.mutate(() => this.commands.keymapSet({ bindings }));
  }
  bookmarkCreate(title: string, url: string, folderId = "") {
    return this.mutate(() =>
      this.commands.bookmarkCreate({ title, url, folderId })
    );
  }
  bookmarkFolderCreate(title: string) {
    return this.mutate(() => this.commands.bookmarkFolderCreate({ title }));
  }
  bookmarkFolderRename(folderId: string, title: string) {
    return this.mutate(() =>
      this.commands.bookmarkFolderRename({ folderId, title })
    );
  }
  bookmarkFolderRemove(folderId: string) {
    return this.mutate(() => this.commands.bookmarkFolderRemove({ folderId }));
  }
  bookmarkSetFolder(bookmarkId: string, folderId: string) {
    return this.mutate(() =>
      this.commands.bookmarkSetFolder({ bookmarkId, folderId })
    );
  }
  bookmarkUpdate(bookmarkId: string, title: string, url: string) {
    return this.mutate(() =>
      this.commands.bookmarkUpdate({ bookmarkId, title, url })
    );
  }
  bookmarkRemove(bookmarkId: string) {
    return this.mutate(() => this.commands.bookmarkRemove({ bookmarkId }));
  }
  bookmarkMove(bookmarkId: string, index: number) {
    return this.mutate(() => this.commands.bookmarkMove({ bookmarkId, index }));
  }
  openBookmark(
    bookmarkId: string,
    visibleAfter: (snapshot: Snapshot) => readonly string[] = singleVisibleTab
  ): Promise<Snapshot> {
    return this.mutate(async () => {
      const snapshot = this.snapshot!;
      const bookmark = (snapshot.bookmarks ?? []).find(
        (item) => item.id === bookmarkId
      );
      if (!bookmark) throw new Error("Bookmark no longer exists");
      if (bookmark.workspaceId !== snapshot.activeWorkspaceId)
        throw new Error("Bookmark belongs to another Space");
      // Private mode never reuses an ordinary live session; the domain opens
      // a plain private tab instead.
      const privateMode = !!snapshot.tabs.find(
        (tab) => tab.id === snapshot.activeTabId
      )?.private;
      // Ownership survives redirects and page navigation. URL matching is only
      // a one-time adoption hint for an existing, unbound tab in this Space.
      const existing = privateMode
        ? undefined
        : snapshot.tabs.find(
            (tab) =>
              !tab.bookmarkId &&
              !tab.favorite &&
              tab.workspaceId === snapshot.activeWorkspaceId &&
              bookmarkUrlKey(tab.homeUrl || tab.url) ===
                bookmarkUrlKey(bookmark.url)
          );
      return this.commands.bookmarkOpen({
        bookmarkId,
        reuseTabId: existing?.id ?? "",
        private: privateMode,
      });
    }, visibleAfter);
  }
  navigated(event: Navigation) {
    return this.initialize().then(() =>
      this.queue.run(async () => {
        this.assertMutable();
        const tab = this.snapshot?.tabs.find((t) => t.id === event.tabId);
        if (
          !tab ||
          tab.suspended ||
          !event.url ||
          (tab.url === event.url && tab.title === event.title)
        )
          return;
        await this.publish(
          await this.commands.tabNavigated({
            tabId: tab.id,
            url: event.url,
            title: event.title,
          })
        );
      })
    );
  }
}

// URL parsing canonicalizes host case and origin root slashes. Scheme-less
// links mean HTTPS; paths, queries, fragments, schemes and hosts stay distinct.
export function bookmarkUrlKey(url: string): string {
  const value = url.trim();
  try {
    const hostWithPort = /^[^/?#]+:\d+(?:[/?#]|$)/.test(value);
    const hasScheme = !hostWithPort && /^[a-z][a-z0-9+.-]*:/i.test(value);
    return new URL(hasScheme ? value : `https://${value}`).href;
  } catch {
    return value;
  }
}
