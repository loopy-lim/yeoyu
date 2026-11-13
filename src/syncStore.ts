// Firefox Sync store & orchestrator. Owns the connection lifecycle and the
// three persisted channels:
//   - credentials (refresh token + kSync + kid + email) → encrypted-secrets
//   - the last fetched bookmark tree → plaintext tree channel
//   - outbound bookkeeping (guid map / dirty / remoteRaw) → outbound channel
// Receive + merge + upload run inside runSync(); nothing fires while
// disconnected (AC-6). Upload is gated on an injected LocalAdapter (T-4).

import { randomBytes } from "@noble/hashes/utils.js";
import { encodeBase64Url } from "./sync/base64";
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
import { encryptEnvelope } from "./sync/crypto";
import {
  decryptRecord,
  decryptRecordCleartext,
  fetchCollection,
  fetchInfoCollections,
  fetchInfoConfiguration,
  fetchTokenserverToken,
  SyncServerError,
  collectionKeysFromCleartext,
  kSyncBundle,
  tokenserverTokenValid,
  OutgoingBso,
  StorageContext,
} from "./sync/sync15";
import {
  BookmarkRecord,
  buildSyncTree,
  DecryptedRecord,
} from "./sync/bookmarkTree";
import { SyncErrorKind, SyncNode, SyncTree, TokenserverInfo } from "./sync/model";
import {
  LocalAdapter,
  LocalApplyOp,
  OutboundState,
  GuidPool,
  RandomSource,
  UploadRecord,
  ackSuccess,
  assignGuidMapping,
  buildUploadSet,
  deserializeOutbound,
  emptyOutboundState,
  forgetGuid,
  markAllDirty,
  markDeleted,
  markDirty,
  noteRemoteRecord,
  reconcileLocalToRemote,
  resolveValueConflict,
  serializeOutbound,
  MOBILE_ROOT_ID,
} from "./sync/outbound";
import { PostQueue, PostQueueError } from "./sync/postQueue";
import type { KeyBundle } from "./sync/crypto";

// ---------------------------------------------------------------------------
// Public state

export type SyncConnectionState = "disconnected" | "connecting" | "connected";

export type SyncResult =
  | { kind: "ok"; atMs: number; received: number; uploaded: number }
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
  /** Dirty + pending tombstone count awaiting upload. */
  pendingUploads: number;
}

export interface SyncPlatformStorage {
  readSecrets?: () => Promise<string | null>;
  saveSecrets?: (json: string) => Promise<void>;
  clearSecrets?: () => Promise<void>;
  readTree?: () => Promise<string | null>;
  saveTree?: (json: string) => Promise<void>;
  clearTree?: () => Promise<void>;
  readOutbound?: () => Promise<string | null>;
  saveOutbound?: (json: string) => Promise<void>;
  clearOutbound?: () => Promise<void>;
}

export interface SyncStoreOptions {
  nowMs?: () => number;
  yieldControl?: () => Promise<void>;
  nonce?: () => string;
  timeoutMs?: number;
  /** When set, runSync merges into local bookmarks and uploads dirty. */
  localAdapter?: LocalAdapter;
  /** GUID issuance entropy (defaults to noble randomBytes → base64url). */
  randomSource?: RandomSource;
  /** Envelope IV source (defaults to noble randomBytes). */
  envelopeRandom?: (n: number) => Uint8Array;
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
  if (failure instanceof PostQueueError) return "protocol";
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
  private localAdapter: LocalAdapter | null;
  private guidPool: GuidPool;
  private envelopeRandom: (n: number) => Uint8Array;

  private listeners = new Set<() => void>();
  private state: SyncStoreState = {
    connection: "disconnected",
    syncing: false,
    email: null,
    tree: null,
    lastSyncAtMs: null,
    lastResult: null,
    pendingUploads: 0,
  };

  private credentials: PersistedCredentials | null = null;
  private accessToken: string | null = null;
  private accessTokenExpiresAtMs = 0;
  private tokenserver: TokenserverInfo | null = null;
  private outbound: OutboundState = emptyOutboundState();

