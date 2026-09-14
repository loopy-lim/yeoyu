// ── rustra generated ────────────────────────────────────────
// File:   rustra-generated-codecs.cpp
// Source: schema.json (single source of truth for this file)
// Regen:  rustra codegen --config rustra.json
// Stage:  schema → cpp codec renderer
// DO NOT EDIT — changes will be overwritten and fail codegen --check.
// ────────────────────────────────────────────────────────────
// C++ postcard codec for the RN JSI fast path (B1).
#include "rustra-generated-codecs.hpp"
#include <cmath>
#include <cstring>
#include <jsi/jsi.h>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>

using namespace facebook::jsi;
namespace jsi = facebook::jsi;
namespace rc = rustra::codec;

namespace rustra { namespace generated {
#ifdef RUSTRA_TEST_JSI_SHIM
  using RuntimePropNameCache = std::unordered_map<std::string, jsi::PropNameID>;
  std::shared_ptr<RuntimePropNameCache> runtimePropNameCache(jsi::Runtime&) {
    static auto cache = std::make_shared<RuntimePropNameCache>();
    return cache;
  }
#else
  class RuntimePropNameCache final : public jsi::NativeState {
  public:
    std::unordered_map<std::string, jsi::PropNameID> values;
  };
  std::shared_ptr<RuntimePropNameCache> runtimePropNameCache(jsi::Runtime& rt) {
    static std::unordered_map<jsi::Runtime*, std::weak_ptr<RuntimePropNameCache>> caches;
    auto found = caches.find(&rt);
    if (found != caches.end()) {
      if (auto cache = found->second.lock()) return cache;
    }
    auto cache = std::make_shared<RuntimePropNameCache>();
    jsi::Object holder(rt);
    holder.setNativeState(rt, cache);
    rt.global().setProperty(rt, "__rustraPropNameCache", std::move(holder));
    caches[&rt] = cache;
    return cache;
  }
#endif
  const jsi::PropNameID& cachedProp(jsi::Runtime& rt, const char* name) {
    auto cache = runtimePropNameCache(rt);
#ifdef RUSTRA_TEST_JSI_SHIM
    auto& values = *cache;
#else
    auto& values = cache->values;
#endif
    auto it = values.find(name);
    if (it == values.end()) {
      it = values.emplace(name, jsi::PropNameID::forAscii(rt, name)).first;
    }
    return it->second;
  }
}}

[[maybe_unused]] static double rustra_f64(jsi::Runtime& rt, const jsi::Value& value, const char* field) {
  if (!value.isNumber()) throw jsi::JSError(rt, std::string("rustra: '") + field + "' must be a number");
  double number = value.asNumber();
  if (!std::isfinite(number)) throw jsi::JSError(rt, std::string("rustra: '") + field + "' must be finite");
  return number;
}
[[maybe_unused]] static int64_t rustra_i64(jsi::Runtime& rt, const jsi::Value& value, const char* field) {
  if (value.isBigInt()) return value.asBigInt(rt).asInt64(rt);
  double number = rustra_f64(rt, value, field);
  constexpr double maxSafe = 9007199254740991.0;
  if (std::trunc(number) != number || number < -maxSafe || number > maxSafe)
    throw jsi::JSError(rt, std::string("rustra: '") + field + "' must be a safe integer or bigint");
  return static_cast<int64_t>(number);
}
[[maybe_unused]] static uint64_t rustra_u64(jsi::Runtime& rt, const jsi::Value& value, const char* field) {
  if (value.isBigInt()) return value.asBigInt(rt).asUint64(rt);
  double number = rustra_f64(rt, value, field);
  constexpr double maxSafe = 9007199254740991.0;
  if (std::trunc(number) != number || number < 0.0 || number > maxSafe)
    throw jsi::JSError(rt, std::string("rustra: '") + field + "' must be a non-negative safe integer or bigint");
  return static_cast<uint64_t>(number);
}
[[maybe_unused]] static uint8_t rustra_u8(jsi::Runtime& rt, const jsi::Value& value, const char* field) {
  if (!value.isNumber()) throw jsi::JSError(rt, std::string("rustra: '") + field + "' must be a number");
  double number = value.asNumber();
  if (!(number >= 0.0 && number <= 255.0))
    throw jsi::JSError(rt, std::string("rustra: '") + field + "' must be an integer in 0..255");
  uint8_t byte = static_cast<uint8_t>(number);
  if (static_cast<double>(byte) != number)
    throw jsi::JSError(rt, std::string("rustra: '") + field + "' must be an integer in 0..255");
  return byte;
}
struct RustraByteSpan { const uint8_t* data; size_t size; };
[[maybe_unused]] static RustraByteSpan rustra_bytes(jsi::Runtime& rt, const jsi::Value& value, const char* field) {
  if (!value.isObject())
    throw jsi::JSError(rt, std::string("rustra: '") + field + "' must be a one-byte TypedArray, ArrayBuffer, or number[]");
  auto object = value.asObject(rt);
  if (object.isArrayBuffer(rt)) {
    auto buffer = object.getArrayBuffer(rt);
    auto size = buffer.length(rt);
    auto* data = buffer.data(rt);
    if (size > 0 && data == nullptr)
      throw jsi::JSError(rt, std::string("rustra: '") + field + "' has detached ArrayBuffer storage");
    return {data, size};
  }
  auto bytesPerElement = object.getProperty(rt, "BYTES_PER_ELEMENT");
  auto bufferValue = object.getProperty(rt, "buffer");
  auto offsetValue = object.getProperty(rt, "byteOffset");
  auto lengthValue = object.getProperty(rt, "byteLength");
  if (!bytesPerElement.isNumber() || bytesPerElement.asNumber() != 1.0 || !bufferValue.isObject() || !bufferValue.asObject(rt).isArrayBuffer(rt) || !offsetValue.isNumber() || !lengthValue.isNumber())
    throw jsi::JSError(rt, std::string("rustra: '") + field + "' must be a one-byte TypedArray or ArrayBuffer");
  auto buffer = bufferValue.asObject(rt).getArrayBuffer(rt);
  auto bufferSize = buffer.length(rt);
  double offsetNumber = offsetValue.asNumber();
  double lengthNumber = lengthValue.asNumber();
  if (!std::isfinite(offsetNumber) || !std::isfinite(lengthNumber) || std::trunc(offsetNumber) != offsetNumber || std::trunc(lengthNumber) != lengthNumber || offsetNumber < 0.0 || lengthNumber < 0.0 || offsetNumber > static_cast<double>(bufferSize) || lengthNumber > static_cast<double>(bufferSize) - offsetNumber)
    throw jsi::JSError(rt, std::string("rustra: '") + field + "' view is outside its ArrayBuffer");
  auto offset = static_cast<size_t>(offsetNumber);
  auto size = static_cast<size_t>(lengthNumber);
  auto* data = buffer.data(rt);
  if (bufferSize > 0 && data == nullptr)
    throw jsi::JSError(rt, std::string("rustra: '") + field + "' has detached TypedArray storage");
  return {size == 0 ? data : data + offset, size};
}
[[maybe_unused]] static float rustra_f32(jsi::Runtime& rt, const jsi::Value& value, const char* field) {
  double number = rustra_f64(rt, value, field);
  if (number < -std::numeric_limits<float>::max() || number > std::numeric_limits<float>::max())
    throw jsi::JSError(rt, std::string("rustra: '") + field + "' is outside the f32 range");
  return static_cast<float>(number);
}

