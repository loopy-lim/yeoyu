import { expect, test } from "bun:test";
import { History, readPersistedHistory } from "../src/history";

const settleWrites = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

test("a late history retry notifies the UI after merging the recovered entries", async () => {
  let reads = 0;
  const history = new History({
    read: async () => {
      if (++reads === 1) throw new Error("read unavailable");
      return JSON.stringify({
        entries: [{ url: "https://old.example", title: "Old", at: 1 }],
      });
    },
    save: async () => {},
  });
  const visible: string[][] = [];
  const unsubscribe = history.subscribe(() =>
    visible.push(history.entries.map((entry) => entry.url))
  );
  await history.load();
  history.record("https://new.example", "New");
  await settleWrites();
  expect(visible.at(-1)).toEqual([
    "https://new.example",
    "https://old.example",
  ]);
  unsubscribe();
});

test("repeated metadata for the current destination avoids duplicate serialization and saves", async () => {
  const saved: string[] = [];
  const history = new History({
    save: async (json) => {
      saved.push(json);
    },
  });
  expect(history.record("https://a.example", "A")).toBe(true);
  const first = history.entries[0];
  for (let i = 0; i < 5; i++)
    expect(history.record("https://a.example", "A")).toBe(false);
  await settleWrites();
  expect(saved).toHaveLength(1);
  expect(history.entries[0]).toBe(first);
  expect(history.record("https://a.example", "Updated title")).toBe(true);
  expect(history.entries[0].title).toBe("Updated title");
  await settleWrites();
  expect(saved).toHaveLength(2);
  history.record("https://b.example", "B");
  expect(history.record("https://a.example", "Updated title")).toBe(true);
  await settleWrites();
  expect(saved).toHaveLength(4);
});

test("an unchanged destination can retry a failed disk write without changing the visible history", async () => {
  let failing = true;
  let writes = 0;
  const history = new History({
    save: async () => {
      writes++;
      if (failing) throw new Error("disk full");
    },
  });
  history.record("https://a.example", "A");
  await settleWrites();
  expect(history.lastSaveOk).toBe(false);
  const first = history.entries[0];
  failing = false;
  expect(history.record("https://a.example", "A")).toBe(false);
  await settleWrites();
  expect(history.entries[0]).toBe(first);
  expect(writes).toBe(2);
  expect(history.lastSaveOk).toBe(true);
});

test("persisted history normalizes junk and keeps the newest duplicate", () => {
  expect(
    readPersistedHistory(
      JSON.stringify({
        entries: [
          { url: "https://b.example", title: "Newer", at: 30 },
          { url: "https://b.example", title: "Older", at: 10 },
          { url: "https://a.example", title: 42, at: "yesterday" },
          { url: "", title: "Empty", at: 5 },
          { title: "No url" },
          "junk",
        ],
      })
    )
  ).toEqual([
    { url: "https://b.example", title: "Newer", at: 30 },
    { url: "https://a.example", title: "", at: 0 },
  ]);
  expect(readPersistedHistory("not-json")).toEqual([]);
  expect(readPersistedHistory(null)).toEqual([]);
});

test("a record during load merges with persisted history before saving", async () => {
  let releaseRead: () => void = () => {};
  let stored = JSON.stringify({
    entries: [{ url: "https://old.example", title: "Old", at: 1 }],
  });
  const history = new History({
    read: () =>
      new Promise<string | null>((resolve) => {
        releaseRead = () => resolve(stored);
      }),
    save: async (json) => {
      stored = json;
    },
  });
  const loading = history.load();
  history.record("https://new.example", "New");
  releaseRead();
  await loading;
  await settleWrites();
  expect(history.entries.map((entry) => entry.url)).toEqual([
    "https://new.example",
    "https://old.example",
  ]);
  expect(readPersistedHistory(stored).map((entry) => entry.url)).toEqual([
    "https://new.example",
    "https://old.example",
  ]);
});

test("a record retries a failed startup read before replacing persisted history", async () => {
  let reads = 0;
  let stored = JSON.stringify({
    entries: [{ url: "https://old.example", title: "Old", at: 1 }],
  });
  const history = new History({
    read: async () => {
      reads++;
      if (reads === 1) throw new Error("temporary read failure");
      return stored;
    },
    save: async (json) => {
      stored = json;
    },
  });

  const loading = history.load();
  history.record("https://new.example", "New");
  history.record("https://newer.example", "Newer");
  await expect(loading).resolves.toBeUndefined();
  await settleWrites();

  expect(reads).toBe(2);
  expect(readPersistedHistory(stored).map((entry) => entry.url)).toEqual([
    "https://newer.example",
    "https://new.example",
    "https://old.example",
  ]);
});

test("a clear cannot be undone by an older write that finishes later", async () => {
  let releaseFirstSave: () => void = () => {};
  let markFirstSaveStarted: () => void = () => {};
  const firstSaveStarted = new Promise<void>((resolve) => {
    markFirstSaveStarted = resolve;
  });
  let saved = "";
  let writes = 0;
  const history = new History({
    save: async (json) => {
      writes++;
      if (writes === 1) {
        markFirstSaveStarted();
        await new Promise<void>((resolve) => {
          releaseFirstSave = resolve;
        });
      }
      saved = json;
    },
  });

  history.record("https://a.example", "A");
  const clearing = history.clear();
  await firstSaveStarted;

  expect(writes).toBe(1);
  releaseFirstSave();
  await clearing;
  expect(readPersistedHistory(saved)).toEqual([]);
});

test("clear reports whether the wipe reached disk", async () => {
  const failing = new History({
    read: async () => null,
    save: async () => {
      throw new Error("disk full");
    },
  });
  failing.record("https://a.example", "A");
  await expect(failing.clear()).resolves.toBe(false);
  expect(failing.lastSaveOk).toBe(false);
  const working = new History({ read: async () => null, save: async () => {} });
  working.record("https://a.example", "A");
  await expect(working.clear()).resolves.toBe(true);
  expect(working.entries).toEqual([]);
});