  /** Bumped by connect/disconnect so late loads/persists cannot clobber. */
  private generation = 0;
  private loadPromise: Promise<void> | null = null;
  private connectFlight: Promise<void> | null = null;
  private syncFlight: Promise<SyncResult> | null = null;
  private secretsQueue: Promise<void> = Promise.resolve();
  private treeQueue: Promise<void> = Promise.resolve();
  private outboundQueue: Promise<void> = Promise.resolve();

  constructor(
    storage: SyncPlatformStorage = {},
    http: HttpTransport = unreachableHttp(),
    options: SyncStoreOptions = {}
  ) {
    this.storage = storage;
    this.rawHttp = http;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.yieldControl = options.yieldControl ?? immediateYield;
    this.nonce = options.nonce ?? randomNonce;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.localAdapter = options.localAdapter ?? null;
    this.guidPool = new GuidPool(options.randomSource ?? defaultRandomSource());
    this.envelopeRandom = options.envelopeRandom ?? ((n) => randomBytes(n));
    this.http = { request: (input) => this.withTimeout(this.rawHttp.request(input)) };
  }

  attach(storage: SyncPlatformStorage, http: HttpTransport) {
    this.storage = storage;
    this.rawHttp = http;
    this.http = { request: (input) => this.withTimeout(this.rawHttp.request(input)) };
  }

