// Firefox Sync (receive-only) store & orchestrator. Owns the connection
// lifecycle and the two persisted channels:
//   - credentials (refresh token + kSync + kid + email) → the host's
//     encrypted-secrets channel, never any other storage
//   - the last fetched bookmark tree → the plaintext tree channel
// The history.ts pattern applies: injected storage, subscribe, generation
// guards against clobbering, and serialized save queues per channel.
// Every network call lives in connect()/runSync() — nothing fires while
// disconnected (AC-6), and Phase 1 issues GET requests only.

import {
  AuthorizationRequest,
  exchangeCode,
  fetchProfileEmail,
  FxaHttpError,
  HttpTransport,
  OLD_SYNC_SCOPE,
  refreshAccessToken,
  decryptScopedKeys,
} from "./sync/fxa";
import {
  decryptRecord,
  decryptRecordCleartext,
  fetchCollection,
  fetchInfoCollections,
  fetchTokenserverToken,
  SyncServerError,
  collectionKeysFromCleartext,
  kSyncBundle,
  tokenserverTokenValid,
} from "./sync/sync15";
import {
  BookmarkRecord,
  buildSyncTree,
  DecryptedRecord,
} from "./sync/bookmarkTree";
import { SyncErrorKind, SyncNode, SyncTree, TokenserverInfo } from "./sync/model";

// ---------------------------------------------------------------------------
// Public state

export type SyncConnectionState = "disconnected" | "connecting" | "connected";

export type SyncResult =
  | { kind: "ok"; atMs: number; changed: boolean }
  | {
      kind: SyncErrorKind;
      atMs: number;
      retryAfterSeconds: number | null;
    };

export interface SyncStoreState {
  connection: SyncConnectionState;
  syncing: boolean;
  email: string | null;
  tree: SyncTree | null;
  lastSyncAtMs: number | null;
  lastResult: SyncResult | null;
}

export interface SyncPlatformStorage {
  readSecrets?: () => Promise<string | null>;
  saveSecrets?: (json: string) => Promise<void>;
  clearSecrets?: () => Promise<void>;
  readTree?: () => Promise<string | null>;
  saveTree?: (json: string) => Promise<void>;
  clearTree?: () => Promise<void>;
}

interface PersistedCredentials {
  v: 1;
  refreshToken: string;
  kSync: string;
  kid: string;
  email: string | null;
}

const BATCH_SIZE = 64; // F-G1-2: yield between decrypt batches on Hermes
const DEFAULT_TIMEOUT_MS = 30_000;

/** Storage GET returned 401 — one automatic recovery round is allowed. */
class StorageUnauthorizedError extends Error {}

/** The injected transport (or our timeout race) failed to answer at all. */
class TransportTimeoutError extends Error {}

/** Structural protocol failure: missing/invalid records or schema breaks. */
class ProtocolFormatError extends Error {}

// ---------------------------------------------------------------------------
// Error classification (F-G1-1 matrix)

export function classifySyncFailure(failure: unknown): SyncErrorKind {
  if (failure instanceof StorageUnauthorizedError) return "auth";
  if (failure instanceof TransportTimeoutError) return "network";
  if (failure instanceof ProtocolFormatError) return "protocol";
  if (failure instanceof FxaHttpError) {
    // 400 covers invalid_grant/invalid_client; 401/403 bad token or scope.
    if (failure.status === 400 || failure.status === 401 || failure.status === 403)
      return "auth";
    return "server";
  }
  if (failure instanceof SyncServerError) {
    if (failure.status === 401 || failure.status === 403) return "auth";
    return "server";
  }
  if (failure instanceof TypeError) return "network";
  if (failure instanceof SyntaxError) return "protocol";
  const message =
    typeof failure === "object" && failure !== null && "message" in failure
      ? String((failure as { message: unknown }).message)
      : "";
  if (
    /hmac|envelope|cbc|gcm|aes-|base64|json|kSync|jwe|kid|scope|token endpoint/i.test(
      message
    )
  )
    return "protocol";
  return "network";
}

// ---------------------------------------------------------------------------
// Store

export class SyncStore {
  private storage: SyncPlatformStorage;
  private rawHttp: HttpTransport;
  private http: HttpTransport;
  private nowMs: () => number;
  private yieldControl: () => Promise<void>;
  private nonce: () => string;
  private timeoutMs: number;

