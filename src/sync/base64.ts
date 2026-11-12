// Base64/hex codecs for the Firefox Sync protocol. React Native (Hermes)
// ships no atob/btoa or Buffer globals, so the codecs are local and tested
// against fixtures shared with the Mozilla application-services vectors.

const STD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function decodeWith(alphabet: string, input: string): Uint8Array {
  const padded = input.replace(/=+$/, "");
  let buffer = 0;
  let bits = 0;
  const out: number[] = [];
  for (const char of padded) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error("invalid base64 character");
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  // Leftover bits must be zero padding, not data.
  if (bits >= 6 && (buffer & ((1 << bits) - 1)) !== 0) {
    throw new Error("invalid base64 padding");
  }
  return Uint8Array.from(out);
}

function encodeWith(alphabet: string, bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += alphabet[(buffer >> bits) & 0x3f];
    }
  }
  if (bits > 0) {
    out += alphabet[(buffer << (6 - bits)) & 0x3f];
  }
  return out;
}

export function decodeBase64(input: string): Uint8Array {
  return decodeWith(STD_ALPHABET, input);
}

/** Standard base64 with padding, as used by sync envelope fields. */
export function encodeBase64(bytes: Uint8Array): string {
  const raw = encodeWith(STD_ALPHABET, bytes);
  return raw + "=".repeat((4 - (raw.length % 4)) % 4);
}

export function decodeBase64Url(input: string): Uint8Array {
  return decodeWith(URL_ALPHABET, input);
}

/** Unpadded url-safe base64, the JWE / JWK / kSync encoding. */
export function encodeBase64Url(bytes: Uint8Array): string {
  return encodeWith(URL_ALPHABET, bytes);
}

export function decodeHex(input: string): Uint8Array {
  if (input.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(input)) {
    throw new Error("invalid hex string");
  }
  const out = new Uint8Array(input.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(input.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function utf8(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

/** Strict (fatal) UTF-8 decode. Hermes guarantees no TextDecoder global — a
 *  missing constructor would surface as a misclassified connect failure — so
 *  the decoder is local and validates exactly like WHATWG "utf-8" fatal:
 *  overlong forms, surrogates (> U+10FFFF) and truncated sequences throw. */
export function fromUtf8(bytes: Uint8Array): string {
  let out = "";
  let index = 0;
  const length = bytes.length;
  while (index < length) {
    const lead = bytes[index]!;
    if (lead < 0x80) {
      out += String.fromCharCode(lead);
      index += 1;
      continue;
    }
    let extra: number;
    let codePoint: number;
    if (lead >= 0xc2 && lead <= 0xdf) {
      extra = 1;
      codePoint = lead & 0x1f;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      extra = 2;
      codePoint = lead & 0x0f;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      extra = 3;
      codePoint = lead & 0x07;
    } else {
      throw new Error("invalid utf-8 lead byte");
    }
    if (index + extra >= length) throw new Error("truncated utf-8 sequence");
    for (let offset = 1; offset <= extra; offset += 1) {
      const continuation = bytes[index + offset]!;
      if ((continuation & 0xc0) !== 0x80) {
        throw new Error("invalid utf-8 continuation byte");
      }
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }
    const second = bytes[index + 1]!;
    if (lead === 0xe0 && second < 0xa0) throw new Error("overlong utf-8");
    if (lead === 0xed && second >= 0xa0) throw new Error("utf-8 surrogate");
    if (lead === 0xf0 && second < 0x90) throw new Error("overlong utf-8");
    if (lead === 0xf4 && second > 0x8f) throw new Error("utf-8 beyond U+10FFFF");
    out += String.fromCodePoint(codePoint);
    index += extra + 1;
  }
  return out;
}
