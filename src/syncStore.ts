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
  fetchMetaGlobal,
  putMetaGlobal,
  storagePost,
  BOOKMARKS_ENGINE_VERSION,
  MetaGlobalPayload,
  STORAGE_VERSION,
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
import {
  META_ROOT_GUIDS,
  SyncedDeviceTabs,
  SyncedHistoryVisit,
  SyncedSpacesTree,
  SyncErrorKind,
  SyncNode,
  SyncTree,
  TokenserverInfo,
} from "./sync/model";
import { fetchSyncedTabs, LocalTabForSync, buildClientsRecordCleartext, buildTabsRecordCleartext } from "./sync/tabs";
import { fetchSyncedHistory } from "./sync/history";
import { fetchSyncedSpaces } from "./sync/spaces";
import {
  applySyncedSpacesTree,
  emptySpacesBindings,
  type SpacesApplyHost,
  type SpacesBindings,
} from "./sync/spacesApply";
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
  /** Other devices' open tabs (receive-only; null = never fetched, the
   * sidebar hides the region until the first tabs fetch lands). */
  tabs: SyncedDeviceTabs[] | null;
  /** Newest synced history visits (receive-only; null = never fetched, the
   * history dialog hides the section until the first fetch lands). */
  history: SyncedHistoryVisit[] | null;
  /** Zen Spaces collection tree (receive-only; null = never fetched). */
  spaces: SyncedSpacesTree | null;
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
  /** GUID issuance and envelope IV entropy (defaults to noble randomBytes → base64url). */
  randomSource?: RandomSource;
  /** Device name published in the clients/tabs collections (default yeoyu). */
  deviceName?: string;
  /** When set, each successful sync publishes our open tabs (other clients
   *  then list this device in their synced-tabs panel). */
  tabsSource?: () => LocalTabForSync[] | null;
  /** When set, a received Spaces tree is materialized into local workspaces. */
  spacesHost?: SpacesApplyHost | null;
}

interface PersistedCredentials {
  v: 1;
  refreshToken: string;
  kSync: string;
  kid: string;
  email: string | null;
}

const BATCH_SIZE = 64; // F-G1-2: yield between decrypt batches on Hermes
/** GET page size for collection fetches — keeps server paging deterministic
 *  so X-Weave-Next-Offset continuation is always exercised on big sets. */
