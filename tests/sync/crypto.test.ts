// Protocol crypto tests against Mozilla application-services test vectors
// (components/sync15/src/key_bundle.rs tests, components/fxa-client
// scoped_keys.rs test_flow) — the JWE and envelope vectors are copied verbatim
// from the upstream sources cached during the research phase.

import { describe, expect, test } from "bun:test";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  decodeBase64,
  decodeBase64Url,
  encodeBase64,
  encodeBase64Url,
  fromUtf8,
  utf8,
} from "../../src/sync/base64";
import {
  decryptEnvelope,
  decryptJwe,
  generateEphemeralKeyPair,
  hawkAuthorizationHeader,
  hawkPayloadHash,
  keyBundleFromBase64Pair,
  keyBundleFromKSyncBase64Url,
  EphemeralKeyPair,
} from "../../src/sync/crypto";

describe("sync15 key bundle", () => {
  test("splits kSync into 32/32 halves", () => {
    const kSync = new Uint8Array(64);
    for (let i = 0; i < 64; i += 1) kSync[i] = i;
    const bundle = keyBundleFromKSyncBase64Url(encodeBase64Url(kSync));
    expect(Array.from(bundle.encKey)).toEqual(Array.from(kSync.slice(0, 32)));
    expect(Array.from(bundle.macKey)).toEqual(Array.from(kSync.slice(32, 64)));
    expect(() => keyBundleFromKSyncBase64Url(encodeBase64Url(new Uint8Array(32)))).toThrow();
  });
});

describe("weave envelope decrypt (a-s key_bundle.rs vector)", () => {
  const ENC_KEY_B64 = "9K/wLdXdw+nrTtXo4ZpECyHFNr4d7aYHqeg3KW9+m6Q=";
  const HMAC_KEY_B64 = "MMntEfutgLTc8FlTLQFms8/xMPmCldqPlq/QQXEjx70=";
  const IV_B64 = "GX8L37AAb2FZJMzIoXlX8w==";
  const HMAC_B16 = "b1e6c18ac30deb70236bc0d65a46f7a4dce3b8b0e02cf92182b914e3afa5eebc";
  const CIPHERTEXT = [
    "NMsdnRulLwQsVcwxKW9XwaUe7ouJk5Wn80QhbD80l0HEcZGCynh45qIbeYBik0lgcHbK",
    "mlIxTJNwU+OeqipN+/j7MqhjKOGIlvbpiPQQLC6/ffF2vbzL0nzMUuSyvaQzyGGkSYM2",
    "xUFt06aNivoQTvU2GgGmUK6MvadoY38hhW2LCMkoZcNfgCqJ26lO1O0sEO6zHsk3IVz6",
    "vsKiJ2Hq6VCo7hu123wNegmujHWQSGyf8JeudZjKzfi0OFRRvvm4QAKyBWf0MgrW1F8S",
    "FDnVfkq8amCB7NhdwhgLWbN+21NitNwWYknoEWe1m6hmGZDgDT32uxzWxCV8QqqrpH/Z",
    "ggViEr9uMgoy4lYaWqP7G5WKvvechc62aqnsNEYhH26A5QgzmlNyvB+KPFvPsYzxDnSC",
    "jOoRSLx7GG86wT59QZw=",
  ].join("");
  const CLEARTEXT = fromUtf8(
    decodeBase64(
      [
        "eyJpZCI6IjVxUnNnWFdSSlpYciIsImhpc3RVcmkiOiJmaWxlOi8vL1VzZXJzL2phc29u",
        "L0xpYnJhcnkvQXBwbGljYXRpb24lMjBTdXBwb3J0L0ZpcmVmb3gvUHJvZmlsZXMva3Nn",
        "ZDd3cGsuTG9jYWxTeW5jU2VydmVyL3dlYXZlL2xvZ3MvIiwidGl0bGUiOiJJbmRleCBv",
        "ZiBmaWxlOi8vL1VzZXJzL2phc29uL0xpYnJhcnkvQXBwbGljYXRpb24gU3VwcG9ydC9G",
        "aXJlZm94L1Byb2ZpbGVzL2tzZ2Q3d3BrLkxvY2FsU3luY1NlcnZlci93ZWF2ZS9sb2dz",
        "LyIsInZpc2l0cyI6W3siZGF0ZSI6MTMxOTE0OTAxMjM3MjQyNSwidHlwZSI6MX1dfQ==",
      ].join("")
    )
  );

  test("decrypts to the upstream cleartext", () => {
    const bundle = keyBundleFromBase64Pair(ENC_KEY_B64, HMAC_KEY_B64);
    const cleartext = decryptEnvelope(bundle, {
      IV: IV_B64,
      hmac: HMAC_B16,
      ciphertext: CIPHERTEXT,
    });
    expect(cleartext).toBe(CLEARTEXT);
  });

  test("rejects a tampered hmac", () => {
    const bundle = keyBundleFromBase64Pair(ENC_KEY_B64, HMAC_KEY_B64);
    const badHmac = HMAC_B16.slice(0, 62) + (HMAC_B16.endsWith("0") ? "1" : "0");
    expect(() =>
      decryptEnvelope(bundle, { IV: IV_B64, hmac: badHmac, ciphertext: CIPHERTEXT })
    ).toThrow(/hmac/);
  });

  test("rejects non-hex hmac strings", () => {
    const bundle = keyBundleFromBase64Pair(ENC_KEY_B64, HMAC_KEY_B64);
    expect(() =>
      decryptEnvelope(bundle, { IV: IV_B64, hmac: "zz".repeat(32), ciphertext: CIPHERTEXT })
    ).toThrow();
  });
});

