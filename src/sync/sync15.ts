// Sync 1.5 storage client: GET (receive, Phase 1) and POST (upload) requests.
// Mirrors application-services components/sync15/src/client/{token,storage}.rs:
// tokenserver uses Bearer + X-KeyID, storage requests use Hawk with the
// tokenserver-issued id/key and the server timestamp as the time source.

import { HttpTransport } from "./fxa";
import {
  decryptEnvelope,
  hawkAuthorizationHeader,
  keyBundleFromBase64Pair,
  keyBundleFromKSyncBase64Url,
  KeyBundle,
} from "./crypto";
import { TokenserverInfo } from "./model";

export const TOKENSERVER_URL = "https://token.services.mozilla.com/1.0/sync/1.5";

export class SyncServerError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Parsed Retry-After / X-Weave-Backoff seconds when the server sent one. */
    public retryAfterSeconds: number | null = null
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Tokenserver

export async function fetchTokenserverToken(
  http: HttpTransport,
  accessToken: string,
  kid: string
): Promise<TokenserverInfo> {
  const response = await http.request({
    method: "GET",
    url: TOKENSERVER_URL,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-KeyID": kid,
      Accept: "application/json",
    },
  });
  if (response.status !== 200) {
    throw new SyncServerError(response.status, `tokenserver ${response.status}`);
  }
  const parsed = JSON.parse(response.body) as {
    id: string;
    key: string;
    api_endpoint: string;
    uid: number;
    hashed_fxa_uid: string;
    duration: number;
  };
  const timestampHeader =
    response.headers["x-timestamp"] ?? response.headers["X-Timestamp"];
  const serverTimestampSeconds = Number(timestampHeader);
  if (!Number.isFinite(serverTimestampSeconds) || serverTimestampSeconds <= 0) {
    // a-s treats a missing X-Timestamp as a protocol error (MissingServerTimestamp).
    throw new SyncServerError(response.status, "tokenserver missing X-Timestamp");
  }
  return {
    id: parsed.id,
    key: parsed.key,
    apiEndpoint: parsed.api_endpoint,
    uid: parsed.uid,
    hashedFxaUid: parsed.hashed_fxa_uid,
    serverTimestampSeconds,
    fetchedAtMs: Date.now(),
    durationSeconds: parsed.duration,
  };
}

export function tokenserverTokenValid(info: TokenserverInfo, nowMs: number): boolean {
  const ageSeconds = (nowMs - info.fetchedAtMs) / 1000;
  // Refresh a little early (a-s does the same in TokenContext::is_valid).
  return ageSeconds < Math.max(info.durationSeconds - 60, 0);
}

// ---------------------------------------------------------------------------
// Storage requests (Hawk)

export interface StorageContext {
  http: HttpTransport;
  token: TokenserverInfo;
  /** Local wall clock — Hawk ts is derived from the tokenserver timestamp. */
  nowMs: () => number;
  nonce: () => string;
}

function authorization(
  context: StorageContext,
  method: string,
  pathAndQuery: string
): string {
  const url = new URL(context.token.apiEndpoint);
  // The MAC covers the URI the server actually receives, which includes the
  // api_endpoint path prefix (…/1.5/<uid>) — a-s token.rs signs url.path().
  // Endpoint trailing slashes are not part of the request path.
  const endpointPath = url.pathname.replace(/\/+$/, "");
  const elapsedSeconds = Math.floor((context.nowMs() - context.token.fetchedAtMs) / 1000);
  const ts = context.token.serverTimestampSeconds + elapsedSeconds;
  return hawkAuthorizationHeader(
    { id: context.token.id, key: context.token.key },
    {
      method,
      pathAndQuery: endpointPath + pathAndQuery,
      host: url.host,
      port: url.protocol === "https:" ? 443 : 80,
    },
    ts,
    context.nonce
  );
}

export interface StorageResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

async function storageGet(
  context: StorageContext,
  pathAndQuery: string
): Promise<StorageResponse> {
  const response = await context.http.request({
    method: "GET",
    url: `${context.token.apiEndpoint}${pathAndQuery}`,
    headers: {
      Authorization: authorization(context, "GET", pathAndQuery),
      Accept: "application/json",
    },
  });
  return {
    status: response.status,
    // Real transports always carry headers; normalize for defensive callers.
    headers: response.headers ?? {},
    body: response.body,
  };
}

