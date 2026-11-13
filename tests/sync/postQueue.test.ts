// Protocol-layer upload tests (T-1): the encryptEnvelope↔decryptEnvelope
// round trip, storagePost request/response handling (success/failed/missing
// ids, batch query parameters, Hawk payload hash over the real body), the
// /info/configuration limits with fallbacks, and the PostQueue batch state
// machine ported from application-services request.rs (non-batch, batching,
// unsupported fallback, limit-driven splits, 412 abort, protocol misuse).

import { describe, expect, test } from "bun:test";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "@noble/hashes/utils.js";
import {
  decodeBase64,
  encodeBase64,
  utf8,
} from "../../src/sync/base64";
import {
  decryptEnvelope,
  encryptEnvelope,
  KeyBundle,
} from "../../src/sync/crypto";
import {
  FALLBACK_STORAGE_LIMITS,
  fetchInfoConfiguration,
  StorageContext,
  StorageLimits,
  storagePost,
  SyncServerError,
} from "../../src/sync/sync15";
import { OutgoingBso } from "../../src/sync/sync15";
import {
  PostQueue,
  PostQueueError,
} from "../../src/sync/postQueue";

// ---------------------------------------------------------------------------
// Fakes (FakeHttp pattern from tests/syncStore.test.ts, adapted locally)

const API_ENDPOINT = "https://sync-1-us-east-1.storage.mozilla.com/1.5/123";

type HttpRequest = {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  body?: string;
};
type HttpResponse = {
  status: number;
  headers?: Record<string, string>;
  body: string;
};

class FakeHttp {
  calls: HttpRequest[] = [];
  handler: (request: HttpRequest) => Promise<HttpResponse> = async () => ({
    status: 404,
    body: "",
  });
  request(request: HttpRequest): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
  }> {
    this.calls.push(request);
    return this.handler(request).then((response) => ({
      ...response,
      headers: response.headers ?? {},
    }));
  }
}

function makeContext(http: FakeHttp): StorageContext {
  return {
    http,
    token: {
      id: "hawk-id",
      key: "hawk-key",
      apiEndpoint: API_ENDPOINT,
      uid: 123,
      hashedFxaUid: "hashed",
      serverTimestampSeconds: 1700000000,
      fetchedAtMs: 0,
      durationSeconds: 3600,
    },
    // Frozen clocks keep the Hawk ts deterministic (token ts + 0s elapsed).
    nowMs: () => 0,
    nonce: () => "noncenonce",
  };
}

/** Recomputes the storage Hawk MAC from the request actually made, hash
 *  included for bodied requests — the POST analogue of the syncStore
 *  storageHawkMatches cross-check. */
function hawkMatches(request: HttpRequest): boolean {
  const header = request.headers?.Authorization ?? "";
  const ts = /ts="(\d+)"/.exec(header)?.[1];
  const nonce = /nonce="([^"]+)"/.exec(header)?.[1];
  const mac = /mac="([^"]+)"/.exec(header)?.[1];
  const hash = /hash="([^"]+)"/.exec(header)?.[1];
  if (ts === undefined || !nonce || !mac) return false;
  const url = new URL(request.url);
  const normalized =
    [
      "hawk.1.header",
      ts,
      nonce,
      request.method,
      url.pathname + url.search,
      url.host,
      url.protocol === "https:" ? "443" : "80",
      "",
      hash ?? "",
    ].join("\n") + "\n";
  const expectedMac = encodeBase64(
    hmac(sha256, utf8("hawk-key"), utf8(normalized))
  );
  if (expectedMac !== mac) return false;
  if (request.body !== undefined) {
    const contentType = request.headers?.["Content-Type"] ?? "";
    const expectedHash = encodeBase64(
      hmac(
        sha256,
        utf8("hawk-key"),
        utf8(`hawk.1.payload\n${contentType}\n${request.body}\n`)
      )
    );
    return hash === expectedHash;
  }
  return hash === undefined;
}

function limits(overrides: Partial<StorageLimits> = {}): StorageLimits {
  return { ...FALLBACK_STORAGE_LIMITS, ...overrides };
}

function smallPayload(): string {
  return JSON.stringify({ IV: "", hmac: "", ciphertext: "" });
}

