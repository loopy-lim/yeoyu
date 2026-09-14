import { afterEach, beforeEach, expect, test } from "bun:test";
import React, { Profiler, StrictMode, Suspense, useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  advanceSidebarWindow,
  type SidebarWindowState,
  shouldApplySidebarWindowChange,
  usePipLayout,
} from "../src/hooks/usePipLayout";

// This hook has no native dependency. Keep it independent of react-native
// module mocks shared by the chrome tests in Bun's process.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface Layout {
  first: string;
  second: string | null;
  target: string;
  split: { ratio: number; orientation: "horizontal" | "vertical" } | null;
}
const split: Layout = {
  first: "a",
  second: "b",
  target: "b",
  split: { ratio: 0.75, orientation: "vertical" },
};
const single = (id: string): Layout => ({
  first: id,
  second: null,
  target: id,
  split: null,
});

let tree: ReactTestRenderer | undefined;
let committed: Layout | undefined;
let commits = 0;
const mounts = new Map<string, number>();
const unmounts = new Map<string, number>();
const never = new Promise<void>(() => {});

function Surface({ id }: { id: string }) {
  useLayoutEffect(() => {
    mounts.set(id, (mounts.get(id) ?? 0) + 1);
    return () => {
      unmounts.set(id, (unmounts.get(id) ?? 0) + 1);
    };
  }, [id]);
  return <span>{id}</span>;
}
function Presentation({
  live,
  retain,
  suspend = false,
}: {
  live: Layout;
  retain: boolean;
  suspend?: boolean;
}) {
  const layout = usePipLayout(live, retain);
  useLayoutEffect(() => {
    committed = layout;
  }, [layout]);
  if (suspend) throw never;
  return (
    <main data-target={layout.target} data-ratio={layout.split?.ratio}>
      <Surface key={layout.first} id={layout.first} />
      {layout.second && <Surface key={layout.second} id={layout.second} />}
    </main>
  );
}
async function render(
  live: Layout,
  retain: boolean,
  options: { strict?: boolean; suspend?: boolean } = {}
) {
  await act(async () => {
    const content = (
      <Profiler id="pip-layout" onRender={() => commits++}>
        <Suspense fallback={<aside>pending</aside>}>
          <Presentation live={live} retain={retain} suspend={options.suspend} />
        </Suspense>
      </Profiler>
    );
    const element = options.strict ? (
      <StrictMode>{content}</StrictMode>
    ) : (
      content
    );
    if (tree) tree.update(element);
    else tree = create(element);
  });
}
const surfaces = () =>
  tree!.root.findAllByType("span").map((node) => node.children[0]);

beforeEach(() => {
  mounts.clear();
  unmounts.clear();
  commits = 0;
  committed = undefined;
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
});

test("normal presentation returns the latest layout in one commit without an extra render", async () => {
  await render(split, false);
  const resized: Layout = {
    ...split,
    target: "a",
    split: { ratio: 0.4, orientation: "horizontal" },
  };
  commits = 0;
  await render(resized, false);
  expect(committed).toBe(resized);
  expect(commits).toBe(1);
  expect(tree!.root.findByType("main").props).toMatchObject({
    "data-target": "a",
    "data-ratio": 0.4,
  });
  expect(mounts).toEqual(
    new Map([
      ["a", 1],
      ["b", 1],
    ])
  );
  expect(unmounts.size).toBe(0);
});

test("the first PiP transition commit preserves both existing surfaces and their original target and split", async () => {
  await render(split, false);
  commits = 0;
  await render(single("new-selection"), true);
  expect(surfaces()).toEqual(["a", "b"]);
  expect(committed).toBe(split);
  expect(commits).toBe(1);
  expect(mounts).toEqual(
    new Map([
      ["a", 1],
      ["b", 1],
    ])
  );
  expect(unmounts.size).toBe(0);
});

test("live changes throughout PiP do not replace the retained surfaces and exit adopts the latest layout immediately", async () => {
  await render(split, false);
  await render(single("c"), true);
  const latest = single("d");
  await render(latest, true);
  expect(surfaces()).toEqual(["a", "b"]);
  expect(mounts.has("c")).toBe(false);
  expect(mounts.has("d")).toBe(false);
  expect(unmounts.size).toBe(0);
  commits = 0;
  await render(latest, false);
  expect(surfaces()).toEqual(["d"]);
  expect(committed).toBe(latest);
  expect(commits).toBe(1);
  expect(unmounts).toEqual(
    new Map([
      ["a", 1],
      ["b", 1],
    ])
  );
});

