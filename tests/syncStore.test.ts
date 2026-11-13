// Orchestrator tests (V-2): happy cycle, no-change cycle, every error class
// of the F-G1-1 matrix, single-flight, 401 auto-recovery, disconnect cleanup,
// and credential/tree channel isolation (F-G1-5/V-5).
//
// The fake server produces real protocol bytes: envelopes are genuine
// AES-256-CBC + HMAC (over the base64 ciphertext string), the keys_jwe is a
// genuine ECDH-ES A256GCM compact serialization, so the store exercises the
// actual crypto, not mocks of it.

import { describe, expect, test } from "bun:test";
import { cbc, gcm } from "@noble/ciphers/aes.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { p256 } from "@noble/curves/nist.js";
import { randomBytes } from "@noble/hashes/utils.js";
import {
  decodeBase64Url,
  encodeBase64,
  encodeBase64Url,
  utf8,
} from "../src/sync/base64";
import {
  EphemeralKeyPair,
  generateEphemeralKeyPair,
  KeyBundle,
} from "../src/sync/crypto";
import {
  LocalAdapter,
  LocalApplyOp,
  RandomSource,
  deserializeOutbound,
  emptyOutboundState,
  markAllDirty,
  noteRemoteRecord,
  reconcileLocalToRemote,
} from "../src/sync/outbound";
import type {
  LocalBookmarkSnapshot,
} from "../src/sync/model";
import { buildAuthorizationFlow } from "../src/sync/fxa";
import { TOKENSERVER_URL, decryptRecordCleartext } from "../src/sync/sync15";
import {
  SyncStore,
  SyncPlatformStorage,
  readPersistedCredentials,
  readPersistedTree,
} from "../src/syncStore";

// ---------------------------------------------------------------------------
// Protocol byte builders (encrypt direction, mirroring decrypt semantics)

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bundleFromKeys(): { enc: string; mac: string; bundle: KeyBundle } {
  const raw = randomBytes(64);
  const bundle: KeyBundle = {
    encKey: raw.slice(0, 32),
    macKey: raw.slice(32, 64),
  };
  return {
    enc: encodeBase64(bundle.encKey),
    mac: encodeBase64(bundle.macKey),
    bundle,
  };
}

/** Weave envelope: HMAC over the base64 ciphertext STRING bytes. */
function envelope(bundle: KeyBundle, cleartext: string): string {
  const iv = randomBytes(16);
  const ciphertext = cbc(bundle.encKey, iv, { disablePadding: false }).encrypt(
    utf8(cleartext)
  );
  const ciphertextB64 = encodeBase64(ciphertext);
  const mac = hmac(sha256, bundle.macKey, utf8(ciphertextB64));
  return JSON.stringify({
    IV: encodeBase64(iv),
    hmac: hex(mac),
    ciphertext: ciphertextB64,
  });
}

function concatKdfCek(z: Uint8Array): Uint8Array {
  // RFC 7518 §4.6.2 with AlgorithmID="A256GCM", empty apu/apv, 256-bit key.
  const parts: Uint8Array[] = [];
  const push = (value: Uint8Array) => {
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, value.length);
    parts.push(length, value);
  };
  push(utf8("A256GCM"));
  push(new Uint8Array(0));
  push(new Uint8Array(0));
  const suppPubInfo = new Uint8Array(4);
  new DataView(suppPubInfo.buffer).setUint32(0, 256);
  parts.push(suppPubInfo);
  const input = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    input.set(part, offset);
    offset += part.length;
  }
  const counter = new Uint8Array(4); // round 1
  new DataView(counter.buffer).setUint32(0, 1);
  return sha256(new Uint8Array([...counter, ...z, ...input]));
}

/** keys_jwe for the client's ephemeral key, sealing the scoped-key map. */
function keysJweFor(keys: EphemeralKeyPair, scopedKeyJson: string): string {
  const serverPrivate = randomBytes(32);
  const serverPublic = p256.getPublicKey(serverPrivate, false);
  const headerJson = JSON.stringify({
    alg: "ECDH-ES",
    enc: "A256GCM",
    epk: {
      kty: "EC",
      crv: "P-256",
      x: encodeBase64Url(serverPublic.slice(1, 33)),
      y: encodeBase64Url(serverPublic.slice(33, 65)),
    },
  });
  const headerB64 = encodeBase64Url(utf8(headerJson));
  const clientPublic = p256.Point.fromBytes(
    new Uint8Array([
      0x04,
      ...decodeBase64Url(keys.publicJwk.x),
      ...decodeBase64Url(keys.publicJwk.y),
    ])
  );
  const shared = p256.getSharedSecret(serverPrivate, clientPublic.toBytes());
  const cek = concatKdfCek(shared.slice(1, 33));
  const iv = randomBytes(12);
  const sealed = gcm(cek, iv, utf8(headerB64)).encrypt(utf8(scopedKeyJson));
  const ciphertext = sealed.slice(0, sealed.length - 16);
  const tag = sealed.slice(sealed.length - 16);
  return [
    headerB64,
    "",
    encodeBase64Url(iv),
    encodeBase64Url(ciphertext),
    encodeBase64Url(tag),
  ].join(".");
}

// ---------------------------------------------------------------------------
// Fakes

type HttpRequest = {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  body?: string;
};
type HttpResponse = { status: number; headers?: Record<string, string>; body: string };

class FakeHttp {
  calls: HttpRequest[] = [];
  /** Flipped to false when a storage request's Hawk MAC does not match the
   *  MAC recomputed from the actual request URL (F-G3-1 cross-check). */
  storageHawkOk = true;
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

/** Recomputes the storage Hawk MAC from the request the store actually made
 *  — the signed path must be the requested path, endpoint prefix included. */
function storageHawkMatches(request: HttpRequest): boolean {
  const header = request.headers?.Authorization ?? "";
  const ts = /ts="(\d+)"/.exec(header)?.[1];
  const nonce = /nonce="([^"]+)"/.exec(header)?.[1];
  const mac = /mac="([^"]+)"/.exec(header)?.[1];
  const hashAttr = /hash="([^"]+)"/.exec(header)?.[1];
  if (ts === undefined || !nonce || !mac) return false;
  const url = new URL(request.url);
  const normalized =
    [
      "hawk.1.header",
      ts,
      nonce,
      request.method.toUpperCase(),
      url.pathname + url.search,
      url.host,
      url.protocol === "https:" ? "443" : "80",
      "",
      hashAttr ?? "",
    ].join("\n") + "\n";
  const expected = encodeBase64(hmac(sha256, utf8("hawk-key"), utf8(normalized)));
  if (expected !== mac) return false;
  if (request.body !== undefined) {
    const contentType = request.headers?.["Content-Type"] ?? "";
    const expectedHash = encodeBase64(
      hmac(
        sha256,
        utf8("hawk-key"),
        utf8(`hawk.1.payload\n${contentType}\n${request.body}\n`)
      )
    );
    return hashAttr === expectedHash;
  }
  return hashAttr === undefined;
}