let bsoCounter = 0;
function makeBso(id?: string): OutgoingBso {
  bsoCounter += 1;
  return {
    id: id ?? `b${String(bsoCounter).padStart(4, "0")}`,
    sortindex: 0,
    payload: smallPayload(),
  };
}

function respondJson(
  status: number,
  bodyJson: unknown,
  headers: Record<string, string> = {}
): HttpResponse {
  return { status, headers, body: JSON.stringify(bodyJson) };
}

/** Batch-capable storage server: appends → 202 + batch id, everything else
 *  (plain POST, commit) → 200 with modified. */
function batchServer(options: {
  batchId?: string;
  lastModified?: number;
  onPosted?: (posted: OutgoingBso[]) => void;
} = {}): (request: HttpRequest) => Promise<HttpResponse> {
  const batchId = options.batchId ?? "B1";
  const lm = options.lastModified ?? 1700000100.25;
  return async (request) => {
    const url = new URL(request.url);
    const posted = JSON.parse(request.body ?? "[]") as OutgoingBso[];
    options.onPosted?.(posted);
    const isBatch = url.searchParams.has("batch");
    const isCommit = url.searchParams.get("commit") === "true";
    if (isBatch && !isCommit) {
      return respondJson(
        202,
        { batch: batchId, success: posted.map((b) => b.id), failed: {} },
        { "X-Last-Modified": String(lm) }
      );
    }
    return respondJson(
      200,
      { modified: lm, success: posted.map((b) => b.id), failed: {} },
      { "X-Last-Modified": String(lm) }
    );
  };
}

// ---------------------------------------------------------------------------
// encryptEnvelope ↔ decryptEnvelope round trip

function randomBundle(): KeyBundle {
  const raw = randomBytes(64);
  return { encKey: raw.slice(0, 32), macKey: raw.slice(32, 64) };
}

