// Cryptographic primitives for Firefox Sync:
//   - sync15 key bundles (kSync split) and weave envelope decryption and
//     encryption (HMAC-SHA256 + AES-256-CBC), mirroring application-services
//     components/sync15/src/key_bundle.rs and the Weave CryptoWrapper
//   - JWE ECDH-ES + A256GCM decryption of the FxA keys_jwe response
//     (RFC 7518 §4.3, ConcatKDF direct key agreement)
//   - Hawk request signing for the sync storage server (taskcluster/rust-hawk
//     normalized string format), with optional Hawk 1.1 payload validation
// All functions are pure; randomness is injected where required.

// noble v2: every subpath import requires the .js suffix (exports map), and
// sha256/p256 live in sha2.js / nist.js respectively.
import { gcm, cbc } from "@noble/ciphers/aes.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { p256 } from "@noble/curves/nist.js";
import { randomBytes } from "@noble/hashes/utils.js";
import {
  decodeBase64,
  decodeBase64Url,
  decodeHex,
  encodeBase64,
  encodeBase64Url,
  fromUtf8,
  utf8,
} from "./base64";

// ---------------------------------------------------------------------------
// Key bundles

export interface KeyBundle {
  encKey: Uint8Array; // 32 bytes
  macKey: Uint8Array; // 32 bytes
}

export function keyBundleFromKSyncBase64Url(kSync: string): KeyBundle {
  const raw = decodeBase64Url(kSync);
  if (raw.length !== 64) {
    throw new Error(`kSync must be 64 bytes, got ${raw.length}`);
  }
  return { encKey: raw.slice(0, 32), macKey: raw.slice(32, 64) };
}

/** crypto/keys payload format: { default: [encStdB64, macStdB64], ... } */
export function keyBundleFromBase64Pair(enc: string, mac: string): KeyBundle {
  const encKey = decodeBase64(enc);
  const macKey = decodeBase64(mac);
  if (encKey.length !== 32 || macKey.length !== 32) {
    throw new Error("key bundle members must be 32 bytes");
  }
  return { encKey, macKey };
}

// ---------------------------------------------------------------------------
// Weave envelope

export interface EnvelopePayload {
  IV: string;
  hmac: string;
  ciphertext: string;
}

export function decryptEnvelope(
  bundle: KeyBundle,
  payload: EnvelopePayload
): string {
  const iv = decodeBase64(payload.IV);
  if (iv.length !== 16) throw new Error("envelope IV must be 16 bytes");
  let mac: Uint8Array;
  try {
    mac = decodeHex(payload.hmac);
  } catch {
    throw new Error("envelope hmac is not hex");
  }
  const ciphertext = decodeBase64(payload.ciphertext);
  // The legacy sync AEAD signs the *base64 ciphertext string bytes*, not the
  // decoded ciphertext (Firefox Weave CryptoWrapper.encrypt; verified against
  // the a-s key_bundle.rs test vector).
  const expected = hmac(sha256, bundle.macKey, utf8(payload.ciphertext));
  if (!constantTimeEqual(expected, mac)) {
    throw new Error("envelope hmac mismatch");
  }
  const plain = cbc(bundle.encKey, iv, { disablePadding: false }).decrypt(
    ciphertext
  );
  return fromUtf8(plain);
}

/**
 * Encrypt a cleartext JSON string into a weave envelope — the exact inverse
 * of decryptEnvelope (Firefox Weave CryptoWrapper.encrypt / a-s
 * bso/crypto.rs into_encrypted): AES-256-CBC with PKCS#7 padding, standard
 * base64 ciphertext, and the legacy sync MAC computed over the base64
 * ciphertext STRING bytes (not the decoded ciphertext), hex-encoded.
 */