class FakeStorage implements SyncPlatformStorage {
  secrets: string | null = null;
  tree: string | null = null;
  outbound: string | null = null;
  secretsWrites: string[] = [];
  treeWrites: string[] = [];
  outboundWrites: string[] = [];
  secretsClears = 0;
  treeClears = 0;
  outboundClears = 0;
  readSecrets = async () => this.secrets;
  saveSecrets = async (json: string) => {
    this.secrets = json;
    this.secretsWrites.push(json);
  };
  clearSecrets = async () => {
    this.secrets = null;
    this.secretsClears += 1;
  };
  readTree = async () => this.tree;
  saveTree = async (json: string) => {
    this.tree = json;
    this.treeWrites.push(json);
  };
  clearTree = async () => {
    this.tree = null;
    this.treeClears += 1;
  };
  readOutbound = async () => this.outbound;
  saveOutbound = async (json: string) => {
    this.outbound = json;
    this.outboundWrites.push(json);
  };
  clearOutbound = async () => {
    this.outbound = null;
    this.outboundClears += 1;
  };
}

function chainHandlers(
  base: (request: HttpRequest) => Promise<HttpResponse>,
  override: (request: HttpRequest) => Promise<HttpResponse | undefined>
): (request: HttpRequest) => Promise<HttpResponse> {
  return async (request) => {
    const result = await override(request);
    if (result) return result;
    return base(request);
  };
}

// ---------------------------------------------------------------------------
// Scenario fixture: one account, real kSync-sealed crypto/keys envelope,
// bookmark records sealed with a bookmarks-specific collection key.

const API_ENDPOINT = "https://sync-1-us-east-1.storage.mozilla.com/1.5/424242";
const KSYNC = encodeBase64Url(randomBytes(64));
const REFRESH_TOKEN = "refresh-token-1";
const DEFAULT_KEYS = bundleFromKeys();
const BOOKMARK_KEYS = bundleFromKeys();

const KEYS_PAYLOAD = JSON.stringify({
  default: [DEFAULT_KEYS.enc, DEFAULT_KEYS.mac],
  collections: { bookmarks: [BOOKMARK_KEYS.enc, BOOKMARK_KEYS.mac] },
});

function kSyncKeyBundle(): KeyBundle {
  const raw = decodeBase64Url(KSYNC);
  return { encKey: raw.slice(0, 32), macKey: raw.slice(32, 64) };
}

const KEYS_ENVELOPE = envelope(kSyncKeyBundle(), KEYS_PAYLOAD);

const BOOKMARK_PAYLOADS: Array<[string, string]> = [
  ["menu________", JSON.stringify({ id: "menu________", type: "folder", title: "menu", children: ["b1", "b2"] })],
  ["b1", JSON.stringify({ id: "b1", parentid: "menu________", type: "bookmark", title: "One", bmkUri: "https://one.example" })],
  ["b2", JSON.stringify({ id: "b2", parentid: "menu________", type: "bookmark", title: "Two", bmkUri: "https://two.example" })],
];

function bso(id: string, payload: string, modified = 1.0) {
  return { id, modified, payload };
}

interface SyncServerScript {
  collectionsModified?: number;
  infoStatus?: number;
  infoHeaders?: Record<string, string>;
  keysStatus?: number;
  keysEnvelope?: string | null;
  bookmarksStatus?: number;
  bookmarksRecords?: Array<{ id: string; payload: string; modified?: number }>;
  /** POST /storage/bookmarks HTTP status (default 200). */
  postStatus?: number;
  /** X-Last-Modified / body.modified after a successful POST (seconds). */
  postModified?: number;
}

function fixedRandomSource(guidSlots: number): RandomSource {
  const bytes = new Uint8Array(guidSlots * 9);
  for (let g = 0; g < guidSlots; g += 1) {
    let n = g + 0x11;
    for (let b = 0; b < 9; b += 1) {
      bytes[g * 9 + b] = n % 256;
      n = Math.floor(n / 256);
    }
  }
  let served = false;
  return {
    randomB64: async (count: number) => {
      if (served) throw new Error("test random source exhausted");
      served = true;
      return encodeBase64Url(bytes.slice(0, count));
    },
  };
}

class MockLocalAdapter implements LocalAdapter {
  incoming: LocalApplyOp[] = [];
  constructor(private snapshot: LocalBookmarkSnapshot) {}
  getLocalSnapshot(): LocalBookmarkSnapshot {
    return this.snapshot;
  }
  async applyIncoming(ops: LocalApplyOp[]): Promise<void> {
    this.incoming.push(...ops);
    for (const op of ops) {
      if (op.kind === "upsertBookmark") {
        const id = op.localId ?? `remote:${op.guid ?? "?"}`;
        const existing = this.snapshot.bookmarks.find((b) => b.id === id);
        if (existing) {
          existing.title = op.title;
          existing.url = op.url;
          existing.folderId = op.folderId;
        } else {
          this.snapshot.bookmarks.push({
            id,
            title: op.title,
            url: op.url,
            folderId: op.folderId,
          });
        }
      } else if (op.kind === "upsertFolder") {
        const id = op.localId ?? `remote-folder:${op.guid ?? "?"}`;
        const folder = this.snapshot.bookmarkFolders.find((f) => f.id === id);
        if (folder) folder.title = op.title;
        else this.snapshot.bookmarkFolders.push({ id, title: op.title });
      } else if (op.kind === "deleteBookmark") {
        this.snapshot.bookmarks = this.snapshot.bookmarks.filter((b) => b.id !== op.localId);
      } else if (op.kind === "deleteFolder") {
        this.snapshot.bookmarkFolders = this.snapshot.bookmarkFolders.filter(
          (f) => f.id !== op.localId
        );
      } else if (op.kind === "setBookmarkFolder") {
        const existing = this.snapshot.bookmarks.find((b) => b.id === op.localId);
        if (existing) existing.folderId = op.folderId;
      } else if (op.kind === "reorderInFolder") {
        const inFolder = this.snapshot.bookmarks.filter(
          (b) => (b.folderId ?? "") === op.folderId
        );
        const others = this.snapshot.bookmarks.filter(
          (b) => (b.folderId ?? "") !== op.folderId
        );
        const byId = new Map(inFolder.map((b) => [b.id, b]));
        const ordered = op.orderedLocalIds
          .map((id) => byId.get(id))
          .filter((b): b is NonNullable<typeof b> => !!b);
        const rest = inFolder.filter((b) => !op.orderedLocalIds.includes(b.id));
        this.snapshot.bookmarks = [...others, ...ordered, ...rest];
      }
    }
  }
}

