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
  pathAndQuery: string,
  payload?: { contentType: string; body: string }
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
      payload,
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

export async function fetchCollection(
  context: StorageContext,
  name: string
): Promise<{
  status: number;
  records: EncryptedBso[];
  backoffSeconds: number | null;
}> {
  const response = await storageGet(
    context,
    `/storage/${name}?full=1`
  );
  const backoffSecondsValue = backoffSeconds(response.headers);
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
  return {
    status: response.status,
    records: raw.map((record) => ({
      id: record.id,
      modified: record.modified,
      payload: record.payload,
    })),
    backoffSeconds: backoffSecondsValue,
  };
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

/** Parse the crypto/keys cleartext and return the bookmarks key bundle. */
export function collectionKeysFromCleartext(
  cleartext: string
): { default: KeyBundle; forBookmarks: KeyBundle } {
  const parsed = JSON.parse(cleartext) as {
    default: [string, string];
    collections?: Record<string, [string, string]>;
  };
  const defaultBundle = keyBundleFromBase64Pair(
    parsed.default[0],
    parsed.default[1]
  );
  const bookmarkPair = parsed.collections?.["bookmarks"];
  return {
    default: defaultBundle,
    forBookmarks: bookmarkPair
      ? keyBundleFromBase64Pair(bookmarkPair[0], bookmarkPair[1])
      : defaultBundle,
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
    Authorization: authorization(context, "POST", pathAndQuery, {
      contentType: "application/json",
      body,
    }),
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
