import { mock } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const scenario = process.argv[2];
const listeners = new Map<string, Set<(event: any) => void>>();
const DeviceEventEmitter = {
  addListener(name: string, listener: (event: any) => void) {
    const group = listeners.get(name) ?? new Set();
    listeners.set(name, group);
    group.add(listener);
    return { remove: () => group.delete(listener) };
  },
};
const emit = (name: string, event: unknown) =>
  listeners.get(name)?.forEach((listener) => listener(event));
mock.module("react-native", () => ({
  DeviceEventEmitter,
  AppState: {
    addEventListener: (_: string, listener: (event: any) => void) =>
      DeviceEventEmitter.addListener("AppState", listener),
  },
}));
const reads: Array<{
  scope: string;
  resolve(json: string): void;
  reject(error: Error): void;
}> = [];
const platform =
  scenario === "unsupported"
    ? {}
    : {
        getInputViewport: (scope: string) =>
          new Promise<string>((resolve, reject) =>
            reads.push({ scope, resolve, reject })
          ),
      };
mock.module("../../src/platform", () => ({ platform }));
const { useInputViewport } = await import("../../src/hooks/useInputViewport");
let main = { keyboardInset: 0, visibleHeight: 0 };
let second = { keyboardInset: 0, visibleHeight: 0 };
function Scene({ scope = "tab-b" }: { scope?: string }) {
  main = useInputViewport("main");
  second = useInputViewport(scope);
  return null;
}
const viewport = (
  scope: string,
  keyboardInset: number,
  visibleHeight = 640
) => ({ scope, keyboardInset, visibleHeight });
const event = (scope: string, keyboardInset: number, visibleHeight = 640) =>
  emit(
    "BrowserInputViewportChanged",
    viewport(scope, keyboardInset, visibleHeight)
  );
const answer = (index: number, scope: string, inset: number, height = 640) =>
  reads[index]!.resolve(JSON.stringify(viewport(scope, inset, height)));
const previousError = console.error;
console.error = (...args: unknown[]) => {
  if (!String(args[0]).includes("react-test-renderer is deprecated"))
    previousError(...args);
};
let renderer!: ReactTestRenderer;
try {
  await act(async () => {
    renderer = create(<Scene />);
  });
  if (scenario === "initial") {
    assert.deepEqual(
      reads.map((read) => read.scope),
      ["main", "tab-b"]
    );
    await act(async () => {
      answer(0, "main", 280, 360);
      answer(1, "tab-b", 0);
    });
    assert.equal(
      main.keyboardInset,
      280,
      "query captures the IME opened before this hook mounted"
    );
    assert.equal(main.visibleHeight, 360);
    assert.equal(second.keyboardInset, 0);
  } else if (scenario === "routing") {
    await act(() => event("tab-b", 240));
    assert.equal(second.keyboardInset, 240);
    assert.equal(main.keyboardInset, 0);
    await act(() => event("main", 320));
    assert.equal(main.keyboardInset, 320);
    assert.equal(second.keyboardInset, 240);
  } else if (scenario === "stale") {
    await act(() => event("main", 320, 320));
    await act(async () => answer(0, "main", 0));
    assert.equal(main.keyboardInset, 320);
    assert.equal(main.visibleHeight, 320);
  } else if (scenario === "rotation") {
    await act(() => event("main", 300, 340));
    await act(() => event("main", 180, 220));
    assert.equal(main.keyboardInset, 180);
    assert.equal(main.visibleHeight, 220);
    await act(() => event("main", 0, 400));
    assert.equal(main.keyboardInset, 0);
    assert.equal(main.visibleHeight, 400);
    await act(async () => emit("AppState", "active"));
    assert.deepEqual(
      reads.slice(2).map((read) => read.scope),
      ["main", "tab-b"]
    );
    await act(async () => answer(2, "main", 140, 260));
    assert.equal(main.keyboardInset, 140);
  } else if (scenario === "retarget") {
    await act(() => event("tab-b", 240));
    await act(async () => renderer.update(<Scene scope="tab-c" />));
    assert.equal(
      second.keyboardInset,
      0,
      "a new owner cannot inherit the previous owner's IME"
    );
    await act(async () => answer(1, "tab-b", 360));
    await act(() => event("tab-b", 180));
    assert.equal(second.keyboardInset, 0);
    await act(async () => answer(2, "tab-c", 120));
    assert.equal(second.keyboardInset, 120);
  } else if (scenario === "invalid") {
    await act(() => event("main", 260));
    await act(() => {
      emit("BrowserInputViewportChanged", { keyboardInset: 100 });
      event("other", 330);
      event("main", -1);
      event("main", Infinity);
    });
    assert.equal(main.keyboardInset, 260);
    await act(async () => answer(1, "main", 350));
    assert.equal(
      second.keyboardInset,
      0,
      "native answers must confirm the requested owner"
    );
  } else if (scenario === "cleanup") {
    await act(() => renderer.unmount());
    const before = { ...main };
    await act(async () => answer(0, "main", 400));
    event("main", 280);
    emit("AppState", "active");
    assert.deepEqual(main, before);
    assert.equal(reads.length, 2);
    assert.equal(listeners.get("BrowserInputViewportChanged")?.size, 0);
  } else if (scenario === "unsupported") {
    assert.equal(reads.length, 0);
    assert.equal(main.keyboardInset, 0);
  } else throw new Error(`Unknown input viewport scenario ${scenario}`);
} finally {
  if (renderer && scenario !== "cleanup") await act(() => renderer.unmount());
  console.error = previousError;
}