static void complex_encode_ref_Workspace(jsi::Runtime&, const jsi::Value&, rc::Writer&, size_t);
static jsi::Value complex_decode_ref_Workspace(jsi::Runtime&, rc::Reader&, size_t);
static void complex_encode_ref_Tab(jsi::Runtime&, const jsi::Value&, rc::Writer&, size_t);
static jsi::Value complex_decode_ref_Tab(jsi::Runtime&, rc::Reader&, size_t);
static void complex_encode_ref_Bookmark(jsi::Runtime&, const jsi::Value&, rc::Writer&, size_t);
static jsi::Value complex_decode_ref_Bookmark(jsi::Runtime&, rc::Reader&, size_t);
static void complex_encode_ref_BookmarkFolder(jsi::Runtime&, const jsi::Value&, rc::Writer&, size_t);
static jsi::Value complex_decode_ref_BookmarkFolder(jsi::Runtime&, rc::Reader&, size_t);
static void complex_encode_ref_KeyBinding(jsi::Runtime&, const jsi::Value&, rc::Writer&, size_t);
static jsi::Value complex_decode_ref_KeyBinding(jsi::Runtime&, rc::Reader&, size_t);

static void complex_encode_ref_Workspace(jsi::Runtime& rt, const jsi::Value& value, rc::Writer& w, size_t _depth) { if (_depth > 32) throw std::runtime_error("complex value depth exceeds 32");
  { if (!value.isObject() || value.asObject(rt).isArray(rt)) throw jsi::JSError(rt, "complex object expected");
    auto _cx0 = value.asObject(rt);
    auto _cx1 = _cx0.getProperty(rt, "id");
    if (!_cx1.isString()) throw jsi::JSError(rt, "complex string expected");
    w.push_string(_cx1.getString(rt).utf8(rt));
    auto _cx2 = _cx0.getProperty(rt, "name");
    if (!_cx2.isString()) throw jsi::JSError(rt, "complex string expected");
    w.push_string(_cx2.getString(rt).utf8(rt));
    auto _cx3 = _cx0.getProperty(rt, "color"); if (_cx0.hasProperty(rt, "color") && !_cx3.isUndefined()) { w.push_u8(1);
      if (!_cx3.isString()) throw jsi::JSError(rt, "complex string expected");
      w.push_string(_cx3.getString(rt).utf8(rt));
    } else { w.push_u8(0); }
    auto _cx4 = _cx0.getProperty(rt, "lastActiveTabId"); if (_cx0.hasProperty(rt, "lastActiveTabId") && !_cx4.isUndefined()) { w.push_u8(1);
      { if (_cx4.isNull() || _cx4.isUndefined()) { w.push_u8(0); } else { w.push_u8(1);
        if (!_cx4.isString()) throw jsi::JSError(rt, "complex string expected");
        w.push_string(_cx4.getString(rt).utf8(rt));
      } }
    } else { w.push_u8(0); }
  }
}
static jsi::Value complex_decode_ref_Workspace(jsi::Runtime& rt, rc::Reader& r, size_t _depth) { if (_depth > 32) throw std::runtime_error("complex value depth exceeds 32"); return [&]() -> jsi::Value { auto _cx0 = jsi::Object(rt); _cx0.setProperty(rt, "id", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); _cx0.setProperty(rt, "name", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); auto _cx1 = r.read_u8(); if (_cx1 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx1 == 1) _cx0.setProperty(rt, "color", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); auto _cx3 = r.read_u8(); if (_cx3 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx3 == 1) _cx0.setProperty(rt, "lastActiveTabId", [&]() -> jsi::Value { auto _cx2 = r.read_u8(); if (_cx2 == 0) return jsi::Value::null(); if (_cx2 != 1) throw std::runtime_error("complex optional presence tag"); return [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }(); }()); return _cx0; }(); }
static void complex_encode_ref_Tab(jsi::Runtime& rt, const jsi::Value& value, rc::Writer& w, size_t _depth) { if (_depth > 32) throw std::runtime_error("complex value depth exceeds 32");
  { if (!value.isObject() || value.asObject(rt).isArray(rt)) throw jsi::JSError(rt, "complex object expected");
    auto _cx0 = value.asObject(rt);
    auto _cx1 = _cx0.getProperty(rt, "id");
    if (!_cx1.isString()) throw jsi::JSError(rt, "complex string expected");
    w.push_string(_cx1.getString(rt).utf8(rt));
    auto _cx2 = _cx0.getProperty(rt, "workspaceId");
    if (!_cx2.isString()) throw jsi::JSError(rt, "complex string expected");
    w.push_string(_cx2.getString(rt).utf8(rt));
    auto _cx3 = _cx0.getProperty(rt, "url");
    if (!_cx3.isString()) throw jsi::JSError(rt, "complex string expected");
    w.push_string(_cx3.getString(rt).utf8(rt));
    auto _cx4 = _cx0.getProperty(rt, "title");
    if (!_cx4.isString()) throw jsi::JSError(rt, "complex string expected");
    w.push_string(_cx4.getString(rt).utf8(rt));
    auto _cx5 = _cx0.getProperty(rt, "favorite"); if (_cx0.hasProperty(rt, "favorite") && !_cx5.isUndefined()) { w.push_u8(1);
      if (!_cx5.isBool()) throw jsi::JSError(rt, "complex boolean expected");
      w.push_bool(_cx5.getBool());
    } else { w.push_u8(0); }
    auto _cx6 = _cx0.getProperty(rt, "pinned"); if (_cx0.hasProperty(rt, "pinned") && !_cx6.isUndefined()) { w.push_u8(1);
      if (!_cx6.isBool()) throw jsi::JSError(rt, "complex boolean expected");
      w.push_bool(_cx6.getBool());
    } else { w.push_u8(0); }
    auto _cx7 = _cx0.getProperty(rt, "private"); if (_cx0.hasProperty(rt, "private") && !_cx7.isUndefined()) { w.push_u8(1);
      if (!_cx7.isBool()) throw jsi::JSError(rt, "complex boolean expected");
      w.push_bool(_cx7.getBool());
    } else { w.push_u8(0); }
    auto _cx8 = _cx0.getProperty(rt, "bookmarkId"); if (_cx0.hasProperty(rt, "bookmarkId") && !_cx8.isUndefined()) { w.push_u8(1);
      if (!_cx8.isString()) throw jsi::JSError(rt, "complex string expected");
      w.push_string(_cx8.getString(rt).utf8(rt));
    } else { w.push_u8(0); }
    auto _cx9 = _cx0.getProperty(rt, "homeUrl"); if (_cx0.hasProperty(rt, "homeUrl") && !_cx9.isUndefined()) { w.push_u8(1);
      if (!_cx9.isString()) throw jsi::JSError(rt, "complex string expected");
      w.push_string(_cx9.getString(rt).utf8(rt));
    } else { w.push_u8(0); }
    auto _cx10 = _cx0.getProperty(rt, "homeTitle"); if (_cx0.hasProperty(rt, "homeTitle") && !_cx10.isUndefined()) { w.push_u8(1);
      if (!_cx10.isString()) throw jsi::JSError(rt, "complex string expected");
      w.push_string(_cx10.getString(rt).utf8(rt));
    } else { w.push_u8(0); }
    auto _cx11 = _cx0.getProperty(rt, "suspended"); if (_cx0.hasProperty(rt, "suspended") && !_cx11.isUndefined()) { w.push_u8(1);
      if (!_cx11.isBool()) throw jsi::JSError(rt, "complex boolean expected");
      w.push_bool(_cx11.getBool());
    } else { w.push_u8(0); }
    auto _cx12 = _cx0.getProperty(rt, "updatedAt"); if (_cx0.hasProperty(rt, "updatedAt") && !_cx12.isUndefined()) { w.push_u8(1);
      w.push_uvar(rustra_u64(rt, _cx12, "complex integer"));
    } else { w.push_u8(0); }
  }
}
static jsi::Value complex_decode_ref_Tab(jsi::Runtime& rt, rc::Reader& r, size_t _depth) { if (_depth > 32) throw std::runtime_error("complex value depth exceeds 32"); return [&]() -> jsi::Value { auto _cx0 = jsi::Object(rt); _cx0.setProperty(rt, "id", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); _cx0.setProperty(rt, "workspaceId", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); _cx0.setProperty(rt, "url", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); _cx0.setProperty(rt, "title", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); auto _cx1 = r.read_u8(); if (_cx1 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx1 == 1) _cx0.setProperty(rt, "favorite", jsi::Value(r.read_bool())); auto _cx2 = r.read_u8(); if (_cx2 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx2 == 1) _cx0.setProperty(rt, "pinned", jsi::Value(r.read_bool())); auto _cx3 = r.read_u8(); if (_cx3 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx3 == 1) _cx0.setProperty(rt, "private", jsi::Value(r.read_bool())); auto _cx4 = r.read_u8(); if (_cx4 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx4 == 1) _cx0.setProperty(rt, "bookmarkId", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); auto _cx5 = r.read_u8(); if (_cx5 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx5 == 1) _cx0.setProperty(rt, "homeUrl", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); auto _cx6 = r.read_u8(); if (_cx6 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx6 == 1) _cx0.setProperty(rt, "homeTitle", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); auto _cx7 = r.read_u8(); if (_cx7 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx7 == 1) _cx0.setProperty(rt, "suspended", jsi::Value(r.read_bool())); auto _cx8 = r.read_u8(); if (_cx8 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx8 == 1) _cx0.setProperty(rt, "updatedAt", [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }()); return _cx0; }(); }
static void complex_encode_ref_Bookmark(jsi::Runtime& rt, const jsi::Value& value, rc::Writer& w, size_t _depth) { if (_depth > 32) throw std::runtime_error("complex value depth exceeds 32");
  { if (!value.isObject() || value.asObject(rt).isArray(rt)) throw jsi::JSError(rt, "complex object expected");
    auto _cx0 = value.asObject(rt);
    auto _cx1 = _cx0.getProperty(rt, "id");
    if (!_cx1.isString()) throw jsi::JSError(rt, "complex string expected");
    w.push_string(_cx1.getString(rt).utf8(rt));
    auto _cx2 = _cx0.getProperty(rt, "workspaceId"); if (_cx0.hasProperty(rt, "workspaceId") && !_cx2.isUndefined()) { w.push_u8(1);
      if (!_cx2.isString()) throw jsi::JSError(rt, "complex string expected");
      w.push_string(_cx2.getString(rt).utf8(rt));
    } else { w.push_u8(0); }
    auto _cx3 = _cx0.getProperty(rt, "title");
    if (!_cx3.isString()) throw jsi::JSError(rt, "complex string expected");
    w.push_string(_cx3.getString(rt).utf8(rt));
    auto _cx4 = _cx0.getProperty(rt, "url");
    if (!_cx4.isString()) throw jsi::JSError(rt, "complex string expected");
    w.push_string(_cx4.getString(rt).utf8(rt));
    auto _cx5 = _cx0.getProperty(rt, "folderId"); if (_cx0.hasProperty(rt, "folderId") && !_cx5.isUndefined()) { w.push_u8(1);
      if (!_cx5.isString()) throw jsi::JSError(rt, "complex string expected");
      w.push_string(_cx5.getString(rt).utf8(rt));
    } else { w.push_u8(0); }
  }
}
static jsi::Value complex_decode_ref_Bookmark(jsi::Runtime& rt, rc::Reader& r, size_t _depth) { if (_depth > 32) throw std::runtime_error("complex value depth exceeds 32"); return [&]() -> jsi::Value { auto _cx0 = jsi::Object(rt); _cx0.setProperty(rt, "id", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); auto _cx1 = r.read_u8(); if (_cx1 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx1 == 1) _cx0.setProperty(rt, "workspaceId", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); _cx0.setProperty(rt, "title", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); _cx0.setProperty(rt, "url", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); auto _cx2 = r.read_u8(); if (_cx2 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx2 == 1) _cx0.setProperty(rt, "folderId", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); return _cx0; }(); }
static void complex_encode_ref_BookmarkFolder(jsi::Runtime& rt, const jsi::Value& value, rc::Writer& w, size_t _depth) { if (_depth > 32) throw std::runtime_error("complex value depth exceeds 32");
  { if (!value.isObject() || value.asObject(rt).isArray(rt)) throw jsi::JSError(rt, "complex object expected");
    auto _cx0 = value.asObject(rt);
    auto _cx1 = _cx0.getProperty(rt, "id");
    if (!_cx1.isString()) throw jsi::JSError(rt, "complex string expected");
    w.push_string(_cx1.getString(rt).utf8(rt));
    auto _cx2 = _cx0.getProperty(rt, "workspaceId"); if (_cx0.hasProperty(rt, "workspaceId") && !_cx2.isUndefined()) { w.push_u8(1);
      if (!_cx2.isString()) throw jsi::JSError(rt, "complex string expected");
      w.push_string(_cx2.getString(rt).utf8(rt));
    } else { w.push_u8(0); }
    auto _cx3 = _cx0.getProperty(rt, "title");
    if (!_cx3.isString()) throw jsi::JSError(rt, "complex string expected");
    w.push_string(_cx3.getString(rt).utf8(rt));
  }
}
static jsi::Value complex_decode_ref_BookmarkFolder(jsi::Runtime& rt, rc::Reader& r, size_t _depth) { if (_depth > 32) throw std::runtime_error("complex value depth exceeds 32"); return [&]() -> jsi::Value { auto _cx0 = jsi::Object(rt); _cx0.setProperty(rt, "id", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); auto _cx1 = r.read_u8(); if (_cx1 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx1 == 1) _cx0.setProperty(rt, "workspaceId", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); _cx0.setProperty(rt, "title", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); return _cx0; }(); }
static void complex_encode_ref_KeyBinding(jsi::Runtime& rt, const jsi::Value& value, rc::Writer& w, size_t _depth) { if (_depth > 32) throw std::runtime_error("complex value depth exceeds 32");
  { if (!value.isObject() || value.asObject(rt).isArray(rt)) throw jsi::JSError(rt, "complex object expected");
    auto _cx0 = value.asObject(rt);
    auto _cx1 = _cx0.getProperty(rt, "key");
    if (!_cx1.isString()) throw jsi::JSError(rt, "complex string expected");
    w.push_string(_cx1.getString(rt).utf8(rt));
    auto _cx2 = _cx0.getProperty(rt, "meta");
    if (!_cx2.isBool()) throw jsi::JSError(rt, "complex boolean expected");
    w.push_bool(_cx2.getBool());
    auto _cx3 = _cx0.getProperty(rt, "ctrl");
    if (!_cx3.isBool()) throw jsi::JSError(rt, "complex boolean expected");
    w.push_bool(_cx3.getBool());
    auto _cx4 = _cx0.getProperty(rt, "alt");
    if (!_cx4.isBool()) throw jsi::JSError(rt, "complex boolean expected");
    w.push_bool(_cx4.getBool());
    auto _cx5 = _cx0.getProperty(rt, "shift");
    if (!_cx5.isBool()) throw jsi::JSError(rt, "complex boolean expected");
    w.push_bool(_cx5.getBool());
    auto _cx6 = _cx0.getProperty(rt, "command");
    if (!_cx6.isString()) throw jsi::JSError(rt, "complex string expected");
    w.push_string(_cx6.getString(rt).utf8(rt));
  }
}
static jsi::Value complex_decode_ref_KeyBinding(jsi::Runtime& rt, rc::Reader& r, size_t _depth) { if (_depth > 32) throw std::runtime_error("complex value depth exceeds 32"); return [&]() -> jsi::Value { auto _cx0 = jsi::Object(rt); _cx0.setProperty(rt, "key", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); _cx0.setProperty(rt, "meta", jsi::Value(r.read_bool())); _cx0.setProperty(rt, "ctrl", jsi::Value(r.read_bool())); _cx0.setProperty(rt, "alt", jsi::Value(r.read_bool())); _cx0.setProperty(rt, "shift", jsi::Value(r.read_bool())); _cx0.setProperty(rt, "command", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); return _cx0; }(); }
static void encode_bookmarkCreate(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(19); w.push_u8(0); // cmd_id = 19 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "title").getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, "url").getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, "folderId").getString(rt).utf8(rt); w.push_string(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 3회 제거.
static void encode_pos_bookmarkCreate(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 3) throw jsi::JSError(rt, "rustra: bookmarkCreate expects 3 positional argument(s), got " + std::to_string(argc));
  w.push_u8(19); w.push_u8(0); // cmd_id = 19 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[1].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[2].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_bookmarkCreate(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_bookmarkFolderCreate(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(23); w.push_u8(0); // cmd_id = 23 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "title").getString(rt).utf8(rt); w.push_string(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_bookmarkFolderCreate(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: bookmarkFolderCreate expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(23); w.push_u8(0); // cmd_id = 23 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_bookmarkFolderCreate(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_bookmarkFolderRemove(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(25); w.push_u8(0); // cmd_id = 25 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "folderId").getString(rt).utf8(rt); w.push_string(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_bookmarkFolderRemove(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: bookmarkFolderRemove expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(25); w.push_u8(0); // cmd_id = 25 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_bookmarkFolderRemove(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_bookmarkFolderRename(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(24); w.push_u8(0); // cmd_id = 24 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "folderId").getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, "title").getString(rt).utf8(rt); w.push_string(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 2회 제거.
static void encode_pos_bookmarkFolderRename(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 2) throw jsi::JSError(rt, "rustra: bookmarkFolderRename expects 2 positional argument(s), got " + std::to_string(argc));
  w.push_u8(24); w.push_u8(0); // cmd_id = 24 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[1].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_bookmarkFolderRename(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_bookmarkMove(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(22); w.push_u8(0); // cmd_id = 22 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "bookmarkId").getString(rt).utf8(rt); w.push_string(_v); }
  w.push_uvar(rustra_u64(rt, argsObj.getProperty(rt, "index"), "index"));
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 2회 제거.
static void encode_pos_bookmarkMove(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 2) throw jsi::JSError(rt, "rustra: bookmarkMove expects 2 positional argument(s), got " + std::to_string(argc));
  w.push_u8(22); w.push_u8(0); // cmd_id = 22 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  w.push_uvar(rustra_u64(rt, argv[1], "index"));
}