/** Backoff hint from Retry-After / X-Weave-Backoff, in seconds (raw value). */
export function backoffSeconds(
  headers: Record<string, string>
): number | null {
  const raw =
    headers["retry-after"] ??
    headers["Retry-After"] ??
    headers["x-weave-backoff"] ??
    headers["X-Weave-Backoff"];
  const value = Number(raw);
  if (raw === undefined || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

export async function fetchInfoCollections(
  context: StorageContext
): Promise<{
  status: number;
  collections: Record<string, number>;
  backoffSeconds: number | null;
}> {
  const response = await storageGet(context, "/info/collections");
  const backoffSecondsValue = backoffSeconds(response.headers);
  if (response.status === 200) {
    return {
      status: response.status,
      collections: JSON.parse(response.body) as Record<string, number>,
      backoffSeconds: backoffSecondsValue,
    };
  }
  return {
    status: response.status,
    collections: {},
    backoffSeconds: backoffSecondsValue,
  };
}

// ---------------------------------------------------------------------------
// Upload limits (/info/configuration)

export interface StorageLimits {
  /** HTTP request body cap — envelopes + JSON overhead included. */
  maxRequestBytes: number;
  /** Per-BSO encrypted payload string cap. */
  maxRecordPayloadBytes: number;
  /** Records per single POST. */
  maxPostRecords: number;
  /** Combined payload bytes per single POST. */
  maxPostBytes: number;
  /** Records per whole batch upload. */
  maxTotalRecords: number;
  /** Combined payload bytes per whole batch upload. */
  maxTotalBytes: number;
}

/**
 * Limits used when /info/configuration is unavailable or omits a field:
 * the a-s client fallbacks (request 260KiB / payload 256KiB — a-s
 * request.rs default_max_request_bytes/default_max_record_payload_bytes)
 * plus the syncstorage server defaults for the post/total caps with the
 * production Spanner clamp on max_total_bytes
 * (MAX_SPANNER_LOAD_SIZE = 100_000_000, syncserver-common).
 */
export const FALLBACK_STORAGE_LIMITS: StorageLimits = {
  maxRequestBytes: 260 * 1024,
  maxRecordPayloadBytes: 256 * 1024,
  maxPostRecords: 100,
  maxPostBytes: 2.5 * 1024 * 1024,
  maxTotalRecords: 10000,
  maxTotalBytes: 100_000_000,
};

const CONFIGURATION_KEYS: Array<[keyof StorageLimits, string]> = [
  ["maxRequestBytes", "max_request_bytes"],
  ["maxRecordPayloadBytes", "max_record_payload_bytes"],
  ["maxPostRecords", "max_post_records"],
  ["maxPostBytes", "max_post_bytes"],
  ["maxTotalRecords", "max_total_records"],
  ["maxTotalBytes", "max_total_bytes"],
];

/**
 * GET /info/configuration. Never rejects: transport failures, non-200
 * statuses and unparseable or partial bodies all degrade to
 * FALLBACK_STORAGE_LIMITS (per-field when only some keys are missing).
 */
export async function fetchInfoConfiguration(
  context: StorageContext
): Promise<{
  status: number;
  limits: StorageLimits;
  backoffSeconds: number | null;
}> {
  let response;
  try {
    response = await storageGet(context, "/info/configuration");
  } catch {
    return { status: 0, limits: FALLBACK_STORAGE_LIMITS, backoffSeconds: null };
  }
  const backoffSecondsValue = backoffSeconds(response.headers);
  if (response.status !== 200) {
    return {
      status: response.status,
      limits: FALLBACK_STORAGE_LIMITS,
      backoffSeconds: backoffSecondsValue,
    };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(response.body) as Record<string, unknown>;
  } catch {
    return {
      status: response.status,
      limits: FALLBACK_STORAGE_LIMITS,
      backoffSeconds: backoffSecondsValue,
    };
  }
  const limits = {} as StorageLimits;
  for (const [field, wireKey] of CONFIGURATION_KEYS) {
    const raw = parsed[wireKey];
    limits[field] =
      typeof raw === "number" && Number.isFinite(raw) && raw > 0
        ? raw
        : FALLBACK_STORAGE_LIMITS[field];
  }
  return { status: response.status, limits, backoffSeconds: backoffSecondsValue };
}

// ---------------------------------------------------------------------------
// Records

export interface EncryptedBso {
  id: string;
  modified: number;
  /** The encrypted payload — a JSON string with IV/hmac/ciphertext. */
  payload: string;
}

export interface FetchCollectionOptions {
  /** Only records modified strictly after this server timestamp (seconds,
   *  centisecond precision) — the incremental-fetch delta boundary. */
  newerThanSeconds?: number;
  /** Records per page. The server caps page size either way; an explicit
   *  limit keeps paging deterministic and guarantees the offset protocol
   *  is exercised on large collections. */
  limit?: number;
  /** Stop following X-Weave-Next-Offset once this many records have been
   *  read (history-sized collections would otherwise page through every
   *  URL the account ever visited). Undefined = fetch the whole set. */
  maxRecords?: number;
}

/** Upper bound on page-follow iterations — a server that always answers
 *  with an X-Weave-Next-Offset must not loop the client forever. */
const MAX_COLLECTION_PAGES = 1000;

/**
 * GET /storage/{name}?full=1 — follows X-Weave-Next-Offset pagination until
 * the server stops offering a continuation, so collections larger than one
 * server page are never silently truncated (api-1.5 §GET; the offset token
 * is opaque and round-trips verbatim). A non-200 on any page fails the call
 * with that status.
 */
export async function fetchCollection(
  context: StorageContext,
  name: string,
  options: FetchCollectionOptions = {}
): Promise<{
  status: number;
  records: EncryptedBso[];
  backoffSeconds: number | null;
}> {
  const records: EncryptedBso[] = [];
  let backoffSecondsValue: number | null = null;
  let offset: string | null = null;
  for (let page = 0; page < MAX_COLLECTION_PAGES; page += 1) {
    const query = [`full=1`];
    if (options.newerThanSeconds !== undefined) {
      query.push(`newer=${weaveTimestamp(options.newerThanSeconds)}`);
    }
    if (options.limit !== undefined) {
      query.push(`limit=${Math.floor(options.limit)}`);
    }
    if (offset !== null) query.push(`offset=${encodeURIComponent(offset)}`);
    const response = await storageGet(
      context,
      `/storage/${name}?${query.join("&")}`
    );
    backoffSecondsValue = backoffSeconds(response.headers) ?? backoffSecondsValue;
    if (response.status !== 200) {
      return {
        status: response.status,
        records: [],
        backoffSeconds: backoffSecondsValue,
      };
    }
    const raw = JSON.parse(response.body) as Array<{
      id: string;
      modified: number;
      payload: string;
    }>;
    for (const record of raw) {
      records.push({
        id: record.id,
        modified: record.modified,
        payload: record.payload,
      });
    }
    const nextOffset = headerValue(response.headers, "x-weave-next-offset");
    offset = nextOffset !== undefined && nextOffset !== "" ? nextOffset : null;
    if (offset === null) break;
    if (
      options.maxRecords !== undefined &&
      records.length >= options.maxRecords
    ) {
      break;
    }
  }
  return { status: 200, records, backoffSeconds: backoffSecondsValue };
}

/**
 * Remaining account storage bytes from the POST response's
 * X-Weave-Quota-Remaining header — null when the server did not send one.
 * A value of 0 or below means the account is over quota.
 */
export function quotaRemaining(headers: Record<string, string>): number | null {
  const raw = headerValue(headers, "x-weave-quota-remaining");
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// meta/global — engine declarations, declined engines and sync IDs. The record
// is account-wide (every client shares it): reads detect server-side engine
// resets (syncID changed / record vanished), writes only ever touch our own
// engine entry, preserving whatever other clients declared.

/** Sync 1.5 storage version this client speaks (api-1.5). */
export const STORAGE_VERSION = 5;

/** Bookmarks engine wire version (places engine version 2). */
export const BOOKMARKS_ENGINE_VERSION = 2;

export interface MetaEngineEntry {
  version: number;
  syncID: string;
}

export interface MetaGlobalPayload {
  storageVersion: number;
  syncID: string;
  engines: Record<string, MetaEngineEntry>;
  declined: string[];
}

export interface MetaGlobalRecord {
  modifiedSeconds: number;
  payload: MetaGlobalPayload;
}

/** Fetch the meta/global record. Unlike data collections, meta/global is a
 * PLAINTEXT BSO (a-s sync15 GlobalPayload / desktop plain WBO) — no envelope,
 * no key bundle. status mirrors the collection fetch: 404/absent global BSO →
 * record null with the collection status. */
export async function fetchMetaGlobal(
  context: StorageContext
): Promise<{ status: number; record: MetaGlobalRecord | null }> {
  const collection = await fetchCollection(context, "meta");
  if (collection.status !== 200) return { status: collection.status, record: null };
  const bso = collection.records.find((record) => record.id === "global");
  if (!bso) return { status: 200, record: null };
  const payload = parseMetaGlobalPayload(bso.payload);
  if (!payload) return { status: 200, record: null };
  return {
    status: 200,
    record: { modifiedSeconds: bso.modified, payload },
  };
}

/** Defensive payload reader: junk degrades to null so one malformed
 *  meta/global cannot wedge every future sync. */
export function parseMetaGlobalPayload(cleartext: string): MetaGlobalPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleartext);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const raw = parsed as Partial<MetaGlobalPayload>;
  if (typeof raw.storageVersion !== "number" || typeof raw.syncID !== "string") {
    return null;
  }
  const engines: Record<string, MetaEngineEntry> = {};
  if (raw.engines !== null && typeof raw.engines === "object") {
    for (const [name, entry] of Object.entries(raw.engines)) {
      if (
        entry !== null &&
        typeof entry === "object" &&
        typeof (entry as MetaEngineEntry).version === "number" &&
        typeof (entry as MetaEngineEntry).syncID === "string"
      ) {
        engines[name] = entry as MetaEngineEntry;
      }
    }
  }
  return {
    storageVersion: raw.storageVersion,
    syncID: raw.syncID,
    engines,
    declined: Array.isArray(raw.declined)
      ? raw.declined.filter((name): name is string => typeof name === "string")
      : [],
  };
}

/** Write meta/global back (single BSO POST, plaintext payload per the
 *  protocol, XIUS-protected against racing other clients when a modified
 *  timestamp is known). */
export async function putMetaGlobal(
  context: StorageContext,
  payload: MetaGlobalPayload,
  xiusSeconds?: number
): Promise<StoragePostResult> {
  return storagePost(
    context,
    "meta",
    [{ id: "global", sortindex: 0, payload: JSON.stringify(payload) }],
    xiusSeconds !== undefined ? { xiusSeconds } : {}
  );
}

/** Decrypt one BSO payload (batch-friendly: caller chunks the loop). */
export function decryptRecord<T>(
  bundle: KeyBundle,
  record: EncryptedBso
): { guid: string; payload: T } {
  return {
    guid: record.id,
    payload: JSON.parse(decryptRecordCleartext(bundle, record)) as T,
  };
}

/** Decrypt one BSO payload to its cleartext string (e.g. crypto/keys). */
export function decryptRecordCleartext(
  bundle: KeyBundle,
  record: EncryptedBso
): string {
  const envelope = JSON.parse(record.payload) as {
    IV: string;
    hmac: string;
    ciphertext: string;
  };
  return decryptEnvelope(bundle, envelope);
}

/** Parsed crypto/keys — mirrors a-s CollectionKeys.key_for_collection. */
export interface CollectionKeys {
  default: KeyBundle;
  forBookmarks: KeyBundle;
  /** Collection-specific bundle when present, otherwise the default. */
  forCollection: (name: string) => KeyBundle;
}

/** Parse the crypto/keys cleartext into the default + per-collection bundles. */
export function collectionKeysFromCleartext(cleartext: string): CollectionKeys {
  const parsed = JSON.parse(cleartext) as {
    default: [string, string];
    collections?: Record<string, [string, string]>;
  };
  const defaultBundle = keyBundleFromBase64Pair(
    parsed.default[0],
    parsed.default[1]
  );
  const byName = new Map<string, KeyBundle>();
  for (const [name, pair] of Object.entries(parsed.collections ?? {})) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    byName.set(name, keyBundleFromBase64Pair(pair[0]!, pair[1]!));
  }
  return {
    default: defaultBundle,
    forBookmarks: byName.get("bookmarks") ?? defaultBundle,
    forCollection: (name: string) => byName.get(name) ?? defaultBundle,
  };
}