  private listeners = new Set<() => void>();
  private state: SyncStoreState = {
    connection: "disconnected",
    syncing: false,
    email: null,
    tree: null,
    lastSyncAtMs: null,
    lastResult: null,
  };

  private credentials: PersistedCredentials | null = null;
  private accessToken: string | null = null;
  private accessTokenExpiresAtMs = 0;
  private tokenserver: TokenserverInfo | null = null;

  /** Bumped by connect/disconnect so late loads/persists cannot clobber. */
  private generation = 0;
  private loadPromise: Promise<void> | null = null;
  private connectFlight: Promise<void> | null = null;
  private syncFlight: Promise<SyncResult> | null = null;
  private secretsQueue: Promise<void> = Promise.resolve();
  private treeQueue: Promise<void> = Promise.resolve();

  constructor(
    storage: SyncPlatformStorage = {},
    http: HttpTransport = unreachableHttp(),
    options: {
      nowMs?: () => number;
      yieldControl?: () => Promise<void>;
      nonce?: () => string;
      timeoutMs?: number;
    } = {}
  ) {
    this.storage = storage;
    this.rawHttp = http;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.yieldControl = options.yieldControl ?? immediateYield;
    this.nonce = options.nonce ?? randomNonce;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.http = { request: (input) => this.withTimeout(this.rawHttp.request(input)) };
  }