const COLLECTION_PAGE_RECORDS = 1000;
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
    /hmac|envelope|cbc|gcm|aes-|base64|json|kSync|jwe|kid|scope|token endpoint|getRandomValues|random source|pool exhausted|TextEncoder/i.test(
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
  private randomSource: RandomSource | null;
  private guidPool: GuidPool;
  private deviceName: string;
  private tabsSource: (() => LocalTabForSync[] | null) | null;
  private spacesHost: SpacesApplyHost | null;

  private listeners = new Set<() => void>();
  private state: SyncStoreState = {
    connection: "disconnected",
    syncing: false,
    email: null,
    tree: null,
    tabs: null,
    history: null,
    spaces: null,
    lastSyncAtMs: null,
    lastResult: null,
    pendingUploads: 0,
  };

  private credentials: PersistedCredentials | null = null;
  private accessToken: string | null = null;
  private accessTokenExpiresAtMs = 0;
  private tokenserver: TokenserverInfo | null = null;
  private outbound: OutboundState = emptyOutboundState();
  /** Incremental boundary for the receive-only tabs collection (in-memory:
   * tabs are ephemeral display data, the first sync after launch refetches). */
  private tabsModifiedSeconds: number | null = null;
  /** Incremental boundary for the receive-only history collection (same
   * ephemeral-display policy as tabs). */
  private historyModifiedSeconds: number | null = null;
  /** Incremental boundary for the receive-only Zen spaces collection. */
  private spacesModifiedSeconds: number | null = null;
  /** Last tabs cleartext we published — an unchanged list is not re-POSTed
   * within a session (the first sync after a restart sends once). */
  private lastSentTabsJson: string | null = null;
  /** Whether the clients-collection device record has been written for the
   * current identity (reset with the identity). */
  private clientsRecordPosted = false;

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
    this.randomSource = options.randomSource ?? null;
    this.deviceName = options.deviceName ?? "yeoyu";
    this.tabsSource = options.tabsSource ?? null;
    this.spacesHost = options.spacesHost ?? null;
    this.guidPool = new GuidPool(this.randomSource ?? defaultRandomSource());
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

  /** Wires (or clears) the Spaces→Snapshot materializer. */
  setSpacesHost(host: SpacesApplyHost | null) {
    this.spacesHost = host;
    // First sync can finish before App wires the host — re-apply the
    // cached tree so collision leftovers and favorite dupes still heal.
    if (host && this.state.spaces) {
      void this.applyCachedSpaces();
    }
  }

  private async applyCachedSpaces(): Promise<void> {
    const host = this.spacesHost;
    const spaces = this.state.spaces;
    if (!host || !spaces) return;
    const generation = this.generation;
    try {
      const previous = this.outbound.spacesBindings ?? emptySpacesBindings();
      const next = await applySyncedSpacesTree(spaces, host, previous);
      if (generation !== this.generation) return;
      this.outbound = { ...this.outbound, spacesBindings: next };
      await this.persistOutbound(generation);
    } catch {
      // best-effort — same tolerance as the sync flight
    }
  }

  /** Wires (or clears) the open-tab publisher for the tabs collection. */
  setTabsSource(source: (() => LocalTabForSync[] | null) | null) {
    this.tabsSource = source;
    this.lastSentTabsJson = null;
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
      console.info("sync load start");
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
          if (generation !== this.generation) {
            console.info("sync load: generation changed, discarding");
            return;
          }
          const credentials = readPersistedCredentials(secretsJson);
          console.info(
            "sync load: secrets=%s tree=%s outbound=%s connection=%s",
            secretsJson == null ? "null" : String(secretsJson).length,
            treeJson == null ? "null" : String(treeJson).length,
            outboundJson == null ? "null" : String(outboundJson).length,
            credentials ? "connected" : "disconnected"
          );
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
        .catch((failure) => {
          // Unreadable storage is not fatal: stay disconnected, AC-6 intact.
          console.info(
            "sync load: failed",
            failure instanceof Error ? failure.message : String(failure)
          );
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
      this.tabsModifiedSeconds = null;
      this.historyModifiedSeconds = null;
      this.spacesModifiedSeconds = null;
      this.lastSentTabsJson = null;
      this.clientsRecordPosted = false;
      this.state = {
        ...this.state,
        connection: "connected",
        email: null,
        tree: null,
        tabs: null,
        history: null,
        spaces: null,
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
    this.tabsModifiedSeconds = null;
    this.historyModifiedSeconds = null;
    this.spacesModifiedSeconds = null;
    this.lastSentTabsJson = null;
    this.clientsRecordPosted = false;
    this.state = {
      connection: "disconnected",
      syncing: false,
      email: null,
      tree: null,
      tabs: null,
      history: null,
      spaces: null,
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
      console.info("sync skip: no credentials");
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
    console.info("sync flight start");
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
    const metaModified = info.collections["meta"];
    // meta/global handshake: on the first sync, and afterwards only when the
    // meta collection changed (another client reset or declared engines) —
    // idle syncs keep making zero requests past info/collections.
    const needMetaHandshake =
      this.outbound.engine === undefined ||
      metaModified === undefined ||
      metaModified !== this.outbound.engine.metaModifiedSeconds;
    // Receive-only tabs: fetch when the collection changed vs. the last
    // flight (null boundary = first sync after launch).
    const tabsModified = info.collections["tabs"];
    const tabsChanged =
      tabsModified !== undefined && tabsModified !== this.tabsModifiedSeconds;
    // Receive-only history: same change gate as tabs (accounts with the
    // engine declined simply never advertise the collection).
    const historyModified = info.collections["history"];
    const historyChanged =
      historyModified !== undefined &&
      historyModified !== this.historyModifiedSeconds;
    // Receive-only Zen Spaces: same change gate as tabs.
    const spacesModified = info.collections["spaces"];
    const spacesChanged =
      spacesModified !== undefined &&
      spacesModified !== this.spacesModifiedSeconds;

    // Computed as a closure: a meta/global reset invalidates every input
    // (tree, guid mappings) and the plan must be recomputed after it.
    const plan = () => {
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
      // Incremental delta boundary: only with a complete remoteRaw (the
      // engine handshake has run and nothing needs re-priming) — the first
      // post-upgrade sync deliberately refetches everything so pagination
      // rebuilds a complete cumulative view.
      const incrementalFrom =
        this.outbound.engine !== undefined &&
        currentTree !== null &&
        !needsRemotePriming
          ? currentTree.bookmarksModified
          : null;
      return {
        shouldReceive,
        hasOutboundWork,
        needsInitialUpload,
        incrementalFrom,
      };
    };

    const initialPlan = plan();
    if (
      !initialPlan.shouldReceive &&
      !initialPlan.hasOutboundWork &&
      !needMetaHandshake &&
      !tabsChanged &&
      !historyChanged &&
      !spacesChanged &&
      !this.ownTabsChanged()
    ) {
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
    const spacesBundle = bundles.forCollection("spaces");

    // meta/global handshake — declare the bookmarks engine, detect
    // server-side resets. A reset voids all local sync state; the plan is
    // recomputed below and the sync continues as a fresh prime.
    if (needMetaHandshake) {
      const reset = await this.metaGlobalHandshake(
        context,
        metaModified,
        generation
      );
      if (reset) {
        this.outbound = emptyOutboundState();
        this.state = { ...this.state, tree: null };
        this.changed();
        // Cancelled by a mid-flight disconnect: do not touch storage.
        if (generation !== this.generation) {
          return { kind: "ok", atMs: this.nowMs(), received: 0, uploaded: 0 };
        }
        await Promise.all([
          this.persistOutbound(generation),
          this.clearPersistedTree(generation),
        ]);
      }
    }

    const { shouldReceive, hasOutboundWork, needsInitialUpload, incrementalFrom } =
      plan();

    let received = 0;
    let tree = this.state.tree;
    let xiusSeconds =
      typeof bookmarksModified === "number"
        ? bookmarksModified
        : tree?.bookmarksModified ?? 0;

    if (shouldReceive) {
      const bookmarks = await fetchCollection(context, "bookmarks", {
        newerThanSeconds:
          incrementalFrom !== null ? incrementalFrom : undefined,
        limit: COLLECTION_PAGE_RECORDS,
      });
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

      if (incrementalFrom === null) {
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
      } else {
        // Incremental: fold the delta into remoteRaw first (live records
        // refresh, tombstones drop out), then rebuild the tree from the
        // cumulative view so parent moves and deletions resolve globally.
        const applied = await this.mergeIncoming(wireRecords, generation);
        if (generation !== this.generation) {
          return { kind: "ok", atMs: this.nowMs(), received: 0, uploaded: 0 };
        }
        const union: DecryptedRecord[] = Object.entries(
          this.outbound.remoteRaw
        ).map(([guid, entry]) => ({
          guid,
          payload: entry.cleartext as BookmarkRecord,
        }));
        tree = buildSyncTree(union, bookmarksModified ?? null);
        this.state = { ...this.state, tree };
        this.changed();
        await this.persistTree(tree, generation);
        received = this.localAdapter ? applied : wireRecords.length;
      }
      xiusSeconds =
        typeof bookmarksModified === "number"
          ? bookmarksModified
          : tree.bookmarksModified ?? xiusSeconds;
    }

    let uploaded = 0;
    if (this.localAdapter && (hasOutboundWork || needsInitialUpload)) {
      const upload = await this.uploadDirty(
        context,
        bookmarkBundle,
        tree,
        xiusSeconds,
        generation
      );
      uploaded = upload.uploaded;
      if (upload.quotaExhausted) {
        // The account is out of storage: committed records stay acked and
        // the dirty set survives, but the flight reports the quota state
        // instead of a silent partial success.
        return { kind: "quota", atMs: this.nowMs(), retryAfterSeconds: null };
      }
    }

    if (tabsChanged) {
      // Receive-only tabs panel data: best-effort — a tabs failure (missing
      // collection on the server, one broken device record) never fails the
      // bookmarks flight; the previous list just stays on screen.
      try {
        const tabs = await fetchSyncedTabs(context, bundles.default);
        if (generation === this.generation) {
          this.tabsModifiedSeconds = tabsModified ?? null;
          // Never list our own device in our own panel.
          const ownClientId = this.outbound.client?.id;
          this.state = {
            ...this.state,
            tabs: ownClientId === undefined
              ? tabs
              : tabs.filter((device) => device.clientId !== ownClientId),
          };
          this.changed();
        }
      } catch {
        // best-effort
      }
    }

    if (historyChanged) {
      // Receive-only synced history: same best-effort policy as tabs — the
      // bookmarks flight never fails on the history engine.
      try {
        const visits = await fetchSyncedHistory(context, bundles.default);
        if (generation === this.generation) {
          this.historyModifiedSeconds = historyModified ?? null;
          this.state = { ...this.state, history: visits };
          this.changed();
        }
      } catch {
        // best-effort
      }
    }

    if (spacesChanged) {
      // Zen Spaces → local Snapshot materialization: best-effort — a spaces
      // failure never fails the bookmarks flight.
      try {
        const spaces = await fetchSyncedSpaces(context, spacesBundle);
        if (generation === this.generation) {
          this.spacesModifiedSeconds = spacesModified ?? null;
          this.state = { ...this.state, spaces };
          this.changed();
        }
      } catch {
        // best-effort
      }
    }
    // Always re-apply when we have a tree + host. Covers: host raced behind
    // the first fetch, and local leftover cleanup when the server timestamp
    // did not move (YouTube favorite dupes, merged "Name 2" folders).
    if (this.spacesHost && this.state.spaces && generation === this.generation) {
      await this.applyCachedSpaces();
    }

    if (this.tabsSource) {
      // Publish our open tabs (clients + tabs records): best-effort, same
      // tolerance as the receive side.
      try {
        await this.publishOwnTabs(context, bundles.default, generation);
      } catch {
        // best-effort
      }
    }

    return { kind: "ok", atMs: this.nowMs(), received, uploaded };
  }

  /**
   * meta/global handshake (run when the meta collection changed or on the
   * first sync): adopts or declares the bookmarks engine entry, and detects
   * server-side engine resets — a changed syncID (or a vanished meta/global
   * while we had state) means the server replaced our data and every piece
   * of local sync state (tree, guid mappings, dirty) is void.
   * Returns true when the caller must perform that reset.
   */
  private async metaGlobalHandshake(
    context: StorageContext,
    metaModifiedSeconds: number | undefined,
    generation: number
  ): Promise<boolean> {
    const meta = await fetchMetaGlobal(context);
    if (meta.status === 401) throw new StorageUnauthorizedError();
    const hadState =
      this.outbound.engine !== undefined || this.state.tree !== null;

    if (meta.status !== 200 && meta.status !== 404) {
      throw new SyncServerError(meta.status, `meta ${meta.status}`);
    }
    const record = meta.status === 200 ? meta.record : null;
    if (!record) {
      // No meta/global on the server: fresh account (declare ours) or a
      // wiped storage (reset if we had state).
      if (!hadState) {
        await this.declareBookmarksEngine(
          context,
          null,
          metaModifiedSeconds,
          generation
        );
        return false;
      }
      return true;
    }
    if (record.payload.storageVersion !== STORAGE_VERSION) {
      throw new ProtocolFormatError(
        `unsupported meta/global storage version ${record.payload.storageVersion}`
      );
    }
    const engineEntry = record.payload.engines["bookmarks"];
    const known = this.outbound.engine?.bookmarksSyncId;
    if (engineEntry && known) {
      if (engineEntry.syncID !== known) {
        // Another client reset the bookmarks engine server-side.
        return true;
      }
      // Unchanged declaration — record the observed meta timestamp so idle
      // syncs can skip the handshake entirely next time.
      this.outbound.engine = {
        bookmarksSyncId: known,
        metaModifiedSeconds: metaModifiedSeconds ?? null,
      };
      await this.persistOutbound(generation);
      return false;
    }
    if (engineEntry && !known) {
      // Live meta/global from other clients: adopt the declaration.
      this.outbound.engine = {
        bookmarksSyncId: engineEntry.syncID,
        metaModifiedSeconds: metaModifiedSeconds ?? null,
      };
      await this.persistOutbound(generation);
      return false;
    }
    // No bookmarks entry (all other clients declined it): declare ours
    // while preserving every other entry and the declined list.
    await this.declareBookmarksEngine(
      context,
      record.payload,
      metaModifiedSeconds,
      generation
    );
    return false;
  }

  /** Write meta/global with a bookmarks engine entry — creating the whole
   *  record when none exists, otherwise preserving the existing payload. */
  private async declareBookmarksEngine(
    context: StorageContext,
    existing: MetaGlobalPayload | null,
    metaModifiedSeconds: number | undefined,
    generation: number
  ): Promise<void> {
    const bookmarksSyncId = await this.newEngineSyncId();
    const payload: MetaGlobalPayload = existing
      ? {
          ...existing,
          engines: {
            ...existing.engines,
            bookmarks: {
              version: BOOKMARKS_ENGINE_VERSION,
              syncID: bookmarksSyncId,
            },
          },
        }
      : {
          storageVersion: STORAGE_VERSION,
          syncID: await this.newEngineSyncId(),
          engines: {
            bookmarks: {
              version: BOOKMARKS_ENGINE_VERSION,
              syncID: bookmarksSyncId,
            },
          },
          declined: [],
        };
    const result = await putMetaGlobal(
      context,
      payload,
      metaModifiedSeconds
    );
    if (result.status < 200 || result.status > 299) {
      throw new SyncServerError(
        result.status,
        `meta/global POST ${result.status}`
      );
    }
    this.outbound.engine = {
      bookmarksSyncId,
      metaModifiedSeconds: result.modifiedSeconds ?? metaModifiedSeconds ?? null,
    };
    await this.persistOutbound(generation);
  }

  /** Fresh opaque engine syncID (12 base64url chars, pool entropy). */
  private async newEngineSyncId(): Promise<string> {
    return encodeBase64Url(await this.guidPool.nextBytes(9)).slice(0, 12);
  }

  /** Cheap idle-sync gate: true when a tabs publish would send anything
   * (no identity yet, or the built record differs from the last send). */
  private ownTabsChanged(): boolean {
    if (this.tabsSource === null) return false;
    const client = this.outbound.client;
    if (!client || !this.clientsRecordPosted) return true;
    const tabs = this.tabsSource();
    if (!tabs) return false;
    return buildTabsRecordCleartext(client.id, client.name, tabs) !== this.lastSentTabsJson;
  }

  /**
   * Publish this device's open tabs: a clients-collection device record
   * (once per identity) plus the tabs-collection BSO other clients render
   * in their synced-tabs panels. Both share the outbound.client id and the
   * default key bundle; the whole-record overwrite is this device's alone,
   * so no XIUS (a race with ourselves is impossible — single flight).
   */
  private async publishOwnTabs(
    context: StorageContext,
    defaultBundle: KeyBundle,
    generation: number
  ): Promise<void> {
    const source = this.tabsSource;
    if (!source) return;
    let client = this.outbound.client;
    if (!client) {
      client = { id: await this.newEngineSyncId(), name: this.deviceName };
      this.outbound.client = client;
      this.clientsRecordPosted = false;
      await this.persistOutbound(generation);
    }
    const tabs = source();
    if (!tabs) return;
    const cleartext = buildTabsRecordCleartext(client.id, client.name, tabs);
    if (cleartext === null) return;
    if (cleartext === this.lastSentTabsJson) return;

    // Two sequential IV draws from one pool (AES-CBC IV reuse across
    // plaintexts is a leak — the cursor function advances per call).
    const random = await drawPoolRandom(this.guidPool, 32);
    if (!this.clientsRecordPosted) {
      const clientsEnvelope = encryptEnvelope(
        defaultBundle,
        buildClientsRecordCleartext(client.id, client.name),
        random
      );
      const clientsResult = await storagePost(context, "clients", [
        {
          id: client.id,
          sortindex: 1,
          payload: JSON.stringify(clientsEnvelope),
        },
      ]);
      if (clientsResult.status < 200 || clientsResult.status > 299) {
        return; // retried on the next flight (clientsRecordPosted stays false)
      }
      this.clientsRecordPosted = true;
    }
    const tabsEnvelope = encryptEnvelope(defaultBundle, cleartext, random);
    const tabsResult = await storagePost(context, "tabs", [
      {
        id: client.id,
        sortindex: 1,
        payload: JSON.stringify(tabsEnvelope),
      },
    ]);
    if (
      tabsResult.status >= 200 &&
      tabsResult.status <= 299 &&
      generation === this.generation
    ) {
      this.lastSentTabsJson = cleartext;
    }
  }

  /** Remove the persisted tree (engine reset path). */
  private clearPersistedTree(generation: number): Promise<unknown> {
    const clearTree = this.storage.clearTree;
    if (typeof clearTree !== "function") return Promise.resolve();
    const operation = this.treeQueue.then(() =>
      generation === this.generation ? clearTree() : undefined
    );
    this.treeQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
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
      if (META_ROOT_GUIDS.has(guid)) continue;
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
  ): Promise<{ uploaded: number; quotaExhausted: boolean }> {
    const adapter = this.localAdapter;
    if (!adapter) return { uploaded: 0, quotaExhausted: false };

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
    if (records.length === 0) return { uploaded: 0, quotaExhausted: false };

    const envelopeRandom = this.randomSource
      ? await drawPoolRandom(this.guidPool, records.length * 16)
      : (n: number) => randomBytes(n);

    const bsos: OutgoingBso[] = records.map((record) =>
      toOutgoingBso(record, bookmarkBundle, envelopeRandom)
    );

    const { limits } = await fetchInfoConfiguration(context);
    const queue = new PostQueue(context, "bookmarks", {
      limits,
      xiusSeconds,
    });
    for (const bso of bsos) {
      // Stop feeding the queue once the account is over quota — the flush
      // below still commits whatever the server already accepted.
      if (queue.quotaExhausted) break;
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

    if (generation !== this.generation) return { uploaded: successIds.length, quotaExhausted: queue.quotaExhausted };

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

    return { uploaded: successIds.length, quotaExhausted: queue.quotaExhausted };
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

async function drawPoolRandom(
  pool: GuidPool,
  totalBytes: number
): Promise<(n: number) => Uint8Array> {
  const bytes = await pool.nextBytes(totalBytes);
  let cursor = 0;
  return (n: number) => {
    if (cursor + n > bytes.length) {
      throw new Error("sync random pool exhausted");
    }
    const slice = bytes.subarray(cursor, cursor + n);
    cursor += n;
    return slice;
  };
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