  /** T-4 wires the controller-backed adapter after construction. */
  setLocalAdapter(adapter: LocalAdapter | null) {
    this.localAdapter = adapter;
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

  private pendingUploadCount(): number {
    return (
      Object.keys(this.outbound.dirty).length +
      Object.keys(this.outbound.pendingDeletes).length
    );
  }

  private publishPending() {
    const pendingUploads = this.pendingUploadCount();
    if (pendingUploads !== this.state.pendingUploads) {
      this.state = { ...this.state, pendingUploads };
      this.changed();
    }
  }

  // -- local change hooks (T-4) --------------------------------------------

  /** Record a local create/update/move for the next upload. */
  noteLocalChange(localId: string, changedAtMs: number = this.nowMs()): void {
    markDirty(this.outbound, localId, changedAtMs);
    this.publishPending();
    void this.persistOutbound(this.generation);
  }

  /** Record a local deletion (tombstone if the item was ever uploaded). */
  noteLocalDelete(localId: string, changedAtMs: number = this.nowMs()): void {
    markDeleted(this.outbound, localId, changedAtMs);
    this.publishPending();
    void this.persistOutbound(this.generation);
  }

  /** Bind a newly created local item to a received GUID (adapter callback). */
  assignRemoteGuid(localId: string, guid: string): void {
    assignGuidMapping(this.outbound, localId, guid);
    void this.persistOutbound(this.generation);
  }

  // -- persistence ---------------------------------------------------------

  /** Loads persisted credentials + tree + outbound. A connect/disconnect that
   *  lands mid-load invalidates the read (generation guard). */
  load(): Promise<void> {
    if (!this.loadPromise) {
      const generation = this.generation;
      const readSecrets = this.storage.readSecrets;
      const readTree = this.storage.readTree;
      const readOutbound = this.storage.readOutbound;
      this.loadPromise = Promise.all([
        // Channel-isolated reads: a corrupted tree/outbound must not discard
        // perfectly valid credentials (and vice versa).
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
        typeof readOutbound === "function"
          ? Promise.resolve()
              .then(readOutbound)
              .catch(() => null)
          : Promise.resolve(null),
      ])
        .then(([secretsJson, treeJson, outboundJson]) => {
          if (generation !== this.generation) return;
          const credentials = readPersistedCredentials(secretsJson);
          this.credentials = credentials;
          this.accessToken = null;
          this.accessTokenExpiresAtMs = 0;
          this.tokenserver = null;
          this.outbound = credentials
            ? deserializeOutbound(outboundJson) ?? emptyOutboundState()
            : emptyOutboundState();
          this.state = {
            ...this.state,
            connection: credentials ? "connected" : "disconnected",
            email: credentials?.email ?? null,
            tree: credentials ? readPersistedTree(treeJson) : null,
            pendingUploads: this.pendingUploadCount(),
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

  private persistOutbound(generation: number) {
    const save = this.storage.saveOutbound;
    if (typeof save !== "function") return Promise.resolve();
    const payload = serializeOutbound(this.outbound);
    const operation = this.outboundQueue.then(() =>
      generation === this.generation ? save(payload) : undefined
    );
    this.outboundQueue = operation.then(
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
      this.outbound = emptyOutboundState();
      this.state = {
        ...this.state,
        connection: "connected",
        email: null,
        tree: null,
        lastSyncAtMs: null,
        lastResult: null,
        pendingUploads: 0,
      };
      this.changed();
      await this.persistOutbound(generation);
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

  /** Disconnect: clears all persisted channels and in-memory state.
   *  Waits for an in-flight sync to finish its upload bookkeeping first so a
   *  successful POST's ackSuccess/persistOutbound cannot be skipped by a
   *  generation bump (G3 Security P1 — lost GUID map → duplicate uploads). */
  async disconnect(): Promise<void> {
    const flight = this.syncFlight;
    if (flight) {
      try {
        await flight;
      } catch {
        // Classified failures are already recorded on state by runSyncGuarded.
      }
    }
    this.generation += 1;
    this.credentials = null;
    this.accessToken = null;
    this.accessTokenExpiresAtMs = 0;
    this.tokenserver = null;
    this.outbound = emptyOutboundState();
    this.state = {
      connection: "disconnected",
      syncing: false,
      email: null,
      tree: null,
      lastSyncAtMs: null,
      lastResult: null,
      pendingUploads: 0,
    };
    this.changed();
    const clearSecrets = this.storage.clearSecrets;
    const clearTree = this.storage.clearTree;
    const clearOutbound = this.storage.clearOutbound;
    const secretsClear =
      typeof clearSecrets === "function"
        ? this.secretsQueue.then(() => clearSecrets())
        : Promise.resolve();
    const treeClear =
      typeof clearTree === "function"
        ? this.treeQueue.then(() => clearTree())
        : Promise.resolve();
    const outboundClear =
      typeof clearOutbound === "function"
        ? this.outboundQueue.then(() => clearOutbound())
        : Promise.resolve();
    this.secretsQueue = secretsClear.then(
      () => undefined,
      () => undefined
    );
    this.treeQueue = treeClear.then(
      () => undefined,
      () => undefined
    );
    this.outboundQueue = outboundClear.then(
      () => undefined,
      () => undefined
    );
    await Promise.all([secretsClear, treeClear, outboundClear]);
  }

  // -- sync ----------------------------------------------------------------

  /** Runs one receive → merge → upload cycle. Single flight: concurrent calls
   *  share the in-flight promise (F-G1-1). Returns the classified result. */
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
        retryAfterSeconds:
          failure instanceof SyncServerError
            ? failure.retryAfterSeconds
            : null,
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
        pendingUploads: this.pendingUploadCount(),
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
    const context: StorageContext = {
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
    const receiveUnchanged =
      !!currentTree &&
      (bookmarksModified === undefined ||
        bookmarksModified === currentTree.bookmarksModified);
    const needsInitialUpload =
      this.localAdapter !== null &&
      Object.keys(this.outbound.guidByLocalId).length === 0;
    const hasOutboundWork =
      needsInitialUpload ||
      Object.keys(this.outbound.dirty).length > 0 ||
      Object.keys(this.outbound.pendingDeletes).length > 0;
    // PLAN §0 / D10: never POST an initial (or unprimed) upload without a
    // fresh receive — early-skip would leave remoteRaw empty and let
    // buildUploadSet replace mobile children with local-only order.
    const needsRemotePriming =
      this.localAdapter !== null &&
      hasOutboundWork &&
      (needsInitialUpload ||
        this.outbound.remoteRaw[MOBILE_ROOT_ID] === undefined);
    const shouldReceive = !receiveUnchanged || needsRemotePriming;

    if (!shouldReceive && !hasOutboundWork) {
      return { kind: "ok", atMs: this.nowMs(), received: 0, uploaded: 0 };
    }

    // crypto/keys — needed for receive decrypt and/or upload encrypt.
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
    const bookmarkBundle = bundles.forBookmarks;

    let received = 0;
    let tree = currentTree;
    let xiusSeconds =
      typeof bookmarksModified === "number"
        ? bookmarksModified
        : currentTree?.bookmarksModified ?? 0;

    if (shouldReceive) {
      const bookmarks = await fetchCollection(context, "bookmarks");
      if (bookmarks.status === 401) throw new StorageUnauthorizedError();
      if (bookmarks.status !== 200) {
        if (bookmarks.backoffSeconds !== null && bookmarks.backoffSeconds > 0) {
          return serverBackoff(bookmarks.backoffSeconds, this.nowMs());
        }
        throw new SyncServerError(bookmarks.status, `bookmarks ${bookmarks.status}`);
      }

      // Batched decrypt — yield to the event loop between batches (F-G1-2).
      const decrypted: DecryptedRecord[] = [];
      const wireRecords: Array<{
        guid: string;
        payload: BookmarkRecord;
        modifiedSeconds: number;
      }> = [];
      for (let index = 0; index < bookmarks.records.length; index += 1) {
        const bso = bookmarks.records[index]!;
        const { guid, payload } = decryptRecord<BookmarkRecord>(
          bookmarkBundle,
          bso
        );
        decrypted.push({ guid, payload });
        wireRecords.push({ guid, payload, modifiedSeconds: bso.modified });
        if ((index + 1) % BATCH_SIZE === 0) await this.yieldControl();
      }

      tree = buildSyncTree(decrypted, bookmarksModified ?? null);
      // Cancelled by a mid-flight disconnect: do not resurrect the tree.
      if (generation !== this.generation) {
        return { kind: "ok", atMs: this.nowMs(), received: 0, uploaded: 0 };
      }
      this.state = { ...this.state, tree };
      this.changed();
      await this.persistTree(tree, generation);

      const applied = await this.mergeIncoming(wireRecords, generation);
      // Without a local adapter, "received" is the fetch size (sidebar tree
      // refresh); with an adapter it is the number of local apply ops.
      received = this.localAdapter ? applied : wireRecords.length;
      xiusSeconds =
        typeof bookmarksModified === "number"
          ? bookmarksModified
          : tree.bookmarksModified ?? xiusSeconds;
    }

    let uploaded = 0;
    if (this.localAdapter && (hasOutboundWork || needsInitialUpload)) {
      uploaded = await this.uploadDirty(
        context,
        bookmarkBundle,
        tree,
        xiusSeconds,
        generation
      );
    }

    return { kind: "ok", atMs: this.nowMs(), received, uploaded };
  }

  /**
   * Apply received mobile-rooted records to the local adapter using LWW.
   * Updates remoteRaw for every live record (unknown-field preservation).
   * Returns the number of apply ops issued (received count for the UI).
   */
  private async mergeIncoming(
    records: Array<{
      guid: string;
      payload: BookmarkRecord;
      modifiedSeconds: number;
    }>,
    generation: number
  ): Promise<number> {
    const adapter = this.localAdapter;
    const ops: LocalApplyOp[] = [];
    // Folder GUIDs under mobile — used to decide which bookmarks map locally.
    const mobileFolders = new Set<string>();

    for (const { guid, payload, modifiedSeconds } of records) {
      const modifiedMs = Math.round(modifiedSeconds * 1000);
      if (payload.deleted === true) {
        const localId = this.outbound.localIdByGuid[guid];
        if (localId) {
          const localChanged =
            this.outbound.dirty[localId]?.changedAtMs ??
            this.outbound.pendingDeletes[localId]?.changedAtMs;
          if (resolveValueConflict(localChanged, modifiedMs) === "remote") {
            const isFolder = this.looksLikeFolder(guid, payload);
            ops.push(
              isFolder
                ? { kind: "deleteFolder", localId }
                : { kind: "deleteBookmark", localId }
            );
            forgetGuid(this.outbound, guid);
          }
        } else {
          forgetGuid(this.outbound, guid);
        }
        continue;
      }

      // Live record — always refresh remoteRaw (T-3 owns these writes).
      noteRemoteRecord(
        this.outbound,
        guid,
        payload as Record<string, unknown>,
        modifiedMs
      );

      if (!adapter) continue;
      if (guid === "places") continue;
      // mobile root: remoteRaw already noted; structure applied in pass 2.
      if (guid === MOBILE_ROOT_ID) continue;

      if (payload.type === "folder" && payload.parentid === MOBILE_ROOT_ID) {
        mobileFolders.add(guid);
        const localId = this.outbound.localIdByGuid[guid] ?? null;
        const localChanged = localId
          ? this.outbound.dirty[localId]?.changedAtMs
          : null;
        if (resolveValueConflict(localChanged, modifiedMs) === "local") continue;
        ops.push({
          kind: "upsertFolder",
          localId,
          title: typeof payload.title === "string" ? payload.title : "",
          guid,
        });
        if (localId) delete this.outbound.dirty[localId];
        continue;
      }

      if (
        payload.type === "bookmark" &&
        typeof payload.bmkUri === "string" &&
        (payload.parentid === MOBILE_ROOT_ID ||
          (typeof payload.parentid === "string" &&
            (mobileFolders.has(payload.parentid) ||
              this.outbound.localIdByGuid[payload.parentid] !== undefined ||
              this.outbound.remoteRaw[payload.parentid]?.cleartext?.parentid ===
                MOBILE_ROOT_ID)))
      ) {
        const localId = this.outbound.localIdByGuid[guid] ?? null;
        const localChanged = localId
          ? this.outbound.dirty[localId]?.changedAtMs
          : null;
        if (resolveValueConflict(localChanged, modifiedMs) === "local") continue;
        const parentGuid =
          typeof payload.parentid === "string" ? payload.parentid : MOBILE_ROOT_ID;
        const folderId =
          parentGuid === MOBILE_ROOT_ID
            ? ""
            : this.outbound.localIdByGuid[parentGuid] ?? "";
        ops.push({
          kind: "upsertBookmark",
          localId,
          title: typeof payload.title === "string" ? payload.title : "",
          url: payload.bmkUri,
          folderId,
          guid,
        });
        if (localId) delete this.outbound.dirty[localId];
      }
    }

    if (adapter && ops.length > 0 && generation === this.generation) {
      await adapter.applyIncoming(ops);
    }
    // Pass 2 — PLAN §2 structure LWW (after creates bind guids).
    const structureOps = this.buildStructureOps(records);
    if (adapter && structureOps.length > 0 && generation === this.generation) {
      await adapter.applyIncoming(structureOps);
      ops.push(...structureOps);
    }
    if (generation === this.generation) {
      this.publishPending();
      await this.persistOutbound(generation);
    }
    return ops.length;
  }

  /** Adopt remote children order/membership when the folder (or mobile) record
   *  wins LWW — value upserts alone cannot express Zen reorder. */
  private buildStructureOps(
    records: Array<{
      guid: string;
      payload: BookmarkRecord;
      modifiedSeconds: number;
    }>
  ): LocalApplyOp[] {
    if (!this.localAdapter) return [];
    const ops: LocalApplyOp[] = [];

    for (const { guid, payload, modifiedSeconds } of records) {
      if (payload.deleted === true) continue;
      const modifiedMs = Math.round(modifiedSeconds * 1000);
      const children = Array.isArray(payload.children)
        ? payload.children.filter((child): child is string => typeof child === "string")
        : null;
      if (!children) continue;

      if (guid === MOBILE_ROOT_ID) {
        // Local "changedAt" for mobile: newest dirty among root-level items
        // (root bookmarks + folders) — they compose mobile.children.
        const snap = this.localAdapter.getLocalSnapshot();
        const rootLocalIds = new Set<string>([
          ...snap.bookmarkFolders.map((folder) => folder.id),
          ...snap.bookmarks
            .filter((bookmark) => !(bookmark.folderId ?? ""))
            .map((bookmark) => bookmark.id),
        ]);
        let localChanged: number | null = null;
        for (const localId of rootLocalIds) {
          const entry = this.outbound.dirty[localId];
          if (entry)
            localChanged = Math.max(localChanged ?? 0, entry.changedAtMs);
        }
        if (resolveValueConflict(localChanged, modifiedMs) === "local") continue;
        const rootBookmarkIds: string[] = [];
        for (const childGuid of children) {
          const localId = this.outbound.localIdByGuid[childGuid];
          if (!localId) continue;
          const cleartext = this.outbound.remoteRaw[childGuid]?.cleartext;
          if (cleartext?.type === "folder") continue;
          ops.push({ kind: "setBookmarkFolder", localId, folderId: "" });
          rootBookmarkIds.push(localId);
        }
        if (rootBookmarkIds.length > 0) {
          ops.push({
            kind: "reorderInFolder",
            folderId: "",
            orderedLocalIds: rootBookmarkIds,
          });
        }
        continue;
      }

      if (payload.type !== "folder" || payload.parentid !== MOBILE_ROOT_ID) continue;
      const folderLocalId = this.outbound.localIdByGuid[guid];
      if (!folderLocalId) continue;
      const localChanged = this.outbound.dirty[folderLocalId]?.changedAtMs;
      if (resolveValueConflict(localChanged, modifiedMs) === "local") continue;

      const orderedLocalIds: string[] = [];
      for (const childGuid of children) {
        const childLocalId = this.outbound.localIdByGuid[childGuid];
        if (!childLocalId) continue;
        ops.push({
          kind: "setBookmarkFolder",
          localId: childLocalId,
          folderId: folderLocalId,
        });
        orderedLocalIds.push(childLocalId);
      }
      if (orderedLocalIds.length > 0) {
        ops.push({
          kind: "reorderInFolder",
          folderId: folderLocalId,
          orderedLocalIds,
        });
      }
    }
    return ops;
  }

  private looksLikeFolder(guid: string, payload: BookmarkRecord): boolean {
    if (payload.type === "folder") return true;
    const raw = this.outbound.remoteRaw[guid]?.cleartext;
    return raw?.type === "folder";
  }

  private async uploadDirty(
    context: StorageContext,
    bookmarkBundle: KeyBundle,
    tree: SyncTree | null,
    xiusSeconds: number,
    generation: number
  ): Promise<number> {
    const adapter = this.localAdapter;
    if (!adapter) return 0;

    const snapshot = adapter.getLocalSnapshot();
    if (Object.keys(this.outbound.guidByLocalId).length === 0) {
      markAllDirty(this.outbound, snapshot, this.nowMs());
      // Reuse server GUIDs for URL/title matches so a prior session's uploads
      // are not re-created under new ids after outbound was cleared.
      reconcileLocalToRemote(this.outbound, snapshot);
    }
    this.publishPending();

    const records = await buildUploadSet(this.outbound, snapshot, {
      pool: this.guidPool,
      remoteTree: tree,
      nowMs: this.nowMs(),
    });
    // Persist GUID assignments before POST so a 412/crash cannot lose them
    // and force re-issuance on retry (G3 Security P2).
    await this.persistOutbound(generation);
    if (records.length === 0) return 0;

    const bsos: OutgoingBso[] = records.map((record) =>
      toOutgoingBso(record, bookmarkBundle, this.envelopeRandom)
    );

    const { limits } = await fetchInfoConfiguration(context);
    const queue = new PostQueue(context, "bookmarks", {
      limits,
      xiusSeconds,
    });
    for (const bso of bsos) {
      await queue.enqueue(bso);
    }
    await queue.flush(true);

    const successIds = queue.successIds;
    const modifiedMs = Math.round(queue.lastModifiedSeconds * 1000);
    ackSuccess(this.outbound, successIds, modifiedMs, records);
    this.publishPending();
    // disconnect() awaits syncFlight before bumping generation/clearing, so
    // this persist lands while generation still matches.
    await this.persistOutbound(generation);

    if (generation !== this.generation) return successIds.length;

    // Advance the cached collection modified so early-skip does not miss
    // our own upload (research-codebase constraint 10).
    if (tree && successIds.length > 0) {
      const nextTree: SyncTree = {
        ...tree,
        bookmarksModified: queue.lastModifiedSeconds,
      };
      this.state = { ...this.state, tree: nextTree };
      this.changed();
      await this.persistTree(nextTree, generation);
    }

    return successIds.length;
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

function toOutgoingBso(
  record: UploadRecord,
  bundle: KeyBundle,
  random: (n: number) => Uint8Array
): OutgoingBso {
  const cleartext = record.isTombstone
    ? JSON.stringify({ id: record.guid, deleted: true })
    : JSON.stringify(record.cleartext);
  const envelope = encryptEnvelope(bundle, cleartext, random);
  return {
    id: record.guid,
    sortindex: record.sortindex,
    payload: JSON.stringify(envelope),
  };
}

function serverBackoff(seconds: number, atMs: number): SyncResult {
  return { kind: "server", atMs, retryAfterSeconds: seconds };
}

function immediateYield(): Promise<void> {
  return Promise.resolve();
}

function defaultRandomSource(): RandomSource {
  return {
    async randomB64(count: number) {
      return encodeBase64Url(randomBytes(count));
    },
  };
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