function localSnapshot(
  bookmarks: { id: string; title: string; url: string; folderId?: string }[],
  bookmarkFolders: { id: string; title: string }[] = []
): LocalBookmarkSnapshot {
  return {
    bookmarks: bookmarks.map((b) => ({ ...b })),
    bookmarkFolders: bookmarkFolders.map((f) => ({ ...f })),
  };
}

function postCalls(http: FakeHttp): HttpRequest[] {
  return http.calls.filter(
    (c) => c.method === "POST" && c.url.includes("/storage/bookmarks")
  );
}

function bookmarkGetCalls(http: FakeHttp): number {
  return http.calls.filter(
    (c) => c.method === "GET" && c.url.includes("/storage/bookmarks")
  ).length;
}

/** FxA token/profile + tokenserver + storage wiring. */
function scriptHttp(script: SyncServerScript) {
  const http = new FakeHttp();
  http.handler = async (request) => {
    if (request.url.startsWith(API_ENDPOINT) && !storageHawkMatches(request)) {
      http.storageHawkOk = false;
    }
    if (request.url === "https://oauth.accounts.firefox.com/v1/token") {
      if (!request.body?.includes(encodeURIComponent(REFRESH_TOKEN)))
        return { status: 400, body: JSON.stringify({ errno: 108 }) };
      return {
        status: 200,
        body: JSON.stringify({
          access_token: "access-" + (http.calls.length + 1),
          expires_in: 900,
          scope: "profile https://identity.mozilla.com/apps/oldsync",
        }),
      };
    }
    if (request.url === "https://profile.accounts.firefox.com/v1/profile") {
      return { status: 200, body: JSON.stringify({ email: "zen@example.com" }) };
    }
    if (request.url === TOKENSERVER_URL) {
      if (!request.headers?.Authorization?.startsWith("Bearer access-"))
        return { status: 401, body: "" };
      return {
        status: 200,
        headers: { "X-Timestamp": "1750000000" },
        body: JSON.stringify({
          id: "hawk-id",
          key: "hawk-key",
          api_endpoint: API_ENDPOINT,
          uid: 424242,
          hashed_fxa_uid: "hashed",
          duration: 3600,
        }),
      };
    }
    if (request.url === `${API_ENDPOINT}/info/collections`) {
      const status = script.infoStatus ?? 200;
      return {
        status,
        headers: script.infoHeaders,
        body:
          status === 200
            ? JSON.stringify({ bookmarks: script.collectionsModified ?? 7.25 })
            : "",
      };
    }
    if (request.url === `${API_ENDPOINT}/storage/crypto?full=1`) {
      const status = script.keysStatus ?? 200;
      if (status !== 200) return { status, body: "" };
      if (script.keysEnvelope === null) return { status: 200, body: JSON.stringify([]) };
      return {
        status: 200,
        body: JSON.stringify([bso("keys", script.keysEnvelope ?? KEYS_ENVELOPE)]),
      };
    }
    if (request.url === `${API_ENDPOINT}/storage/bookmarks?full=1`) {
      const status = script.bookmarksStatus ?? 200;
      if (status !== 200) return { status, body: "" };
      const records =
        script.bookmarksRecords ??
        BOOKMARK_PAYLOADS.map(([id, payload]) => bso(id, envelope(BOOKMARK_KEYS.bundle, payload)));
      return {
        status: 200,
        body: JSON.stringify(
          records.map((record) =>
            bso(record.id, record.payload, record.modified ?? 1.0)
          )
        ),
      };
    }
    if (request.url === `${API_ENDPOINT}/info/configuration`) {
      return {
        status: 200,
        body: JSON.stringify({
          max_request_bytes: 266240,
          max_record_payload_bytes: 262144,
          max_post_records: 100,
          max_post_bytes: 2621440,
          max_total_records: 10000,
          max_total_bytes: 100000000,
        }),
      };
    }
    if (
      request.method === "POST" &&
      request.url.startsWith(`${API_ENDPOINT}/storage/bookmarks`)
    ) {
      const status = script.postStatus ?? 200;
      if (status === 412) {
        return {
          status: 412,
          headers: { "X-Last-Modified": String(script.collectionsModified ?? 7.25) },
          body: JSON.stringify({}),
        };
      }
      const posted = JSON.parse(request.body ?? "[]") as Array<{ id: string }>;
      const modified = script.postModified ?? (script.collectionsModified ?? 7.25) + 1;
      return {
        status,
        headers: { "X-Last-Modified": String(modified) },
        body: JSON.stringify({
          modified,
          success: posted.map((item) => item.id),
          failed: {},
        }),
      };
    }
    return { status: 404, body: "" };
  };
  return http;
}

function credentialsJson(email: string | null = null): string {
  return JSON.stringify({
    v: 1 as const,
    refreshToken: REFRESH_TOKEN,
    kSync: KSYNC,
    kid: "1750000000-kid",
    email,
  });
}

function connectedStore(script: SyncServerScript = {}) {
  const storage = new FakeStorage();
  storage.secrets = credentialsJson("zen@example.com");
  const http = scriptHttp(script);
  const store = new SyncStore(storage, http, { nonce: () => "nonce12345" });
  return { storage, http, store };
}

function connectedStoreWithAdapter(
  adapter: MockLocalAdapter,
  script: SyncServerScript = {},
  nowMs?: () => number
) {
  const storage = new FakeStorage();
  storage.secrets = credentialsJson("zen@example.com");
  const http = scriptHttp({ postModified: 8.5, ...script });
  const store = new SyncStore(storage, http, {
    nonce: () => "nonce12345",
    ...(nowMs ? { nowMs } : {}),
    localAdapter: adapter,
    randomSource: fixedRandomSource(32),
  });
  return { storage, http, store, adapter };
}

function mobileRemoteBookmarkRecords(
  bookmarkGuid: string,
  modifiedSeconds: number,
  title = "Remote",
  url = "https://remote.example"
) {
  const mobileCleartext = JSON.stringify({
    id: "mobile",
    type: "folder",
    title: "mobile",
    parentid: "places",
    children: [bookmarkGuid],
  });
  const bookmarkCleartext = JSON.stringify({
    id: bookmarkGuid,
    parentid: "mobile",
    parentName: "mobile",
    type: "bookmark",
    title,
    bmkUri: url,
  });
  return [
    {
      id: "mobile",
      payload: envelope(BOOKMARK_KEYS.bundle, mobileCleartext),
      modified: 1.0,
    },
    {
      id: bookmarkGuid,
      payload: envelope(BOOKMARK_KEYS.bundle, bookmarkCleartext),
      modified: modifiedSeconds,
    },
  ];
}

