import { expect, test } from "bun:test";
import { TabProgressStore, type TabProgressEvent } from "../src/tabProgress";

function setup() {
  let receive: ((event: TabProgressEvent) => void) | undefined;
  let sources = 0;
  const store = new TabProgressStore((listener) => {
    receive = listener;
    sources++;
    return () => {
      receive = undefined;
      sources--;
    };
  });
  return {
    store,
    emit: (event: TabProgressEvent) => receive?.(event),
    sources: () => sources,
  };
}

test("progress only notifies its own pane and suppresses duplicate values", () => {
  const { store, emit, sources } = setup();
  let aUpdates = 0;
  let bUpdates = 0;
  const offA = store.subscribe("a", () => aUpdates++);
  const offB = store.subscribe("b", () => bUpdates++);
  expect(sources()).toBe(1);
  emit({ tabId: "a", loading: true, progress: 20 });
  const first = store.getSnapshot("a");
  emit({ tabId: "a", loading: true, progress: 20 });
  emit({ tabId: "background", loading: true, progress: 40 });
  expect(aUpdates).toBe(1);
  expect(bUpdates).toBe(0);
  expect(store.getSnapshot("a")).toBe(first);
  expect(first).toEqual({ loading: true, progress: 20 });
  emit({ tabId: "b", loading: false, progress: 100 });
  expect(bUpdates).toBe(1);
  offA();
  emit({ tabId: "a", loading: false, progress: 100 });
  expect(aUpdates).toBe(1);
  offB();
  expect(sources()).toBe(0);
});

test("cached progress survives a pane switch while the cache remains bounded", () => {
  const { store, emit } = setup();
  const offA = store.subscribe("a", () => {});
  emit({ tabId: "a", loading: true, progress: 30 });
  emit({ tabId: "background", loading: true, progress: 45 });
  const offBackground = store.subscribe("background", () => {});
  offA();
  expect(store.getSnapshot("background")).toEqual({
    loading: true,
    progress: 45,
  });
  for (let i = 0; i < 150; i++)
    emit({ tabId: `old-${i}`, loading: false, progress: 100 });
  expect(store.getSnapshot("a")).toBeUndefined();
  expect(store.getSnapshot("background")).toEqual({
    loading: true,
    progress: 45,
  });
  offBackground();
});
