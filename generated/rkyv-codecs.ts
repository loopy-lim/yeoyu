// ── rustra generated ────────────────────────────────────────
// File:   rkyv-codecs.ts
// Source: schema.json (single source of truth for this file)
// Regen:  rustra codegen --config rustra.json
// Stage:  schema → ts codec renderer
// DO NOT EDIT — changes will be overwritten and fail codegen --check.
// ────────────────────────────────────────────────────────────

// ── postcard wire format helpers ─────────────────────────────

const _dvScratchBuf = new ArrayBuffer(8);
const _dvScratch = new DataView(_dvScratchBuf);
const _dvScratchU8 = new Uint8Array(_dvScratchBuf);

function _pcEncodeVarint(n: number): Uint8Array {
  n = Math.floor(n);
  if (n < 0) throw new Error('varint must be non-negative: ' + n);
  if (n === 0) return new Uint8Array([0]);
  const bytes: number[] = [];
  while (n > 0) {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b += 128;
    bytes.push(b);
  }
  return new Uint8Array(bytes);
}

function _pcDecodeVarint(buf: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let multiplier = 1;
  let bytesRead = 0;
  while (true) {
    const b = buf[offset + bytesRead];
    if (b === undefined) throw new Error('varint out of bounds');
    value += (b & 0x7f) * multiplier;
    bytesRead++;
    if ((b & 0x80) === 0) break;
    multiplier *= 128;
    if (bytesRead > 10) throw new Error('varint too long');
  }
  return { value, bytesRead };
}

function _pcEncodeZigzag(n: number): number { return n >= 0 ? n * 2 : -n * 2 - 1; }
function _pcDecodeZigzag(n: number): number {
  const negative = n % 2 === 1;
  const magnitude = Math.floor(n / 2);
  return negative ? -magnitude - 1 : magnitude;
}
function _pcEncodeZigzagVarint(n: number): Uint8Array { return _pcEncodeVarint(_pcEncodeZigzag(n)); }
function _pcDecodeZigzagVarint(buf: Uint8Array, offset: number): { value: number; bytesRead: number } {
  const { value, bytesRead } = _pcDecodeVarint(buf, offset);
  return { value: _pcDecodeZigzag(value), bytesRead };
}

const _pcI64Min = -(2n ** 63n);
const _pcI64Max = 2n ** 63n - 1n;

function _pcEncodeVarint64(v: number | bigint): Uint8Array {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return _pcEncodeVarint(v);
  let value = BigInt(v);
  if (value < 0n) throw new Error('varint must be non-negative: ' + value.toString());
  if (value > 0xffffffffffffffffn) throw new Error('varint exceeds u64 range: ' + value.toString());
  const bytes: number[] = [];
  do {
    let next = Number(value & 0x7fn);
    value >>= 7n;
    if (value !== 0n) next |= 0x80;
    bytes.push(next);
  } while (value !== 0n);
  return new Uint8Array(bytes);
}

function _pcDecodeVarint64(buf: Uint8Array, offset: number): { value: number | bigint; bytesRead: number } {
  let num = 0;
  let multiplier = 1;
  let big = 0n;
  let bytesRead = 0;
  while (true) {
    const b = buf[offset + bytesRead];
    if (b === undefined) throw new Error('varint out of bounds');
    bytesRead++;
    if (bytesRead <= 7) {
      num += (b & 0x7f) * multiplier;
      multiplier *= 128;
      if ((b & 0x80) === 0) return { value: num, bytesRead };
    } else {
      if (bytesRead === 8) big = BigInt(num);
      big |= BigInt(b & 0x7f) << BigInt(7 * (bytesRead - 1));
      if ((b & 0x80) === 0) {
        if (bytesRead === 10 && (b & 0x7f) > 0x01) throw new Error('varint exceeds 64 bits');
        const asNumber = Number(big);
        return { value: Number.isSafeInteger(asNumber) ? asNumber : big, bytesRead };
      }
    }
    if (bytesRead >= 10) throw new Error('varint too long');
  }
}