// ---------------------------------------------------------------------------
// tests

describe("persisted payload readers", () => {
  test("credentials round-trip and reject junk", () => {
    const parsed = readPersistedCredentials(credentialsJson("a@b.c"));
    expect(parsed?.refreshToken).toBe(REFRESH_TOKEN);
    expect(parsed?.email).toBe("a@b.c");
    expect(readPersistedCredentials("{nope")).toBeNull();
    expect(readPersistedCredentials(JSON.stringify({ v: 2 }))).toBeNull();
    expect(readPersistedCredentials(null)).toBeNull();
  });

  test("tree reader rejects junk but accepts a real persisted tree", () => {
    expect(readPersistedTree("not json")).toBeNull();
    expect(readPersistedTree(JSON.stringify({ roots: "x" }))).toBeNull();
    const tree = readPersistedTree(
      JSON.stringify({
        roots: [{ guid: "menu________", type: "folder" }],
        fetchedAt: 5,
        bookmarksModified: 7.25,
      })
    );
    expect(tree?.roots[0]?.guid).toBe("menu________");
    expect(tree?.bookmarksModified).toBe(7.25);
  });
});

describe("load()", () => {
  test("restores connection, email and tree from storage", async () => {
    const { storage, http, store } = connectedStore();
    storage.tree = JSON.stringify({
      roots: [{ guid: "menu________", type: "folder", title: "menu", children: [] }],
      fetchedAt: 5,
      bookmarksModified: 7.25,
    });
    await store.load();
    const state = store.getState();
    expect(state.connection).toBe("connected");
    expect(state.email).toBe("zen@example.com");
    expect(state.tree?.roots[0]?.guid).toBe("menu________");
    expect(http.calls.length).toBe(0); // load never touches the network (AC-6)
  });

  test("junk secrets leave the store disconnected without network", async () => {
    const storage = new FakeStorage();
    storage.secrets = "{broken";
    const http = new FakeHttp();
    const store = new SyncStore(storage, http);
    await store.load();
    expect(store.getState().connection).toBe("disconnected");
    expect(http.calls.length).toBe(0);
  });

  test("a corrupted tree channel does not discard valid credentials (F-G3S-5)", async () => {
    const { storage, store } = connectedStore();
    storage.readTree = async () => {
      throw new Error("sync tree file too large");
    };
    await store.load();
    const state = store.getState();
    expect(state.connection).toBe("connected");
    expect(state.email).toBe("zen@example.com");
    expect(state.tree).toBeNull(); // next sync rebuilds it
  });

  test("an unreadable secrets channel stays disconnected without network (F-G3S-5)", async () => {
    const { storage, http, store } = connectedStore();
    storage.readSecrets = async () => {
      throw new Error("keystore unavailable");
    };
    await store.load();
    expect(store.getState().connection).toBe("disconnected");
    expect(http.calls.length).toBe(0);
  });
});

describe("runSync", () => {
  test("full cycle: tokenserver → collections → keys → bookmarks → tree", async () => {
    const { store, storage, http } = connectedStore();
    await store.load();
    const result = await store.runSync();
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.received).toBeGreaterThan(0);
    const state = store.getState();
    expect(state.tree).not.toBeNull();
    expect(state.lastSyncAtMs).not.toBeNull();
    expect(state.lastResult?.kind).toBe("ok");
    // Every storage GET carried a Hawk MAC computed over the requested URL
    // (endpoint path prefix included) — F-G3-1 regression pin.
    expect(http.storageHawkOk).toBe(true);
    const persisted = readPersistedTree(storage.tree);
    expect(persisted?.roots.length).toBe(1);
    expect(persisted?.roots[0]?.children?.map((c) => c.guid)).toEqual(["b1", "b2"]);
    expect(persisted?.bookmarksModified).toBe(7.25);
  });

  test("no-change cycle skips bookmark decryption entirely", async () => {
    const { store, http } = connectedStore();
    await store.load();
    await store.runSync();
    const bookmarkCalls = () =>
      http.calls.filter((c) => c.url.includes("/storage/bookmarks")).length;
    const afterFirst = bookmarkCalls();
    const second = await store.runSync();
    expect(second.kind).toBe("ok");
    if (second.kind === "ok") {
      expect(second.received).toBe(0);
      expect(second.uploaded).toBe(0);
    }
    expect(bookmarkCalls()).toBe(afterFirst);
  });

  test("storage 401 recovers exactly once via token refresh + tokenserver", async () => {
    const { store, http } = connectedStore();
    await store.load();
    let infoCalls = 0;
    const original = http.handler;
    http.handler = async (request) => {
      if (request.url === `${API_ENDPOINT}/info/collections`) {
        infoCalls += 1;
        if (infoCalls === 1) return { status: 401, body: "" };
      }
      return original(request);
    };
    const result = await store.runSync();
    expect(result.kind).toBe("ok");
    expect(http.calls.filter((c) => c.url === TOKENSERVER_URL).length).toBe(2);
    expect(
      http.calls.filter(
        (c) => c.url.includes("oauth.accounts.firefox.com") && c.method === "POST"
      ).length
    ).toBeGreaterThanOrEqual(1);
  });

  test("persistent 401 becomes an auth error", async () => {
    const { store } = connectedStore({ infoStatus: 401 });
    await store.load();
    const result = await store.runSync();
    expect(result.kind).toBe("auth");
    // The connection itself survives; the UI offers reconnect.
    expect(store.getState().connection).toBe("connected");
  });

  test("network failure (TypeError) classifies as network", async () => {
    const storage = new FakeStorage();
    storage.secrets = credentialsJson();
    const http = new FakeHttp();
    http.handler = async () => {
      throw new TypeError("connection refused");
    };
    const store = new SyncStore(storage, http);
    await store.load();
    expect((await store.runSync()).kind).toBe("network");
  });

  test("timeout classifies as network", async () => {
    const storage = new FakeStorage();
    storage.secrets = credentialsJson();
    const http = new FakeHttp();
    http.handler = () => new Promise<HttpResponse>(() => {}); // never resolves
    const store = new SyncStore(storage, http, { timeoutMs: 30 });
    await store.load();
    expect((await store.runSync()).kind).toBe("network");
  });

  test("Retry-After on a failed info fetch surfaces a server result", async () => {
    const { store, http } = connectedStore({
      infoStatus: 503,
      infoHeaders: { "Retry-After": "120" },
    });
    await store.load();
    const result = await store.runSync();
    expect(result.kind).toBe("server");
    if (result.kind !== "ok") expect(result.retryAfterSeconds).toBe(120);
    // The backoff stops the cycle before any collection fetch.
    expect(http.calls.filter((c) => c.url.includes("/storage/")).length).toBe(0);
  });

  test("a 200 with a backoff hint still uses the data", async () => {
    const { store } = connectedStore({
      infoHeaders: { "X-Weave-Backoff": "60" },
    });
    await store.load();
    const result = await store.runSync();
    expect(result.kind).toBe("ok");
    expect(store.getState().tree).not.toBeNull();
  });

  test("5xx without Retry-After is a plain server error", async () => {
    const { store } = connectedStore({ infoStatus: 503 });
    await store.load();
    expect((await store.runSync()).kind).toBe("server");
  });

  test("undecryptable crypto/keys is a protocol error and keeps the old tree", async () => {
    const { store, http } = connectedStore();
    await store.load();
    await store.runSync(); // populate tree first
    const treeBefore = store.getState().tree;
    const wrongBundle = bundleFromKeys();
    let bumped = false;
    const original = http.handler;
    http.handler = chainHandlers(original, async (request) => {
      if (request.url === `${API_ENDPOINT}/info/collections`) {
        bumped = true;
        return { status: 200, body: JSON.stringify({ bookmarks: 9.5 }) };
      }
      if (request.url === `${API_ENDPOINT}/storage/crypto?full=1` && bumped) {
        return {
          status: 200,
          body: JSON.stringify([bso("keys", envelope(wrongBundle.bundle, KEYS_PAYLOAD))]),
        };
      }
      return undefined;
    });
    const result = await store.runSync();
    expect(result.kind).toBe("protocol");
    expect(store.getState().tree).toBe(treeBefore);
  });

  test("missing keys record is a protocol error", async () => {
    const { store } = connectedStore({ keysEnvelope: null, collectionsModified: 9.5 });
    await store.load();
    expect((await store.runSync()).kind).toBe("protocol");
  });

  test("concurrent calls share one flight", async () => {
    const { store, http } = connectedStore();
    await store.load();
    const [a, b] = await Promise.all([store.runSync(), store.runSync()]);
    expect(a).toEqual(b);
    expect(http.calls.filter((c) => c.url.includes("/info/collections")).length).toBe(1);
  });

  test("disconnected store never touches the network", async () => {
    const http = new FakeHttp();
    const store = new SyncStore(new FakeStorage(), http);
    const result = await store.runSync();
    expect(result.kind).toBe("protocol");
    expect(http.calls.length).toBe(0);
  });
});