describe("JWE ECDH-ES A256GCM (a-s scoped_keys.rs test_flow vector)", () => {
  const X = "ARvGIPJ5eIFdp6YTM-INVDqwfun2R9FfCUvXbH7QCIU";
  const D = "UayD4kn_4QHvLvLLSSaANfDUp9AcQndQu_TohQKoyn8";
  const JWE =
    "eyJhbGciOiJFQ0RILUVTIiwia2lkIjoiNFBKTTl5dGVGeUtsb21ILWd2UUtyWGZ0a0N3ak9HNHRfTmpYVXhLM1VqSSIsImVwayI6eyJrdHkiOiJFQyIsImNydiI6IlAtMjU2IiwieCI6IlB3eG9Na1RjSVZ2TFlKWU4wM2R0Y3o2TEJrR0FHaU1hZWlNQ3lTZXEzb2MiLCJ5IjoiLUYtTllRRDZwNUdSQ2ZoYm1hN3NvNkhxdExhVlNub012S0pFcjFBeWlaSSJ9LCJlbmMiOiJBMjU2R0NNIn0..b9FPhjjpmAmo_rP8.ur9jTry21Y2trvtcanSFmAtiRfF6s6qqyg6ruRal7PCwa7PxDzAuMN6DZW5BiK8UREOH08-FyRcIgdDOm5Zq8KwVAn56PGfcH30aNDGQNkA_mpfjx5Tj2z8kI6ryLWew4PGZb-PsL1g-_eyXhktq7dAhetjNYttKwSREWQFokv7N3nJGpukBqnwL1ost-MjDXlINZLVJKAiMHDcu-q7Epitwid2c2JVGOSCJjbZ4-zbxVmZ4o9xhFb2lbvdiaMygH6bPlrjEK99uT6XKtaIZmyDwftbD6G3x4On-CqA2TNL6ILRaJMtmyX--ctL0IrngUIHg_F0Wz94v.zBD8NACkUcZTPLH0tceGnA";
  const EXPECTED =
    '{"https://identity.mozilla.com/apps/oldsync":{"kty":"oct","scope":"https://identity.mozilla.com/apps/oldsync","k":"8ek1VNk4sjrNP0DhGC4crzQtwmpoR64zHuFMHb4Tw-exR70Z2SSIfMSrJDTLEZid9lD05-hbA3n2Q4Esjlu1tA","kid":"1526414944666-zgTjf5oXmPmBjxwXWFsDWg"}}';

  function staticKeyPair(): EphemeralKeyPair {
    return {
      publicJwk: {
        kty: "EC",
        crv: "P-256",
        x: X,
        y: "hk8gP0Po8nBh-WSiTsvsyesC5c1L6fGOEVuX8FHsvTs",
      },
      privateScalar: decodeBase64Url(D),
    };
  }

  test("decrypts keys_jwe to the oldsync scoped key", () => {
    expect(decryptJwe(JWE, staticKeyPair())).toBe(EXPECTED);
  });

  test("rejects with the wrong local key", () => {
    const other = generateEphemeralKeyPair(() => new Uint8Array(32).fill(7));
    expect(() => decryptJwe(JWE, other)).toThrow();
  });
});