static jsi::Value decode_bookmarkMove(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_bookmarkOpen(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(28); w.push_u8(0); // cmd_id = 28 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "bookmarkId").getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, "reuseTabId").getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, "private").getBool(); w.push_bool(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 3회 제거.
static void encode_pos_bookmarkOpen(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 3) throw jsi::JSError(rt, "rustra: bookmarkOpen expects 3 positional argument(s), got " + std::to_string(argc));
  w.push_u8(28); w.push_u8(0); // cmd_id = 28 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[1].asString(rt).utf8(rt); w.push_string(_s); }
  w.push_bool(argv[2].asBool());
}

static jsi::Value decode_bookmarkOpen(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_bookmarkRemove(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(21); w.push_u8(0); // cmd_id = 21 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "bookmarkId").getString(rt).utf8(rt); w.push_string(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_bookmarkRemove(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: bookmarkRemove expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(21); w.push_u8(0); // cmd_id = 21 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_bookmarkRemove(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_bookmarkSetFolder(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(26); w.push_u8(0); // cmd_id = 26 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "bookmarkId").getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, "folderId").getString(rt).utf8(rt); w.push_string(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 2회 제거.
static void encode_pos_bookmarkSetFolder(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 2) throw jsi::JSError(rt, "rustra: bookmarkSetFolder expects 2 positional argument(s), got " + std::to_string(argc));
  w.push_u8(26); w.push_u8(0); // cmd_id = 26 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[1].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_bookmarkSetFolder(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_bookmarkUpdate(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(20); w.push_u8(0); // cmd_id = 20 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "bookmarkId").getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, "title").getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, "url").getString(rt).utf8(rt); w.push_string(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 3회 제거.
static void encode_pos_bookmarkUpdate(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 3) throw jsi::JSError(rt, "rustra: bookmarkUpdate expects 3 positional argument(s), got " + std::to_string(argc));
  w.push_u8(20); w.push_u8(0); // cmd_id = 20 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[1].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[2].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_bookmarkUpdate(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_browserSnapshot(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(1); w.push_u8(0); // cmd_id = 1 LE
  auto argsObj = args.asObject(rt);
}

static jsi::Value decode_browserSnapshot(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_keymapSet(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(18); w.push_u8(0); // cmd_id = 18 LE
  auto argsObj = args.asObject(rt);
  { auto _arr = argsObj.getProperty(rt, "bindings").asObject(rt).getArray(rt); auto _n = _arr.length(rt); w.push_uvar(_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = _arr.getValueAtIndex(rt, _i).getObject(rt);
      { auto _v = _obj.getProperty(rt, "key").getString(rt).utf8(rt); w.push_string(_v); }
      { auto _v = _obj.getProperty(rt, "meta").getBool(); w.push_bool(_v); }
      { auto _v = _obj.getProperty(rt, "ctrl").getBool(); w.push_bool(_v); }
      { auto _v = _obj.getProperty(rt, "alt").getBool(); w.push_bool(_v); }
      { auto _v = _obj.getProperty(rt, "shift").getBool(); w.push_bool(_v); }
      { auto _v = _obj.getProperty(rt, "command").getString(rt).utf8(rt); w.push_string(_v); }
    } }
}

static jsi::Value decode_keymapSet(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_snapshotRestore(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(17); w.push_u8(0); // cmd_id = 17 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "json").getString(rt).utf8(rt); w.push_string(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_snapshotRestore(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: snapshotRestore expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(17); w.push_u8(0); // cmd_id = 17 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_snapshotRestore(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_tabActivate(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(9); w.push_u8(0); // cmd_id = 9 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "tabId").getString(rt).utf8(rt); w.push_string(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_tabActivate(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: tabActivate expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(9); w.push_u8(0); // cmd_id = 9 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_tabActivate(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_tabClose(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(10); w.push_u8(0); // cmd_id = 10 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "tabId").getString(rt).utf8(rt); w.push_string(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_tabClose(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: tabClose expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(10); w.push_u8(0); // cmd_id = 10 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_tabClose(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_tabCreate(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(7); w.push_u8(0); // cmd_id = 7 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "workspaceId").getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, "url").getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, "private").getBool(); w.push_bool(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 3회 제거.
static void encode_pos_tabCreate(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 3) throw jsi::JSError(rt, "rustra: tabCreate expects 3 positional argument(s), got " + std::to_string(argc));
  w.push_u8(7); w.push_u8(0); // cmd_id = 7 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[1].asString(rt).utf8(rt); w.push_string(_s); }
  w.push_bool(argv[2].asBool());
}

static jsi::Value decode_tabCreate(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_tabMove(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(14); w.push_u8(0); // cmd_id = 14 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "tabId").getString(rt).utf8(rt); w.push_string(_v); }
  w.push_uvar(rustra_u64(rt, argsObj.getProperty(rt, "index"), "index"));
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 2회 제거.
static void encode_pos_tabMove(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 2) throw jsi::JSError(rt, "rustra: tabMove expects 2 positional argument(s), got " + std::to_string(argc));
  w.push_u8(14); w.push_u8(0); // cmd_id = 14 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  w.push_uvar(rustra_u64(rt, argv[1], "index"));
}

static jsi::Value decode_tabMove(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_tabNavigated(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(11); w.push_u8(0); // cmd_id = 11 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "tabId").getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, "url").getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, "title").getString(rt).utf8(rt); w.push_string(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 3회 제거.
static void encode_pos_tabNavigated(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 3) throw jsi::JSError(rt, "rustra: tabNavigated expects 3 positional argument(s), got " + std::to_string(argc));
  w.push_u8(11); w.push_u8(0); // cmd_id = 11 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[1].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[2].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_tabNavigated(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_tabOpenExternal(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(8); w.push_u8(0); // cmd_id = 8 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "requestId").getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, "url").getString(rt).utf8(rt); w.push_string(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 2회 제거.
static void encode_pos_tabOpenExternal(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 2) throw jsi::JSError(rt, "rustra: tabOpenExternal expects 2 positional argument(s), got " + std::to_string(argc));
  w.push_u8(8); w.push_u8(0); // cmd_id = 8 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[1].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_tabOpenExternal(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_tabReset(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(27); w.push_u8(0); // cmd_id = 27 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "tabId").getString(rt).utf8(rt); w.push_string(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_tabReset(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: tabReset expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(27); w.push_u8(0); // cmd_id = 27 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_tabReset(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_tabSetFavorite(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(12); w.push_u8(0); // cmd_id = 12 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "tabId").getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, "favorite").getBool(); w.push_bool(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 2회 제거.
static void encode_pos_tabSetFavorite(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 2) throw jsi::JSError(rt, "rustra: tabSetFavorite expects 2 positional argument(s), got " + std::to_string(argc));
  w.push_u8(12); w.push_u8(0); // cmd_id = 12 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  w.push_bool(argv[1].asBool());
}

static jsi::Value decode_tabSetFavorite(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_tabSetPinned(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(13); w.push_u8(0); // cmd_id = 13 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "tabId").getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, "pinned").getBool(); w.push_bool(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 2회 제거.
static void encode_pos_tabSetPinned(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 2) throw jsi::JSError(rt, "rustra: tabSetPinned expects 2 positional argument(s), got " + std::to_string(argc));
  w.push_u8(13); w.push_u8(0); // cmd_id = 13 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  w.push_bool(argv[1].asBool());
}

static jsi::Value decode_tabSetPinned(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_tabSetWorkspace(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(15); w.push_u8(0); // cmd_id = 15 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "tabId").getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, "workspaceId").getString(rt).utf8(rt); w.push_string(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 2회 제거.
static void encode_pos_tabSetWorkspace(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 2) throw jsi::JSError(rt, "rustra: tabSetWorkspace expects 2 positional argument(s), got " + std::to_string(argc));
  w.push_u8(15); w.push_u8(0); // cmd_id = 15 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[1].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_tabSetWorkspace(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_workArchiveImport(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(5); w.push_u8(0); // cmd_id = 5 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "json").getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, "includeFavorites").getBool(); w.push_bool(_v); }
  { auto _v = argsObj.getProperty(rt, "restoreKeymap").getBool(); w.push_bool(_v); }
  w.push_uvar(rustra_u64(rt, argsObj.getProperty(rt, "expectedRevision"), "expectedRevision"));
}

static jsi::Value decode_workArchiveImport(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_workArchivePrepare(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(4); w.push_u8(0); // cmd_id = 4 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "json").getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, "includeFavorites").getBool(); w.push_bool(_v); }
  { auto _v = argsObj.getProperty(rt, "restoreKeymap").getBool(); w.push_bool(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 3회 제거.
static void encode_pos_workArchivePrepare(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 3) throw jsi::JSError(rt, "rustra: workArchivePrepare expects 3 positional argument(s), got " + std::to_string(argc));
  w.push_u8(4); w.push_u8(0); // cmd_id = 4 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  w.push_bool(argv[1].asBool());
  w.push_bool(argv[2].asBool());
}

static jsi::Value decode_workArchivePrepare(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_workArchivePreview(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(3); w.push_u8(0); // cmd_id = 3 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "json").getString(rt).utf8(rt); w.push_string(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_workArchivePreview(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: workArchivePreview expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(3); w.push_u8(0); // cmd_id = 3 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_workArchivePreview(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "spaces"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "folders"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "favorites"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "duplicateUrls"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "hasKeyBindings"), r.read_bool());
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "presentation"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "presentation"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  return std::move(resultObj);
}

static void encode_workspaceActivate(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(16); w.push_u8(0); // cmd_id = 16 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "workspaceId").getString(rt).utf8(rt); w.push_string(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_workspaceActivate(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: workspaceActivate expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(16); w.push_u8(0); // cmd_id = 16 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_workspaceActivate(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_workspaceCreate(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(6); w.push_u8(0); // cmd_id = 6 LE
  auto argsObj = args.asObject(rt);
  { auto _v = argsObj.getProperty(rt, "name").getString(rt).utf8(rt); w.push_string(_v); }
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_workspaceCreate(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: workspaceCreate expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(6); w.push_u8(0); // cmd_id = 6 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_workspaceCreate(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "version"), (double)r.read_uvar());
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "revision"), (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "lastExternalRequestId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "name"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "color"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "lastActiveTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaces"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "favorite"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "pinned"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "private"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeUrl"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "homeTitle"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "suspended"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "updatedAt"), [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "tabs"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "url"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "folderId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarks"), _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "id"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "workspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "title"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "bookmarkFolders"), _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeWorkspaceId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "activeTabId"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "key"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "meta"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "ctrl"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "alt"), r.read_bool());
      _obj.setProperty(rt, rustra::generated::cachedProp(rt, "shift"), r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, rustra::generated::cachedProp(rt, "command"), jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keyBindings"), _arr); }
  resultObj.setProperty(rt, rustra::generated::cachedProp(rt, "keymapVersion"), (double)r.read_uvar());
  return std::move(resultObj);
}

static void encode_complex_workArchiveExport(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(2); w.push_u8(0);
  { if (!args.isObject() || args.asObject(rt).isArray(rt)) throw jsi::JSError(rt, "complex object expected");
    auto _cx0 = args.asObject(rt);
    auto _cx1 = _cx0.getProperty(rt, "presentation"); if (_cx0.hasProperty(rt, "presentation") && !_cx1.isUndefined()) { w.push_u8(1);
      { if (_cx1.isNull() || _cx1.isUndefined()) { w.push_u8(0); } else { w.push_u8(1);
        if (!_cx1.isString()) throw jsi::JSError(rt, "complex string expected");
        w.push_string(_cx1.getString(rt).utf8(rt));
      } }
    } else { w.push_u8(0); }
  }
}

static jsi::Value decode_complex_workArchiveExport(jsi::Runtime& rt, rc::Reader& r) {
  return [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }();
}

namespace rustra::generated {

bool encode_by_name(Runtime& rt, const std::string& name, const Value& args, rc::Writer& w) {
  if (name == "bookmarkCreate") { encode_bookmarkCreate(rt, args, w); return true; }
  if (name == "bookmarkFolderCreate") { encode_bookmarkFolderCreate(rt, args, w); return true; }
  if (name == "bookmarkFolderRemove") { encode_bookmarkFolderRemove(rt, args, w); return true; }
  if (name == "bookmarkFolderRename") { encode_bookmarkFolderRename(rt, args, w); return true; }
  if (name == "bookmarkMove") { encode_bookmarkMove(rt, args, w); return true; }
  if (name == "bookmarkOpen") { encode_bookmarkOpen(rt, args, w); return true; }
  if (name == "bookmarkRemove") { encode_bookmarkRemove(rt, args, w); return true; }
  if (name == "bookmarkSetFolder") { encode_bookmarkSetFolder(rt, args, w); return true; }
  if (name == "bookmarkUpdate") { encode_bookmarkUpdate(rt, args, w); return true; }
  if (name == "browserSnapshot") { encode_browserSnapshot(rt, args, w); return true; }
  if (name == "keymapSet") { encode_keymapSet(rt, args, w); return true; }
  if (name == "snapshotRestore") { encode_snapshotRestore(rt, args, w); return true; }
  if (name == "tabActivate") { encode_tabActivate(rt, args, w); return true; }
  if (name == "tabClose") { encode_tabClose(rt, args, w); return true; }
  if (name == "tabCreate") { encode_tabCreate(rt, args, w); return true; }
  if (name == "tabMove") { encode_tabMove(rt, args, w); return true; }
  if (name == "tabNavigated") { encode_tabNavigated(rt, args, w); return true; }
  if (name == "tabOpenExternal") { encode_tabOpenExternal(rt, args, w); return true; }
  if (name == "tabReset") { encode_tabReset(rt, args, w); return true; }
  if (name == "tabSetFavorite") { encode_tabSetFavorite(rt, args, w); return true; }
  if (name == "tabSetPinned") { encode_tabSetPinned(rt, args, w); return true; }
  if (name == "tabSetWorkspace") { encode_tabSetWorkspace(rt, args, w); return true; }
  if (name == "workArchiveImport") { encode_workArchiveImport(rt, args, w); return true; }
  if (name == "workArchivePrepare") { encode_workArchivePrepare(rt, args, w); return true; }
  if (name == "workArchivePreview") { encode_workArchivePreview(rt, args, w); return true; }
  if (name == "workspaceActivate") { encode_workspaceActivate(rt, args, w); return true; }
  if (name == "workspaceCreate") { encode_workspaceCreate(rt, args, w); return true; }
  if (name == "workArchiveExport") { encode_complex_workArchiveExport(rt, args, w); return true; }
  return false; // 동적 명령 — JS 가 Tier 3 fallback 처리
}

Value decode_by_name(Runtime& rt, const std::string& name, rc::Reader& r) {
  if (name == "bookmarkCreate") return decode_bookmarkCreate(rt, r);
  if (name == "bookmarkFolderCreate") return decode_bookmarkFolderCreate(rt, r);
  if (name == "bookmarkFolderRemove") return decode_bookmarkFolderRemove(rt, r);
  if (name == "bookmarkFolderRename") return decode_bookmarkFolderRename(rt, r);
  if (name == "bookmarkMove") return decode_bookmarkMove(rt, r);
  if (name == "bookmarkOpen") return decode_bookmarkOpen(rt, r);
  if (name == "bookmarkRemove") return decode_bookmarkRemove(rt, r);
  if (name == "bookmarkSetFolder") return decode_bookmarkSetFolder(rt, r);
  if (name == "bookmarkUpdate") return decode_bookmarkUpdate(rt, r);
  if (name == "browserSnapshot") return decode_browserSnapshot(rt, r);
  if (name == "keymapSet") return decode_keymapSet(rt, r);
  if (name == "snapshotRestore") return decode_snapshotRestore(rt, r);
  if (name == "tabActivate") return decode_tabActivate(rt, r);
  if (name == "tabClose") return decode_tabClose(rt, r);
  if (name == "tabCreate") return decode_tabCreate(rt, r);
  if (name == "tabMove") return decode_tabMove(rt, r);
  if (name == "tabNavigated") return decode_tabNavigated(rt, r);
  if (name == "tabOpenExternal") return decode_tabOpenExternal(rt, r);
  if (name == "tabReset") return decode_tabReset(rt, r);
  if (name == "tabSetFavorite") return decode_tabSetFavorite(rt, r);
  if (name == "tabSetPinned") return decode_tabSetPinned(rt, r);
  if (name == "tabSetWorkspace") return decode_tabSetWorkspace(rt, r);
  if (name == "workArchiveImport") return decode_workArchiveImport(rt, r);
  if (name == "workArchivePrepare") return decode_workArchivePrepare(rt, r);
  if (name == "workArchivePreview") return decode_workArchivePreview(rt, r);
  if (name == "workspaceActivate") return decode_workspaceActivate(rt, r);
  if (name == "workspaceCreate") return decode_workspaceCreate(rt, r);
  if (name == "workArchiveExport") return decode_complex_workArchiveExport(rt, r);
  throw JSError(rt, "rustra: no C++ codec for '" + name + "'");
}

bool encode_by_id(Runtime& rt, uint16_t cmd_id, const Value& args, rc::Writer& w) {
  switch (cmd_id) {
    case 19: encode_bookmarkCreate(rt, args, w); return true;
    case 23: encode_bookmarkFolderCreate(rt, args, w); return true;
    case 25: encode_bookmarkFolderRemove(rt, args, w); return true;
    case 24: encode_bookmarkFolderRename(rt, args, w); return true;
    case 22: encode_bookmarkMove(rt, args, w); return true;
    case 28: encode_bookmarkOpen(rt, args, w); return true;
    case 21: encode_bookmarkRemove(rt, args, w); return true;
    case 26: encode_bookmarkSetFolder(rt, args, w); return true;
    case 20: encode_bookmarkUpdate(rt, args, w); return true;
    case 1: encode_browserSnapshot(rt, args, w); return true;
    case 18: encode_keymapSet(rt, args, w); return true;
    case 17: encode_snapshotRestore(rt, args, w); return true;
    case 9: encode_tabActivate(rt, args, w); return true;
    case 10: encode_tabClose(rt, args, w); return true;
    case 7: encode_tabCreate(rt, args, w); return true;
    case 14: encode_tabMove(rt, args, w); return true;
    case 11: encode_tabNavigated(rt, args, w); return true;
    case 8: encode_tabOpenExternal(rt, args, w); return true;
    case 27: encode_tabReset(rt, args, w); return true;
    case 12: encode_tabSetFavorite(rt, args, w); return true;
    case 13: encode_tabSetPinned(rt, args, w); return true;
    case 15: encode_tabSetWorkspace(rt, args, w); return true;
    case 5: encode_workArchiveImport(rt, args, w); return true;
    case 4: encode_workArchivePrepare(rt, args, w); return true;
    case 3: encode_workArchivePreview(rt, args, w); return true;
    case 16: encode_workspaceActivate(rt, args, w); return true;
    case 6: encode_workspaceCreate(rt, args, w); return true;
    case 2: encode_complex_workArchiveExport(rt, args, w); return true;
    default: return false; // 동적/알 수 없는 cmd_id — JS 가 Tier 3 fallback 처리
  }
}

Value decode_by_id(Runtime& rt, uint16_t cmd_id, rc::Reader& r) {
  switch (cmd_id) {
    case 19: return decode_bookmarkCreate(rt, r);
    case 23: return decode_bookmarkFolderCreate(rt, r);
    case 25: return decode_bookmarkFolderRemove(rt, r);
    case 24: return decode_bookmarkFolderRename(rt, r);
    case 22: return decode_bookmarkMove(rt, r);
    case 28: return decode_bookmarkOpen(rt, r);
    case 21: return decode_bookmarkRemove(rt, r);
    case 26: return decode_bookmarkSetFolder(rt, r);
    case 20: return decode_bookmarkUpdate(rt, r);
    case 1: return decode_browserSnapshot(rt, r);
    case 18: return decode_keymapSet(rt, r);
    case 17: return decode_snapshotRestore(rt, r);
    case 9: return decode_tabActivate(rt, r);
    case 10: return decode_tabClose(rt, r);
    case 7: return decode_tabCreate(rt, r);
    case 14: return decode_tabMove(rt, r);
    case 11: return decode_tabNavigated(rt, r);
    case 8: return decode_tabOpenExternal(rt, r);
    case 27: return decode_tabReset(rt, r);
    case 12: return decode_tabSetFavorite(rt, r);
    case 13: return decode_tabSetPinned(rt, r);
    case 15: return decode_tabSetWorkspace(rt, r);
    case 5: return decode_workArchiveImport(rt, r);
    case 4: return decode_workArchivePrepare(rt, r);
    case 3: return decode_workArchivePreview(rt, r);
    case 16: return decode_workspaceActivate(rt, r);
    case 6: return decode_workspaceCreate(rt, r);
    case 2: return decode_complex_workArchiveExport(rt, r);
    default: throw JSError(rt, "rustra: no C++ codec for cmd_id " + std::to_string(cmd_id));
  }
}

bool has_static_codec(const std::string& name) {
  if (name == "bookmarkCreate") return true;
  if (name == "bookmarkFolderCreate") return true;
  if (name == "bookmarkFolderRemove") return true;
  if (name == "bookmarkFolderRename") return true;
  if (name == "bookmarkMove") return true;
  if (name == "bookmarkOpen") return true;
  if (name == "bookmarkRemove") return true;
  if (name == "bookmarkSetFolder") return true;
  if (name == "bookmarkUpdate") return true;
  if (name == "browserSnapshot") return true;
  if (name == "keymapSet") return true;
  if (name == "snapshotRestore") return true;
  if (name == "tabActivate") return true;
  if (name == "tabClose") return true;
  if (name == "tabCreate") return true;
  if (name == "tabMove") return true;
  if (name == "tabNavigated") return true;
  if (name == "tabOpenExternal") return true;
  if (name == "tabReset") return true;
  if (name == "tabSetFavorite") return true;
  if (name == "tabSetPinned") return true;
  if (name == "tabSetWorkspace") return true;
  if (name == "workArchiveImport") return true;
  if (name == "workArchivePrepare") return true;
  if (name == "workArchivePreview") return true;
  if (name == "workspaceActivate") return true;
  if (name == "workspaceCreate") return true;
  if (name == "workArchiveExport") return true;
  return false;
}

bool has_static_codec_id(uint16_t cmd_id) {
  switch (cmd_id) {
    case 19: return true;
    case 23: return true;
    case 25: return true;
    case 24: return true;
    case 22: return true;
    case 28: return true;
    case 21: return true;
    case 26: return true;
    case 20: return true;
    case 1: return true;
    case 18: return true;
    case 17: return true;
    case 9: return true;
    case 10: return true;
    case 7: return true;
    case 14: return true;
    case 11: return true;
    case 8: return true;
    case 27: return true;
    case 12: return true;
    case 13: return true;
    case 15: return true;
    case 5: return true;
    case 4: return true;
    case 3: return true;
    case 16: return true;
    case 6: return true;
    case 2: return true;
    default: return false;
  }
}

/// (Tier 1) positional 인자를 직접 인코딩 가능한 cmd_id 집합 — JS 폴백 판별용.
bool has_pos_codec(uint16_t cmd_id) {
  if (cmd_id == 19) return true;
  if (cmd_id == 23) return true;
  if (cmd_id == 25) return true;
  if (cmd_id == 24) return true;
  if (cmd_id == 22) return true;
  if (cmd_id == 28) return true;
  if (cmd_id == 21) return true;
  if (cmd_id == 26) return true;
  if (cmd_id == 20) return true;
  if (cmd_id == 17) return true;
  if (cmd_id == 9) return true;
  if (cmd_id == 10) return true;
  if (cmd_id == 7) return true;
  if (cmd_id == 14) return true;
  if (cmd_id == 11) return true;
  if (cmd_id == 8) return true;
  if (cmd_id == 27) return true;
  if (cmd_id == 12) return true;
  if (cmd_id == 13) return true;
  if (cmd_id == 15) return true;
  if (cmd_id == 4) return true;
  if (cmd_id == 3) return true;
  if (cmd_id == 16) return true;
  if (cmd_id == 6) return true;
  return false;
}

/// (Tier 1) 개별 Value 인자 → postcard 바이트. 명령별 코덱이 argc를 정확히 검증한다.
void encode_pos_by_id(jsi::Runtime& rt, uint16_t cmd_id, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  switch (cmd_id) {
    case 19: encode_pos_bookmarkCreate(rt, argv, argc, w); return;
    case 23: encode_pos_bookmarkFolderCreate(rt, argv, argc, w); return;
    case 25: encode_pos_bookmarkFolderRemove(rt, argv, argc, w); return;
    case 24: encode_pos_bookmarkFolderRename(rt, argv, argc, w); return;
    case 22: encode_pos_bookmarkMove(rt, argv, argc, w); return;
    case 28: encode_pos_bookmarkOpen(rt, argv, argc, w); return;
    case 21: encode_pos_bookmarkRemove(rt, argv, argc, w); return;
    case 26: encode_pos_bookmarkSetFolder(rt, argv, argc, w); return;
    case 20: encode_pos_bookmarkUpdate(rt, argv, argc, w); return;
    case 17: encode_pos_snapshotRestore(rt, argv, argc, w); return;
    case 9: encode_pos_tabActivate(rt, argv, argc, w); return;
    case 10: encode_pos_tabClose(rt, argv, argc, w); return;
    case 7: encode_pos_tabCreate(rt, argv, argc, w); return;
    case 14: encode_pos_tabMove(rt, argv, argc, w); return;
    case 11: encode_pos_tabNavigated(rt, argv, argc, w); return;
    case 8: encode_pos_tabOpenExternal(rt, argv, argc, w); return;
    case 27: encode_pos_tabReset(rt, argv, argc, w); return;
    case 12: encode_pos_tabSetFavorite(rt, argv, argc, w); return;
    case 13: encode_pos_tabSetPinned(rt, argv, argc, w); return;
    case 15: encode_pos_tabSetWorkspace(rt, argv, argc, w); return;
    case 4: encode_pos_workArchivePrepare(rt, argv, argc, w); return;
    case 3: encode_pos_workArchivePreview(rt, argv, argc, w); return;
    case 16: encode_pos_workspaceActivate(rt, argv, argc, w); return;
    case 6: encode_pos_workspaceCreate(rt, argv, argc, w); return;
    default: throw JSError(rt, "rustra: no positional codec for cmd_id " + std::to_string(cmd_id));
  }
}

bool has_buffer_codec(uint16_t cmd_id) {
  switch (cmd_id) {

    default: return false;
  }
}

void encode_buffer_by_id(uint16_t cmd_id, const uint8_t* data, size_t size, rc::Writer& w) {
  if (size > 0 && data == nullptr) throw std::invalid_argument("rustra: null byte buffer");
  switch (cmd_id) {
    default: throw std::invalid_argument("rustra: no buffer codec for cmd_id " + std::to_string(cmd_id));
  }
}

Value decode_buffer_result_by_id(Runtime& rt, uint16_t cmd_id, Value buffer) {
  switch (cmd_id) {
    default: throw JSError(rt, "rustra: no buffer result codec for cmd_id " + std::to_string(cmd_id));
  }
}

bool has_raw_codec(uint16_t cmd_id) {
  switch (cmd_id) {

    default: return false;
  }
}

void encode_raw_slots(Runtime& rt, uint16_t cmd_id, const Value* argv, size_t argc, uint64_t* slots) {
  switch (cmd_id) {
    default: throw JSError(rt, "rustra: no raw input codec for cmd_id " + std::to_string(cmd_id));
  }
}

Value decode_raw_result(Runtime& rt, uint16_t cmd_id, uint64_t slot) {
  switch (cmd_id) {
    default: throw JSError(rt, "rustra: no raw result codec for cmd_id " + std::to_string(cmd_id));
  }
}

} // namespace rustra::generated