export function kSyncBundle(kSyncBase64Url: string): KeyBundle {
  return keyBundleFromKSyncBase64Url(kSyncBase64Url);
}

// ---------------------------------------------------------------------------
// Upload (POST /storage/{collection})

/** A BSO as it appears in a POST body: envelope fields plus the encrypted
 *  payload as a JSON *string* (the wire format double-encodes payloads). */
export interface OutgoingBso {
  id: string;
  sortindex?: number;
  ttl?: number;
  payload: string;
}

export interface StoragePostOptions {
  /** X-If-Unmodified-Since (seconds, server clock) — compared against the
   *  collection's last-modified; a newer server value fails with 412. */
  xiusSeconds?: number;
  /** Batch (query-parameter protocol only): true starts a batch, an opaque
   *  server-issued id appends to one. */
  batch?: boolean | string;
  /** Commit the batch — only valid together with `batch`. */
  commit?: boolean;
}

export interface StoragePostResult {
  status: number;
  /** Response body "modified" (non-batch 200 / commit 200), seconds. */
  modifiedSeconds: number | null;
  /** Batch id from 202 in-progress responses. */
  batch: string | null;
  /** Ids the server accepted. */
  success: string[];
  /** id → reason for rejected records. Ids absent from both the success and
   *  failed lists are added here — "treated as failed for an unspecified
   *  reason" (api-1.5 §POST). */
  failed: Record<string, string>;
  /** X-Last-Modified response header, seconds — the XIUS for the next POST. */
  lastModifiedSeconds: number | null;
  headers: Record<string, string>;
  body: string;
}