describe("hawk header", () => {
  test("normalized mac string and header format match rust-hawk layout", () => {
    const header = hawkAuthorizationHeader(
      { id: "my-id", key: "my-key" },
      { method: "get", pathAndQuery: "/1.5/123/storage/bookmarks?full=1", host: "sync-1-us-east-1.storage.mozilla.com", port: 443 },
      1700000000,
      () => "noncenonce"
    );
    // Reconstruct the expected mac with the documented normalized string.
    const normalized =
      "hawk.1.header\n1700000000\nnoncenonce\nGET\n/1.5/123/storage/bookmarks?full=1\nsync-1-us-east-1.storage.mozilla.com\n443\n\n\n";
    const mac = encodeBase64(hmac(sha256, utf8("my-key"), utf8(normalized)));
    expect(header).toBe(
      `Hawk id="my-id", ts="1700000000", nonce="noncenonce", mac="${mac}"`
    );
  });

  test("GET without payload keeps the legacy empty-hash format (no hash attribute)", () => {
    const header = hawkAuthorizationHeader(
      { id: "my-id", key: "my-key" },
      { method: "GET", pathAndQuery: "/1.5/123/info/configuration", host: "sync-1-us-east-1.storage.mozilla.com", port: 443 },
      1700000000,
      () => "noncenonce"
    );
    expect(header).not.toContain("hash=");
    expect(header).toMatch(/^Hawk id="my-id", ts="1700000000", nonce="noncenonce", mac="[A-Za-z0-9+/]+={0,2}"$/);
  });

  test("bodied request carries the Hawk 1.1 payload hash and a mac over it", () => {
    const body = JSON.stringify([
      { id: "abc", sortindex: 1000000, payload: '{"IV":"…","hmac":"…","ciphertext":"…"}' },
    ]);
    const header = hawkAuthorizationHeader(
      { id: "my-id", key: "my-key" },
      {
        method: "post",
        pathAndQuery: "/1.5/123/storage/bookmarks?batch=true&commit=true",
        host: "sync-1-us-east-1.storage.mozilla.com",
        port: 443,
        payload: { contentType: "application/json", body },
      },
      1700000000,
      () => "noncenonce"
    );
    // hawk.1.payload artifact, then the header mac over hawk.1.header with
    // the hash in the (otherwise empty) hash field.
    const hash = encodeBase64(
      hmac(sha256, utf8("my-key"), utf8(`hawk.1.payload\napplication/json\n${body}\n`))
    );
    const normalized =
      "hawk.1.header\n1700000000\nnoncenonce\nPOST\n" +
      "/1.5/123/storage/bookmarks?batch=true&commit=true\n" +
      "sync-1-us-east-1.storage.mozilla.com\n443\n\n" +
      `${hash}\n`;
    const mac = encodeBase64(hmac(sha256, utf8("my-key"), utf8(normalized)));
    expect(header).toBe(
      `Hawk id="my-id", ts="1700000000", nonce="noncenonce", hash="${hash}", mac="${mac}"`
    );
  });

  test("hawkPayloadHash matches the hawk.1.payload normalization", () => {
    const body = '{"id":"x","payload":"y"}';
    const expected = encodeBase64(
      hmac(sha256, utf8("feedf00d"), utf8(`hawk.1.payload\napplication/json\n${body}\n`))
    );
    expect(hawkPayloadHash("feedf00d", "application/json", body)).toBe(expected);
    // The body is included verbatim — different bytes, different hash.
    expect(hawkPayloadHash("feedf00d", "application/json", body + " ")).not.toBe(expected);
  });
});
