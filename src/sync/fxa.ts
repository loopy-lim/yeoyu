// FxA OAuth client for the receive-only sync integration. Mirrors
// application-services components/fxa-client/src/internal/oauth.rs:
// PKCE S256, ephemeral ECDH keys_jwk, context=oauth_webchannel_v1, and no
// redirect_uri (the server default for the Fenix client is the webchannel
// URN, which the host browser intercepts as a navigation).

import { sha256 as defaultSha256 } from "@noble/hashes/sha2.js";
import { decodeBase64Url, encodeBase64Url, utf8 } from "./base64";
import { decryptJwe, EphemeralKeyPair, generateEphemeralKeyPair } from "./crypto";

export const FXA_CLIENT_ID = "a2270f727f45f648"; // Fenix (public constant, user-approved)
export const FXA_AUTHORIZATION_URL = "https://accounts.firefox.com/authorization";
export const FXA_TOKEN_URL = "https://oauth.accounts.firefox.com/v1/token";
export const FXA_PROFILE_URL = "https://profile.accounts.firefox.com/v1/profile";
export const OAUTH_WEBCHANNEL_REDIRECT =
  "urn:ietf:wg:oauth:2.0:oob:oauth-redirect-webchannel";
export const OAUTH_CONTEXT = "oauth_webchannel_v1";
export const OLD_SYNC_SCOPE = "https://identity.mozilla.com/apps/oldsync";
export const FXA_SCOPES = `profile ${OLD_SYNC_SCOPE}`;

export interface HttpTransport {
  request(input: {
    method: "GET" | "POST";
    url: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
}

export function sha256Base64Url(
  input: string,
  hash: (data: Uint8Array) => Uint8Array = defaultSha256
): string {
  return encodeBase64Url(hash(utf8(input)));
}

export interface AuthorizationRequest {
  state: string;
  codeVerifier: string;
  keys: EphemeralKeyPair;
}

export function buildAuthorizationFlow(random: (n: number) => Uint8Array): {
  url: string;
  request: AuthorizationRequest;
} {
  // PKCE: 43-byte url-safe verifier per the fxa oauth api contract.
  const codeVerifier = encodeBase64Url(random(32)).slice(0, 43);
  if (codeVerifier.length !== 43) throw new Error("PKCE verifier length");
  const state = encodeBase64Url(random(16));
  const keys = generateEphemeralKeyPair(random);
  const url =
    `${FXA_AUTHORIZATION_URL}?client_id=${encodeURIComponent(FXA_CLIENT_ID)}` +
    `&state=${encodeURIComponent(state)}` +
    `&code_challenge_method=S256` +
    // Hash injected for testability (bun and Hermes both lack sync crypto here).
    `&code_challenge=${sha256Base64Url(codeVerifier)}` +
    `&access_type=offline` +
    `&keys_jwk=${encodeURIComponent(encodeBase64Url(utf8(JSON.stringify(keys.publicJwk))))}` +
    `&scope=${encodeURIComponent(FXA_SCOPES)}` +
    `&context=${encodeURIComponent(OAUTH_CONTEXT)}`;
  return { url, request: { state, codeVerifier, keys } };
}


export interface TokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number;
  keysJwe: string | null;
  scope: string;
}

async function postForm(
  http: HttpTransport,
  url: string,
  form: Record<string, string>
): Promise<{ status: number; body: string }> {
  const body = Object.entries(form)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join("&");
  const response = await http.request({
    method: "POST",
    url,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  return { status: response.status, body: response.body };
}

export async function exchangeCode(
  http: HttpTransport,
  code: string,
  codeVerifier: string
): Promise<TokenResponse> {
  const { status, body } = await postForm(http, FXA_TOKEN_URL, {
    grant_type: "authorization_code",
    code,
    client_id: FXA_CLIENT_ID,
    code_verifier: codeVerifier,
  });
  return parseTokenResponse(status, body);
}

export async function refreshAccessToken(
  http: HttpTransport,
  refreshToken: string
): Promise<TokenResponse> {
  const { status, body } = await postForm(http, FXA_TOKEN_URL, {
    grant_type: "refresh_token",
    client_id: FXA_CLIENT_ID,
    refresh_token: refreshToken,
  });
  return parseTokenResponse(status, body);
}

export class FxaHttpError extends Error {
  constructor(
    public status: number,
    public errno: number | null,
    message: string
  ) {
    super(message);
  }
}

function parseTokenResponse(status: number, body: string): TokenResponse {
  if (status !== 200) {
    let errno: number | null = null;
    try {
      errno = (JSON.parse(body) as { errno?: number }).errno ?? null;
    } catch {
      // non-JSON error body
    }
    throw new FxaHttpError(status, errno, `fxa token endpoint ${status}`);
  }
  const parsed = JSON.parse(body) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    keys_jwe?: string;
    scope: string;
  };
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? null,
    expiresInSeconds: parsed.expires_in,
    keysJwe: parsed.keys_jwe ?? null,
    scope: parsed.scope,
  };
}

export interface ScopedKeyMaterial {
  /** base64url 64 bytes */
  k: string;
  kid: string;
}

export function decryptScopedKeys(
  keysJwe: string,
  localKeys: EphemeralKeyPair
): Record<string, ScopedKeyMaterial> {
  const plaintext = decryptJwe(keysJwe, localKeys);
  const parsed = JSON.parse(plaintext) as Record<string, ScopedKeyMaterial>;
  const syncKey = parsed[OLD_SYNC_SCOPE];
  if (!syncKey || !syncKey.k || !syncKey.kid) {
    throw new Error("keys_jwe has no oldsync scoped key");
  }
  if (decodeBase64Url(syncKey.k).length !== 64) {
    throw new Error("oldsync k must be 64 bytes");
  }
  return parsed;
}

export async function fetchProfileEmail(
  http: HttpTransport,
  accessToken: string
): Promise<string | null> {
  const response = await http.request({
    method: "GET",
    url: FXA_PROFILE_URL,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status !== 200) {
    throw new FxaHttpError(
      response.status,
      null,
      `fxa profile ${response.status}`
    );
  }
  return (JSON.parse(response.body) as { email?: string }).email ?? null;
}