export function encryptEnvelope(
  bundle: KeyBundle,
  cleartext: string,
  random: (n: number) => Uint8Array = randomBytes
): EnvelopePayload {
  const iv = random(16);
  if (iv.length !== 16) throw new Error("envelope IV must be 16 bytes");
  const ciphertext = cbc(bundle.encKey, iv, { disablePadding: false }).encrypt(
    utf8(cleartext)
  );
  const ciphertextB64 = encodeBase64(ciphertext);
  const mac = hmac(sha256, bundle.macKey, utf8(ciphertextB64));
  return {
    IV: encodeBase64(iv),
    hmac: toHex(mac),
    ciphertext: ciphertextB64,
  };
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  // Length-dependent early exit leaks only the length, which is not secret.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// JWE ECDH-ES + A256GCM (keys_jwe)

export interface EphemeralKeyPair {
  /** JWK public key sent as the keys_jwk query parameter. */
  publicJwk: { kty: "EC"; crv: "P-256"; x: string; y: string };
  privateScalar: Uint8Array;
}

export function generateEphemeralKeyPair(random: (n: number) => Uint8Array = randomBytes): EphemeralKeyPair {
  const privateKey = random(32);
  // false → uncompressed (0x04 || X || Y, 65 bytes); v2 defaults to compressed.
  const publicKey = p256.getPublicKey(privateKey, false);
  return {
    publicJwk: {
      kty: "EC",
      crv: "P-256",
      x: encodeBase64Url(publicKey.subarray(1, 33)),
      y: encodeBase64Url(publicKey.subarray(33, 65)),
    },
    privateScalar: privateKey,
  };
}

/**
 * Decrypt a JWE compact serialization produced with alg=ECDH-ES, enc=A256GCM.
 * The CEK is derived with the ConcatKDF from RFC 7518 §4.3.2 over the ECDH
 * shared secret between our ephemeral private key and the epk in the header.
 */
export function decryptJwe(
  jweCompact: string,
  localKey: EphemeralKeyPair
): string {
  const parts = jweCompact.split(".");
  if (parts.length !== 5) throw new Error("JWE must have 5 parts");
  const [headerB64, encryptedKeyB64, ivB64, ciphertextB64, tagB64] = parts;
  const header = JSON.parse(fromUtf8(decodeBase64Url(headerB64))) as {
    alg: string;
    enc: string;
    epk?: { kty: string; crv: string; x: string; y: string };
    apu?: string;
    apv?: string;
  };
  if (header.alg !== "ECDH-ES" || header.enc !== "A256GCM") {
    throw new Error(`unsupported JWE alg/enc: ${header.alg}/${header.enc}`);
  }
  if (!header.epk || header.epk.kty !== "EC" || header.epk.crv !== "P-256") {
    throw new Error("JWE header has no P-256 epk");
  }
  if (encryptedKeyB64 !== "") {
    // Direct key agreement: the encrypted key section must be empty.
    throw new Error("ECDH-ES JWE must not carry an encrypted key");
  }
  const x = decodeBase64Url(header.epk.x);
  const y = decodeBase64Url(header.epk.y);
  if (x.length !== 32 || y.length !== 32) {
    throw new Error("JWE epk coordinates must be 32 bytes");
  }
  const serverPublicKey = p256.Point.fromBytes(
    concat(new Uint8Array([0x04]), x, y)
  );
  // RFC 7518 §4.3.2: Z is the x-coordinate of the shared point. noble v2
  // returns the compressed shared point (0x02/03 || X); slice the x out.
  const shared = p256.getSharedSecret(
    localKey.privateScalar,
    serverPublicKey.toBytes()
  );
  const z = shared.subarray(1, 33);
  const cek = concatKdf(
    z,
    utf8("A256GCM"),
    header.apu ? decodeBase64Url(header.apu) : new Uint8Array(0),
    header.apv ? decodeBase64Url(header.apv) : new Uint8Array(0),
    32
  );
  const iv = decodeBase64Url(ivB64);
  const ciphertext = decodeBase64Url(ciphertextB64);
  const tag = decodeBase64Url(tagB64);
  // AAD is the raw base64url protected-header segment, exactly as serialized
  // (jwcrypto aes.rs: aead::Aad::from(jwe.protected_header_raw().as_bytes())).
  const plaintext = gcm(cek, iv, utf8(headerB64)).decrypt(
    concat(ciphertext, tag)
  );
  return fromUtf8(plaintext);
}

/** RFC 7518 §4.4 ConcatKDF over SHA-256, single 32-byte key (1 round). */
function concatKdf(
  z: Uint8Array,
  algorithmId: Uint8Array,
  apu: Uint8Array,
  apv: Uint8Array,
  lengthBytes: number
): Uint8Array {
  const suppPubInfo = new Uint8Array(4);
  const bits = lengthBytes * 8;
  suppPubInfo[0] = (bits >>> 24) & 0xff;
  suppPubInfo[1] = (bits >>> 16) & 0xff;
  suppPubInfo[2] = (bits >>> 8) & 0xff;
  suppPubInfo[3] = bits & 0xff;
  const otherInfo = concat(
    lengthPrefixed(algorithmId),
    lengthPrefixed(apu),
    lengthPrefixed(apv),
    // SuppPubInfo (key length in bits, 4-byte BE) is NOT length-prefixed —
    // jwcrypto ec.rs get_secret_from_ikm appends it raw.
    suppPubInfo
  );
  const rounds = Math.ceil(lengthBytes / 32);
  // Explicit ArrayBufferLike backing: sha256 results are not guaranteed
  // ArrayBuffer-backed under the TS 5.7 Uint8Array generics.
  let out: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  for (let i = 1; i <= rounds; i += 1) {
    const counter = new Uint8Array(4);
    counter[0] = (i >>> 24) & 0xff;
    counter[1] = (i >>> 16) & 0xff;
    counter[2] = (i >>> 8) & 0xff;
    counter[3] = i & 0xff;
    out = concat(out, sha256(concat(counter, z, otherInfo)));
  }
  return out.slice(0, lengthBytes);
}

function lengthPrefixed(bytes: Uint8Array): Uint8Array {
  const length = new Uint8Array(4);
  length[0] = (bytes.length >>> 24) & 0xff;
  length[1] = (bytes.length >>> 16) & 0xff;
  length[2] = (bytes.length >>> 8) & 0xff;
  length[3] = bytes.length & 0xff;
  return concat(length, bytes);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const array of arrays) {
    out.set(array, offset);
    offset += array.length;
  }
  return out;
}

