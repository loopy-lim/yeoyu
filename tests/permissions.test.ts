import { expect, test } from "bun:test";
import {
  permissionKindsFromEvent,
  readPersistedPermissions,
  SitePermissions,
} from "../src/permissions";

test("persisted rules sanitize: junk entries drop, duplicates keep the newest", () => {
  expect(
    readPersistedPermissions(
      JSON.stringify({
        originFormat: 2,
        rules: [
          {
            origin: "https://b.example",
            kind: "camera",
            decision: "block",
            at: 2,
          },
          {
            origin: "https://a.example",
            kind: "geolocation",
            decision: "allow",
            at: 3,
          },
          {
            origin: "https://a.example",
            kind: "geolocation",
            decision: "block",
            at: 1,
          },
          { origin: "", kind: "camera", decision: "allow", at: 1 },
          {
            origin: "https://a.example",
            kind: "made-up",
            decision: "allow",
            at: 1,
          },
          {
            origin: "https://a.example",
            kind: "camera",
            decision: "sometimes",
            at: 1,
          },
          { origin: 42, kind: "camera", decision: "allow", at: 1 },
          "junk",
        ],
      })
    )
  ).toEqual([
    { origin: "https://b.example", kind: "camera", decision: "block", at: 2 },
    {
      origin: "https://a.example",
      kind: "geolocation",
      decision: "allow",
      at: 3,
    },
  ]);
  expect(readPersistedPermissions("not-json")).toEqual([]);
  expect(readPersistedPermissions(null)).toEqual([]);
  expect(readPersistedPermissions(JSON.stringify({ rules: "junk" }))).toEqual(
    []
  );
});

test("a combined media event yields only known kinds", () => {
  expect(permissionKindsFromEvent("camera,microphone")).toEqual([
    "camera",
    "microphone",
  ]);
  expect(permissionKindsFromEvent("camera,bogus")).toEqual(["camera"]);
  expect(permissionKindsFromEvent("")).toEqual([]);
});

test("decide stores per origin+kind and persists through the adapter", async () => {
  let saved = "";
  const store = new SitePermissions({
    readSitePermissions: async () => null,
    saveSitePermissions: async (json) => {
      saved = json;
    },
  });
  await store.decide("https://a.example", "camera", "allow");
  expect(store.decisionFor("https://a.example", "camera")).toBe("allow");
  expect(store.decisionFor("https://b.example", "camera")).toBeNull();
  expect(store.decisionFor("https://a.example", "microphone")).toBeNull();
  expect(JSON.parse(saved).rules).toEqual([
    expect.objectContaining({
      origin: "https://a.example",
      kind: "camera",
      decision: "allow",
    }),
  ]);
  await store.decide("https://a.example", "camera", "block");
  expect(store.decisionFor("https://a.example", "camera")).toBe("block");
  expect(JSON.parse(saved).rules).toHaveLength(1);
});

test("revoke and clearAll remove rules and persist", async () => {
  let saved = "";
  const store = new SitePermissions({
    readSitePermissions: async () =>
      JSON.stringify({
        originFormat: 2,
        rules: [
          {
            origin: "https://a.example",
            kind: "camera",
            decision: "allow",
            at: 1,
          },
          {
            origin: "https://a.example",
            kind: "microphone",
            decision: "allow",
            at: 1,
          },
        ],
      }),
    saveSitePermissions: async (json) => {
      saved = json;
    },
  });
  await store.revoke("https://a.example", "camera");
  expect(store.decisionFor("https://a.example", "camera")).toBeNull();
  expect(store.decisionFor("https://a.example", "microphone")).toBe("allow");
  await store.clearAll();
  expect(store.all()).toEqual([]);
  expect(JSON.parse(saved).rules).toEqual([]);
});

test("permission mutations wait for durable storage", async () => {
  let releaseSave: () => void = () => {};
  let markSaveStarted: () => void = () => {};
  const saveStarted = new Promise<void>((resolve) => {
    markSaveStarted = resolve;
  });
  let settled = false;
  const store = new SitePermissions({
    readSitePermissions: async () => null,
    saveSitePermissions: () =>
      new Promise<void>((resolve) => {
        markSaveStarted();
        releaseSave = resolve;
      }),
  });

  const deciding = store.decide("https://a.example", "camera", "allow");
  void deciding.then(() => {
    settled = true;
  });
  await saveStarted;
  await Promise.resolve();

  expect(settled).toBe(false);
  releaseSave();
  await deciding;
  expect(settled).toBe(true);
});

test("permission mutations report storage failures", async () => {
  const store = new SitePermissions({
    readSitePermissions: async () => null,
    saveSitePermissions: async () => {
      throw new Error("disk full");
    },
  });

  await expect(
    store.decide("https://a.example", "camera", "allow")
  ).rejects.toThrow("disk full");
  await expect(store.revoke("https://a.example", "camera")).rejects.toThrow(
    "disk full"
  );
  await expect(store.clearAll()).rejects.toThrow("disk full");
});

