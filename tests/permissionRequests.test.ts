import { expect, test } from "bun:test";
import { SitePermissions } from "../src/permissions";
import {
  PermissionRequests,
  answerPermission,
} from "../src/permissionRequests";

const request = (requestId: number) => ({
  requestId,
  tabId: "tab",
  kind: "camera",
  origin: "https://example.com",
});
const deferred = () => {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("a combined permission decision has one durable commit and a failed save grants neither channel", async () => {
  let writes = 0;
  const rules = new SitePermissions({
    saveSitePermissions: async () => {
      writes++;
      throw new Error("disk full");
    },
  });
  const queue = new PermissionRequests();
  queue.enqueue({ ...request(1), kind: "camera,microphone" });
  const replies: boolean[] = [];
  await expect(
    answerPermission(queue, 1, "always", {
      requestAndroid: async () => true,
      save: (origin, kinds, decision) =>
        rules.decideMany(origin, kinds, decision),
      resolve: (_id, allow) => {
        replies.push(allow);
      },
    })
  ).rejects.toThrow("disk full");
  expect(writes).toBe(1);
  expect(rules.all()).toEqual([]);
  expect(replies).toEqual([false]);
});

test("navigation during an explicit Always commit preserves only that origin choice and denies the retired request", async () => {
  const saving = deferred(),
    started = deferred();
  const rules = new SitePermissions({
    saveSitePermissions: async () => {
      started.resolve(true);
      await saving.promise;
    },
  });
  const queue = new PermissionRequests();
  queue.enqueue(request(1));
  const replies: boolean[] = [];
  const answer = answerPermission(queue, 1, "always", {
    requestAndroid: async () => true,
    save: (origin, kinds, decision) =>
      rules.decideMany(origin, kinds, decision),
    resolve: (_id, allow) => {
      replies.push(allow);
    },
  });
  await started.promise;
  queue.cancel(1);
  saving.resolve(true);
  await answer;
  expect(replies).toEqual([false]);
  expect(rules.decisionFor("https://example.com", "camera")).toBe("allow");
  expect(rules.decisionFor("https://other.example", "camera")).toBeNull();
});

test("same-turn requests retain FIFO order and a second click cannot answer the next dialog", () => {
  const queue = new PermissionRequests();
  queue.enqueue(request(1));
  queue.enqueue(request(2));
  expect(queue.getSnapshot()?.requestId).toBe(1);
  expect(queue.begin(1)?.requestId).toBe(1);
  expect(queue.begin(1)).toBeNull();
  expect(queue.getSnapshot()).toBeNull();
  queue.finish(1);
  expect(queue.getSnapshot()?.requestId).toBe(2);
});

test("cancel during Android permission keeps the next request waiting and never grants or remembers the stale one", async () => {
  const queue = new PermissionRequests();
  queue.enqueue(request(1));
  queue.enqueue(request(2));
  const os = deferred();
  const replies: [number, boolean][] = [];
  const saved: string[] = [];
  const result = answerPermission(queue, 1, "always", {
    requestAndroid: () => os.promise,
    save: async (origin) => {
      saved.push(origin);
    },
    resolve: (id, allow) => {
      replies.push([id, allow]);
    },
  });
  queue.cancel(1);
  expect(queue.getSnapshot()).toBeNull();
  os.resolve(true);
  await result;
  expect(replies).toEqual([[1, false]]);
  expect(saved).toEqual([]);
  expect(queue.getSnapshot()?.requestId).toBe(2);
});

test("failed permission persistence denies the request, reports failure and advances the queue", async () => {
  const queue = new PermissionRequests();
  queue.enqueue(request(1));
  queue.enqueue(request(2));
  const replies: [number, boolean][] = [];
  await expect(
    answerPermission(queue, 1, "always", {
      requestAndroid: async () => true,
      save: async () => {
        throw new Error("disk full");
      },
      resolve: (id, allow) => {
        replies.push([id, allow]);
      },
    })
  ).rejects.toThrow("disk full");
  expect(replies).toEqual([[1, false]]);
  expect(queue.getSnapshot()?.requestId).toBe(2);
});

test("allow once requires both media channels and never persists; unknown kinds are denied", async () => {
  const queue = new PermissionRequests();
  const asked: string[] = [],
    saved: string[] = [];
  const replies: [number, boolean][] = [];
  const ports = {
    requestAndroid: async (kind: string) => {
      asked.push(kind);
      return true;
    },
    save: async (origin: string) => {
      saved.push(origin);
    },
    resolve: (id: number, allow: boolean) => {
      replies.push([id, allow]);
    },
  };
  queue.enqueue({ ...request(1), kind: "camera,microphone" });
  await answerPermission(queue, 1, "once", ports);
  queue.enqueue({ ...request(2), kind: "unknown" });
  await answerPermission(queue, 2, "once", ports);
  expect(asked).toEqual(["camera", "microphone"]);
  expect(saved).toEqual([]);
  expect(replies).toEqual([
    [1, true],
    [2, false],
  ]);
});

test("private permissions never persist allow or block decisions", async () => {
  for (const choice of ["always", "block", "once"] as const) {
    const queue = new PermissionRequests();
    queue.enqueue({ ...request(1), ephemeral: true });
    const saved: string[] = [], replies: boolean[] = [];
    await answerPermission(queue, 1, choice, {
      requestAndroid: async () => true,
      save: async (origin) => { saved.push(origin); },
      resolve: (_id, allow) => { replies.push(allow); },
    });
    expect(saved).toEqual([]);
    expect(replies).toEqual([choice !== "block"]);
  }
});