function _pcEncodeZigzag64(v: number | bigint): Uint8Array {
  const n = BigInt(v);
  if (n < _pcI64Min || n > _pcI64Max) throw new Error('zigzag64 input outside i64 range: ' + n.toString());
  return _pcEncodeVarint64((n << 1n) ^ (n >> 63n));
}
function _pcDecodeZigzag64(v: number | bigint): number | bigint {
  const decoded = (BigInt(v) >> 1n) ^ -(BigInt(v) & 1n);
  const asNumber = Number(decoded);
  return Number.isSafeInteger(asNumber) ? asNumber : decoded;
}

function _pcConcatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  let totalLen = 0;
  for (const a of arrays) totalLen += a.length;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}

function _utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {
      const low = s.charCodeAt(++i);
      const cp = 0x10000 + ((c - 0xd800) << 10) + (low - 0xdc00);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}

function _utf8Decode(bytes: Uint8Array, start: number, end: number): string {
  // end 가 버퍼를 넘으면 즉시 실패 — 잘린 프레임에서 while (i < end) 가
  // undefined 바이트를 수없이 돌아 런타임이 멈추는 것을 막는다.
  if (end > bytes.length) throw new Error('string out of bounds');
  let s = ''; let i = start;
  while (i < end) {
    const b = bytes[i];
    if (b < 0x80) { s += String.fromCharCode(b); i += 1; }
    else if ((b & 0xe0) === 0xc0) { s += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f)); i += 2; }
    else if ((b & 0xf0) === 0xe0) { s += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)); i += 3; }
    else if ((b & 0xf8) === 0xf0) { const cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f); const adj = cp - 0x10000; s += String.fromCharCode(0xd800 + (adj >> 10), 0xdc00 + (adj & 0x3ff)); i += 4; }
    else i += 1;
  }
  return s;
}

function _pcEncodeString(s: string): Uint8Array { const bytes = _utf8Encode(s); return _pcConcatUint8Arrays([_pcEncodeVarint(bytes.length), bytes]); }
function _pcDecodeString(buf: Uint8Array, offset: number): { value: string; bytesRead: number } {
  const len = _pcDecodeVarint(buf, offset); const start = offset + len.bytesRead; const end = start + len.value;
  return { value: _utf8Decode(buf, start, end), bytesRead: len.bytesRead + len.value };
}

function _pcEncodeF64(n: number): Uint8Array { const buf = new ArrayBuffer(8); new DataView(buf).setFloat64(0, n, true); return new Uint8Array(buf); }
function _pcDecodeF64(buf: Uint8Array, offset: number): { value: number; bytesRead: number } { return { value: new DataView(buf.buffer, buf.byteOffset + offset, 8).getFloat64(0, true), bytesRead: 8 }; }
function _pcEncodeF32(n: number): Uint8Array { const buf = new ArrayBuffer(4); new DataView(buf).setFloat32(0, n, true); return new Uint8Array(buf); }
function _pcDecodeF32(buf: Uint8Array, offset: number): { value: number; bytesRead: number } { return { value: new DataView(buf.buffer, buf.byteOffset + offset, 4).getFloat32(0, true), bytesRead: 4 }; }

import { createComplexCodec } from '@rustra/types';
import type { RkyvV2Codec, RustraError, ComplexSchema } from '@rustra/types';
import type { Bookmark, BookmarkCreateInput, BookmarkFolder, BookmarkFolderCreateInput, BookmarkFolderIdInput, BookmarkFolderRenameInput, BookmarkIdInput, BookmarkMoveInput, BookmarkOpenInput, BookmarkSetFolderInput, BookmarkUpdateInput, BrowserSnapshotInput, KeyBinding, KeymapSetInput, Snapshot, SnapshotRestoreInput, String, Tab, TabCreateInput, TabFavoriteInput, TabIdInput, TabMoveInput, TabNavigatedInput, TabOpenExternalInput, TabPinnedInput, TabWorkspaceInput, WorkArchiveExportInput, WorkArchiveImportInput, WorkArchivePrepareInput, WorkArchivePreview, WorkArchivePreviewInput, Workspace, WorkspaceCreateInput, WorkspaceIdInput } from './types.js';