test("failed permission saves leave the visible rules unchanged", async () => {
  const failingSave = async () => {
    throw new Error("disk full");
  };
  const emptyStore = new SitePermissions({
    readSitePermissions: async () => null,
    saveSitePermissions: failingSave,
  });
  await expect(
    emptyStore.decide("https://a.example", "camera", "allow")
  ).rejects.toThrow("disk full");
  expect(emptyStore.decisionFor("https://a.example", "camera")).toBeNull();

  const persisted = JSON.stringify({
    originFormat: 2,
    rules: [
      {
        origin: "https://a.example",
        kind: "camera",
        decision: "allow",
        at: 1,
      },
    ],
  });
  const revokeStore = new SitePermissions({
    readSitePermissions: async () => persisted,
    saveSitePermissions: failingSave,
  });
  await expect(
    revokeStore.revoke("https://a.example", "camera")
  ).rejects.toThrow("disk full");
  expect(revokeStore.decisionFor("https://a.example", "camera")).toBe("allow");

  const clearStore = new SitePermissions({
    readSitePermissions: async () => persisted,
    saveSitePermissions: failingSave,
  });
  await expect(clearStore.clearAll()).rejects.toThrow("disk full");
  expect(clearStore.decisionFor("https://a.example", "camera")).toBe("allow");
});

test("a failed permission read blocks writes and remains retryable", async () => {
  let reads = 0;
  let saved = "";
  const store = new SitePermissions({
    readSitePermissions: async () => {
      reads++;
      if (reads === 1) throw new Error("temporary read failure");
      return JSON.stringify({
        originFormat: 2,
        rules: [
          {
            origin: "https://old.example",
            kind: "camera",
            decision: "block",
            at: 1,
          },
        ],
      });
    },
    saveSitePermissions: async (json) => {
      saved = json;
    },
  });

  await expect(
    store.decide("https://new.example", "camera", "allow")
  ).rejects.toThrow("temporary read failure");
  expect(saved).toBe("");

  await store.decide("https://new.example", "camera", "allow");
  expect(reads).toBe(2);
  expect(
    JSON.parse(saved).rules.map((rule: { origin: string }) => rule.origin)
  ).toEqual(["https://new.example", "https://old.example"]);
});

test("a revoke cannot be undone by an older write that finishes later", async () => {
  let releaseFirstSave: () => void = () => {};
  let markFirstSaveStarted: () => void = () => {};
  const firstSaveStarted = new Promise<void>((resolve) => {
    markFirstSaveStarted = resolve;
  });
  let saved = "";
  let writes = 0;
  const storage = {
    readSitePermissions: async () => null,
    saveSitePermissions: async (json: string) => {
      writes++;
      if (writes === 1) {
        markFirstSaveStarted();
        await new Promise<void>((resolve) => {
          releaseFirstSave = resolve;
        });
      }
      saved = json;
    },
  };
  const store = new SitePermissions(storage);

  const deciding = store.decide("https://a.example", "camera", "allow");
  const revoking = store.revoke("https://a.example", "camera");
  await firstSaveStarted;
  await Promise.resolve();

  expect(writes).toBe(1);
  releaseFirstSave();
  await Promise.all([deciding, revoking]);
  const restored = new SitePermissions({
    ...storage,
    readSitePermissions: async () => saved,
  });
  await restored.load();
  expect(restored.decisionFor("https://a.example", "camera")).toBeNull();
});

test("a decision made while persisted rules load is not clobbered", async () => {
  let releaseRead: () => void = () => {};
  const stored = JSON.stringify({
    rules: [
      {
        origin: "https://old.example",
        kind: "camera",
        decision: "block",
        at: 1,
      },
    ],
  });
  const store = new SitePermissions({
    readSitePermissions: () =>
      new Promise((resolve) => {
        releaseRead = () => resolve(stored);
      }),
    saveSitePermissions: async () => {},
  });
  const deciding = store.decide("https://new.example", "camera", "allow");
  releaseRead();
  await deciding;
  expect(store.decisionFor("https://new.example", "camera")).toBe("allow");
  expect(store.decisionFor("https://old.example", "camera")).toBe("block");
});

test("optional native storage is safe before a rebuilt binary is installed", async () => {
  const store = new SitePermissions({});
  await expect(store.load()).resolves.toBeUndefined();
  await expect(
    store.decide("https://a.example", "camera", "allow")
  ).resolves.toBeUndefined();
  expect(store.decisionFor("https://a.example", "camera")).toBe("allow");
});

test("legacy grants require confirmation again while existing blocks remain", async () => {
  const store = new SitePermissions({
    readSitePermissions: async () =>
      JSON.stringify({
        rules: [
          {
            origin: "https://example.com",
            kind: "camera",
            decision: "allow",
            at: 1,
          },
          {
            origin: "https://blocked.example",
            kind: "camera",
            decision: "block",
            at: 2,
          },
        ],
      }),
  });
  await store.load();
  expect(store.decisionFor("https://example.com", "camera")).toBeNull();
  expect(store.decisionFor("https://www.example.com", "camera")).toBeNull();
  expect(store.decisionFor("https://blocked.example", "camera")).toBe("block");
});

test("new full-origin grants survive reload without sharing across subdomains or ports", async () => {
  let saved = "";
  const storage = {
    readSitePermissions: async () => saved || null,
    saveSitePermissions: async (json: string) => {
      saved = json;
    },
  };
  const first = new SitePermissions(storage);
  await first.decide("https://www.example.com:8443", "camera", "allow");
  const restored = new SitePermissions(storage);
  await restored.load();
  expect(restored.decisionFor("https://www.example.com:8443", "camera")).toBe(
    "allow"
  );
  expect(
    restored.decisionFor("https://www.example.com:9443", "camera")
  ).toBeNull();
  expect(restored.decisionFor("https://example.com:8443", "camera")).toBeNull();
  expect(JSON.parse(saved).originFormat).toBe(2);
});