test("a subsequent PiP entry captures the most recent normal commit rather than an older session", async () => {
  await render(split, false);
  await render(single("c"), true);
  const normal = single("d");
  await render(normal, false);
  await render(single("e"), true);
  expect(committed).toBe(normal);
  expect(surfaces()).toEqual(["d"]);
  expect(mounts.has("e")).toBe(false);
});

test("mounting during PiP uses its initial layout until the first normal presentation is available", async () => {
  await render(split, true);
  await render(single("c"), true);
  expect(surfaces()).toEqual(["a", "b"]);
  expect(committed).toBe(split);
  const latest = single("d");
  await render(latest, false);
  expect(committed).toBe(latest);
  expect(surfaces()).toEqual(["d"]);
});

test("StrictMode retention adds no surface cleanup or mount beyond its initial development probe", async () => {
  await render(split, false, { strict: true });
  const initialMounts = new Map(mounts);
  const initialUnmounts = new Map(unmounts);
  await render(single("c"), true, { strict: true });
  await render(single("d"), true, { strict: true });
  expect(surfaces()).toEqual(["a", "b"]);
  expect(committed).toBe(split);
  expect(mounts).toEqual(initialMounts);
  expect(unmounts).toEqual(initialUnmounts);
});

test("an uncommitted normal render cannot overwrite the layout retained by a later PiP transition", async () => {
  await render(split, false);
  await render(single("speculative"), false, { suspend: true });
  expect(tree!.root.findByType("aside").children).toEqual(["pending"]);
  await render(single("latest-live"), true);
  expect(surfaces()).toEqual(["a", "b"]);
  expect(committed).toBe(split);
  expect(mounts.has("speculative")).toBe(false);
  expect(mounts.has("latest-live")).toBe(false);
});

test.each([
  {
    name: "foreground window becomes compact",
    previousCompact: false,
    nextCompact: true,
    appState: "active",
    pipVisible: false,
    expected: true,
  },
  {
    name: "foreground window becomes wide",
    previousCompact: true,
    nextCompact: false,
    appState: "active",
    pipVisible: false,
    expected: true,
  },
  {
    name: "unchanged wide window preserves a manual sidebar choice",
    previousCompact: false,
    nextCompact: false,
    appState: "active",
    pipVisible: false,
    expected: false,
  },
  {
    name: "unchanged compact window preserves a manual sidebar choice",
    previousCompact: true,
    nextCompact: true,
    appState: "active",
    pipVisible: false,
    expected: false,
  },
  {
    name: "compact transition while PiP is active or entering",
    previousCompact: false,
    nextCompact: true,
    appState: "active",
    pipVisible: true,
    expected: false,
  },
  {
    name: "wide transition while PiP is active or entering",
    previousCompact: true,
    nextCompact: false,
    appState: "active",
    pipVisible: true,
    expected: false,
  },
  {
    name: "background compact transition",
    previousCompact: false,
    nextCompact: true,
    appState: "background",
    pipVisible: false,
    expected: false,
  },
  {
    name: "background wide transition",
    previousCompact: true,
    nextCompact: false,
    appState: "background",
    pipVisible: false,
    expected: false,
  },
  {
    name: "inactive window transition",
    previousCompact: false,
    nextCompact: true,
    appState: "inactive",
    pipVisible: false,
    expected: false,
  },
  {
    name: "initial app state is not yet known",
    previousCompact: false,
    nextCompact: true,
    appState: null,
    pipVisible: false,
    expected: false,
  },
])(
  "responsive sidebar preference write eligibility: $name",
  ({ previousCompact, nextCompact, appState, pipVisible, expected }) => {
    expect(
      shouldApplySidebarWindowChange(
        previousCompact,
        nextCompact,
        appState,
        pipVisible
      )
    ).toBe(expected);
  }
);

function sidebarWindow(initiallyCollapsed = true) {
  let state: SidebarWindowState = {
    acceptedCompact: false,
    recovering: false,
  };
  let input: Parameters<typeof advanceSidebarWindow>[1] = {
    width: 1280,
    appState: "active",
    pipVisible: false,
  };
  let preference = initiallyCollapsed;
  const writes: boolean[] = [];
  return {
    step(next: Partial<typeof input>) {
      input = { ...input, ...next };
      const result = advanceSidebarWindow(state, input);
      state = result.state;
      if (result.collapsed !== undefined) {
        preference = result.collapsed;
        writes.push(result.collapsed);
      }
      return state;
    },
    preference: () => preference,
    writes,
  };
}