  attach(storage: SyncPlatformStorage, http: HttpTransport) {
    this.storage = storage;
    this.rawHttp = http;
    this.http = { request: (input) => this.withTimeout(this.rawHttp.request(input)) };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState(): SyncStoreState {
    return { ...this.state, tree: this.state.tree };
  }

  private changed() {
    this.listeners.forEach((listener) => listener());
  }

  // -- persistence ---------------------------------------------------------

  /** Loads persisted credentials + tree. A connect/disconnect that lands
   *  mid-load invalidates the read (generation guard). */
  load(): Promise<void> {
    if (!this.loadPromise) {
      const generation = this.generation;
      const readSecrets = this.storage.readSecrets;
      const readTree = this.storage.readTree;
      this.loadPromise = Promise.all([
        // Channel-isolated reads: a corrupted tree file must not discard
        // perfectly valid credentials (and vice versa) — a failed channel is
        // treated as absent and the next sync rebuilds it.
        typeof readSecrets === "function"
          ? Promise.resolve()
              .then(readSecrets)
              .catch(() => null)
          : Promise.resolve(null),
        typeof readTree === "function"
          ? Promise.resolve()
              .then(readTree)
              .catch(() => null)
          : Promise.resolve(null),
      ])
        .then(([secretsJson, treeJson]) => {
          if (generation !== this.generation) return;
          const credentials = readPersistedCredentials(secretsJson);
          this.credentials = credentials;
          this.accessToken = null;
          this.accessTokenExpiresAtMs = 0;
          this.tokenserver = null;
          this.state = {
            ...this.state,
            connection: credentials ? "connected" : "disconnected",
            email: credentials?.email ?? null,
            tree: credentials ? readPersistedTree(treeJson) : null,
          };
          this.changed();
        })
        .catch(() => {
          // Unreadable storage is not fatal: stay disconnected, AC-6 intact.
        })
        .then(() => undefined);
    }
    return this.loadPromise;
  }

  private persistSecrets(credentials: PersistedCredentials, generation: number) {
    const save = this.storage.saveSecrets;
    if (typeof save !== "function") return Promise.resolve();
    const operation = this.secretsQueue.then(() =>
      generation === this.generation
        ? save(JSON.stringify(credentials))
        : undefined
    );
    this.secretsQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  private persistTree(tree: SyncTree, generation: number) {
    const save = this.storage.saveTree;
    if (typeof save !== "function") return Promise.resolve();
    const operation = this.treeQueue.then(() =>
      generation === this.generation
        ? save(JSON.stringify(tree))
        : undefined
    );
    this.treeQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  // -- connect / disconnect ------------------------------------------------

  /** Exchanges the OAuth code (single flight — a duplicate login event is
   *  ignored rather than re-exchanging). Throws classified errors. */
  connect(request: AuthorizationRequest, code: string): Promise<void> {
    if (this.state.connection === "connected") return Promise.resolve();
    if (this.connectFlight) return this.connectFlight;
    this.connectFlight = this.connectOnce(request, code).finally(() => {
      this.connectFlight = null;
    });
    return this.connectFlight;
  }

  private async connectOnce(request: AuthorizationRequest, code: string) {
    this.generation += 1;
    const generation = this.generation;
    this.state = { ...this.state, connection: "connecting" };
    this.changed();
    try {
      const tokens = await exchangeCode(this.http, code, request.codeVerifier);
      if (!tokens.refreshToken) {
        throw new Error("token endpoint returned no offline grant");
      }
      // decryptScopedKeys throws plain protocol-shaped errors on mismatch.
      const scoped = decryptScopedKeys(tokens.keysJwe ?? "", request.keys);
      const oldsync = scoped[OLD_SYNC_SCOPE];
      const credentials: PersistedCredentials = {
        v: 1,
        refreshToken: tokens.refreshToken,
        kSync: oldsync.k,
        kid: oldsync.kid,
        email: null,
      };
      // Persist before declaring connected: a failed save must not leave a
      // session-only "connected" state that silently drops on restart, and a
      // disconnect that raced the awaits owns the state now — bail out.
      await this.persistSecrets(credentials, generation);
      if (generation !== this.generation) return;
      this.credentials = credentials;
      this.accessToken = tokens.accessToken;
      this.accessTokenExpiresAtMs =
        this.nowMs() + tokens.expiresInSeconds * 1000;
      this.tokenserver = null;
      this.state = {
        ...this.state,
        connection: "connected",
        email: null,
        tree: null,
        lastSyncAtMs: null,
        lastResult: null,
      };
      this.changed();
      // Email is display-only: a profile failure never breaks the connection.
      try {
        const email = await fetchProfileEmail(this.http, tokens.accessToken);
        if (email && this.credentials === credentials && generation === this.generation) {
          this.credentials = { ...credentials, email };
          this.state = { ...this.state, email };
          this.changed();
          await this.persistSecrets(this.credentials, generation);
        }
      } catch {
        // best-effort
      }
    } catch (failure) {
      if (this.state.connection === "connecting") {
        this.state = { ...this.state, connection: "disconnected" };
        this.changed();
      }
      throw failure;
    }
  }

  /** Disconnect: clears both persisted channels and all in-memory state.
   *  In-flight syncs observe the generation bump and skip their writes. */
  async disconnect(): Promise<void> {
    this.generation += 1;
    this.credentials = null;
    this.accessToken = null;
    this.accessTokenExpiresAtMs = 0;
    this.tokenserver = null;
    this.state = {
      connection: "disconnected",
      syncing: false,
      email: null,
      tree: null,
      lastSyncAtMs: null,
      lastResult: null,
    };
    this.changed();
    const clearSecrets = this.storage.clearSecrets;
    const clearTree = this.storage.clearTree;
    const secretsClear =
      typeof clearSecrets === "function"
        ? this.secretsQueue.then(() => clearSecrets())
        : Promise.resolve();
    const treeClear =
      typeof clearTree === "function"
        ? this.treeQueue.then(() => clearTree())
        : Promise.resolve();
    this.secretsQueue = secretsClear.then(
      () => undefined,
      () => undefined
    );
    this.treeQueue = treeClear.then(
      () => undefined,
      () => undefined
    );
    await Promise.all([secretsClear, treeClear]);
  }

  // -- sync ----------------------------------------------------------------

  /** Runs one receive-only cycle. Single flight: concurrent calls share the
   *  in-flight promise (F-G1-1). Returns the classified result. */
  runSync(): Promise<SyncResult> {
    if (!this.credentials) {
      // Defensive: no connection, no network (AC-6).
      return Promise.resolve({
        kind: "protocol",
        atMs: this.nowMs(),
        retryAfterSeconds: null,
      });
    }
    if (this.syncFlight) return this.syncFlight;
    this.syncFlight = this.runSyncGuarded().finally(() => {
      this.syncFlight = null;
    });
    return this.syncFlight;
  }

  private async runSyncGuarded(): Promise<SyncResult> {
    const generation = this.generation;
    this.state = { ...this.state, syncing: true };
    this.changed();
    let result: SyncResult;
    try {
      result = await this.syncWithRecovery();
    } catch (failure) {
      result = {
        kind: classifySyncFailure(failure),
        atMs: this.nowMs(),
        retryAfterSeconds: null,
      };
    }
    // A disconnect that raced the flight owns the state now: writing here
    // would resurrect the tree / last result the disconnect just cleared.
    if (generation === this.generation) {
      this.state = {
        ...this.state,
        syncing: false,
        lastSyncAtMs: result.kind === "ok" ? result.atMs : this.state.lastSyncAtMs,
        lastResult: result,
      };
      this.changed();
    }
    return result;
  }

  /** Storage 401 triggers exactly one recovery round (fresh access token →
   *  fresh tokenserver hawk credentials → replay); a second 401 is auth. */
  private async syncWithRecovery(): Promise<SyncResult> {
    let unauthorized = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.syncOnce();
      } catch (failure) {
        if (failure instanceof StorageUnauthorizedError && !unauthorized) {
          unauthorized = true;
          this.accessToken = null;
          this.accessTokenExpiresAtMs = 0;
          this.tokenserver = null;
          continue;
        }
        throw failure;
      }
    }
    throw new StorageUnauthorizedError();
  }

  private async syncOnce(): Promise<SyncResult> {
    const credentials = this.credentials;
    if (!credentials) throw new StorageUnauthorizedError();
    const generation = this.generation;
    const token = await this.ensureTokenserver();
    const context = {
      http: this.http,
      token,
      nowMs: this.nowMs,
      nonce: this.nonce,
    };

    const info = await fetchInfoCollections(context);
    if (info.status === 401) throw new StorageUnauthorizedError();
    if (info.status !== 200) {
      // Backoff headers only gate retries on failures: a 200 with a backoff
      // hint still carries data, and discarding it would fail a healthy sync.
      if (info.backoffSeconds !== null && info.backoffSeconds > 0) {
        return serverBackoff(info.backoffSeconds, this.nowMs());
      }
      throw new SyncServerError(info.status, `info/collections ${info.status}`);
    }

    const bookmarksModified = info.collections["bookmarks"];
    const currentTree = this.state.tree;
    if (
      currentTree &&
      (bookmarksModified === undefined ||
        bookmarksModified === currentTree.bookmarksModified)
    ) {
      return { kind: "ok", atMs: this.nowMs(), changed: false };
    }

    // crypto/keys — decrypt with the account kSync bundle.
    const cryptoCollection = await fetchCollection(context, "crypto");
    if (cryptoCollection.status === 401) throw new StorageUnauthorizedError();
    if (cryptoCollection.status !== 200) {
      if (cryptoCollection.backoffSeconds !== null && cryptoCollection.backoffSeconds > 0) {
        return serverBackoff(cryptoCollection.backoffSeconds, this.nowMs());
      }
      throw new SyncServerError(cryptoCollection.status, `crypto ${cryptoCollection.status}`);
    }
    const keysRecord = cryptoCollection.records.find((record) => record.id === "keys");
    if (!keysRecord) throw new ProtocolFormatError("crypto collection has no keys record");
    const bundles = collectionKeysFromCleartext(
      decryptRecordCleartext(kSyncBundle(credentials.kSync), keysRecord)
    );

    const bookmarks = await fetchCollection(context, "bookmarks");
    if (bookmarks.status === 401) throw new StorageUnauthorizedError();
    if (bookmarks.status !== 200) {
      if (bookmarks.backoffSeconds !== null && bookmarks.backoffSeconds > 0) {
        return serverBackoff(bookmarks.backoffSeconds, this.nowMs());
      }
      throw new SyncServerError(bookmarks.status, `bookmarks ${bookmarks.status}`);
    }

    // Batched decrypt — yield to the event loop between batches (F-G1-2)
    // so navigation/scroll stay responsive on Hermes.
    const decrypted: DecryptedRecord[] = [];
    for (let index = 0; index < bookmarks.records.length; index += 1) {
      decrypted.push(
        decryptRecord<BookmarkRecord>(bundles.forBookmarks, bookmarks.records[index])
      );
      if ((index + 1) % BATCH_SIZE === 0) await this.yieldControl();
    }

    const tree = buildSyncTree(decrypted, bookmarksModified ?? null);
    // Cancelled by a mid-flight disconnect: do not resurrect the tree.
    if (generation !== this.generation) {
      return { kind: "ok", atMs: this.nowMs(), changed: false };
    }
    this.state = { ...this.state, tree };
    this.changed();
    await this.persistTree(tree, generation);
    return { kind: "ok", atMs: this.nowMs(), changed: true };
  }

  private async ensureTokenserver(): Promise<TokenserverInfo> {
    if (
      this.tokenserver &&
      tokenserverTokenValid(this.tokenserver, this.nowMs())
    ) {
      return this.tokenserver;
    }
    const credentials = this.credentials;
    if (!credentials) throw new StorageUnauthorizedError();
    try {
      this.tokenserver = await fetchTokenserverToken(
        this.http,
        await this.ensureAccessToken(),
        credentials.kid
      );
      return this.tokenserver;
    } catch (failure) {
      // An expired/rejected access token answers 401 at the tokenserver:
      // force one refresh round and retry before declaring auth failure.
      if (failure instanceof SyncServerError && failure.status === 401) {
        this.accessToken = null;
        this.accessTokenExpiresAtMs = 0;
        this.tokenserver = await fetchTokenserverToken(
          this.http,
          await this.ensureAccessToken(),
          credentials.kid
        );
        return this.tokenserver;
      }
      throw failure;
    }
  }

  private async ensureAccessToken(): Promise<string> {
    if (this.accessToken && this.nowMs() < this.accessTokenExpiresAtMs - 60_000) {
      return this.accessToken;
    }
    const credentials = this.credentials;
    if (!credentials) throw new StorageUnauthorizedError();
    const tokens = await refreshAccessToken(this.http, credentials.refreshToken);
    this.accessToken = tokens.accessToken;
    this.accessTokenExpiresAtMs = this.nowMs() + tokens.expiresInSeconds * 1000;
    return this.accessToken;
  }

  private withTimeout<T>(operation: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new TransportTimeoutError("sync request timed out"));
      }, this.timeoutMs);
      operation.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (failure) => {
          clearTimeout(timer);
          reject(failure);
        }
      );
    });
  }
}

