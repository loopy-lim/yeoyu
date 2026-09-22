import { expect, test } from "bun:test";
import { FrameCoalescer } from "../src/chrome/FrameCoalescer";

function scheduler() {
  let next = 0;
  const pending = new Map<number, () => void>();
  const all = new Map<number, () => void>();
  return {
    request: (callback: () => void) => { const id = ++next; pending.set(id, callback); all.set(id, callback); return id; },
    cancel: (id: number) => { pending.delete(id); },
    count: () => pending.size,
    latest: () => next,
    fire: (id: number) => { pending.delete(id); all.get(id)!(); },
  };
}

test("a burst keeps only its latest sample and schedules at most one frame", () => {
  const clock = scheduler(), values: number[] = [];
  const frames = new FrameCoalescer<number>((value) => values.push(value), clock);
  for (let value = 0; value < 1000; value++) frames.push(value);
  expect(clock.count()).toBe(1);
  expect(values).toEqual([]);
  clock.fire(1);
  expect(values).toEqual([999]);
  frames.push(1000);
  expect(clock.count()).toBe(1);
  clock.fire(2);
  expect(values).toEqual([999, 1000]);
});

test("release flushes its exact final position and invalidates the queued frame", () => {
  const clock = scheduler(), values: number[] = [];
  const frames = new FrameCoalescer<number>((value) => values.push(value), clock);
  frames.push(20);
  frames.flush(27);
  expect(values).toEqual([27]);
  expect(clock.count()).toBe(0);
  clock.fire(1); // A host may deliver a callback after cancellation.
  expect(values).toEqual([27]);
  frames.flush();
  expect(values).toEqual([27]);
});

test("cancel prevents an old ownership callback from consuming the next gesture", () => {
  const clock = scheduler(), values: string[] = [];
  const frames = new FrameCoalescer<string>((value) => values.push(value), clock);
  frames.push("old drag");
  frames.cancel();
  frames.push("new drag");
  clock.fire(1);
  expect(values).toEqual([]);
  expect(clock.count()).toBe(1);
  clock.fire(2);
  expect(values).toEqual(["new drag"]);
});

test("a stable coalescer consumes pending samples using the latest committed callback", () => {
  const clock = scheduler(), values: string[] = [];
  const frames = new FrameCoalescer<number>((value) => values.push(`old:${value}`), clock);
  frames.push(42);
  frames.setConsumer((value) => values.push(`current:${value}`));
  clock.fire(1);
  expect(values).toEqual(["current:42"]);
});

test("a consumer may queue another sample without losing it", () => {
  const clock = scheduler(), values: number[] = [];
  const frames = new FrameCoalescer<number>((value) => {
    values.push(value);
    if (value === 1) frames.push(2);
  }, clock);
  frames.push(1);
  clock.fire(1);
  expect(clock.count()).toBe(1);
  clock.fire(2);
  expect(values).toEqual([1, 2]);
});

test("flush without a final override emits the pending sample, including undefined", () => {
  const clock = scheduler(), values: Array<number | undefined> = [];
  const frames = new FrameCoalescer<number | undefined>((value) => values.push(value), clock);
  frames.push(1);
  frames.flush();
  frames.flush(undefined);
  expect(values).toEqual([1, undefined]);
});
