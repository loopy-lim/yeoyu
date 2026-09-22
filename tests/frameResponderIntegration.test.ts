import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@babel/parser";
import { FrameCoalescer } from "../src/chrome/FrameCoalescer";
import { clampSplitRatio, type SplitLayout } from "../src/splitLayout";

// Execute App's actual responder/consumer expressions with a delayed React
// state-update queue. This covers JS ordering; native PanResponder is not simulated.
const source = readFileSync(resolve(import.meta.dir, "../src/App.tsx"), "utf8");
const tree = parse(source, {
  sourceType: "module",
  plugins: ["typescript", "jsx"],
});
const declarations = new Map<string, string>();
let dividerEffect = "";
function visit(node: unknown) {
  if (!node || typeof node !== "object") return;
  const entry = node as Record<string, unknown>;
  if (entry.type === "VariableDeclarator") {
    const id = entry.id as { name?: string };
    const init = entry.init as { start: number; end: number } | null;
    if (
      id.name &&
      init &&
      ["sameSplit", "dividerPanResponder", "renderDrag", "finishDrag"].includes(
        id.name
      )
    )
      declarations.set(id.name, source.slice(init.start, init.end));
  }
  if (
    entry.type === "CallExpression" &&
    (entry.callee as { name?: string }).name === "useLayoutEffect"
  ) {
    const args = entry.arguments as Array<{ start: number; end: number }>;
    const body = source.slice(args[0]!.start, args[0]!.end);
    if (body.includes("dividerFrames.setConsumer")) dividerEffect = body;
  }
  for (const value of Object.values(entry)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") visit(value);
  }
}
visit(tree);
const transpiler = new Bun.Transpiler({ loader: "tsx" });
function expression(
  text: string | undefined,
  environment: Record<string, unknown>
): any {
  if (!text) throw new Error("App integration expression was not found");
  const javascript = transpiler
    .transformSync(`export const extracted = (${text});`)
    .replace(/^export /m, "");
  return new Function(
    ...Object.keys(environment),
    `${javascript}\nreturn extracted;`
  )(...Object.values(environment));
}

function divider() {
  const initial: SplitLayout = {
    first: "favorite-a",
    second: "favorite-b",
    orientation: "horizontal",
    ratio: 0.5,
  };
  let layout: SplitLayout | null = initial;
  let sequence = 0;
  const frames = new Map<number, () => void>();
  const dividerFrames = new FrameCoalescer<{
    owner: SplitLayout;
    ratio: number;
  }>(() => {}, {
    request: (callback) => {
      frames.set(++sequence, callback);
      return sequence;
    },
    cancel: (handle) => {
      frames.delete(handle);
    },
  });
  const owner = { current: null as SplitLayout | null };
  const valid = { current: initial as SplitLayout | null };
  const updates: Array<(value: SplitLayout | null) => SplitLayout | null> = [];
  let finishActivation: () => void = () => {};
  let activation = Promise.resolve();
  const environment = {
    useMemo: (create: () => unknown) => create(),
    PanResponder: { create: (handlers: unknown) => handlers },
    sameSplit: expression(declarations.get("sameSplit"), {}),
    dividerFrames,
    dividerOwner: owner,
    validSplitRef: valid,
    paneBounds: { current: { x: 0, y: 0, width: 1000, height: 600 } },
    clampSplitRatio,
    measurePanes: () => {},
    setFocused: () => {},
    setSplitLayout: (
      update: (value: SplitLayout | null) => SplitLayout | null
    ) => updates.push(update),
    controller: {
      activate: () =>
        new Promise<void>((resolve) => {
          finishActivation = resolve;
        }),
    },
    run: (operation: Promise<void>) => {
      activation = operation;
    },
  };
  expression(dividerEffect, environment)();
  const handlers = expression(
    declarations.get("dividerPanResponder"),
    environment
  );
  return {
    handlers,
    owner,
    setLayout: (value: SplitLayout | null) => {
      layout = value;
      valid.current = value;
    },
    current: () => layout,
    pending: () => frames.size,
    frame: () => {
      const work = [...frames.values()];
      frames.clear();
      work.forEach((callback) => callback());
    },
    commit: () => {
      while (updates.length) layout = updates.shift()!(layout);
      valid.current = layout;
    },
    resolveActivation: async () => {
      finishActivation();
      await activation;
    },
  };
}
const at = (pageX: number) => ({ nativeEvent: { pageX, pageY: 300 } });

test("divider release retains exact final ratio after the gesture owner is cleared", () => {
  const value = divider();
  value.handlers.onPanResponderGrant();
  value.handlers.onPanResponderMove(at(350));
  value.handlers.onPanResponderRelease(at(680));
  expect(value.owner.current).toBeNull();
  expect(value.pending()).toBe(0);
  value.commit(); // React runs the updater after release clears the owner.
  expect(value.current()?.ratio).toBe(0.68);
});

test("pending divider samples do not modify a replacement pair", () => {
  const value = divider();
  value.handlers.onPanResponderGrant();
  value.handlers.onPanResponderMove(at(350));
  const replacement = {
    ...value.current()!,
    second: "different-tab",
    ratio: 0.6,
  };
  value.setLayout(replacement);
  value.frame();
  value.commit();
  expect(value.current()).toBe(replacement);
});

test("edge-release activation cannot collapse a replacement split with the same favorite tabs", async () => {
  const value = divider();
  value.handlers.onPanResponderGrant();
  value.handlers.onPanResponderRelease(at(50));
  const replacement = { ...value.current()!, ratio: 0.7 };
  value.setLayout(replacement); // e.g. the same favorites reopened in another Space.
  await value.resolveActivation();
  value.commit();
  expect(value.current()).toBe(replacement);
});

test("edge release captures the latest layout, even after a ratio update replaced the grant object", async () => {
  const value = divider();
  value.handlers.onPanResponderGrant();
  value.setLayout({ ...value.current()!, ratio: 0.63 });
  value.handlers.onPanResponderRelease(at(950));
  await value.resolveActivation();
  value.commit();
  expect(value.current()).toBeNull();
});

test("drag release renders its final sample before releasing the synchronous lifecycle", () => {
  const points: Array<{ x: number; y: number }> = [];
  const updates: Array<(value: { zone: null; reorderIndex: null }) => unknown> =
    [];
  const consumer = expression(declarations.get("renderDrag"), {
    ghostPosition: {
      setValue: (point: { x: number; y: number }) => points.push(point),
    },
    ghostCenter: (x: number, y: number) => ({ x, y }),
    paneBounds: { current: null },
    setDrag: (update: (value: { zone: null; reorderIndex: null }) => unknown) =>
      updates.push(update),
    sidebarDropActive: { current: false },
  });
  const frames = new FrameCoalescer<{ x: number; y: number }>(consumer, {
    request: () => 1,
    cancel: () => {},
  });
  let released = false;
  const finish = expression(declarations.get("finishDrag"), {
    dragFrames: frames,
    dragLifecycle: {
      release: () => {
        expect(points.at(-1)).toEqual({ x: 64, y: 80 });
        released = true;
        return null;
      },
    },
  });
  frames.push({ x: 20, y: 30 });
  finish(64, 80);
  expect(released).toBe(true);
  expect(points).toEqual([{ x: 64, y: 80 }]);
  expect(updates).toHaveLength(1);
});