/** POST a JSON array of BSOs to a collection (Sync 1.5 api §1.1/§1.2). */
export async function storagePost(
  context: StorageContext,
  collection: string,
  bsos: OutgoingBso[],
  options: StoragePostOptions = {}
): Promise<StoragePostResult> {
  if (options.commit && options.batch === undefined) {
    throw new Error("storagePost: commit requires batch");
  }
  const query: string[] = [];
  if (options.batch !== undefined) {
    // The batch id is opaque — encode it before it enters the URL.
    query.push(
      `batch=${options.batch === true ? "true" : encodeURIComponent(options.batch)}`
    );
    if (options.commit) query.push("commit=true");
  }
  const pathAndQuery =
    `/storage/${collection}${query.length > 0 ? `?${query.join("&")}` : ""}`;
  const body = JSON.stringify(bsos);
  const headers: Record<string, string> = {
    Authorization: authorization(context, "POST", pathAndQuery),
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (options.xiusSeconds !== undefined) {
    headers["X-If-Unmodified-Since"] = weaveTimestamp(options.xiusSeconds);
  }
  const response = await context.http.request({
    method: "POST",
    url: `${context.token.apiEndpoint}${pathAndQuery}`,
    headers,
    body,
  });
  const responseHeaders = response.headers ?? {};
  const parsed = parseUploadResponse(response.body);
  const failed = { ...parsed.failed };
  const accounted = new Set<string>([
    ...parsed.success,
    ...Object.keys(parsed.failed),
  ]);
  for (const bso of bsos) {
    if (!accounted.has(bso.id)) {
      failed[bso.id] ??= "missing from success/failed lists";
    }
  }
  return {
    status: response.status,
    modifiedSeconds: parsed.modified,
    batch: parsed.batch,
    success: parsed.success,
    failed,
    lastModifiedSeconds: timestampHeader(responseHeaders, "x-last-modified"),
    headers: responseHeaders,
    body: response.body,
  };
}

/** Server timestamps are decimal seconds with centisecond precision; format
 *  like the a-s ServerTimestamp Display (1700000000.25 → "1700000000.25")
 *  so XIUS values round-trip without float noise. */
function weaveTimestamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const whole = Math.floor(ms / 1000);
  const centiseconds = Math.floor((ms % 1000) / 10);
  if (centiseconds === 0) return String(whole);
  return `${whole}.${String(centiseconds).padStart(2, "0")}`;
}

