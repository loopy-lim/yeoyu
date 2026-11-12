// Sync 1.5 storage client (GET-only by design — Phase 1 never writes).
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
    message: string
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
