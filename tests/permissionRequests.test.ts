import { expect, test } from "bun:test";
import { SitePermissions } from "../src/permissions";
import {
  PermissionRequests,
  answerPermission,
  permissionSupportsOnce,
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

test("only media requests support a one-request site grant", () => {
  expect(permissionSupportsOnce(["camera"])).toBe(true);
  expect(permissionSupportsOnce(["microphone", "camera"])).toBe(true);
  for (const kinds of [[], ["notifications"], ["geolocation"], ["autoplay"], ["persistent-storage"], ["camera", "notifications"]])
    expect(permissionSupportsOnce(kinds)).toBe(false);
});

test("unsupported one-time content grants fail closed instead of silently granting permanently", async () => {
  for (const kind of ["notifications", "geolocation", "autoplay", "persistent-storage"]) {
    const queue = new PermissionRequests();
    queue.enqueue({ ...request(1), kind });
    const replies: unknown[][] = [], saves: unknown[] = [], asked: string[] = [];
    await expect(answerPermission(queue, 1, "once", {
      requestAndroid: async (value) => { asked.push(value); return true; },
      save: async (origin) => { saves.push(origin); },
      resolve: (...reply) => replies.push(reply),
    })).rejects.toThrow("cannot be allowed just once");
    expect(asked).toEqual([]);
    expect(saves).toEqual([]);
    expect(replies).toEqual([[1, false, false]]);
  }
});

test("content Allow saves its explicit site choice and forwards a grant", async () => {
  for (const kind of ["notifications", "geolocation", "autoplay", "persistent-storage"]) {
    const queue = new PermissionRequests();
    queue.enqueue({ ...request(1), kind });
    const replies: unknown[][] = [], saves: unknown[][] = [];
    await answerPermission(queue, 1, "always", {
      requestAndroid: async () => true,
      save: async (...args) => { saves.push(args); },
      resolve: (...reply) => replies.push(reply),
    });
    expect(saves).toEqual([["https://example.com", [kind], "allow"]]);
    expect(replies).toEqual([[1, true, false]]);
  }
});

test("dismiss is a prompt response, while a successfully saved explicit Block may be remembered by Gecko", async () => {
  for (const choice of ["dismiss", "block"] as const) {
    const queue = new PermissionRequests();
    queue.enqueue({ ...request(1), kind: "notifications" });
    const replies: unknown[][] = [], saves: unknown[][] = [];
    await answerPermission(queue, 1, choice, {
      requestAndroid: async () => { throw new Error("denials must not request Android"); },
      save: async (...args) => { saves.push(args); },
      resolve: (...reply) => replies.push(reply),
    });
    expect(replies).toEqual([[1, false, choice === "block"]]);
    expect(saves.length).toBe(choice === "block" ? 1 : 0);
  }
});

test("failed Block persistence must not leave an unlisted durable Gecko denial", async () => {
  const queue = new PermissionRequests();
  queue.enqueue({ ...request(1), kind: "notifications" });
  const replies: unknown[][] = [];
  await expect(answerPermission(queue, 1, "block", {
    requestAndroid: async () => true,
    save: async () => { throw new Error("disk full"); },
    resolve: (...reply) => replies.push(reply),
  })).rejects.toThrow("disk full");
  expect(replies).toEqual([[1, false, false]]);
});

test("a remembered answer resolves already queued requests for that site without another prompt", async () => {
  const queue = new PermissionRequests();
  queue.enqueue({ ...request(1), kind: "camera,microphone" });
  queue.enqueue(request(2));
  queue.enqueue({ ...request(3), kind: "microphone" });
  queue.enqueue({ ...request(4), origin: "https://other.example" });
  queue.enqueue({ ...request(5), ephemeral: true });
  queue.enqueue({ ...request(6), kind: "camera,geolocation" });
  const replies: unknown[][] = [];
  await answerPermission(queue, 1, "always", {
    requestAndroid: async () => true,
    save: async () => {},
    resolve: (...reply) => replies.push(reply),
  });
  expect(replies).toEqual([[1, true, false], [2, true, false], [3, true, false]]);
  expect(queue.getSnapshot()?.requestId).toBe(4);
  expect(queue.has(5)).toBe(true);
  expect(queue.has(6)).toBe(true);
});

test("a saved Block rejects queued combined requests while a one-time Allow stays one-time", async () => {
  for (const choice of ["block", "once"] as const) {
    const queue = new PermissionRequests();
    queue.enqueue(request(1));
    queue.enqueue({ ...request(2), kind: "camera,microphone" });
    const replies: unknown[][] = [];
    await answerPermission(queue, 1, choice, {
      requestAndroid: async () => true, save: async () => {},
      resolve: (...reply) => replies.push(reply),
    });
    expect(queue.has(2)).toBe(choice === "once");
    expect(replies).toEqual(choice === "block"
      ? [[1, false, true], [2, false, true]] : [[1, true, false]]);
  }
});