function timestampHeader(
  headers: Record<string, string>,
  name: string
): number | null {
  const raw = headerValue(headers, name);
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function headerValue(
  headers: Record<string, string>,
  name: string
): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

function parseUploadResponse(body: string): {
  modified: number | null;
  batch: string | null;
  success: string[];
  failed: Record<string, string>;
} {
  let parsed: unknown;
  try {
    parsed = body.trim() === "" ? null : JSON.parse(body);
  } catch {
    parsed = null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { modified: null, batch: null, success: [], failed: {} };
  }
  const obj = parsed as {
    modified?: unknown;
    batch?: unknown;
    success?: unknown;
    failed?: unknown;
  };
  const failed: Record<string, string> = {};
  if (
    obj.failed !== null &&
    typeof obj.failed === "object" &&
    !Array.isArray(obj.failed)
  ) {
    for (const [id, reason] of Object.entries(
      obj.failed as Record<string, unknown>
    )) {
      failed[id] = typeof reason === "string" ? reason : String(reason);
    }
  }
  return {
    modified:
      typeof obj.modified === "number" && Number.isFinite(obj.modified)
        ? obj.modified
        : null,
    batch: typeof obj.batch === "string" ? obj.batch : null,
    success: Array.isArray(obj.success)
      ? obj.success.filter((id): id is string => typeof id === "string")
      : [],
    failed,
  };
}