export { concat };

// ---------------------------------------------------------------------------
// Hawk

export interface HawkCredentials {
  id: string;
  key: string;
}

export interface HawkRequest {
  method: string;
  /** path + query, e.g. /1.5/uid/storage/bookmarks?full=1 */
  pathAndQuery: string;
  host: string;
  port: number;
  /** Optional payload validation (Hawk 1.1): POST bodies. When present the
   *  header carries hash = hawkPayloadHash(...) and the MAC normalized
   *  string's hash field holds it; GETs keep the legacy empty hash. */
  payload?: { contentType: string; body: string };
}

/**
 * Hawk 1.1 payload hash artifact: BASE64(HMAC-SHA256(key,
 * "hawk.1.payload\n" + contentType + "\n" + body + "\n")). The content type
 * is the normalized (lowercase, parameter-free) value — "application/json"
 * for storage POSTs.
 */
export function hawkPayloadHash(
  macKey: string,
  contentType: string,
  body: string
): string {
  return encodeBase64(
    hmac(sha256, utf8(macKey), utf8(`hawk.1.payload\n${contentType}\n${body}\n`))
  );
}

/** Server-time in seconds — the tokenserver X-Timestamp keeps us in sync. */
export function hawkAuthorizationHeader(
  credentials: HawkCredentials,
  request: HawkRequest,
  serverTimeSeconds: number,
  nonce: () => string
): string {
  const nonceValue = nonce();
  // hawk.1.header: …\n{host}\n{port}\n{ext}\n{hash}\n — ext stays empty
  // (never used against the storage server); hash is set only for bodied
  // requests, keeping the GET wire format byte-identical to Phase 1.
  const hash = request.payload
    ? hawkPayloadHash(
        credentials.key,
        request.payload.contentType,
        request.payload.body
      )
    : "";
  const normalized =
    `hawk.1.header\n${serverTimeSeconds}\n${nonceValue}\n` +
    `${request.method.toUpperCase()}\n${request.pathAndQuery}\n` +
    `${request.host}\n${request.port}\n\n${hash}\n`;
  const mac = hmac(
    sha256,
    utf8(credentials.key),
    utf8(normalized)
  );
  // Attribute order follows the reference hawk clients: id, ts, nonce,
  // hash, mac (servers parse attributes by name, mac must sign them all).
  return (
    `Hawk id="${credentials.id}", ts="${serverTimeSeconds}", ` +
    `nonce="${nonceValue}"` +
    (hash === "" ? "" : `, hash="${hash}"`) +
    `, mac="${encodeBase64(mac)}"`
  );
}