function serverBackoff(seconds: number, atMs: number): SyncResult {
  return { kind: "server", atMs, retryAfterSeconds: seconds };
}

function immediateYield(): Promise<void> {
  return Promise.resolve();
}

/** Nonces only need uniqueness per timestamp, not secrecy (rust-hawk does the
 *  same). The default is Math.random — production keeps this default; the
 *  option exists for deterministic tests and future hosts that prefer a
 *  stronger source. */
function randomNonce(): string {
  return Math.random().toString(36).slice(2, 14);
}

function unreachableHttp(): HttpTransport {
  return {
    request() {
      return Promise.reject(new Error("sync http transport is not attached"));
    },
  };
}

// ---------------------------------------------------------------------------
// Persisted payload readers (defensive: junk never crashes the store)

export function readPersistedCredentials(json: string | null): PersistedCredentials | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<PersistedCredentials>;
    if (
      parsed &&
      parsed.v === 1 &&
      typeof parsed.refreshToken === "string" &&
      parsed.refreshToken.length > 0 &&
      typeof parsed.kSync === "string" &&
      typeof parsed.kid === "string" &&
      typeof parsed.email !== "undefined" &&
      (parsed.email === null || typeof parsed.email === "string")
    ) {
      return {
        v: 1,
        refreshToken: parsed.refreshToken,
        kSync: parsed.kSync,
        kid: parsed.kid,
        email: parsed.email ?? null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function readPersistedTree(json: string | null): SyncTree | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<SyncTree>;
    if (!parsed || !Array.isArray(parsed.roots)) return null;
    const tree: SyncTree = {
      roots: parsed.roots.filter(isPersistedNode),
      fetchedAt: typeof parsed.fetchedAt === "number" ? parsed.fetchedAt : 0,
      bookmarksModified:
        typeof parsed.bookmarksModified === "number" ? parsed.bookmarksModified : null,
    };
    return tree;
  } catch {
    return null;
  }
}

function isPersistedNode(value: unknown): value is SyncNode {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Partial<SyncNode>;
  return typeof node.guid === "string" && typeof node.type === "string";
}
