import assert from "node:assert/strict";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { Snapshot } from "../../generated/types";
import type {
  BrowserCommands,
  BrowserStorage,
} from "../../src/BrowserController";
import type { SplitLayout } from "../../src/splitLayout";
import "../chromeTestHarness";

const { BrowserController } = await import("../../src/BrowserController");
const { useSplitMotion } = await import("../../src/chrome/useChromeMotion");
const { liveSplitLayout } = await import("../../src/sidebarModel");

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const pair: SplitLayout = {
  first: "a",
  second: "b",
  orientation: "horizontal",
  ratio: 0.5,
};
const initial: Snapshot = {
  version: 1,
  revision: 0,
  workspaces: [
    { id: "w", name: "Default" },
    { id: "work", name: "Work" },
  ],
  tabs: ["a", "b", "c"].map((id) => ({
    id,
    workspaceId: "w",
    url: `https://${id}.example`,
    title: id,
  })),
  activeWorkspaceId: "w",
  activeTabId: "a",
  keyBindings: [],
  bookmarks: [
    {
      id: "bookmark-c",
      title: "C",
      url: "https://c.example",
      workspaceId: "w",
    },
  ],
};
const selected = (id: string): Snapshot => ({ ...initial, activeTabId: id });

async function fixture(
  layout: SplitLayout | null = pair,
  focus = "a",
  reduced = false
) {
  const domains: Array<ReturnType<typeof deferred<Snapshot>>> = [];
  const preparations: Array<{
    previous: string | null;
    next: string | null;
    after: string | null | undefined;
    mounted: string[];
    gate: ReturnType<typeof deferred<void>>;
  }> = [];
  const mounted = new Set<string>();
  const mounts = new Map<string, number>();
  const lifetime: string[] = [];
  const commands = new Proxy({} as BrowserCommands, {
    get(_target, name) {
      if (name === "ready") return async () => undefined;
      if (name === "browserSnapshot") return async () => initial;
      if (
        name === "tabActivate" ||
        name === "bookmarkOpen" ||
        name === "tabSetWorkspace"
      )
        return () => {
          const gate = deferred<Snapshot>();
          domains.push(gate);
          return gate.promise;
        };
      throw Error(`Unexpected domain command: ${String(name)}`);
    },
  });
  const storage: BrowserStorage = {
    readSnapshot: async () => null,
    saveSnapshot: async () => {},
    reconcileTabs: () => {},
    configureKeys: () => {},
    prepareTabTransition: async (previous, next, after) => {
      const gate = deferred<void>();
      preparations.push({
        previous,
        next,
        after,
        mounted: [...mounted].sort(),
        gate,
      });
      await gate.promise;
      lifetime.push(`prepared:${next}`);
    },
  };
  const controller = new BrowserController(commands, storage);
  await controller.initialize();
  let root!: ReactTestRenderer;
  let show!: (nextLayout: SplitLayout | null, nextFocus: string) => void;
  function Surface({ id }: { id: string }) {
    React.useLayoutEffect(() => {
      mounted.add(id);
      mounts.set(id, (mounts.get(id) ?? 0) + 1);
      lifetime.push(`mount:${id}`);
      return () => {
        mounted.delete(id);
        lifetime.push(`unmount:${id}`);
      };
    }, [id]);
    return null;
  }
  function Presentation() {
    const snapshot = React.useSyncExternalStore(
      controller.subscribe,
      controller.getSnapshot
    )!;
    const [local, setLocal] = React.useState({ layout, focus });
    show = (nextLayout, nextFocus) =>
      setLocal({ layout: nextLayout, focus: nextFocus });
    const valid = liveSplitLayout(
      local.layout,
      snapshot.tabs.filter(
        (tab) => tab.favorite || tab.workspaceId === snapshot.activeWorkspaceId
      )
    );
    const motion = useSplitMotion(
      valid,
      snapshot.activeWorkspaceId,
      local.focus,
      reduced
    );
    const ids = motion.layout
      ? [motion.layout.first, motion.layout.second]
      : [snapshot.activeTabId!];
    return (
      <>
        {ids.map((id) => (
          <Surface key={id} id={id} />
        ))}
      </>
    );
  }
  await act(async () => {
    root = create(<Presentation />);
  });
  return {
    controller,
    domains,
    preparations,
    mounted,
    mounts,
    lifetime,
    show: (nextLayout: SplitLayout | null, nextFocus: string) =>
      show(nextLayout, nextFocus),
    dispose: async () => {
      await act(async () => root.unmount());
      await controller.flush();
    },
  };
}
const flushReact = (operation: () => void) =>
  act(async () => {
    operation();
  });