describe("encryptEnvelope ↔ decryptEnvelope round trip", () => {
  test("round-trips a bookmark cleartext payload", () => {
    const bundle = randomBundle();
    const cleartext = JSON.stringify({
      id: "abc123XYZ_-",
      parentid: "mobile",
      type: "bookmark",
      title: "여유 yeoyu",
      bmkUri: "https://yeoyu.ll3.kr/",
      hasDupe: true,
    });
    const envelope = encryptEnvelope(bundle, cleartext);
    expect(decryptEnvelope(bundle, envelope)).toBe(cleartext);
  });

  test("round-trips multi-byte content and block-boundary lengths", () => {
    const bundle = randomBundle();
    for (const cleartext of [
      "",
      "x".repeat(15),
      "x".repeat(16),
      "x".repeat(17),
      "한글🖼️".repeat(64),
      "x".repeat(10_000),
    ]) {
      const envelope = encryptEnvelope(bundle, cleartext);
      expect(decryptEnvelope(bundle, envelope)).toBe(cleartext);
    }
  });

  test("produces a well-formed weave envelope", () => {
    const bundle = randomBundle();
    const envelope = encryptEnvelope(bundle, '{"id":"a"}');
    expect(decodeBase64(envelope.IV)).toHaveLength(16);
    expect(envelope.hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(decodeBase64(envelope.ciphertext).length % 16).toBe(0);
    // The MAC is over the base64 ciphertext string bytes (legacy sync AEAD).
    const expected = encodeBase64(
      hmac(sha256, bundle.macKey, utf8(envelope.ciphertext))
    );
    expect(encodeBase64(hmac(sha256, bundle.macKey, utf8(envelope.ciphertext)))).toBe(expected);
  });

  test("rejects tampering exactly like received envelopes", () => {
    const bundle = randomBundle();
    const envelope = encryptEnvelope(bundle, '{"id":"a"}');
    const badHmac =
      envelope.hmac.slice(0, 62) +
      (envelope.hmac.endsWith("0") ? "1" : "0");
    expect(() =>
      decryptEnvelope(bundle, { ...envelope, hmac: badHmac })
    ).toThrow(/hmac/);
  });

  test("uses the injected randomness (distinct IVs per encryption)", () => {
    const bundle = randomBundle();
    let counter = 0;
    const random = (n: number) => new Uint8Array(n).fill((counter += 1));
    const first = encryptEnvelope(bundle, "same", random);
    const second = encryptEnvelope(bundle, "same", random);
    expect(first.IV).not.toBe(second.IV);
    expect(decryptEnvelope(bundle, first)).toBe("same");
    expect(decryptEnvelope(bundle, second)).toBe("same");
  });
});

// ---------------------------------------------------------------------------
// storagePost

describe("storagePost", () => {
  test("posts the BSO array with protocol headers and parses the response", async () => {
    const http = new FakeHttp();
    const bsos = [makeBso("aaa"), makeBso("bbb"), makeBso("ccc")];
    http.handler = async () =>
      respondJson(
        200,
        { modified: 1700000100.25, success: ["aaa", "bbb"], failed: { ccc: "invalid ttl" } },
        { "X-Last-Modified": "1700000100.25" }
      );
    const result = await storagePost(makeContext(http), "bookmarks", bsos, {
      batch: true,
      commit: true,
      xiusSeconds: 1700000000.05,
    });
    const call = http.calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${API_ENDPOINT}/storage/bookmarks?batch=true&commit=true`);
    expect(call.headers?.["Content-Type"]).toBe("application/json");
    expect(call.headers?.["X-If-Unmodified-Since"]).toBe("1700000000.05");
    expect(call.body).toBe(JSON.stringify(bsos));
    expect(hawkMatches(call)).toBe(true);
    expect(result.status).toBe(200);
    expect(result.modifiedSeconds).toBe(1700000100.25);
    expect(result.batch).toBe(null);
    expect(result.success).toEqual(["aaa", "bbb"]);
    expect(result.failed).toEqual({ ccc: "invalid ttl" });
    expect(result.lastModifiedSeconds).toBe(1700000100.25);
  });

  test("a 202 in-progress response yields the batch id", async () => {
    const http = new FakeHttp();
    http.handler = async () =>
      respondJson(
        202,
        { batch: "OPAQUEBATCHID", success: ["aaa"], failed: {} },
        { "x-last-modified": "1700000100" }
      );
    const result = await storagePost(
      makeContext(http),
      "bookmarks",
      [makeBso("aaa")],
      { batch: true, xiusSeconds: 1700000000 }
    );
    expect(result.status).toBe(202);
    expect(result.batch).toBe("OPAQUEBATCHID");
    expect(result.modifiedSeconds).toBe(null);
    expect(result.lastModifiedSeconds).toBe(1700000100);
  });

  test("ids absent from success and failed count as failed", async () => {
    const http = new FakeHttp();
    http.handler = async () =>
      respondJson(200, { modified: 1.5, success: ["aaa"], failed: {} });
    const result = await storagePost(
      makeContext(http),
      "bookmarks",
      [makeBso("aaa"), makeBso("bbb"), makeBso("ccc")],
      {}
    );
    expect(result.success).toEqual(["aaa"]);
    expect(result.failed).toEqual({
      bbb: "missing from success/failed lists",
      ccc: "missing from success/failed lists",
    });
  });

  test("URL-encodes the opaque batch id and keeps commit pairing", async () => {
    const http = new FakeHttp();
    http.handler = async () => respondJson(200, { modified: 1, success: [], failed: {} });
    await storagePost(makeContext(http), "bookmarks", [], {
      batch: "abc/def+ghi",
      commit: true,
    });
    expect(http.calls[0]!.url).toBe(
      `${API_ENDPOINT}/storage/bookmarks?batch=abc%2Fdef%2Bghi&commit=true`
    );
  });

  test("commit without batch is a protocol misuse error", async () => {
    const http = new FakeHttp();
    await expect(
      storagePost(makeContext(http), "bookmarks", [], { commit: true })
    ).rejects.toThrow(/commit requires batch/);
    expect(http.calls).toHaveLength(0);
  });

  test("omits X-If-Unmodified-Since when no xius is given; survives error bodies", async () => {
    const http = new FakeHttp();
    http.handler = async () =>
      respondJson(412, { status: "precondition failed" }, { "X-Last-Modified": "1700000050" });
    const result = await storagePost(
      makeContext(http),
      "bookmarks",
      [makeBso("aaa")],
      {}
    );
    expect(http.calls[0]!.headers?.["X-If-Unmodified-Since"]).toBeUndefined();
    expect(result.status).toBe(412);
    expect(result.success).toEqual([]);
    expect(result.failed).toEqual({ aaa: "missing from success/failed lists" });
    expect(result.lastModifiedSeconds).toBe(1700000050);
  });
});

// ---------------------------------------------------------------------------
// fetchInfoConfiguration

describe("fetchInfoConfiguration", () => {
  test("parses the wire fields", async () => {
    const http = new FakeHttp();
    http.handler = async () =>
      respondJson(200, {
        max_request_bytes: 2625536,
        max_record_payload_bytes: 2621440,
        max_post_records: 100,
        max_post_bytes: 2621440,
        max_total_records: 10000,
        max_total_bytes: 262144000,
      });
    const result = await fetchInfoConfiguration(makeContext(http));
    expect(result.status).toBe(200);
    expect(result.limits).toEqual({
      maxRequestBytes: 2625536,
      maxRecordPayloadBytes: 2621440,
      maxPostRecords: 100,
      maxPostBytes: 2621440,
      maxTotalRecords: 10000,
      maxTotalBytes: 262144000,
    });
    expect(hawkMatches(http.calls[0]!)).toBe(true);
    expect(http.calls[0]!.url).toBe(`${API_ENDPOINT}/info/configuration`);
  });

  test("falls back per-field when the body is partial", async () => {
    const http = new FakeHttp();
    http.handler = async () => respondJson(200, { max_post_records: 42 });
    const result = await fetchInfoConfiguration(makeContext(http));
    expect(result.limits.maxPostRecords).toBe(42);
    expect(result.limits.maxRequestBytes).toBe(FALLBACK_STORAGE_LIMITS.maxRequestBytes);
    expect(result.limits.maxRecordPayloadBytes).toBe(FALLBACK_STORAGE_LIMITS.maxRecordPayloadBytes);
    expect(result.limits.maxTotalBytes).toBe(FALLBACK_STORAGE_LIMITS.maxTotalBytes);
  });

  test("non-200 and transport failures degrade to the fallback limits", async () => {
    const http = new FakeHttp();
    http.handler = async () => respondJson(503, "overloaded", { "Retry-After": "30" });
    const degraded = await fetchInfoConfiguration(makeContext(http));
    expect(degraded.status).toBe(503);
    expect(degraded.limits).toEqual(FALLBACK_STORAGE_LIMITS);
    expect(degraded.backoffSeconds).toBe(30);

    const broken = new FakeHttp();
    broken.handler = async () => {
      throw new Error("network down");
    };
    const offline = await fetchInfoConfiguration(makeContext(broken));
    expect(offline.status).toBe(0);
    expect(offline.limits).toEqual(FALLBACK_STORAGE_LIMITS);
  });

  test("GET requests keep the legacy Hawk format (no payload hash)", async () => {
    const http = new FakeHttp();
    http.handler = async () => respondJson(200, {});
    await fetchInfoConfiguration(makeContext(http));
    expect(http.calls[0]!.headers?.Authorization).not.toMatch(/hash=/);
  });
});

// ---------------------------------------------------------------------------
// PostQueue state machine

function queue(
  http: FakeHttp,
  queueLimits: StorageLimits,
  options: { xiusSeconds?: number } = {}
): PostQueue {
  return new PostQueue(makeContext(http), "bookmarks", {
    limits: queueLimits,
    xiusSeconds: options.xiusSeconds ?? 1700000000.25,
  });
}

function postUrls(http: FakeHttp): string[] {
  return http.calls.map((call) => new URL(call.url).pathname + new URL(call.url).search);
}

describe("PostQueue", () => {
  test("small upload: single-shot batch=true&commit=true POST", async () => {
    const http = new FakeHttp();
    http.handler = batchServer();
    const q = queue(http, limits());
    await q.enqueue(makeBso("r1"));
    await q.enqueue(makeBso("r2"));
    await q.flush(true);
    expect(postUrls(http)).toEqual([
      "/1.5/123/storage/bookmarks?batch=true&commit=true",
    ]);
    const body = JSON.parse(http.calls[0]!.body!) as OutgoingBso[];
    expect(body.map((b) => b.id)).toEqual(["r1", "r2"]);
    expect(http.calls[0]!.headers?.["X-If-Unmodified-Since"]).toBe("1700000000.25");
    expect(hawkMatches(http.calls[0]!)).toBe(true);
    expect(q.successIds).toEqual(["r1", "r2"]);
    expect(q.failedIds).toEqual({});
    expect(q.batchState).toBe("none");
    expect(q.lastModifiedSeconds).toBe(1700000100.25);
  });

  test("batching: appends stay pending until the commit folds them in", async () => {
    const http = new FakeHttp();
    http.handler = batchServer({ lastModified: 1700000100.25 });
    const q = queue(http, limits({ maxPostRecords: 2 }));
    await q.enqueue(makeBso("r1"));
    await q.enqueue(makeBso("r2"));
    // r3 overflows the per-POST record limit → auto append flush (no commit).
    await q.enqueue(makeBso("r3"));
    expect(postUrls(http)).toEqual([
      "/1.5/123/storage/bookmarks?batch=true",
    ]);
    expect(q.batchState).toBe("active");
    // Mid-batch successes are pending, not durable.
    expect(q.successIds).toEqual([]);

    await q.flush(true);
    expect(postUrls(http)).toEqual([
      "/1.5/123/storage/bookmarks?batch=true",
      "/1.5/123/storage/bookmarks?batch=B1&commit=true",
    ]);
    // The commit's XIUS is the append response's X-Last-Modified.
    expect(http.calls[1]!.headers?.["X-If-Unmodified-Since"]).toBe("1700000100.25");
    const commitBody = JSON.parse(http.calls[1]!.body!) as OutgoingBso[];
    expect(commitBody.map((b) => b.id)).toEqual(["r3"]);
    expect(q.successIds).toEqual(["r1", "r2", "r3"]);
    expect(q.batchState).toBe("none");
    expect(q.lastModifiedSeconds).toBe(1700000100.25);
  });

  test("server without batch semantics: fall back to plain POSTs", async () => {
    const http = new FakeHttp();
    http.handler = async (request) => {
      const posted = JSON.parse(request.body ?? "[]") as OutgoingBso[];
      return respondJson(
        200,
        { modified: 1700000300, success: posted.map((b) => b.id), failed: {} },
        { "X-Last-Modified": "1700000300" }
      );
    };
    const q = queue(http, limits({ maxPostRecords: 1 }));
    await q.enqueue(makeBso("r1"));
    await q.enqueue(makeBso("r2"));
    // The non-202 answer to ?batch=true marks batching unsupported and the
    // records durable immediately.
    expect(q.batchState).toBe("unsupported");
    expect(q.successIds).toEqual(["r1"]);
    await q.flush(true);
    expect(postUrls(http)).toEqual([
      "/1.5/123/storage/bookmarks?batch=true",
      "/1.5/123/storage/bookmarks",
    ]);
    expect(q.successIds).toEqual(["r1", "r2"]);
  });

  test("batch total limits force mid-upload commits", async () => {
    const http = new FakeHttp();
    http.handler = batchServer();
    const q = queue(
      http,
      limits({ maxPostRecords: 10, maxTotalRecords: 2 })
    );
    for (const id of ["r1", "r2", "r3", "r4"]) {
      await q.enqueue(makeBso(id));
    }
    await q.flush(true);
    // r3 cannot fit the 2-record batch budget → the queue commits [r1,r2]
    // as its own single-shot batch, then [r3,r4] as the next one.
    expect(postUrls(http)).toEqual([
      "/1.5/123/storage/bookmarks?batch=true&commit=true",
      "/1.5/123/storage/bookmarks?batch=true&commit=true",
    ]);
    const first = JSON.parse(http.calls[0]!.body!) as OutgoingBso[];
    const second = JSON.parse(http.calls[1]!.body!) as OutgoingBso[];
    expect(first.map((b) => b.id)).toEqual(["r1", "r2"]);
    expect(second.map((b) => b.id)).toEqual(["r3", "r4"]);
    expect(q.successIds).toEqual(["r1", "r2", "r3", "r4"]);
  });

  test("payload-byte limits split posts by size", async () => {
    const http = new FakeHttp();
    http.handler = batchServer();
    const probe = JSON.stringify(makeBso()).length + 2;
    const q = queue(
      http,
      // Request budget (minus the 4KiB slack) fits one item but not two.
      limits({ maxRequestBytes: 4096 + probe + 20 })
    );
    await q.enqueue(makeBso("r1"));
    await q.enqueue(makeBso("r2"));
    await q.flush(true);
    expect(http.calls).toHaveLength(2);
    for (const call of http.calls) {
      const body = JSON.parse(call.body!) as OutgoingBso[];
      expect(body).toHaveLength(1);
    }
    expect(q.successIds).toEqual(["r1", "r2"]);
  });

  test("412 aborts the upload with SyncServerError and keeps successes empty", async () => {
    const http = new FakeHttp();
    http.handler = async () =>
      respondJson(412, { status: "precondition failed" }, { "X-Last-Modified": "1700000099" });
    const q = queue(http, limits());
    await q.enqueue(makeBso("r1"));
    await q.enqueue(makeBso("r2"));
    let caught: unknown;
    try {
      await q.flush(true);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SyncServerError);
    expect((caught as SyncServerError).status).toBe(412);
    expect(q.successIds).toEqual([]);
    expect(http.calls).toHaveLength(1);
  });

  test("202 without a batch id is a batch protocol error", async () => {
    const http = new FakeHttp();
    http.handler = async () => respondJson(202, { success: [], failed: {} });
    const q = queue(http, limits());
    await q.enqueue(makeBso("r1"));
    let caught: unknown;
    try {
      // Non-commit flush (?batch=true) is the a-s path that requires a
      // batch id on 202; commit short-circuits before that check.
      await q.flush(false);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PostQueueError);
    expect((caught as PostQueueError).kind).toBe("batch");
    expect((caught as Error).message).toMatch(/batch id/);
  });

  test("batch id mismatch on append is a batch protocol error", async () => {
    const http = new FakeHttp();
    const q = queue(http, limits({ maxPostRecords: 1 }));
    http.handler = batchServer({ batchId: "B1" });
    await q.enqueue(makeBso("r1"));
    await q.enqueue(makeBso("r2")); // overflow → 202 B1
    http.handler = batchServer({ batchId: "B9" });
    let caught: unknown;
    try {
      await q.flush(false); // append r2 → server answers with a different id
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PostQueueError);
    expect((caught as PostQueueError).kind).toBe("batch");
    expect((caught as Error).message).toMatch(/mismatch/);
  });

  test("non-202 success mid-batch is a batch protocol error", async () => {
    const http = new FakeHttp();
    const q = queue(http, limits({ maxPostRecords: 1 }));
    http.handler = batchServer({ batchId: "B1" });
    await q.enqueue(makeBso("r1"));
    await q.enqueue(makeBso("r2")); // 202 → active batch
    http.handler = async (request) => {
      const posted = JSON.parse(request.body ?? "[]") as OutgoingBso[];
      return respondJson(200, { modified: 1700000400, success: posted.map((b) => b.id), failed: {} });
    };
    let caught: unknown;
    try {
      await q.flush(false);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PostQueueError);
    expect((caught as PostQueueError).kind).toBe("batch");
    expect((caught as Error).message).toMatch(/non-202/);
  });

  test("records that can never fit are skipped and reported failed", async () => {
    const http = new FakeHttp();
    http.handler = batchServer();
    const q = queue(http, limits({ maxRecordPayloadBytes: 64 }));
    const oversized: OutgoingBso = {
      id: "huge",
      sortindex: 0,
      payload: "x".repeat(80),
    };
    const fits = { ...makeBso("ok") };
    expect(await q.enqueue(oversized)).toBe(false);
    expect(await q.enqueue(fits)).toBe(true);
    await q.flush(true);
    expect(http.calls).toHaveLength(1);
    const body = JSON.parse(http.calls[0]!.body!) as OutgoingBso[];
    expect(body.map((b) => b.id)).toEqual(["ok"]);
    expect(q.failedIds).toEqual({ huge: "single record too large" });
    expect(q.successIds).toEqual(["ok"]);
  });

  test("flush(true) with nothing queued and no batch is a no-op", async () => {
    const http = new FakeHttp();
    const q = queue(http, limits());
    await q.flush(true);
    expect(http.calls).toHaveLength(0);
    expect(q.batchState).toBe("none");
  });

  test("flush(true) with an empty queue while a batch is active is misuse", async () => {
    const http = new FakeHttp();
    const q = queue(http, limits({ maxPostRecords: 1 }));
    http.handler = batchServer({ batchId: "B1" });
    await q.enqueue(makeBso("r1"));
    await q.enqueue(makeBso("r2")); // overflow → 202 → active batch, [r2] queued
    await q.flush(false); // drain r2 → active batch, empty queue
    let caught: unknown;
    try {
      await q.flush(true);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PostQueueError);
    expect((caught as PostQueueError).kind).toBe("misuse");
  });

  test("per-record failures are reported without aborting the upload", async () => {
    const http = new FakeHttp();
    http.handler = async (request) => {
      const posted = JSON.parse(request.body ?? "[]") as OutgoingBso[];
      const success = posted.filter((b) => b.id !== "bad").map((b) => b.id);
      return respondJson(200, {
        modified: 1700000500,
        success,
        // "bad" is deliberately left out of failed too — it must still land
        // in failedIds via the unspecified-reason rule.
        failed: {},
      });
    };
    const q = queue(http, limits());
    await q.enqueue(makeBso("good1"));
    await q.enqueue(makeBso("bad"));
    await q.enqueue(makeBso("good2"));
    await q.flush(true);
    expect(q.successIds).toEqual(["good1", "good2"]);
    expect(q.failedIds).toEqual({ bad: "missing from success/failed lists" });
  });

  test("onPost observes every POST with committed/durable distinction", async () => {
    const http = new FakeHttp();
    http.handler = batchServer({ batchId: "B7" });
    const summaries: { ids: string[]; committed: boolean }[] = [];
    const q = new PostQueue(makeContext(http), "bookmarks", {
      limits: limits({ maxPostRecords: 2 }),
      xiusSeconds: 1700000000,
      onPost: (summary) => {
        summaries.push({
          ids: summary.posted.map((b) => b.id),
          committed: summary.committed,
        });
        expect(summary.lastModifiedSeconds).toBe(1700000100.25);
      },
    });
    for (const id of ["r1", "r2", "r3"]) {
      await q.enqueue(makeBso(id));
    }
    await q.flush(true);
    expect(summaries).toEqual([
      { ids: ["r1", "r2"], committed: false },
      { ids: ["r3"], committed: true },
    ]);
  });
});

// ---------------------------------------------------------------------------
// End-to-end protocol bytes: real envelopes through the queue

describe("PostQueue with real encrypted payloads", () => {
  test("25 records in 3 POSTs; the server decrypts every payload intact", async () => {
    const bundle = randomBundle();
    const http = new FakeHttp();
    const decrypted: string[] = [];
    http.handler = async (request) => {
      const posted = JSON.parse(request.body ?? "[]") as OutgoingBso[];
      for (const bso of posted) {
        // Envelope payload strings must decrypt back to the cleartexts the
        // caller produced — protocol bytes, not mocks.
        decrypted.push(decryptEnvelope(bundle, JSON.parse(bso.payload)));
      }
      const url = new URL(request.url);
      const isBatch = url.searchParams.has("batch");
      const isCommit = url.searchParams.get("commit") === "true";
      if (isBatch && !isCommit) {
        return respondJson(
          202,
          { batch: "REALBATCH", success: posted.map((b) => b.id), failed: {} },
          { "X-Last-Modified": "1700000600" }
        );
      }
      return respondJson(
        200,
        { modified: 1700000601, success: posted.map((b) => b.id), failed: {} },
        { "X-Last-Modified": "1700000601" }
      );
    };
    const q = queue(http, limits({ maxPostRecords: 10 }));
    const cleartexts: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      const cleartext = JSON.stringify({
        id: `rec${i}`,
        parentid: "mobile",
        parentName: "mobile",
        type: "bookmark",
        title: `북마크 ${i}`,
        bmkUri: `https://example.com/${i}`,
        dateAdded: 727747200000 + i,
        hasDupe: true,
      });
      cleartexts.push(cleartext);
      const envelope = encryptEnvelope(bundle, cleartext);
      const ok = await q.enqueue({
        id: `rec${i}`,
        sortindex: 0,
        payload: JSON.stringify(envelope),
      });
      expect(ok).toBe(true);
    }
    await q.flush(true);
    expect(decrypted).toEqual(cleartexts);
    expect(http.calls.map((c) => new URL(c.url).search)).toEqual([
      "?batch=true",
      "?batch=REALBATCH",
      "?batch=REALBATCH&commit=true",
    ]);
    for (const call of http.calls) {
      expect(call.headers?.["Content-Type"]).toBe("application/json");
      expect(hawkMatches(call)).toBe(true);
    }
    expect(q.successIds).toHaveLength(25);
    expect(q.lastModifiedSeconds).toBe(1700000601);
  });
});