export const bookmarkCreateCodec: RkyvV2Codec<BookmarkCreateInput, Snapshot> = {
  commandId: 20,

  encode(args: BookmarkCreateInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(BookmarkCreateInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 20, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.title));
    parts.push(_pcEncodeString(args.url));
    parts.push(_pcEncodeString(args.folderId));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: BookmarkCreateInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 20; out[w++] = 0;
    { const _s = args.title; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.url; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.folderId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const bookmarkFolderCreateCodec: RkyvV2Codec<BookmarkFolderCreateInput, Snapshot> = {
  commandId: 24,

  encode(args: BookmarkFolderCreateInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(BookmarkFolderCreateInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 24, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.title));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: BookmarkFolderCreateInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 24; out[w++] = 0;
    { const _s = args.title; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const bookmarkFolderRemoveCodec: RkyvV2Codec<BookmarkFolderIdInput, Snapshot> = {
  commandId: 26,

  encode(args: BookmarkFolderIdInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(BookmarkFolderIdInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 26, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.folderId));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: BookmarkFolderIdInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 26; out[w++] = 0;
    { const _s = args.folderId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const bookmarkFolderRenameCodec: RkyvV2Codec<BookmarkFolderRenameInput, Snapshot> = {
  commandId: 25,

  encode(args: BookmarkFolderRenameInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(BookmarkFolderRenameInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 25, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.folderId));
    parts.push(_pcEncodeString(args.title));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: BookmarkFolderRenameInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 25; out[w++] = 0;
    { const _s = args.folderId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.title; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const bookmarkMoveCodec: RkyvV2Codec<BookmarkMoveInput, Snapshot> = {
  commandId: 23,

  encode(args: BookmarkMoveInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(BookmarkMoveInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 23, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.bookmarkId));
    parts.push(_pcEncodeVarint(args.index));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: BookmarkMoveInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 23; out[w++] = 0;
    { const _s = args.bookmarkId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { let _v = args.index; do { ensure(1); out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const bookmarkOpenCodec: RkyvV2Codec<BookmarkOpenInput, Snapshot> = {
  commandId: 29,

  encode(args: BookmarkOpenInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(BookmarkOpenInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 29, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.bookmarkId));
    parts.push(_pcEncodeString(args.reuseTabId));
    parts.push(new Uint8Array([args.private ? 1 : 0]));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: BookmarkOpenInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 29; out[w++] = 0;
    { const _s = args.bookmarkId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.reuseTabId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { ensure(1); out[w++] = args.private ? 1 : 0; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const bookmarkRemoveCodec: RkyvV2Codec<BookmarkIdInput, Snapshot> = {
  commandId: 22,

  encode(args: BookmarkIdInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(BookmarkIdInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 22, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.bookmarkId));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: BookmarkIdInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 22; out[w++] = 0;
    { const _s = args.bookmarkId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const bookmarkSetFolderCodec: RkyvV2Codec<BookmarkSetFolderInput, Snapshot> = {
  commandId: 27,

  encode(args: BookmarkSetFolderInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(BookmarkSetFolderInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 27, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.bookmarkId));
    parts.push(_pcEncodeString(args.folderId));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: BookmarkSetFolderInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 27; out[w++] = 0;
    { const _s = args.bookmarkId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.folderId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const bookmarkUpdateCodec: RkyvV2Codec<BookmarkUpdateInput, Snapshot> = {
  commandId: 21,

  encode(args: BookmarkUpdateInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(BookmarkUpdateInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 21, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.bookmarkId));
    parts.push(_pcEncodeString(args.title));
    parts.push(_pcEncodeString(args.url));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: BookmarkUpdateInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 21; out[w++] = 0;
    { const _s = args.bookmarkId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.title; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.url; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const browserSnapshotCodec: RkyvV2Codec<BrowserSnapshotInput, Snapshot> = {
  commandId: 1,

  encode(args: BrowserSnapshotInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(BrowserSnapshotInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 1, true);
    parts.push(cmdId);
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: BrowserSnapshotInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 1; out[w++] = 0;
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const keymapDefaultsCodec: RkyvV2Codec<BrowserSnapshotInput, KeymapSetInput> = {
  commandId: 19,

  encode(args: BrowserSnapshotInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(BrowserSnapshotInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 19, true);
    parts.push(cmdId);
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: BrowserSnapshotInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 19; out[w++] = 0;
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: KeymapSetInput; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<KeymapSetInput> = {};
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bindings = _arr;
    }
    return { ok: true, result: result as KeymapSetInput };
  },
};

export const keymapSetCodec: RkyvV2Codec<KeymapSetInput, Snapshot> = {
  commandId: 18,

  encode(args: KeymapSetInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(KeymapSetInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 18, true);
    parts.push(cmdId);
    {
      const _arr = args.bindings;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(args.bindings[_i].key));
        parts.push(new Uint8Array([args.bindings[_i].meta ? 1 : 0]));
        parts.push(new Uint8Array([args.bindings[_i].ctrl ? 1 : 0]));
        parts.push(new Uint8Array([args.bindings[_i].alt ? 1 : 0]));
        parts.push(new Uint8Array([args.bindings[_i].shift ? 1 : 0]));
        parts.push(_pcEncodeString(args.bindings[_i].command));
      }
    }
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const snapshotRestoreCodec: RkyvV2Codec<SnapshotRestoreInput, Snapshot> = {
  commandId: 17,

  encode(args: SnapshotRestoreInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(SnapshotRestoreInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 17, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.json));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: SnapshotRestoreInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 17; out[w++] = 0;
    { const _s = args.json; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const tabActivateCodec: RkyvV2Codec<TabIdInput, Snapshot> = {
  commandId: 9,

  encode(args: TabIdInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(TabIdInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 9, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.tabId));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: TabIdInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 9; out[w++] = 0;
    { const _s = args.tabId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const tabCloseCodec: RkyvV2Codec<TabIdInput, Snapshot> = {
  commandId: 10,

  encode(args: TabIdInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(TabIdInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 10, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.tabId));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: TabIdInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 10; out[w++] = 0;
    { const _s = args.tabId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const tabCreateCodec: RkyvV2Codec<TabCreateInput, Snapshot> = {
  commandId: 7,

  encode(args: TabCreateInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(TabCreateInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 7, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.workspaceId));
    parts.push(_pcEncodeString(args.url));
    parts.push(new Uint8Array([args.private ? 1 : 0]));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: TabCreateInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 7; out[w++] = 0;
    { const _s = args.workspaceId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.url; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { ensure(1); out[w++] = args.private ? 1 : 0; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const tabMoveCodec: RkyvV2Codec<TabMoveInput, Snapshot> = {
  commandId: 14,

  encode(args: TabMoveInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(TabMoveInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 14, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.tabId));
    parts.push(_pcEncodeVarint(args.index));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: TabMoveInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 14; out[w++] = 0;
    { const _s = args.tabId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { let _v = args.index; do { ensure(1); out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const tabNavigatedCodec: RkyvV2Codec<TabNavigatedInput, Snapshot> = {
  commandId: 11,

  encode(args: TabNavigatedInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(TabNavigatedInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 11, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.tabId));
    parts.push(_pcEncodeString(args.url));
    parts.push(_pcEncodeString(args.title));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: TabNavigatedInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 11; out[w++] = 0;
    { const _s = args.tabId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.url; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.title; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const tabOpenExternalCodec: RkyvV2Codec<TabOpenExternalInput, Snapshot> = {
  commandId: 8,

  encode(args: TabOpenExternalInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(TabOpenExternalInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 8, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.requestId));
    parts.push(_pcEncodeString(args.url));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: TabOpenExternalInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 8; out[w++] = 0;
    { const _s = args.requestId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.url; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const tabResetCodec: RkyvV2Codec<TabIdInput, Snapshot> = {
  commandId: 28,

  encode(args: TabIdInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(TabIdInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 28, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.tabId));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: TabIdInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 28; out[w++] = 0;
    { const _s = args.tabId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const tabSetFavoriteCodec: RkyvV2Codec<TabFavoriteInput, Snapshot> = {
  commandId: 12,

  encode(args: TabFavoriteInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(TabFavoriteInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 12, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.tabId));
    parts.push(new Uint8Array([args.favorite ? 1 : 0]));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: TabFavoriteInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 12; out[w++] = 0;
    { const _s = args.tabId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { ensure(1); out[w++] = args.favorite ? 1 : 0; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const tabSetPinnedCodec: RkyvV2Codec<TabPinnedInput, Snapshot> = {
  commandId: 13,

  encode(args: TabPinnedInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(TabPinnedInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 13, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.tabId));
    parts.push(new Uint8Array([args.pinned ? 1 : 0]));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: TabPinnedInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 13; out[w++] = 0;
    { const _s = args.tabId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { ensure(1); out[w++] = args.pinned ? 1 : 0; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const tabSetWorkspaceCodec: RkyvV2Codec<TabWorkspaceInput, Snapshot> = {
  commandId: 15,

  encode(args: TabWorkspaceInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(TabWorkspaceInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 15, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.tabId));
    parts.push(_pcEncodeString(args.workspaceId));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: TabWorkspaceInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 15; out[w++] = 0;
    { const _s = args.tabId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.workspaceId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

/** route: complex-binary; RN uses native C++ when the schema is native-safe, otherwise JS. */
export const workArchiveExportComplexCodec: RkyvV2Codec<WorkArchiveExportInput, String> = createComplexCodec<WorkArchiveExportInput, String>({
  commandId: 2,
  inputSchema: {"title":"WorkArchiveExportInput","type":"object","properties":{"presentation":{"type":["string","null"]}}} as ComplexSchema,
  outputSchema: {"title":"String","type":"string"} as ComplexSchema,
  definitions: {"Workspace":{"type":"object","required":["id","name"],"properties":{"id":{"type":"string"},"name":{"type":"string"},"color":{"description":"Space tint as #rrggbb. Empty means \"follow the appearance hue\" — the default space stays appearance-colored so existing snapshots keep their look; created spaces pick from the palette round-robin.","default":"","type":"string"},"lastActiveTabId":{"description":"The space's most recently used tab; activate_workspace reopens the space where the user left off (Arc's working-set behavior). Dangling values are rejected on restore like the other active pointers.","default":null,"type":["string","null"]}}},"Tab":{"type":"object","required":["id","title","url","workspaceId"],"properties":{"id":{"type":"string"},"workspaceId":{"type":"string"},"url":{"type":"string"},"title":{"type":"string"},"favorite":{"description":"Favorites appear in every space without changing the selected space. Older snapshots restore without the field as non-favorites.","default":false,"type":"boolean"},"pinned":{"description":"Pinned tabs keep their own section under favorites, per space.","default":false,"type":"boolean"},"private":{"description":"Private tabs run engine-private sessions and never persist: the controller strips them from saved copies and restore drops them.","default":false,"type":"boolean"},"bookmarkId":{"description":"The persistent sidebar item owning this tab, independent of its live URL.","default":"","type":"string"},"homeUrl":{"description":"Saved destination, independent of navigation in the live session.","default":"","type":"string"},"homeTitle":{"default":"","type":"string"},"suspended":{"description":"The saved row remains while its browser session is closed.","default":false,"type":"boolean"},"updatedAt":{"description":"Last touch in epoch ms; drives the Today/Earlier split (12h archive).","default":0,"type":"integer","format":"uint64","minimum":0}}},"Bookmark":{"type":"object","required":["id","title","url"],"properties":{"id":{"type":"string"},"workspaceId":{"description":"Empty only in legacy snapshots, assigned to a Space during restore.","default":"","type":"string"},"title":{"type":"string"},"url":{"type":"string"},"folderId":{"default":"","type":"string"}}},"BookmarkFolder":{"type":"object","required":["id","title"],"properties":{"id":{"type":"string"},"workspaceId":{"default":"","type":"string"},"title":{"type":"string"}}},"KeyBinding":{"type":"object","required":["alt","command","ctrl","key","meta","shift"],"properties":{"key":{"type":"string"},"meta":{"type":"boolean"},"ctrl":{"type":"boolean"},"alt":{"type":"boolean"},"shift":{"type":"boolean"},"command":{"type":"string"}}}} as Record<string, ComplexSchema>,
});

export const workArchiveExportCodec = workArchiveExportComplexCodec;

export const workArchiveImportCodec: RkyvV2Codec<WorkArchiveImportInput, Snapshot> = {
  commandId: 5,

  encode(args: WorkArchiveImportInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(WorkArchiveImportInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 5, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.json));
    parts.push(new Uint8Array([args.includeFavorites ? 1 : 0]));
    parts.push(new Uint8Array([args.restoreKeymap ? 1 : 0]));
    parts.push(_pcEncodeVarint(args.expectedRevision));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: WorkArchiveImportInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 5; out[w++] = 0;
    { const _s = args.json; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { ensure(1); out[w++] = args.includeFavorites ? 1 : 0; }
    { ensure(1); out[w++] = args.restoreKeymap ? 1 : 0; }
    { let _v = args.expectedRevision; do { ensure(1); out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const workArchivePrepareCodec: RkyvV2Codec<WorkArchivePrepareInput, Snapshot> = {
  commandId: 4,

  encode(args: WorkArchivePrepareInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(WorkArchivePrepareInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 4, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.json));
    parts.push(new Uint8Array([args.includeFavorites ? 1 : 0]));
    parts.push(new Uint8Array([args.restoreKeymap ? 1 : 0]));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: WorkArchivePrepareInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 4; out[w++] = 0;
    { const _s = args.json; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { ensure(1); out[w++] = args.includeFavorites ? 1 : 0; }
    { ensure(1); out[w++] = args.restoreKeymap ? 1 : 0; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const workArchivePreviewCodec: RkyvV2Codec<WorkArchivePreviewInput, WorkArchivePreview> = {
  commandId: 3,

  encode(args: WorkArchivePreviewInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(WorkArchivePreviewInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 3, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.json));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: WorkArchivePreviewInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 3; out[w++] = 0;
    { const _s = args.json; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: WorkArchivePreview; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<WorkArchivePreview> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.spaces = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.tabs = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.bookmarks = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.folders = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.favorites = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.duplicateUrls = _v.value;
      offset += _v.bytesRead;
    }
    {
      result.hasKeyBindings = u8[offset] === 1;
      offset += 1;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.presentation = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.presentation = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    return { ok: true, result: result as WorkArchivePreview };
  },
};

export const workspaceActivateCodec: RkyvV2Codec<WorkspaceIdInput, Snapshot> = {
  commandId: 16,

  encode(args: WorkspaceIdInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(WorkspaceIdInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 16, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.workspaceId));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: WorkspaceIdInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 16; out[w++] = 0;
    { const _s = args.workspaceId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};

export const workspaceCreateCodec: RkyvV2Codec<WorkspaceCreateInput, Snapshot> = {
  commandId: 6,

  encode(args: WorkspaceCreateInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(WorkspaceCreateInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 6, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.name));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: WorkspaceCreateInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 6; out[w++] = 0;
    { const _s = args.name; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: Snapshot; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<Snapshot> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.version = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.revision = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastExternalRequestId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Workspace[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Workspace = {} as Workspace;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.name = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.color = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastActiveTabId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastActiveTabId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.workspaces = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Tab[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Tab = {} as Tab;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.favorite = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.pinned = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.private = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.bookmarkId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeUrl = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.homeTitle = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.suspended = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.updatedAt = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tabs = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: Bookmark[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: Bookmark = {} as Bookmark;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.url = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.folderId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: BookmarkFolder[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: BookmarkFolder = {} as BookmarkFolder;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workspaceId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.bookmarkFolders = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.activeWorkspaceId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.activeTabId = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.activeTabId = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: KeyBinding[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: KeyBinding = {} as KeyBinding;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.key = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.meta = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.ctrl = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.alt = u8[offset] === 1;
          offset += 1;
        }
        {
          _obj.shift = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.keyBindings = _arr;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.keymapVersion = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as Snapshot };
  },
};