const ids = (f: Awaited<ReturnType<typeof fixture>>) => [...f.mounted].sort();

async function movePaneToSpace(tabId: "a" | "b") {
  // Reduced motion makes premature layout retirement immediately observable;
  // the Rust result and native claim are independently delayed.
  const f = await fixture(pair, "a", true);
  let pending!: Promise<unknown>;
  await flushReact(() => {
    pending = f.controller.setTabWorkspace(tabId, "work").then((snapshot) => {
      f.show(null, snapshot.activeTabId!);
    });
  });
  assert.deepEqual(ids(f), ["a", "b"]);
  assert.equal(f.preparations.length, 0);
  const moved: Snapshot = {
    ...initial,
    activeWorkspaceId: tabId === "a" ? "work" : "w",
    tabs: initial.tabs.map((tab) =>
      tab.id === tabId ? { ...tab, workspaceId: "work" } : tab
    ),
  };
  await flushReact(() => f.domains[0].resolve(moved));
  assert.equal(
    f.preparations.length,
    1,
    "moving a pane must prepare the final single pane even when active ID is unchanged"
  );
  const claim = f.preparations[0];
  assert.equal(claim.previous, "a");
  assert.equal(claim.next, "a");
  assert.equal(claim.after, '["a"]');
  assert.deepEqual(claim.mounted, ["a", "b"]);
  assert.deepEqual(ids(f), ["a", "b"], "native still needs the outgoing host");
  assert.equal(f.controller.snapshot!.activeWorkspaceId, "w");
  await act(async () => {
    claim.gate.resolve();
    await pending;
  });
  assert.deepEqual(ids(f), ["a"]);
  assert.equal(f.mounts.get("a"), 1, "the surviving session must not remount");
  assert.ok(f.lifetime.indexOf("prepared:a") < f.lifetime.indexOf("unmount:b"));
  assert.equal(f.controller.snapshot!.activeWorkspaceId, moved.activeWorkspaceId);
  await f.dispose();
}

