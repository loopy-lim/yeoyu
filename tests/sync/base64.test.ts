// Codec tests: alphabet round-trips plus the local strict UTF-8 decoder.
// The decoder is hand-rolled because Hermes guarantees no TextDecoder
// (F-G3S-9): these cases pin it to WHATWG "utf-8" fatal semantics.

import { describe, expect, test } from "bun:test";
import {
  decodeBase64,
  decodeBase64Url,
  encodeBase64,
  encodeBase64Url,
  fromUtf8,
  utf8,
} from "../../src/sync/base64";

describe("base64", () => {
  test("roundtrips standard and url-safe alphabets", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const std = encodeBase64(bytes);
    expect(decodeBase64(std)).toEqual(bytes);
    const url = encodeBase64Url(bytes);
    expect(decodeBase64Url(url)).toEqual(bytes);
    expect(url).not.toContain("+");
    expect(url).not.toContain("/");
    expect(url).not.toContain("=");
  });

  test("decodes upstream vector encodings", () => {
    expect(decodeBase64Url("AQ").length).toBe(1);
    expect(() => decodeBase64("!!")).toThrow();
  });
});

describe("utf8", () => {
  test("encodes ascii and multibyte sequences", () => {
    expect(utf8("abc")).toEqual(new Uint8Array([97, 98, 99]));
    expect(Array.from(utf8("한"))).toEqual([0xed, 0x95, 0x9c]);
  });

  test("fromUtf8 decodes 1–4 byte sequences and roundtrips", () => {
    expect(fromUtf8(new Uint8Array([97]))).toBe("a");
    expect(fromUtf8(new Uint8Array([0xc3, 0xa9]))).toBe("é");
    expect(fromUtf8(new Uint8Array([0xed, 0x95, 0x9c]))).toBe("한");
    expect(fromUtf8(new Uint8Array([0xf0, 0x9f, 0xa6, 0x8a]))).toBe("🦊");
    const sample = "여유 yeoyu — Firefox Sync 🦊";
    expect(fromUtf8(utf8(sample))).toBe(sample);
  });

  test("fromUtf8 rejects malformed sequences like WHATWG fatal", () => {
    expect(() => fromUtf8(new Uint8Array([0x80]))).toThrow(); // bare continuation
    expect(() => fromUtf8(new Uint8Array([0xc0, 0xaf]))).toThrow(); // overlong lead
    expect(() => fromUtf8(new Uint8Array([0xc3]))).toThrow(); // truncated 2-byte
    expect(() => fromUtf8(new Uint8Array([0xe0, 0x80, 0xaf]))).toThrow(); // overlong 3-byte
    expect(() => fromUtf8(new Uint8Array([0xed, 0xa0, 0x80]))).toThrow(); // UTF-16 surrogate
    expect(() => fromUtf8(new Uint8Array([0xf0, 0x80, 0x80, 0x80]))).toThrow(); // overlong 4-byte
    expect(() => fromUtf8(new Uint8Array([0xf4, 0x90, 0x80, 0x80]))).toThrow(); // > U+10FFFF
    expect(() => fromUtf8(new Uint8Array([0xf0, 0x9f, 0xa6]))).toThrow(); // truncated 4-byte
  });
});
