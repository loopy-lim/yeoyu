import { expect, mock, test } from "bun:test";
import { ReducedMotionStore } from "../src/chrome/reducedMotionStore";

function setup() {
  const readers: Array<(enabled: boolean) => void> = [];
  const listeners = new Set<(enabled: boolean) => void>();
  const unsubscribe = mock(() => {});
  const subscribe = mock((listener: (enabled: boolean) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      unsubscribe();
    };
  });
  const store = new ReducedMotionStore({
    read: () => new Promise<boolean>((resolve) => readers.push(resolve)),
    subscribe,
  });
  return {
    store,
    readers,
    subscribe,
    unsubscribe,
    emit: (enabled: boolean) =>
      listeners.forEach((listener) => listener(enabled)),
  };
}

test("all consumers share one OS subscription and release it after the last unmount", async () => {
  const h = setup();
  expect(h.store.getSnapshot()).toBe(true);
  const first = mock(() => {});
  const second = mock(() => {});
  const offFirst = h.store.subscribe(first);
  const offSecond = h.store.subscribe(second);
  expect(h.subscribe).toHaveBeenCalledTimes(1);
  h.readers[0](false);
  await Promise.resolve();
  expect(h.store.getSnapshot()).toBe(false);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  offFirst();
  expect(h.unsubscribe).not.toHaveBeenCalled();
  h.emit(true);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(2);
  offSecond();
  expect(h.unsubscribe).toHaveBeenCalledTimes(1);
});

test("an older initial OS query cannot override a live preference change", async () => {
  const h = setup();
  const off = h.store.subscribe(() => {});
  h.emit(true);
  h.readers[0](false);
  await Promise.resolve();
  expect(h.store.getSnapshot()).toBe(true);
  h.emit(false);
  expect(h.store.getSnapshot()).toBe(false);
  off();
});

test("a resolved query from an unmounted subscription cannot change a new subscription", async () => {
  const h = setup();
  const off = h.store.subscribe(() => {});
  off();
  const offNew = h.store.subscribe(() => {});
  h.readers[1](true);
  await Promise.resolve();
  h.readers[0](false);
  await Promise.resolve();
  expect(h.store.getSnapshot()).toBe(true);
  offNew();
});

test("query failure keeps motion reduced while live OS changes remain available", async () => {
  let emit: (enabled: boolean) => void = () => {};
  const store = new ReducedMotionStore({
    read: () => Promise.reject(new Error("native unavailable")),
    subscribe: (listener) => {
      emit = listener;
      return () => {};
    },
  });
  const off = store.subscribe(() => {});
  await Promise.resolve();
  expect(store.getSnapshot()).toBe(true);
  emit(false);
  expect(store.getSnapshot()).toBe(false);
  off();
});