const scenarios: Record<string, () => Promise<void>> = {
  "move-background-pane-space": () => movePaneToSpace("b"),
  "move-active-pane-space": () => movePaneToSpace("a"),
  "replace-pane": async () => {
    const f = await fixture();
    const replacement = { ...pair, first: "c" };
    let pending!: Promise<unknown>;
    await flushReact(() => {
      pending = f.controller
        .activate("c", ["c", "b"])
        .then(() => f.show(replacement, "c"));
    });
    assert.deepEqual(ids(f), ["a", "b"]);
    assert.equal(f.preparations.length, 0);
    await flushReact(() => f.domains[0].resolve(selected("c")));
    assert.deepEqual(f.preparations[0].mounted, ["a", "b"]);
    assert.equal(f.preparations[0].after, '["c","b"]');
    assert.equal(f.controller.snapshot!.activeTabId, "a");
    assert.deepEqual(ids(f), ["a", "b"]);
    await act(async () => {
      f.preparations[0].gate.resolve();
      await pending;
    });
    assert.deepEqual(ids(f), ["b", "c"]);
    assert.equal(f.mounts.get("b"), 1, "the surviving pane must not remount");
    assert.ok(
      f.lifetime.indexOf("prepared:c") < f.lifetime.indexOf("unmount:a")
    );
    await f.dispose();
  },
  "leave-focused-second-pane": async () => {
    const f = await fixture(pair, "b");
    let pending!: Promise<unknown>;
    await flushReact(() => {
      pending = f.controller.activate("c", ["c"]).then(() => f.show(null, "c"));
    });
    await flushReact(() => f.domains[0].resolve(selected("c")));
    assert.deepEqual(f.preparations[0].mounted, ["a", "b"]);
    assert.equal(
      f.preparations[0].previous,
      "a",
      "domain active ID differs from focused b"
    );
    assert.equal(
      f.preparations[0].after,
      '["c"]',
      "native needs the exact next visible set to find outgoing playing b"
    );
    assert.deepEqual(ids(f), ["a", "b"]);
    await act(async () => {
      f.preparations[0].gate.resolve();
      await pending;
    });
    assert.deepEqual(ids(f), ["c"]);
    assert.ok(
      f.lifetime.indexOf("prepared:c") < f.lifetime.indexOf("unmount:b")
    );
    await f.dispose();
  },
  "return-to-second-pane": async () => {
    const f = await fixture(null);
    let pending!: Promise<unknown>;
    await flushReact(() => {
      pending = f.controller
        .activate("a", ["a", "b"])
        .then(() => f.show(pair, "a"));
    });
    await flushReact(() => f.domains[0].resolve(selected("a")));
    assert.equal(
      f.preparations.length,
      1,
      "same active ID must still prepare an explicit pane change"
    );
    assert.equal(f.preparations[0].after, '["a","b"]');
    assert.deepEqual(
      ids(f),
      ["a"],
      "do not mount a leased second pane before native return"
    );
    await act(async () => {
      f.preparations[0].gate.resolve();
      await pending;
    });
    assert.deepEqual(ids(f), ["a", "b"]);
    assert.equal(f.mounts.get("a"), 1);
    assert.equal(f.mounts.get("b"), 1);
    assert.ok(f.lifetime.indexOf("prepared:a") < f.lifetime.indexOf("mount:b"));
    await f.dispose();
  },
  "bookmark-layout": async () => {
    const f = await fixture();
    const resolved: string[] = [];
    let pending!: Promise<unknown>;
    await flushReact(() => {
      pending = f.controller
        .openBookmark("bookmark-c", (snapshot) => {
          resolved.push(snapshot.activeTabId!);
          return [snapshot.activeTabId!, "b"];
        })
        .then((snapshot) =>
          f.show(
            { ...pair, first: snapshot.activeTabId! },
            snapshot.activeTabId!
          )
        );
    });
    assert.deepEqual(
      resolved,
      [],
      "the bookmark's tab identity is unknown before domain completion"
    );
    await flushReact(() => f.domains[0].resolve(selected("c")));
    assert.deepEqual(resolved, ["c"]);
    assert.equal(f.preparations[0].after, '["c","b"]');
    assert.deepEqual(ids(f), ["a", "b"]);
    await act(async () => {
      f.preparations[0].gate.resolve();
      await pending;
    });
    assert.deepEqual(ids(f), ["b", "c"]);
    assert.equal(f.mounts.get("b"), 1);
    await f.dispose();
  },
  "queued-layouts": async () => {
    const f = await fixture();
    let first!: Promise<Snapshot>;
    let second!: Promise<Snapshot>;
    await flushReact(() => {
      first = f.controller.activate("c", ["c", "b"]);
      second = f.controller.activate("b", ["b"]);
    });
    await flushReact(() => f.domains[0].resolve(selected("c")));
    assert.equal(
      f.domains.length,
      1,
      "the second selection must wait for the first preparation"
    );
    assert.equal(f.preparations[0].after, '["c","b"]');
    await act(async () => {
      f.preparations[0].gate.resolve();
      await first;
    });
    await flushReact(() => f.domains[1].resolve(selected("b")));
    assert.equal(f.preparations[1].previous, "c");
    assert.equal(
      f.preparations[1].after,
      '["b"]',
      "queued plans must not overwrite each other"
    );
    assert.equal(f.controller.snapshot!.activeTabId, "c");
    await act(async () => {
      f.preparations[1].gate.resolve();
      await second;
    });
    assert.equal(f.controller.snapshot!.activeTabId, "b");
    await f.dispose();
  },
};
const scenario = process.argv[2];
assert.ok(scenarios[scenario], `Unknown scenario: ${scenario}`);
await scenarios[scenario]();
console.log(JSON.stringify({ scenario, passed: true }));