describe("connect()", () => {
  function connectFixture() {
    const storage = new FakeStorage();
    const http = new FakeHttp();
    const { url, request } = buildAuthorizationFlow(randomBytes);
    const scoped = JSON.stringify({
      "https://identity.mozilla.com/apps/oldsync": {
        kty: "oct",
        scope: "https://identity.mozilla.com/apps/oldsync",
        k: KSYNC,
        kid: "1750000000-kid",
      },
    });
    const jwe = keysJweFor(request.keys, scoped);
    return { storage, http, url, request, jwe };
  }

  test("exchange → keys_jwe → credentials persisted, email fetched", async () => {
    const { storage, http, url, request, jwe } = connectFixture();
    let sawVerifier = false;
    http.handler = async (call) => {
      if (call.url === "https://oauth.accounts.firefox.com/v1/token") {
        sawVerifier = !!call.body?.includes("code_verifier=");
        return {
          status: 200,
          body: JSON.stringify({
            access_token: "access-1",
            refresh_token: REFRESH_TOKEN,
            expires_in: 900,
            keys_jwe: jwe,
            scope: "profile https://identity.mozilla.com/apps/oldsync",
          }),
        };
      }
      if (call.url === "https://profile.accounts.firefox.com/v1/profile") {
        return { status: 200, body: JSON.stringify({ email: "zen@example.com" }) };
      }
      return { status: 404, body: "" };
    };
    const store = new SyncStore(storage, http);
    await store.connect(request, "the-auth-code");
    expect(sawVerifier).toBe(true);
    const state = store.getState();
    expect(state.connection).toBe("connected");
    expect(state.email).toBe("zen@example.com");
    const persisted = readPersistedCredentials(storage.secrets);
    expect(persisted?.kSync).toBe(KSYNC);
    expect(persisted?.kid).toBe("1750000000-kid");
    expect(persisted?.refreshToken).toBe(REFRESH_TOKEN);
    // The tree channel is untouched by connect.
    expect(storage.treeWrites.length).toBe(0);
    expect(url).toContain("accounts.firefox.com/authorization");
  });

  test("duplicate connect calls share the single flight", async () => {
    const { storage, http, request, jwe } = connectFixture();
    http.handler = async () => ({
      status: 200,
      body: JSON.stringify({
        access_token: "access-1",
        refresh_token: REFRESH_TOKEN,
        expires_in: 900,
        keys_jwe: jwe,
        scope: "profile",
      }),
    });
    const store = new SyncStore(storage, http);
    await Promise.all([store.connect(request, "code-1"), store.connect(request, "code-2")]);
    expect(
      http.calls.filter((c) => c.url.includes("oauth.accounts.firefox.com")).length
    ).toBe(1);
  });

  test("fxa 400 (invalid grant) classifies as auth and stays disconnected", async () => {
    const { storage, http, request } = connectFixture();
    http.handler = async () => ({
      status: 400,
      body: JSON.stringify({ errno: 105 }),
    });
    const store = new SyncStore(storage, http);
    await expect(store.connect(request, "bad-code")).rejects.toThrow();
    expect(store.getState().connection).toBe("disconnected");
    expect(storage.secretsWrites.length).toBe(0);
  });

  test("a failed credentials save never connects — no session-only state (F-G3S-2)", async () => {
    const { storage, http, request, jwe } = connectFixture();
    http.handler = async () => ({
      status: 200,
      body: JSON.stringify({
        access_token: "access-1",
        refresh_token: REFRESH_TOKEN,
        expires_in: 900,
        keys_jwe: jwe,
        scope: "profile",
      }),
    });
    storage.saveSecrets = async () => {
      throw new Error("keystore rejected the write");
    };
    const store = new SyncStore(storage, http);
    await expect(store.connect(request, "code")).rejects.toThrow(
      "keystore rejected the write"
    );
    const state = store.getState();
    expect(state.connection).toBe("disconnected");
    expect(state.email).toBeNull();
    // And the session-only credentials are gone: no network on a later sync.
    const callsAfterFailure = http.calls.length;
    const result = await store.runSync();
    expect(result.kind).toBe("protocol");
    expect(http.calls.length).toBe(callsAfterFailure);
  });

  test("a disconnect racing the code exchange cancels the connection (F-G3S-7)", async () => {
    const { storage, http, request, jwe } = connectFixture();
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    http.handler = async (call) => {
      if (call.url === "https://oauth.accounts.firefox.com/v1/token") {
        await gate;
        return {
          status: 200,
          body: JSON.stringify({
            access_token: "access-1",
            refresh_token: REFRESH_TOKEN,
            expires_in: 900,
            keys_jwe: jwe,
            scope: "profile",
          }),
        };
      }
      return { status: 404, body: "" };
    };
    const store = new SyncStore(storage, http);
    const connecting = store.connect(request, "code");
    // Let the flight park inside the gated token exchange, then cancel it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await store.disconnect();
    release!();
    await connecting;
    const state = store.getState();
    expect(state.connection).toBe("disconnected");
    expect(state.email).toBeNull();
    expect(storage.secretsWrites.length).toBe(0);
  });
});

