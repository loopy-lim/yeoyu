import { mock } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create } from "react-test-renderer";
import type { Snapshot } from "../../generated/types";
import type {
  BrowserCommands,
  BrowserStorage,
} from "../../src/BrowserController";
import type { SplitLayout } from "../../src/splitLayout";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { animations, resetAnimations, TestValue, TestAnimation } = await import(
  "../chromeTestHarness"
);
const listeners = new Set<(value: unknown) => void>();
mock.module("react-native", () => ({
  Easing: { bezier: () => () => 0 },
  Animated: {
    Value: TestValue,
    timing: (
      value: InstanceType<typeof TestValue>,
      config: Record<string, unknown>
    ) => new TestAnimation(value, config),
    parallel: (children: InstanceType<typeof TestAnimation>[]) =>
      new TestAnimation(undefined, {}, children),
  },
  NativeEventEmitter: class {
    addListener(_name: string, fn: (v: unknown) => void) {
      listeners.add(fn);
      return { remove: () => listeners.delete(fn) };
    }
  },
  AppState: { addEventListener: () => ({ remove() {} }) },
}));
mock.module("../../src/platform", () => ({ platform: {} }));
const { BrowserController } = await import("../../src/BrowserController");
const { useExternalPictureInPicture } = await import(
  "../../src/hooks/useExternalPictureInPicture"
);
const { useExternalPipReturnLayout } = await import(
  "../../src/hooks/useExternalPipReturnLayout"
);
const { useSplitMotion } = await import("../../src/chrome/useChromeMotion");
const defer = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((yes) => (resolve = yes));
  return { promise, resolve };
};
const pair: SplitLayout = {
  first: "a",
  second: "b",
  orientation: "horizontal",
  ratio: 0.63,
};
const original: Snapshot = {
  version: 1,
  revision: 0,
  workspaces: [
    { id: "w", name: "Default" },
    { id: "other", name: "Other" },
  ],
  activeWorkspaceId: "w",
  activeTabId: "a",
  keyBindings: [],
  tabs: ["a", "b", "c"].map((id) => ({
    id,
    workspaceId: "w",
    url: `https://${id}.example`,
    title: id,
  })),
};
async function fixture(
  layout: SplitLayout = pair,
  lateInitialRead = false,
  idleBeforeCommit = false
) {
  const initialRead = defer<string>();
  let current = structuredClone(original),
    local = { layout: layout as SplitLayout | null, focus: "b" };
  let setLocal!: React.Dispatch<React.SetStateAction<typeof local>>;
  let seq = 1,
    returning = false,
    departing = true;
  const mounted = new Set<string>(),
    calls: string[] = [],
    acks: number[] = [];
  const commits: string[][] = [];
  const preparations: Array<{
    after: string | null;
    mounted: string[];
    gate: ReturnType<typeof defer<void>>;
  }> = [];
  const state = (extra = {}) => ({
    supported: true,
    allowed: true,
    active: false,
    transitioning: false,
    tabId: null,
    sequence: ++seq,
    ...extra,
  });
  const emit = (s: unknown) => listeners.forEach((fn) => fn(s));
  const commands = new Proxy({} as BrowserCommands, {
    get(_t, name) {
      if (name === "ready") return async () => {};
      if (name === "browserSnapshot") return async () => current;
      if (name === "tabActivate")
        return async ({ tabId }: { tabId: string }) => {
          calls.push(tabId);
          current = {
            ...current,
            activeTabId: tabId,
            revision: current.revision + 1,
          };
          return current;
        };
      throw Error(`Unexpected command ${String(name)}`);
    },
  });
  const storage: BrowserStorage = {
    readSnapshot: async () => null,
    saveSnapshot: async () => {},
    reconcileTabs() {},
    configureKeys() {},
    prepareTabTransition: async (_previous, _next, after) => {
      if (!departing && !returning) return;
      const gate = defer<void>();
      preparations.push({ after, mounted: [...mounted], gate });
      if (!returning) {
        if (lateInitialRead) {
          initialRead.resolve(JSON.stringify(state()));
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        emit(state({ transitioning: true, tabId: "b" }));
      }
      await gate.promise;
    },
  };
  const controller = new BrowserController(commands, storage);
  await controller.initialize();
  const runtime = {
    getExternalPictureInPictureState: async () =>
      lateInitialRead ? initialRead.promise : JSON.stringify(state()),
    configureExternalPictureInPicture() {},
    acknowledgeExternalPictureInPictureReturn(token: number) {
      acks.push(token);
      emit(state());
    },
  };
  let lastReturn!: ReturnType<typeof useExternalPipReturnLayout>;
  let lastMotion!: ReturnType<typeof useSplitMotion>;
  function Surface({ id }: { id: string }) {
    React.useLayoutEffect(() => {
      mounted.add(id);
      return () => {
        mounted.delete(id);
      };
    }, [id]);
    return <span>{id}</span>;
  }
  function AppReturnPresentation() {
    const snapshot = React.useSyncExternalStore(
      controller.subscribe,
      controller.getSnapshot
    )!;
    const [presentation, update] = React.useState(local);
    setLocal = update;
    local = presentation;
    const layoutRef = React.useRef(presentation.layout),
      workspaceRef = React.useRef<string | undefined>(
        snapshot.activeWorkspaceId
      );
    React.useLayoutEffect(() => {
      layoutRef.current = presentation.layout;
      workspaceRef.current = snapshot.activeWorkspaceId;
    });
    lastReturn = useExternalPipReturnLayout({
      controller,
      layoutRef,
      workspaceRef,
      setSplitLayout: (next) => {
        if (idleBeforeCommit && returning && next) emit(state());
        update((old) => ({ ...old, layout: next }));
      },
      setFocused: (focus) => update((old) => ({ ...old, focus: focus ?? "" })),
    });
    const restoreToken = lastReturn.settleTokenFor?.(
      presentation.layout,
      snapshot.activeWorkspaceId
    );
    lastMotion = useSplitMotion(
      presentation.layout,
      snapshot.activeWorkspaceId ?? "",
      presentation.focus,
      false,
      restoreToken
    );
    React.useLayoutEffect(() => {
      lastReturn.didCommitSplit?.(
        presentation.layout,
        snapshot.activeWorkspaceId,
        restoreToken
      );
    });
    useExternalPictureInPicture({
      runtime,
      enabled: true,
      blocked: false,
      visibleTabIds: presentation.layout
        ? [presentation.layout.first, presentation.layout.second]
        : [snapshot.activeTabId ?? undefined],
      onState: lastReturn.observeNative,
      onReturn: lastReturn.onReturn,
    });
    const ids = presentation.layout
      ? [presentation.layout.first, presentation.layout.second]
      : [snapshot.activeTabId!];
    React.useLayoutEffect(() => {
      commits.push(ids);
    });
    return (
      <>
        {ids.map((id) => (
          <Surface key={id} id={id} />
        ))}
      </>
    );
  }
  let root!: ReturnType<typeof create>;
  await act(async () => {
    root = create(<AppReturnPresentation />);
  });
  async function leave(destination = "c") {
    let operation!: Promise<unknown>;
    await act(async () => {
      operation = controller
        .activate(destination, [destination])
        .then(() => setLocal({ layout: null, focus: destination }));
    });
    assert.deepEqual(
      [...mounted],
      [layout.first, layout.second],
      "native claim has not finished, so outgoing hosts must remain"
    );
    await act(async () => {
      preparations.at(-1)!.gate.resolve();
      await operation;
      emit(state({ active: true, tabId: "b" }));
    });
    assert.deepEqual([...mounted], [destination]);
    departing = false;
  }
  async function requestReturn() {
    commits.length = 0;
    resetAnimations();
    returning = true;
    await act(async () => {
      emit(state({ returnTabId: "b", returnToken: 20 }));
    });
  }
  async function settle() {
    await act(async () => {
      preparations.at(-1)!.gate.resolve();
    });
  }
  async function change(edit: (s: Snapshot) => Snapshot) {
    await act(async () => {
      await controller.mutate(async () => {
        current = edit(current);
        return current;
      });
    });
  }
  return {
    controller,
    mounted,
    calls,
    acks,
    preparations,
    commits,
    leave,
    requestReturn,
    settle,
    change,
    layout: () => local,
    beginReturn: () => {
      returning = true;
    },
    emit,
    block: () => {
      const gate = defer<Snapshot>();
      const operation = controller.mutate(async () => {
        current = await gate.promise;
        return current;
      });
      return { gate, operation };
    },
    nav: (id: string) => lastReturn.navigationStarted(id),
    show: async (layout: SplitLayout | null, focus: string) => {
      await act(async () => setLocal({ layout, focus }));
    },
    geometry: () => ({
      progress: (lastMotion.progress as unknown as { value: number }).value,
      fraction: (lastMotion.firstFraction as unknown as { value: number })
        .value,
      animations: animations.length,
    }),
    dispose: async () => {
      await act(async () => root.unmount());
      await controller.flush();
    },
  };
}
const cases: Record<string, () => Promise<void>> = {
  "right-pane-roundtrip": async () => {
    const f = await fixture();
    await f.leave();
    await f.requestReturn();
    assert.deepEqual(f.preparations.at(-1)!.mounted, ["c"]);
    assert.equal(
      f.preparations.at(-1)!.after,
      '["a","b"]',
      "OS Expand must restore exact original pair before mounting it"
    );
    assert.deepEqual(
      f.acks,
      [],
      "do not ACK while native preparation remains pending"
    );
    await f.settle();
    assert.deepEqual(f.layout(), { layout: pair, focus: "b" });
    assert.ok(
      !f.commits.some((ids) => ids.length === 1 && ids[0] === "b"),
      "no transient full-width source commit before the pair"
    );
    assert.deepEqual([...f.mounted], ["a", "b"]);
    assert.deepEqual(f.acks, [20]);
    await f.dispose();
  },
  "unhydrated-no-restoration": async () => {
    const controller = new BrowserController(
      {} as BrowserCommands,
      {} as BrowserStorage
    );
    function EmptyApp() {
      const layoutRef = React.useRef<SplitLayout | null>(null);
      const workspaceRef = React.useRef<string | undefined>(undefined);
      const restore = useExternalPipReturnLayout({
        controller,
        layoutRef,
        workspaceRef,
        setSplitLayout() {},
        setFocused() {},
      });
      const token = restore.settleTokenFor(null, undefined);
      React.useLayoutEffect(() =>
        restore.didCommitSplit(null, undefined, token)
      );
      return null;
    }
    let root!: ReturnType<typeof create>;
    await act(async () => {
      root = create(
        <React.StrictMode>
          <EmptyApp />
        </React.StrictMode>
      );
    });
    await act(async () => root.unmount());
  },
  "restore-geometry-immediately": async () => {
    const f = await fixture();
    await f.leave();
    await f.requestReturn();
    await f.settle();
    assert.deepEqual(
      f.geometry(),
      { progress: 1, fraction: pair.ratio, animations: 0 },
      "OS return must not reopen the right pane from zero width"
    );
    await f.dispose();
  },
  "idle-before-commit": async () => {
    const f = await fixture(pair, false, true);
    await f.leave();
    await f.requestReturn();
    await f.settle();
    assert.deepEqual(
      f.geometry(),
      { progress: 1, fraction: pair.ratio, animations: 0 },
      "native idle/ACK cannot erase the pending React geometry restoration"
    );
    await f.dispose();
  },
  "restoration-consumed": async () => {
    const f = await fixture();
    await f.leave();
    await f.requestReturn();
    await f.settle();
    assert.equal(f.geometry().fraction, pair.ratio);
    await f.show(null, "c");
    resetAnimations();
    await f.show({ ...pair }, "b");
    assert.ok(
      f.geometry().animations > 0,
      "later ordinary split opening must still animate"
    );
    await f.dispose();
  },
  "queued-new-split-wins": async () => {
    const f = await fixture();
    await f.leave();
    let block!: ReturnType<typeof f.block>;
    await act(async () => {
      block = f.block();
    });
    await f.requestReturn();
    const replacement: SplitLayout = {
      first: "c",
      second: "a",
      ratio: 0.4,
      orientation: "vertical",
    };
    await f.show(replacement, "a");
    await act(async () => {
      block.gate.resolve({ ...f.controller.getSnapshot()! });
      await block.operation;
    });
    assert.deepEqual(
      f.calls,
      ["c"],
      "a queued old return must yield to a newer committed split"
    );
    assert.deepEqual(f.layout(), { layout: replacement, focus: "a" });
    assert.ok(f.geometry().animations > 0);
    await f.dispose();
  },
  "same-active-departure": async () => {
    const f = await fixture();
    await f.leave("a");
    await f.requestReturn();
    assert.equal(f.preparations.at(-1)!.after, '["a","b"]');
    await f.settle();
    assert.deepEqual(f.layout(), { layout: pair, focus: "b" });
    assert.deepEqual(f.calls, ["a", "b"]);
    await f.dispose();
  },
  "query-during-preparation": async () => {
    const f = await fixture(pair, true);
    await f.leave();
    await f.requestReturn();
    assert.equal(
      f.preparations.at(-1)!.after,
      '["a","b"]',
      "an idle query during video measurement must not discard departure layout"
    );
    await f.settle();
    assert.deepEqual(f.layout(), { layout: pair, focus: "b" });
    await f.dispose();
  },
  "vertical-order-ratio": async () => {
    const layout: SplitLayout = {
      first: "b",
      second: "a",
      orientation: "vertical",
      ratio: 0.29,
    };
    const f = await fixture(layout);
    await f.leave();
    await f.requestReturn();
    await f.settle();
    assert.deepEqual(f.layout(), { layout, focus: "b" });
    assert.deepEqual([...f.mounted], ["b", "a"]);
    await f.dispose();
  },
  "partner-closed": async () => {
    const f = await fixture();
    await f.leave();
    await f.change((s) => ({ ...s, tabs: s.tabs.filter((t) => t.id !== "a") }));
    await f.requestReturn();
    await f.settle();
    assert.deepEqual(f.layout(), { layout: null, focus: "b" });
    await f.dispose();
  },
  "partner-close-reopen": async () => {
    const f = await fixture();
    await f.leave();
    const a = original.tabs[0];
    await f.change((s) => ({ ...s, tabs: s.tabs.filter((t) => t.id !== "a") }));
    await f.change((s) => ({ ...s, tabs: [...s.tabs, a] }));
    await f.requestReturn();
    await f.settle();
    assert.equal(f.layout().layout, null);
    await f.dispose();
  },
  "space-away-and-back": async () => {
    const f = await fixture();
    await f.leave();
    await f.change((s) => ({ ...s, activeWorkspaceId: "other" }));
    await f.change((s) => ({ ...s, activeWorkspaceId: "w" }));
    await f.requestReturn();
    await f.settle();
    assert.equal(f.layout().layout, null);
    await f.dispose();
  },
  "source-reused-before-return": async () => {
    const f = await fixture();
    await f.leave();
    const b = original.tabs[1];
    await f.change((s) => ({ ...s, tabs: s.tabs.filter((t) => t.id !== "b") }));
    await f.change((s) => ({ ...s, tabs: [...s.tabs, b] }));
    await f.requestReturn();
    assert.deepEqual(
      f.calls,
      ["c"],
      "late return must not activate reused source id"
    );
    assert.equal(f.layout().focus, "c");
    assert.deepEqual(f.acks, [20]);
    await f.dispose();
  },
  "queued-source-suspended": async () => {
    const f = await fixture();
    await f.leave();
    let block!: ReturnType<typeof f.block>;
    await act(async () => {
      block = f.block();
    });
    await f.requestReturn();
    await act(async () => {
      block.gate.resolve({
        ...f.controller.getSnapshot()!,
        tabs: f.controller
          .getSnapshot()!
          .tabs.map((t) => (t.id === "b" ? { ...t, suspended: true } : t)),
      });
      await block.operation;
    });
    assert.deepEqual(
      f.calls,
      ["c"],
      "source must be checked when queued activation actually starts"
    );
    assert.equal(f.layout().focus, "c");
    assert.deepEqual(f.acks, [20]);
    await f.dispose();
  },
  "queued-partner-moved": async () => {
    const f = await fixture();
    await f.leave();
    let block!: ReturnType<typeof f.block>;
    await act(async () => {
      block = f.block();
    });
    await f.requestReturn();
    await act(async () => {
      block.gate.resolve({
        ...f.controller.getSnapshot()!,
        tabs: f.controller
          .getSnapshot()!
          .tabs.map((t) => (t.id === "a" ? { ...t, workspaceId: "other" } : t)),
      });
      await block.operation;
    });
    await f.settle();
    assert.equal(f.layout().layout, null);
    assert.equal(f.layout().focus, "b");
    await f.dispose();
  },
  "source-navigation-invalidates": async () => {
    const f = await fixture();
    await f.leave();
    f.nav("b");
    await f.requestReturn();
    assert.deepEqual(f.calls, ["c"]);
    assert.deepEqual(f.acks, [20]);
    await f.dispose();
  },
};
const scenario = process.argv[2];
assert.ok(cases[scenario], scenario);
await cases[scenario]();
console.log(JSON.stringify({ scenario, passed: true }));