test.each([
  {
    name: "return event arrives before Dimensions and restored width",
    restoredWidth: 1280,
    initiallyCollapsed: true,
    steps: [
      { input: { pipVisible: false }, recovering: true },
      { input: { width: 1280 }, recovering: true },
      { input: { restoredWindowWidth: 1280 }, recovering: false },
    ],
  },
  {
    name: "Dimensions arrive before the return event",
    restoredWidth: 1280,
    initiallyCollapsed: true,
    steps: [
      { input: { width: 1280 }, recovering: true },
      {
        input: { pipVisible: false, restoredWindowWidth: 1280 },
        recovering: false,
      },
    ],
  },
  {
    name: "restored width arrives before the return event and Dimensions",
    restoredWidth: 1280,
    initiallyCollapsed: true,
    steps: [
      { input: { restoredWindowWidth: 1280 }, recovering: true },
      { input: { pipVisible: false }, recovering: true },
      { input: { width: 1280 }, recovering: false },
    ],
  },
  {
    name: "rotation returns to a different compact category",
    restoredWidth: 800,
    initiallyCollapsed: false,
    steps: [
      {
        input: { pipVisible: false, restoredWindowWidth: 800 },
        recovering: true,
      },
      { input: { width: 800 }, recovering: false },
    ],
  },
])(
  "PiP sidebar recovery preserves the preference when $name",
  ({ restoredWidth, initiallyCollapsed, steps }) => {
    const window = sidebarWindow(initiallyCollapsed);
    expect(window.step({ width: 360, pipVisible: true }).recovering).toBe(true);
    for (const { input, recovering } of steps) {
      expect(window.step(input).recovering).toBe(recovering);
      expect(window.preference()).toBe(initiallyCollapsed);
      expect(window.writes).toEqual([]);
    }
    expect(window.step({}).acceptedCompact).toBe(restoredWidth < 840);
    // The recovery baseline is synchronized; only a later real resize writes.
    window.step({ width: restoredWidth < 840 ? 1280 : 800 });
    expect(window.writes).toEqual([restoredWidth >= 840]);
  }
);

test("normal window crossings apply in both directions but other renders preserve manual choices", () => {
  const window = sidebarWindow(true);
  window.step({ width: 1100 });
  expect(window.writes).toEqual([]);
  window.step({ width: 800 });
  window.step({ width: 760 });
  window.step({ width: 840 });
  window.step({ width: 1000 });
  expect(window.writes).toEqual([true, false]);
});

test("background and inactive states cannot finish recovery even when geometry already matches", () => {
  const window = sidebarWindow();
  window.step({ width: 360, pipVisible: true, appState: "background" });
  expect(
    window.step({ pipVisible: false, width: 1280, restoredWindowWidth: 1280 })
      .recovering
  ).toBe(true);
  expect(window.step({ appState: "inactive" }).recovering).toBe(true);
  expect(window.step({ appState: null }).recovering).toBe(true);
  expect(window.step({ appState: "active" }).recovering).toBe(false);
  expect(window.writes).toEqual([]);
});

test("recovery requires a valid restored width within half a dp", () => {
  const window = sidebarWindow();
  window.step({ width: 360, pipVisible: true });
  for (const restoredWindowWidth of [undefined, NaN, Infinity, 0, -1]) {
    expect(
      window.step({ pipVisible: false, width: 1280, restoredWindowWidth })
        .recovering
    ).toBe(true);
  }
  expect(window.step({ restoredWindowWidth: 1280.51 }).recovering).toBe(true);
  expect(window.step({ restoredWindowWidth: 1280.5 }).recovering).toBe(false);
  expect(window.writes).toEqual([]);
});

test("a later PiP cycle waits for its own restored geometry", () => {
  const window = sidebarWindow();
  window.step({ pipVisible: true, width: 360 });
  window.step({ pipVisible: false, width: 1280, restoredWindowWidth: 1280 });
  window.step({ pipVisible: true, width: 360, restoredWindowWidth: undefined });
  expect(window.step({ pipVisible: false, width: 800 }).recovering).toBe(true);
  expect(window.step({ restoredWindowWidth: 800 })).toEqual({
    acceptedCompact: true,
    recovering: false,
  });
  expect(window.writes).toEqual([]);
});