describe("disconnect()", () => {
  test("clears both channels and resets state", async () => {
    const { store, storage } = connectedStore();
    await store.load();
    await store.runSync();
    expect(storage.tree).not.toBeNull();
    await store.disconnect();
    const state = store.getState();
    expect(state.connection).toBe("disconnected");
    expect(state.tree).toBeNull();
    expect(state.email).toBeNull();
    expect(state.lastResult).toBeNull();
    expect(storage.secretsClears).toBe(1);
    expect(storage.treeClears).toBe(1);
    expect(storage.secrets).toBeNull();
    expect(storage.tree).toBeNull();
    // A later runSync is a no-op — no reconnection, no network.
    await store.runSync();
  });

  test("a sync completing after disconnect does not resurrect the tree (F-G3S-6)", async () => {
    const { store, storage, http } = connectedStore();
    await store.load();
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = http.handler;
    http.handler = async (request) => {
      if (request.url.includes("storage/bookmarks")) await gate;
      return base(request);
    };
    const syncing = store.runSync();
    // Park the flight inside the gated bookmarks fetch, then disconnect.
    // disconnect awaits the in-flight sync (outbound bookkeeping) before
    // clearing channels, so the sync may persist briefly — final state must
    // still be wiped.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const disconnecting = store.disconnect();
    release!();
    const result = await syncing;
    await disconnecting;
    expect(result.kind).toBe("ok");
    const state = store.getState();
    expect(state.connection).toBe("disconnected");
    expect(state.tree).toBeNull();
    expect(state.lastResult).toBeNull();
    expect(storage.tree).toBeNull();
    expect(storage.secrets).toBeNull();
  });
});

describe("storage channel isolation (V-5)", () => {
  test("credentials never appear in the tree channel and vice versa", async () => {
    const { store, storage } = connectedStore();
    await store.load();
    await store.runSync();
    const tokenMarkers = [REFRESH_TOKEN, KSYNC, "1750000000-kid"];
    for (const write of storage.treeWrites) {
      for (const marker of tokenMarkers) {
        expect(write.includes(marker)).toBe(false);
      }
    }
    for (const write of storage.secretsWrites) {
      expect(write.includes("menu________")).toBe(false);
      expect(write.includes("https://one.example")).toBe(false);
      expect(write.includes("roots")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Upload orchestration matrix (V-4 / T-6) — SyncStore receive → merge → POST

describe("upload orchestration (V-4)", () => {
  test("D10 initial full upload marks local snapshot dirty and POSTs bookmarks", async () => {
    const adapter = new MockLocalAdapter(
      localSnapshot([
        { id: "lb1", title: "One", url: "https://local-one.example" },
        { id: "lb2", title: "Two", url: "https://local-two.example" },
      ])
    );
    const { store, storage, http } = connectedStoreWithAdapter(adapter, {
      postModified: 8.5,
    });
    await store.load();
    const result = await store.runSync();
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.uploaded).toBeGreaterThan(0);
    expect(postCalls(http).length).toBeGreaterThan(0);
    expect(http.storageHawkOk).toBe(true);
    const outbound = deserializeOutbound(storage.outbound);
    expect(Object.keys(outbound?.dirty ?? {}).length).toBe(0);
    expect(store.getState().pendingUploads).toBe(0);
    const tree = readPersistedTree(storage.tree);
    expect(tree?.bookmarksModified).toBe(8.5);
  });

  test("early-skip still uploads when noteLocalChange dirtied outbound", async () => {
    const adapter = new MockLocalAdapter(
      localSnapshot([{ id: "lb1", title: "One", url: "https://local-one.example" }])
    );
    const { store, http } = connectedStoreWithAdapter(adapter, {
      collectionsModified: 8.5,
      postModified: 8.5,
    });
    await store.load();
    await store.runSync();
    const getsAfterFirst = bookmarkGetCalls(http);
    store.noteLocalChange("lb1", 5_000_000_001);
    expect(store.getState().pendingUploads).toBe(1);
    const second = await store.runSync();
    expect(second.kind).toBe("ok");
    if (second.kind === "ok") expect(second.uploaded).toBeGreaterThan(0);
    expect(bookmarkGetCalls(http)).toBe(getsAfterFirst);
    expect(postCalls(http).length).toBeGreaterThanOrEqual(2);
  });

  test("LWW remote wins: older dirty local yields to newer remote without re-upload", async () => {
    const adapter = new MockLocalAdapter(
      localSnapshot([{ id: "lb1", title: "Local", url: "https://local.example" }])
    );
    const { store, storage, http } = connectedStoreWithAdapter(adapter, {}, () => 5_000_000_000);
    await store.load();
    await store.runSync();
    const mappedGuid = deserializeOutbound(storage.outbound)?.guidByLocalId.lb1;
    expect(mappedGuid).toBeTruthy();
    const postsAfterFirst = postCalls(http).length;

    const base = http.handler;
    let useLwwRemote = false;
    http.handler = chainHandlers(base, async (request) => {
      if (request.url === `${API_ENDPOINT}/info/collections`) {
        if (useLwwRemote) {
          return { status: 200, body: JSON.stringify({ bookmarks: 9.0 }) };
        }
      }
      if (request.url === `${API_ENDPOINT}/storage/bookmarks?full=1` && useLwwRemote) {
        const records = mobileRemoteBookmarkRecords(
          mappedGuid!,
          4.0,
          "Remote wins",
          "https://r.example"
        );
        return {
          status: 200,
          body: JSON.stringify(
            records.map((r) => bso(r.id, r.payload, r.modified ?? 1.0))
          ),
        };
      }
      if (
        request.method === "POST" &&
        request.url.startsWith(`${API_ENDPOINT}/storage/bookmarks`) &&
        useLwwRemote
      ) {
        return { status: 404, body: "" };
      }
      return undefined;
    });

    adapter.incoming = [];
    store.noteLocalChange("lb1", 1_000);
    useLwwRemote = true;
    const result = await store.runSync();
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.uploaded).toBe(0);
    expect(adapter.incoming.some((op) => op.kind === "upsertBookmark")).toBe(true);
    expect(deserializeOutbound(storage.outbound)?.dirty.lb1).toBeUndefined();
    expect(postCalls(http).length).toBe(postsAfterFirst);
  });

  test("LWW local wins: newer dirty local is kept and uploaded", async () => {
    const adapter = new MockLocalAdapter(
      localSnapshot([{ id: "lb1", title: "Local", url: "https://local.example" }])
    );
    const { store, storage, http } = connectedStoreWithAdapter(adapter, {}, () => 5_000_000_000);
    await store.load();
    await store.runSync();
    const mappedGuid = deserializeOutbound(storage.outbound)?.guidByLocalId.lb1!;
    const postsAfterFirst = postCalls(http).length;

    const base = http.handler;
    let lwwRound = false;
    http.handler = chainHandlers(base, async (request) => {
      if (request.url === `${API_ENDPOINT}/info/collections` && lwwRound) {
        return { status: 200, body: JSON.stringify({ bookmarks: 9.0 }) };
      }
      if (request.url === `${API_ENDPOINT}/storage/bookmarks?full=1` && lwwRound) {
        const records = mobileRemoteBookmarkRecords(
          mappedGuid,
          2.0,
          "Stale remote",
          "https://old.example"
        );
        return {
          status: 200,
          body: JSON.stringify(
            records.map((r) => bso(r.id, r.payload, r.modified ?? 1.0))
          ),
        };
      }
      return undefined;
    });

    adapter.incoming = [];
    store.noteLocalChange("lb1", 9_000);
    lwwRound = true;
    const result = await store.runSync();
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.uploaded).toBeGreaterThan(0);
    expect(postCalls(http).length).toBeGreaterThan(postsAfterFirst);
    expect(deserializeOutbound(storage.outbound)?.dirty.lb1).toBeUndefined();
    expect(adapter.incoming.filter((op) => op.kind === "upsertBookmark")).toHaveLength(0);
  });

  test("LWW tie on timestamps: remote wins (PLAN §2)", async () => {
    const adapter = new MockLocalAdapter(
      localSnapshot([{ id: "lb1", title: "Local", url: "https://local.example" }])
    );
    const { store, storage, http } = connectedStoreWithAdapter(adapter, {}, () => 5_000_000_000);
    await store.load();
    await store.runSync();
    const mappedGuid = deserializeOutbound(storage.outbound)?.guidByLocalId.lb1!;
    const base = http.handler;
    let tieRound = false;
    http.handler = chainHandlers(base, async (request) => {
      if (request.url === `${API_ENDPOINT}/info/collections` && tieRound) {
        return { status: 200, body: JSON.stringify({ bookmarks: 9.0 }) };
      }
      if (request.url === `${API_ENDPOINT}/storage/bookmarks?full=1` && tieRound) {
        const records = mobileRemoteBookmarkRecords(
          mappedGuid,
          2.0,
          "Tie remote",
          "https://tie.example"
        );
        return {
          status: 200,
          body: JSON.stringify(
            records.map((r) => bso(r.id, r.payload, r.modified ?? 1.0))
          ),
        };
      }
      return undefined;
    });
    adapter.incoming = [];
    store.noteLocalChange("lb1", 2_000);
    tieRound = true;
    await store.runSync();
    expect(adapter.incoming.some((op) => op.kind === "upsertBookmark")).toBe(true);
    expect(deserializeOutbound(storage.outbound)?.dirty.lb1).toBeUndefined();
  });

  test("412 on POST aborts as server and preserves dirty outbound", async () => {
    const adapter = new MockLocalAdapter(
      localSnapshot([{ id: "lb1", title: "One", url: "https://one.example" }])
    );
    const { store, storage, http } = connectedStoreWithAdapter(adapter, {
      collectionsModified: 8.5,
      postModified: 8.5,
    });
    await store.load();
    await store.runSync();
    store.noteLocalChange("lb1", 6_000_000_000);
    const base = http.handler;
    let rejectPost = true;
    http.handler = chainHandlers(base, async (request) => {
      if (
        rejectPost &&
        request.method === "POST" &&
        request.url.startsWith(`${API_ENDPOINT}/storage/bookmarks`)
      ) {
        return {
          status: 412,
          headers: { "X-Last-Modified": "8.5" },
          body: JSON.stringify({}),
        };
      }
      return undefined;
    });
    const result = await store.runSync();
    expect(result.kind).toBe("server");
    if (result.kind !== "ok") expect(result.retryAfterSeconds).toBeNull();
    expect(store.getState().pendingUploads).toBeGreaterThan(0);
    expect(deserializeOutbound(storage.outbound)?.dirty.lb1).toBeDefined();
  });

  test("tombstone upload ack clears pendingDeletes", async () => {
    const adapter = new MockLocalAdapter(
      localSnapshot([{ id: "lb1", title: "One", url: "https://one.example" }])
    );
    const { store, storage, http } = connectedStoreWithAdapter(adapter);
    await store.load();
    await store.runSync();
    store.noteLocalDelete("lb1", 6_100_000_000);
    expect(store.getState().pendingUploads).toBe(1);
    const result = await store.runSync();
    expect(result.kind).toBe("ok");
    const post = postCalls(http).at(-1);
    expect(post?.body).toBeDefined();
    const posted = JSON.parse(post!.body!) as Array<{ id: string; payload: string }>;
    const tombstone = posted.find((item) => {
      const cleartext = decryptRecordCleartext(BOOKMARK_KEYS.bundle, {
        id: item.id,
        payload: item.payload,
        modified: 1,
      });
      return cleartext.includes('"deleted":true');
    });
    expect(tombstone).toBeDefined();
    const outbound = deserializeOutbound(storage.outbound);
    expect(outbound?.pendingDeletes.lb1).toBeUndefined();
    expect(store.getState().pendingUploads).toBe(0);
  });

  test("disconnect clears outbound channel after upload bookkeeping", async () => {
    const adapter = new MockLocalAdapter(
      localSnapshot([{ id: "lb1", title: "One", url: "https://one.example" }])
    );
    const { store, storage } = connectedStoreWithAdapter(adapter);
    await store.load();
    await store.runSync();
    store.noteLocalChange("lb2", 6_000_000_000);
    expect(storage.outboundWrites.length).toBeGreaterThan(0);
    await store.disconnect();
    expect(storage.outboundClears).toBe(1);
    expect(storage.outbound).toBeNull();
    expect(store.getState().pendingUploads).toBe(0);
  });

  test("runSync exposes pendingUploads and ok result received/uploaded counts", async () => {
    const adapter = new MockLocalAdapter(
      localSnapshot([{ id: "lb1", title: "One", url: "https://one.example" }])
    );
    const { store } = connectedStoreWithAdapter(adapter, {
      collectionsModified: 8.5,
      postModified: 8.5,
    });
    await store.load();
    await store.runSync();
    store.noteLocalChange("lb1", 6_000_000_001);
    expect(store.getState().pendingUploads).toBe(1);
    const syncingSeen: boolean[] = [];
    const unsubscribe = store.subscribe(() => syncingSeen.push(store.getState().syncing));
    const result = await store.runSync();
    unsubscribe();
    expect(syncingSeen).toContain(true);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.received).toBe(0);
      expect(result.uploaded).toBeGreaterThan(0);
    }
    expect(store.getState().pendingUploads).toBe(0);
  });

  test("mobile-rooted remote bookmark triggers applyIncoming (echo/merge)", async () => {
    const adapter = new MockLocalAdapter(localSnapshot([]));
    const script = {
      collectionsModified: 7.5,
      bookmarksRecords: mobileRemoteBookmarkRecords("remoteguid01", 5.0),
    };
    const { store } = connectedStoreWithAdapter(adapter, script);
    await store.load();
    const result = await store.runSync();
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.received).toBeGreaterThanOrEqual(1);
    expect(adapter.incoming.some((op) => op.kind === "upsertBookmark")).toBe(true);
  });

  test("P0: initial upload forces receive when tree cache matches but remoteRaw empty", async () => {
    const zenGuid = "zenonlyguid01";
    const adapter = new MockLocalAdapter(
      localSnapshot([{ id: "lb1", title: "Local", url: "https://local.example" }])
    );
    const { store, storage, http } = connectedStoreWithAdapter(adapter, {
      collectionsModified: 7.25,
      bookmarksRecords: mobileRemoteBookmarkRecords(
        zenGuid,
        5.0,
        "Zen Only",
        "https://zen-only.example"
      ),
      postModified: 8.5,
    });
    // Phase-1 leftover: matching tree cache, empty outbound (no remoteRaw).
    storage.tree = JSON.stringify({
      roots: [{ guid: "mobile", type: "folder", title: "mobile", children: [] }],
      fetchedAt: 1,
      bookmarksModified: 7.25,
    });
    await store.load();
    expect(deserializeOutbound(storage.outbound)).toBeNull();
    const result = await store.runSync();
    expect(result.kind).toBe("ok");
    expect(bookmarkGetCalls(http)).toBeGreaterThan(0);
    const mobilePost = postCalls(http)
      .flatMap((call) => JSON.parse(call.body!) as Array<{ id: string; payload: string }>)
      .find((item) => item.id === "mobile");
    expect(mobilePost).toBeDefined();
    const cleartext = JSON.parse(
      decryptRecordCleartext(BOOKMARK_KEYS.bundle, {
        id: "mobile",
        payload: mobilePost!.payload,
        modified: 1,
      })
    ) as { children?: string[] };
    expect(cleartext.children).toContain(zenGuid);
  });

  test("POST 503 surfaces Retry-After on SyncResult", async () => {
    const adapter = new MockLocalAdapter(
      localSnapshot([{ id: "lb1", title: "One", url: "https://one.example" }])
    );
    const { store, http } = connectedStoreWithAdapter(adapter, {
      collectionsModified: 8.5,
      postModified: 8.5,
    });
    await store.load();
    await store.runSync();
    store.noteLocalChange("lb1", 6_000_000_000);
    const base = http.handler;
    http.handler = chainHandlers(base, async (request) => {
      if (
        request.method === "POST" &&
        request.url.startsWith(`${API_ENDPOINT}/storage/bookmarks`)
      ) {
        return {
          status: 503,
          headers: { "Retry-After": "17" },
          body: "",
        };
      }
      return undefined;
    });
    const result = await store.runSync();
    expect(result.kind).toBe("server");
    if (result.kind !== "ok") expect(result.retryAfterSeconds).toBe(17);
    expect(store.getState().pendingUploads).toBeGreaterThan(0);
  });

  test("disconnect waits for in-flight sync so POST ack persists before clear", async () => {
    const adapter = new MockLocalAdapter(
      localSnapshot([{ id: "lb1", title: "One", url: "https://one.example" }])
    );
    const { store, storage, http } = connectedStoreWithAdapter(adapter, {
      postModified: 8.5,
    });
    await store.load();
    let releasePost: (() => void) | null = null;
    const postGate = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    const base = http.handler;
    http.handler = async (request) => {
      if (
        request.method === "POST" &&
        request.url.startsWith(`${API_ENDPOINT}/storage/bookmarks`)
      ) {
        await postGate;
      }
      return base(request);
    };
    const syncing = store.runSync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const disconnecting = store.disconnect();
    releasePost!();
    await syncing;
    await disconnecting;
    // Cleared after the flight finished — no resurrected connection state.
    expect(store.getState().connection).toBe("disconnected");
    expect(storage.outbound).toBeNull();
    expect(storage.outboundClears).toBe(1);
  });

  test("reconcileLocalToRemote reuses server GUIDs by URL after outbound clear", () => {
    const state = emptyOutboundState();
    noteRemoteRecord(
      state,
      "serverguid01",
      {
        id: "serverguid01",
        type: "bookmark",
        title: "One",
        bmkUri: "https://one.example",
        parentid: "mobile",
      },
      1000
    );
    markAllDirty(
      state,
      localSnapshot([{ id: "lb1", title: "One", url: "https://one.example" }]),
      2000
    );
    reconcileLocalToRemote(
      state,
      localSnapshot([{ id: "lb1", title: "One", url: "https://one.example" }])
    );
    expect(state.guidByLocalId.lb1).toBe("serverguid01");
    expect(state.dirty.lb1).toBeUndefined();
  });

  test("reconcileLocalToRemote ignores menu/toolbar receive-only bookmarks", () => {
    const state = emptyOutboundState();
    noteRemoteRecord(
      state,
      "b1",
      {
        id: "b1",
        type: "bookmark",
        title: "One",
        bmkUri: "https://one.example",
        parentid: "menu________",
      },
      1000
    );
    markAllDirty(
      state,
      localSnapshot([{ id: "lb1", title: "One", url: "https://one.example" }]),
      2000
    );
    reconcileLocalToRemote(
      state,
      localSnapshot([{ id: "lb1", title: "One", url: "https://one.example" }])
    );
    expect(state.guidByLocalId.lb1).toBeUndefined();
    expect(state.dirty.lb1).toBeDefined();
  });
});
