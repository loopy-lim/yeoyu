// ── rustra generated ────────────────────────────────────────
// File:   rustra-generated-codecs.cpp
// Source: schema.json (single source of truth for this file)
// Regen:  rustra codegen --config rustra.json
// Stage:  schema → cpp codec renderer
// DO NOT EDIT — changes will be overwritten and fail codegen --check.
// ────────────────────────────────────────────────────────────
// C++ postcard codec for the RN JSI fast path (B1).
#include "rustra-generated-codecs.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <jsi/jsi.h>
#include <initializer_list>
#include <limits>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

using namespace facebook::jsi;
namespace jsi = facebook::jsi;
namespace rc = rustra::codec;
namespace rustra::generated {
const char* compiled_contract_hash() { return "938480b835ce4b8b769f5a3027f4cfbb022b9cdc97b32156bd35d88223c99b79"; }
}

// Each invocation owns its captured map values until canonical encoding finishes.
// Small maps avoid a vector allocation; larger maps retain bounded reservation.
class RustraMapEntries {
public:
  using Entry = std::pair<std::string, jsi::Value>;
  RustraMapEntries(jsi::Runtime& rt, size_t count) : use_inline_(count <= inline_entries_.size()) {
    if (count > heap_entries_.max_size()) throw jsi::JSError(rt, "rustra: map size exceeds native capacity");
    if (!use_inline_) heap_entries_.reserve(std::min<size_t>(count, 64));
  }
  void emplace_back(std::string&& key, jsi::Value&& value) {
    if (use_inline_) inline_entries_[size_] = Entry(std::move(key), std::move(value));
    else heap_entries_.emplace_back(std::move(key), std::move(value));
    ++size_;
  }
  Entry* begin() { return use_inline_ ? inline_entries_.data() : heap_entries_.data(); }
  Entry* end() { return begin() + size_; }
  size_t size() const { return size_; }
private:
  std::array<Entry, 4> inline_entries_;
  std::vector<Entry> heap_entries_;
  size_t size_ = 0;
  bool use_inline_;
};

// UTF8 may replace lone UTF16 surrogates. Preserve the prior normalized lookup
// for replacement-containing keys; ordinary keys retain their original JSI string.
[[maybe_unused]] static jsi::Value rustra_map_value(jsi::Runtime& rt, const jsi::Object& object, const jsi::String& key, const std::string& utf8) {
  if (utf8.find("\xEF\xBF\xBD") == std::string::npos) return object.getProperty(rt, key);
  return object.getProperty(rt, jsi::String::createFromUtf8(rt, reinterpret_cast<const uint8_t*>(utf8.data()), utf8.size()));
}

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

namespace rustra::generated {
struct BoundCodecContext {
  const uint16_t commandId;
  const std::vector<jsi::PropNameID> input;
  const std::vector<jsi::PropNameID> output;
private:
  static std::vector<jsi::PropNameID> ownNames(Runtime& rt, std::initializer_list<const char*> names) {
    std::vector<jsi::PropNameID> result; result.reserve(names.size());
    for (auto name : names) result.push_back(jsi::PropNameID::forAscii(rt, name));
    return result;
  }
  BoundCodecContext(Runtime& rt, uint16_t id, std::initializer_list<const char*> in, std::initializer_list<const char*> out)
    : commandId(id), input(ownNames(rt, in)), output(ownNames(rt, out)) {}
  friend std::shared_ptr<const BoundCodecContext> make_bound_codec_context(Runtime&, uint16_t);
};
std::shared_ptr<const BoundCodecContext> make_bound_codec_context(Runtime& rt, uint16_t commandId) {
  switch (commandId) {
    case 20: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"title", "url", "folderId"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 24: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"title"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 26: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"folderId"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 25: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"folderId", "title"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 23: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"bookmarkId", "index"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 29: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"bookmarkId", "reuseTabId", "private"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 22: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"bookmarkId"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 27: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"bookmarkId", "folderId"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 21: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"bookmarkId", "title", "url"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 1: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 19: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {}, {"bindings", "key", "meta", "ctrl", "alt", "shift", "command"}));
    case 18: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"bindings", "key", "meta", "ctrl", "alt", "shift", "command"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 17: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"json"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 31: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"splitGroupId"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 30: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"splitGroupId", "name", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 9: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"tabId"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 10: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"tabId"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 7: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"workspaceId", "url", "private"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 14: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"tabId", "index"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 11: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"tabId", "url", "title"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 8: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"requestId", "url"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 32: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"tabId", "title"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 28: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"tabId"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 12: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"tabId", "favorite"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 13: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"tabId", "pinned"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 15: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"tabId", "workspaceId"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 5: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"json", "includeFavorites", "restoreKeymap", "expectedRevision"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 4: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"json", "includeFavorites", "restoreKeymap"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 3: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"json"}, {"spaces", "tabs", "bookmarks", "folders", "favorites", "duplicateUrls", "hasKeyBindings", "presentation"}));
    case 16: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"workspaceId"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    case 6: return std::shared_ptr<const BoundCodecContext>(new BoundCodecContext(rt, commandId, {"name"}, {"version", "revision", "lastExternalRequestId", "workspaces", "id", "name", "color", "lastActiveTabId", "tabs", "workspaceId", "url", "title", "customTitle", "favorite", "pinned", "private", "bookmarkId", "homeUrl", "homeTitle", "suspended", "updatedAt", "bookmarks", "folderId", "bookmarkFolders", "splitGroups", "orientation", "ratioMilli", "firstTitle", "firstUrl", "secondTitle", "secondUrl", "activeWorkspaceId", "activeTabId", "keyBindings", "key", "meta", "ctrl", "alt", "shift", "command", "keymapVersion"}));
    default: throw JSError(rt, "rustra: no bound codec for cmd_id " + std::to_string(commandId));
  }
}
} // namespace rustra::generated

static void complex_encode_ref_Workspace(jsi::Runtime&, const jsi::Value&, rc::Writer&, size_t);
static jsi::Value complex_decode_ref_Workspace(jsi::Runtime&, rc::Reader&, size_t);
static void complex_encode_ref_Tab(jsi::Runtime&, const jsi::Value&, rc::Writer&, size_t);
static jsi::Value complex_decode_ref_Tab(jsi::Runtime&, rc::Reader&, size_t);
static void complex_encode_ref_Bookmark(jsi::Runtime&, const jsi::Value&, rc::Writer&, size_t);
static jsi::Value complex_decode_ref_Bookmark(jsi::Runtime&, rc::Reader&, size_t);
static void complex_encode_ref_BookmarkFolder(jsi::Runtime&, const jsi::Value&, rc::Writer&, size_t);
static jsi::Value complex_decode_ref_BookmarkFolder(jsi::Runtime&, rc::Reader&, size_t);
static void complex_encode_ref_SplitGroup(jsi::Runtime&, const jsi::Value&, rc::Writer&, size_t);
static jsi::Value complex_decode_ref_SplitGroup(jsi::Runtime&, rc::Reader&, size_t);
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
    auto _cx5 = _cx0.getProperty(rt, "customTitle"); if (_cx0.hasProperty(rt, "customTitle") && !_cx5.isUndefined()) { w.push_u8(1);
      if (!_cx5.isString()) throw jsi::JSError(rt, "complex string expected");
      w.push_string(_cx5.getString(rt).utf8(rt));
    } else { w.push_u8(0); }
    auto _cx6 = _cx0.getProperty(rt, "favorite"); if (_cx0.hasProperty(rt, "favorite") && !_cx6.isUndefined()) { w.push_u8(1);
      if (!_cx6.isBool()) throw jsi::JSError(rt, "complex boolean expected");
      w.push_bool(_cx6.getBool());
    } else { w.push_u8(0); }
    auto _cx7 = _cx0.getProperty(rt, "pinned"); if (_cx0.hasProperty(rt, "pinned") && !_cx7.isUndefined()) { w.push_u8(1);
      if (!_cx7.isBool()) throw jsi::JSError(rt, "complex boolean expected");
      w.push_bool(_cx7.getBool());
    } else { w.push_u8(0); }
    auto _cx8 = _cx0.getProperty(rt, "private"); if (_cx0.hasProperty(rt, "private") && !_cx8.isUndefined()) { w.push_u8(1);
      if (!_cx8.isBool()) throw jsi::JSError(rt, "complex boolean expected");
      w.push_bool(_cx8.getBool());
    } else { w.push_u8(0); }
    auto _cx9 = _cx0.getProperty(rt, "bookmarkId"); if (_cx0.hasProperty(rt, "bookmarkId") && !_cx9.isUndefined()) { w.push_u8(1);
      if (!_cx9.isString()) throw jsi::JSError(rt, "complex string expected");
      w.push_string(_cx9.getString(rt).utf8(rt));
    } else { w.push_u8(0); }
    auto _cx10 = _cx0.getProperty(rt, "homeUrl"); if (_cx0.hasProperty(rt, "homeUrl") && !_cx10.isUndefined()) { w.push_u8(1);
      if (!_cx10.isString()) throw jsi::JSError(rt, "complex string expected");
      w.push_string(_cx10.getString(rt).utf8(rt));
    } else { w.push_u8(0); }
    auto _cx11 = _cx0.getProperty(rt, "homeTitle"); if (_cx0.hasProperty(rt, "homeTitle") && !_cx11.isUndefined()) { w.push_u8(1);
      if (!_cx11.isString()) throw jsi::JSError(rt, "complex string expected");
      w.push_string(_cx11.getString(rt).utf8(rt));
    } else { w.push_u8(0); }
    auto _cx12 = _cx0.getProperty(rt, "suspended"); if (_cx0.hasProperty(rt, "suspended") && !_cx12.isUndefined()) { w.push_u8(1);
      if (!_cx12.isBool()) throw jsi::JSError(rt, "complex boolean expected");
      w.push_bool(_cx12.getBool());
    } else { w.push_u8(0); }
    auto _cx13 = _cx0.getProperty(rt, "updatedAt"); if (_cx0.hasProperty(rt, "updatedAt") && !_cx13.isUndefined()) { w.push_u8(1);
      w.push_uvar(rustra_u64(rt, _cx13, "complex integer"));
    } else { w.push_u8(0); }
  }
}
static jsi::Value complex_decode_ref_Tab(jsi::Runtime& rt, rc::Reader& r, size_t _depth) { if (_depth > 32) throw std::runtime_error("complex value depth exceeds 32"); return [&]() -> jsi::Value { auto _cx0 = jsi::Object(rt); _cx0.setProperty(rt, "id", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); _cx0.setProperty(rt, "workspaceId", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); _cx0.setProperty(rt, "url", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); _cx0.setProperty(rt, "title", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); auto _cx1 = r.read_u8(); if (_cx1 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx1 == 1) _cx0.setProperty(rt, "customTitle", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); auto _cx2 = r.read_u8(); if (_cx2 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx2 == 1) _cx0.setProperty(rt, "favorite", jsi::Value(r.read_bool())); auto _cx3 = r.read_u8(); if (_cx3 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx3 == 1) _cx0.setProperty(rt, "pinned", jsi::Value(r.read_bool())); auto _cx4 = r.read_u8(); if (_cx4 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx4 == 1) _cx0.setProperty(rt, "private", jsi::Value(r.read_bool())); auto _cx5 = r.read_u8(); if (_cx5 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx5 == 1) _cx0.setProperty(rt, "bookmarkId", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); auto _cx6 = r.read_u8(); if (_cx6 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx6 == 1) _cx0.setProperty(rt, "homeUrl", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); auto _cx7 = r.read_u8(); if (_cx7 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx7 == 1) _cx0.setProperty(rt, "homeTitle", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); auto _cx8 = r.read_u8(); if (_cx8 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx8 == 1) _cx0.setProperty(rt, "suspended", jsi::Value(r.read_bool())); auto _cx9 = r.read_u8(); if (_cx9 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx9 == 1) _cx0.setProperty(rt, "updatedAt", [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }()); return _cx0; }(); }
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
static void complex_encode_ref_SplitGroup(jsi::Runtime& rt, const jsi::Value& value, rc::Writer& w, size_t _depth) { if (_depth > 32) throw std::runtime_error("complex value depth exceeds 32");
  { if (!value.isObject() || value.asObject(rt).isArray(rt)) throw jsi::JSError(rt, "complex object expected");
    auto _cx0 = value.asObject(rt);
    auto _cx1 = _cx0.getProperty(rt, "id");
    if (!_cx1.isString()) throw jsi::JSError(rt, "complex string expected");
    w.push_string(_cx1.getString(rt).utf8(rt));
    auto _cx2 = _cx0.getProperty(rt, "workspaceId"); if (_cx0.hasProperty(rt, "workspaceId") && !_cx2.isUndefined()) { w.push_u8(1);
      if (!_cx2.isString()) throw jsi::JSError(rt, "complex string expected");
      w.push_string(_cx2.getString(rt).utf8(rt));
    } else { w.push_u8(0); }
    auto _cx3 = _cx0.getProperty(rt, "name");
    if (!_cx3.isString()) throw jsi::JSError(rt, "complex string expected");
    w.push_string(_cx3.getString(rt).utf8(rt));
    auto _cx4 = _cx0.getProperty(rt, "orientation");
    if (!_cx4.isString()) throw jsi::JSError(rt, "complex string expected");
    w.push_string(_cx4.getString(rt).utf8(rt));
    auto _cx5 = _cx0.getProperty(rt, "ratioMilli");
    w.push_uvar(rustra_u64(rt, _cx5, "complex integer"));
    auto _cx6 = _cx0.getProperty(rt, "firstTitle");
    if (!_cx6.isString()) throw jsi::JSError(rt, "complex string expected");
    w.push_string(_cx6.getString(rt).utf8(rt));
    auto _cx7 = _cx0.getProperty(rt, "firstUrl");
    if (!_cx7.isString()) throw jsi::JSError(rt, "complex string expected");
    w.push_string(_cx7.getString(rt).utf8(rt));
    auto _cx8 = _cx0.getProperty(rt, "secondTitle");
    if (!_cx8.isString()) throw jsi::JSError(rt, "complex string expected");
    w.push_string(_cx8.getString(rt).utf8(rt));
    auto _cx9 = _cx0.getProperty(rt, "secondUrl");
    if (!_cx9.isString()) throw jsi::JSError(rt, "complex string expected");
    w.push_string(_cx9.getString(rt).utf8(rt));
  }
}
static jsi::Value complex_decode_ref_SplitGroup(jsi::Runtime& rt, rc::Reader& r, size_t _depth) { if (_depth > 32) throw std::runtime_error("complex value depth exceeds 32"); return [&]() -> jsi::Value { auto _cx0 = jsi::Object(rt); _cx0.setProperty(rt, "id", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); auto _cx1 = r.read_u8(); if (_cx1 > 1) throw std::runtime_error("complex optional field presence tag"); if (_cx1 == 1) _cx0.setProperty(rt, "workspaceId", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); _cx0.setProperty(rt, "name", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); _cx0.setProperty(rt, "orientation", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); _cx0.setProperty(rt, "ratioMilli", [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }()); _cx0.setProperty(rt, "firstTitle", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); _cx0.setProperty(rt, "firstUrl", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); _cx0.setProperty(rt, "secondTitle", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); _cx0.setProperty(rt, "secondUrl", [&]() -> jsi::Value { auto _s = r.read_string_view(); return jsi::String::createFromUtf8(rt, _s.data, _s.size); }()); return _cx0; }(); }
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
static void encode_body_bookmarkCreate(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_1).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_2).getString(rt).utf8(rt); w.push_string(_v); }
}
static void encode_bookmarkCreate(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(20); w.push_u8(0); // cmd_id = 20 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 3> _properties{jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "folderId")};
  encode_body_bookmarkCreate(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 3회 제거.
static void encode_pos_bookmarkCreate(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 3) throw jsi::JSError(rt, "rustra: bookmarkCreate expects 3 positional argument(s), got " + std::to_string(argc));
  w.push_u8(20); w.push_u8(0); // cmd_id = 20 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[1].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[2].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_body_bookmarkCreate(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_bookmarkCreate(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_bookmarkCreate(rt, resultObj, r, _properties.data());
}

static void encode_body_bookmarkFolderCreate(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
}
static void encode_bookmarkFolderCreate(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(24); w.push_u8(0); // cmd_id = 24 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 1> _properties{jsi::PropNameID::forAscii(rt, "title")};
  encode_body_bookmarkFolderCreate(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_bookmarkFolderCreate(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: bookmarkFolderCreate expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(24); w.push_u8(0); // cmd_id = 24 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_body_bookmarkFolderCreate(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_bookmarkFolderCreate(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_bookmarkFolderCreate(rt, resultObj, r, _properties.data());
}

static void encode_body_bookmarkFolderRemove(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
}
static void encode_bookmarkFolderRemove(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(26); w.push_u8(0); // cmd_id = 26 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 1> _properties{jsi::PropNameID::forAscii(rt, "folderId")};
  encode_body_bookmarkFolderRemove(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_bookmarkFolderRemove(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: bookmarkFolderRemove expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(26); w.push_u8(0); // cmd_id = 26 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_body_bookmarkFolderRemove(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_bookmarkFolderRemove(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_bookmarkFolderRemove(rt, resultObj, r, _properties.data());
}

static void encode_body_bookmarkFolderRename(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_1).getString(rt).utf8(rt); w.push_string(_v); }
}
static void encode_bookmarkFolderRename(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(25); w.push_u8(0); // cmd_id = 25 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 2> _properties{jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "title")};
  encode_body_bookmarkFolderRename(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 2회 제거.
static void encode_pos_bookmarkFolderRename(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 2) throw jsi::JSError(rt, "rustra: bookmarkFolderRename expects 2 positional argument(s), got " + std::to_string(argc));
  w.push_u8(25); w.push_u8(0); // cmd_id = 25 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[1].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_body_bookmarkFolderRename(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_bookmarkFolderRename(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_bookmarkFolderRename(rt, resultObj, r, _properties.data());
}

static void encode_body_bookmarkMove(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
  w.push_uvar(rustra_u64(rt, argsObj.getProperty(rt, _prop_1), "index"));
}
static void encode_bookmarkMove(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(23); w.push_u8(0); // cmd_id = 23 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 2> _properties{jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "index")};
  encode_body_bookmarkMove(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 2회 제거.
static void encode_pos_bookmarkMove(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 2) throw jsi::JSError(rt, "rustra: bookmarkMove expects 2 positional argument(s), got " + std::to_string(argc));
  w.push_u8(23); w.push_u8(0); // cmd_id = 23 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  w.push_uvar(rustra_u64(rt, argv[1], "index"));
}

static jsi::Value decode_body_bookmarkMove(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_bookmarkMove(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_bookmarkMove(rt, resultObj, r, _properties.data());
}

static void encode_body_bookmarkOpen(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_1).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_2).getBool(); w.push_bool(_v); }
}
static void encode_bookmarkOpen(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(29); w.push_u8(0); // cmd_id = 29 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 3> _properties{jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "reuseTabId"), jsi::PropNameID::forAscii(rt, "private")};
  encode_body_bookmarkOpen(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 3회 제거.
static void encode_pos_bookmarkOpen(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 3) throw jsi::JSError(rt, "rustra: bookmarkOpen expects 3 positional argument(s), got " + std::to_string(argc));
  w.push_u8(29); w.push_u8(0); // cmd_id = 29 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[1].asString(rt).utf8(rt); w.push_string(_s); }
  w.push_bool(argv[2].asBool());
}

static jsi::Value decode_body_bookmarkOpen(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_bookmarkOpen(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_bookmarkOpen(rt, resultObj, r, _properties.data());
}

static void encode_body_bookmarkRemove(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
}
static void encode_bookmarkRemove(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(22); w.push_u8(0); // cmd_id = 22 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 1> _properties{jsi::PropNameID::forAscii(rt, "bookmarkId")};
  encode_body_bookmarkRemove(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_bookmarkRemove(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: bookmarkRemove expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(22); w.push_u8(0); // cmd_id = 22 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_body_bookmarkRemove(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_bookmarkRemove(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_bookmarkRemove(rt, resultObj, r, _properties.data());
}

static void encode_body_bookmarkSetFolder(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_1).getString(rt).utf8(rt); w.push_string(_v); }
}
static void encode_bookmarkSetFolder(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(27); w.push_u8(0); // cmd_id = 27 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 2> _properties{jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "folderId")};
  encode_body_bookmarkSetFolder(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 2회 제거.
static void encode_pos_bookmarkSetFolder(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 2) throw jsi::JSError(rt, "rustra: bookmarkSetFolder expects 2 positional argument(s), got " + std::to_string(argc));
  w.push_u8(27); w.push_u8(0); // cmd_id = 27 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[1].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_body_bookmarkSetFolder(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_bookmarkSetFolder(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_bookmarkSetFolder(rt, resultObj, r, _properties.data());
}

static void encode_body_bookmarkUpdate(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_1).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_2).getString(rt).utf8(rt); w.push_string(_v); }
}
static void encode_bookmarkUpdate(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(21); w.push_u8(0); // cmd_id = 21 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 3> _properties{jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "url")};
  encode_body_bookmarkUpdate(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 3회 제거.
static void encode_pos_bookmarkUpdate(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 3) throw jsi::JSError(rt, "rustra: bookmarkUpdate expects 3 positional argument(s), got " + std::to_string(argc));
  w.push_u8(21); w.push_u8(0); // cmd_id = 21 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[1].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[2].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_body_bookmarkUpdate(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_bookmarkUpdate(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_bookmarkUpdate(rt, resultObj, r, _properties.data());
}

static void encode_body_browserSnapshot(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
}
static void encode_browserSnapshot(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(1); w.push_u8(0); // cmd_id = 1 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 0> _properties{};
  encode_body_browserSnapshot(rt, argsObj, w, _properties.data());
}

static jsi::Value decode_body_browserSnapshot(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_browserSnapshot(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_browserSnapshot(rt, resultObj, r, _properties.data());
}

static void encode_body_keymapDefaults(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
}
static void encode_keymapDefaults(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(19); w.push_u8(0); // cmd_id = 19 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 0> _properties{};
  encode_body_keymapDefaults(rt, argsObj, w, _properties.data());
}

static jsi::Value decode_body_keymapDefaults(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_1, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_2, r.read_bool());
      _obj.setProperty(rt, _prop_3, r.read_bool());
      _obj.setProperty(rt, _prop_4, r.read_bool());
      _obj.setProperty(rt, _prop_5, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_0, _arr); }
  return std::move(resultObj);
}
static jsi::Value decode_keymapDefaults(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 7> _properties{jsi::PropNameID::forAscii(rt, "bindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command")};
  return decode_body_keymapDefaults(rt, resultObj, r, _properties.data());
}

static void encode_body_keymapSet(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  { auto _arr = argsObj.getProperty(rt, _prop_0).asObject(rt).getArray(rt); auto _n = _arr.length(rt); w.push_uvar(_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = _arr.getValueAtIndex(rt, _i).getObject(rt);
      { auto _v = _obj.getProperty(rt, _prop_1).getString(rt).utf8(rt); w.push_string(_v); }
      { auto _v = _obj.getProperty(rt, _prop_2).getBool(); w.push_bool(_v); }
      { auto _v = _obj.getProperty(rt, _prop_3).getBool(); w.push_bool(_v); }
      { auto _v = _obj.getProperty(rt, _prop_4).getBool(); w.push_bool(_v); }
      { auto _v = _obj.getProperty(rt, _prop_5).getBool(); w.push_bool(_v); }
      { auto _v = _obj.getProperty(rt, _prop_6).getString(rt).utf8(rt); w.push_string(_v); }
    } }
}
static void encode_keymapSet(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(18); w.push_u8(0); // cmd_id = 18 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 7> _properties{jsi::PropNameID::forAscii(rt, "bindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command")};
  encode_body_keymapSet(rt, argsObj, w, _properties.data());
}

static jsi::Value decode_body_keymapSet(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_keymapSet(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_keymapSet(rt, resultObj, r, _properties.data());
}

static void encode_body_snapshotRestore(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
}
static void encode_snapshotRestore(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(17); w.push_u8(0); // cmd_id = 17 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 1> _properties{jsi::PropNameID::forAscii(rt, "json")};
  encode_body_snapshotRestore(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_snapshotRestore(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: snapshotRestore expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(17); w.push_u8(0); // cmd_id = 17 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_body_snapshotRestore(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_snapshotRestore(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_snapshotRestore(rt, resultObj, r, _properties.data());
}

static void encode_body_splitGroupRemove(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
}
static void encode_splitGroupRemove(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(31); w.push_u8(0); // cmd_id = 31 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 1> _properties{jsi::PropNameID::forAscii(rt, "splitGroupId")};
  encode_body_splitGroupRemove(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_splitGroupRemove(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: splitGroupRemove expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(31); w.push_u8(0); // cmd_id = 31 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_body_splitGroupRemove(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_splitGroupRemove(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_splitGroupRemove(rt, resultObj, r, _properties.data());
}

static void encode_body_splitGroupSave(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  { auto _option_value = argsObj.getProperty(rt, _prop_0); if (_option_value.isNull() || _option_value.isUndefined()) { w.push_u8(0); } else { w.push_u8(1); { auto _v = _option_value.getString(rt).utf8(rt); w.push_string(_v); } } }
  { auto _v = argsObj.getProperty(rt, _prop_1).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_2).getString(rt).utf8(rt); w.push_string(_v); }
  w.push_uvar(rustra_u64(rt, argsObj.getProperty(rt, _prop_3), "ratioMilli"));
  { auto _v = argsObj.getProperty(rt, _prop_4).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_5).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_6).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_7).getString(rt).utf8(rt); w.push_string(_v); }
}
static void encode_splitGroupSave(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(30); w.push_u8(0); // cmd_id = 30 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 8> _properties{jsi::PropNameID::forAscii(rt, "splitGroupId"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl")};
  encode_body_splitGroupSave(rt, argsObj, w, _properties.data());
}

static jsi::Value decode_body_splitGroupSave(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_splitGroupSave(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_splitGroupSave(rt, resultObj, r, _properties.data());
}

static void encode_body_tabActivate(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
}
static void encode_tabActivate(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(9); w.push_u8(0); // cmd_id = 9 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 1> _properties{jsi::PropNameID::forAscii(rt, "tabId")};
  encode_body_tabActivate(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_tabActivate(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: tabActivate expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(9); w.push_u8(0); // cmd_id = 9 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_body_tabActivate(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_tabActivate(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_tabActivate(rt, resultObj, r, _properties.data());
}

static void encode_body_tabClose(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
}
static void encode_tabClose(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(10); w.push_u8(0); // cmd_id = 10 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 1> _properties{jsi::PropNameID::forAscii(rt, "tabId")};
  encode_body_tabClose(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_tabClose(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: tabClose expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(10); w.push_u8(0); // cmd_id = 10 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_body_tabClose(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_tabClose(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_tabClose(rt, resultObj, r, _properties.data());
}

static void encode_body_tabCreate(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_1).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_2).getBool(); w.push_bool(_v); }
}
static void encode_tabCreate(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(7); w.push_u8(0); // cmd_id = 7 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 3> _properties{jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "private")};
  encode_body_tabCreate(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 3회 제거.
static void encode_pos_tabCreate(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 3) throw jsi::JSError(rt, "rustra: tabCreate expects 3 positional argument(s), got " + std::to_string(argc));
  w.push_u8(7); w.push_u8(0); // cmd_id = 7 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[1].asString(rt).utf8(rt); w.push_string(_s); }
  w.push_bool(argv[2].asBool());
}

static jsi::Value decode_body_tabCreate(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_tabCreate(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_tabCreate(rt, resultObj, r, _properties.data());
}

static void encode_body_tabMove(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
  w.push_uvar(rustra_u64(rt, argsObj.getProperty(rt, _prop_1), "index"));
}
static void encode_tabMove(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(14); w.push_u8(0); // cmd_id = 14 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 2> _properties{jsi::PropNameID::forAscii(rt, "tabId"), jsi::PropNameID::forAscii(rt, "index")};
  encode_body_tabMove(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 2회 제거.
static void encode_pos_tabMove(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 2) throw jsi::JSError(rt, "rustra: tabMove expects 2 positional argument(s), got " + std::to_string(argc));
  w.push_u8(14); w.push_u8(0); // cmd_id = 14 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  w.push_uvar(rustra_u64(rt, argv[1], "index"));
}

static jsi::Value decode_body_tabMove(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_tabMove(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_tabMove(rt, resultObj, r, _properties.data());
}

static void encode_body_tabNavigated(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_1).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_2).getString(rt).utf8(rt); w.push_string(_v); }
}
static void encode_tabNavigated(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(11); w.push_u8(0); // cmd_id = 11 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 3> _properties{jsi::PropNameID::forAscii(rt, "tabId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title")};
  encode_body_tabNavigated(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 3회 제거.
static void encode_pos_tabNavigated(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 3) throw jsi::JSError(rt, "rustra: tabNavigated expects 3 positional argument(s), got " + std::to_string(argc));
  w.push_u8(11); w.push_u8(0); // cmd_id = 11 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[1].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[2].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_body_tabNavigated(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_tabNavigated(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_tabNavigated(rt, resultObj, r, _properties.data());
}

static void encode_body_tabOpenExternal(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_1).getString(rt).utf8(rt); w.push_string(_v); }
}
static void encode_tabOpenExternal(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(8); w.push_u8(0); // cmd_id = 8 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 2> _properties{jsi::PropNameID::forAscii(rt, "requestId"), jsi::PropNameID::forAscii(rt, "url")};
  encode_body_tabOpenExternal(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 2회 제거.
static void encode_pos_tabOpenExternal(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 2) throw jsi::JSError(rt, "rustra: tabOpenExternal expects 2 positional argument(s), got " + std::to_string(argc));
  w.push_u8(8); w.push_u8(0); // cmd_id = 8 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[1].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_body_tabOpenExternal(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_tabOpenExternal(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_tabOpenExternal(rt, resultObj, r, _properties.data());
}

static void encode_body_tabRename(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_1).getString(rt).utf8(rt); w.push_string(_v); }
}
static void encode_tabRename(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(32); w.push_u8(0); // cmd_id = 32 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 2> _properties{jsi::PropNameID::forAscii(rt, "tabId"), jsi::PropNameID::forAscii(rt, "title")};
  encode_body_tabRename(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 2회 제거.
static void encode_pos_tabRename(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 2) throw jsi::JSError(rt, "rustra: tabRename expects 2 positional argument(s), got " + std::to_string(argc));
  w.push_u8(32); w.push_u8(0); // cmd_id = 32 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[1].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_body_tabRename(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_tabRename(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_tabRename(rt, resultObj, r, _properties.data());
}

static void encode_body_tabReset(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
}
static void encode_tabReset(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(28); w.push_u8(0); // cmd_id = 28 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 1> _properties{jsi::PropNameID::forAscii(rt, "tabId")};
  encode_body_tabReset(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_tabReset(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: tabReset expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(28); w.push_u8(0); // cmd_id = 28 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_body_tabReset(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_tabReset(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_tabReset(rt, resultObj, r, _properties.data());
}

static void encode_body_tabSetFavorite(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_1).getBool(); w.push_bool(_v); }
}
static void encode_tabSetFavorite(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(12); w.push_u8(0); // cmd_id = 12 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 2> _properties{jsi::PropNameID::forAscii(rt, "tabId"), jsi::PropNameID::forAscii(rt, "favorite")};
  encode_body_tabSetFavorite(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 2회 제거.
static void encode_pos_tabSetFavorite(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 2) throw jsi::JSError(rt, "rustra: tabSetFavorite expects 2 positional argument(s), got " + std::to_string(argc));
  w.push_u8(12); w.push_u8(0); // cmd_id = 12 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  w.push_bool(argv[1].asBool());
}

static jsi::Value decode_body_tabSetFavorite(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_tabSetFavorite(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_tabSetFavorite(rt, resultObj, r, _properties.data());
}

static void encode_body_tabSetPinned(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_1).getBool(); w.push_bool(_v); }
}
static void encode_tabSetPinned(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(13); w.push_u8(0); // cmd_id = 13 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 2> _properties{jsi::PropNameID::forAscii(rt, "tabId"), jsi::PropNameID::forAscii(rt, "pinned")};
  encode_body_tabSetPinned(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 2회 제거.
static void encode_pos_tabSetPinned(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 2) throw jsi::JSError(rt, "rustra: tabSetPinned expects 2 positional argument(s), got " + std::to_string(argc));
  w.push_u8(13); w.push_u8(0); // cmd_id = 13 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  w.push_bool(argv[1].asBool());
}

static jsi::Value decode_body_tabSetPinned(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_tabSetPinned(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_tabSetPinned(rt, resultObj, r, _properties.data());
}

static void encode_body_tabSetWorkspace(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_1).getString(rt).utf8(rt); w.push_string(_v); }
}
static void encode_tabSetWorkspace(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(15); w.push_u8(0); // cmd_id = 15 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 2> _properties{jsi::PropNameID::forAscii(rt, "tabId"), jsi::PropNameID::forAscii(rt, "workspaceId")};
  encode_body_tabSetWorkspace(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 2회 제거.
static void encode_pos_tabSetWorkspace(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 2) throw jsi::JSError(rt, "rustra: tabSetWorkspace expects 2 positional argument(s), got " + std::to_string(argc));
  w.push_u8(15); w.push_u8(0); // cmd_id = 15 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  { auto _s = argv[1].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_body_tabSetWorkspace(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_tabSetWorkspace(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_tabSetWorkspace(rt, resultObj, r, _properties.data());
}

static void encode_body_workArchiveImport(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_1).getBool(); w.push_bool(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_2).getBool(); w.push_bool(_v); }
  w.push_uvar(rustra_u64(rt, argsObj.getProperty(rt, _prop_3), "expectedRevision"));
}
static void encode_workArchiveImport(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(5); w.push_u8(0); // cmd_id = 5 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 4> _properties{jsi::PropNameID::forAscii(rt, "json"), jsi::PropNameID::forAscii(rt, "includeFavorites"), jsi::PropNameID::forAscii(rt, "restoreKeymap"), jsi::PropNameID::forAscii(rt, "expectedRevision")};
  encode_body_workArchiveImport(rt, argsObj, w, _properties.data());
}

static jsi::Value decode_body_workArchiveImport(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_workArchiveImport(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_workArchiveImport(rt, resultObj, r, _properties.data());
}

static void encode_body_workArchivePrepare(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_1).getBool(); w.push_bool(_v); }
  { auto _v = argsObj.getProperty(rt, _prop_2).getBool(); w.push_bool(_v); }
}
static void encode_workArchivePrepare(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(4); w.push_u8(0); // cmd_id = 4 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 3> _properties{jsi::PropNameID::forAscii(rt, "json"), jsi::PropNameID::forAscii(rt, "includeFavorites"), jsi::PropNameID::forAscii(rt, "restoreKeymap")};
  encode_body_workArchivePrepare(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 3회 제거.
static void encode_pos_workArchivePrepare(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 3) throw jsi::JSError(rt, "rustra: workArchivePrepare expects 3 positional argument(s), got " + std::to_string(argc));
  w.push_u8(4); w.push_u8(0); // cmd_id = 4 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
  w.push_bool(argv[1].asBool());
  w.push_bool(argv[2].asBool());
}

static jsi::Value decode_body_workArchivePrepare(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_workArchivePrepare(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_workArchivePrepare(rt, resultObj, r, _properties.data());
}

static void encode_body_workArchivePreview(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
}
static void encode_workArchivePreview(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(3); w.push_u8(0); // cmd_id = 3 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 1> _properties{jsi::PropNameID::forAscii(rt, "json")};
  encode_body_workArchivePreview(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_workArchivePreview(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: workArchivePreview expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(3); w.push_u8(0); // cmd_id = 3 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_body_workArchivePreview(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_2, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_3, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_4, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_5, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_6, r.read_bool());
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  return std::move(resultObj);
}
static jsi::Value decode_workArchivePreview(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 8> _properties{jsi::PropNameID::forAscii(rt, "spaces"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folders"), jsi::PropNameID::forAscii(rt, "favorites"), jsi::PropNameID::forAscii(rt, "duplicateUrls"), jsi::PropNameID::forAscii(rt, "hasKeyBindings"), jsi::PropNameID::forAscii(rt, "presentation")};
  return decode_body_workArchivePreview(rt, resultObj, r, _properties.data());
}

static void encode_body_workspaceActivate(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
}
static void encode_workspaceActivate(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(16); w.push_u8(0); // cmd_id = 16 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 1> _properties{jsi::PropNameID::forAscii(rt, "workspaceId")};
  encode_body_workspaceActivate(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_workspaceActivate(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: workspaceActivate expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(16); w.push_u8(0); // cmd_id = 16 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_body_workspaceActivate(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_workspaceActivate(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_workspaceActivate(rt, resultObj, r, _properties.data());
}

static void encode_body_workspaceCreate(jsi::Runtime& rt, const jsi::Object& argsObj, rc::Writer& w, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  { auto _v = argsObj.getProperty(rt, _prop_0).getString(rt).utf8(rt); w.push_string(_v); }
}
static void encode_workspaceCreate(jsi::Runtime& rt, const jsi::Value& args, rc::Writer& w) {
  w.push_u8(6); w.push_u8(0); // cmd_id = 6 LE
  auto argsObj = args.asObject(rt);
  const std::array<jsi::PropNameID, 1> _properties{jsi::PropNameID::forAscii(rt, "name")};
  encode_body_workspaceCreate(rt, argsObj, w, _properties.data());
}

// (Tier 1 positional) 개별 인자 → 직접 인코딩. argsObj 경유 대비 JSI 프로퍼티 조회 1회 제거.
static void encode_pos_workspaceCreate(jsi::Runtime& rt, const jsi::Value* argv, size_t argc, rc::Writer& w) {
  if (argc != 1) throw jsi::JSError(rt, "rustra: workspaceCreate expects 1 positional argument(s), got " + std::to_string(argc));
  w.push_u8(6); w.push_u8(0); // cmd_id = 6 LE
  { auto _s = argv[0].asString(rt).utf8(rt); w.push_string(_s); }
}

static jsi::Value decode_body_workspaceCreate(jsi::Runtime& rt, jsi::Object& resultObj, rc::Reader& r, const jsi::PropNameID* _properties) {
  const auto& _prop_0 = _properties[0];
  const auto& _prop_1 = _properties[1];
  const auto& _prop_2 = _properties[2];
  const auto& _prop_3 = _properties[3];
  const auto& _prop_4 = _properties[4];
  const auto& _prop_5 = _properties[5];
  const auto& _prop_6 = _properties[6];
  const auto& _prop_7 = _properties[7];
  const auto& _prop_8 = _properties[8];
  const auto& _prop_9 = _properties[9];
  const auto& _prop_10 = _properties[10];
  const auto& _prop_11 = _properties[11];
  const auto& _prop_12 = _properties[12];
  const auto& _prop_13 = _properties[13];
  const auto& _prop_14 = _properties[14];
  const auto& _prop_15 = _properties[15];
  const auto& _prop_16 = _properties[16];
  const auto& _prop_17 = _properties[17];
  const auto& _prop_18 = _properties[18];
  const auto& _prop_19 = _properties[19];
  const auto& _prop_20 = _properties[20];
  const auto& _prop_21 = _properties[21];
  const auto& _prop_22 = _properties[22];
  const auto& _prop_23 = _properties[23];
  const auto& _prop_24 = _properties[24];
  const auto& _prop_25 = _properties[25];
  const auto& _prop_26 = _properties[26];
  const auto& _prop_27 = _properties[27];
  const auto& _prop_28 = _properties[28];
  const auto& _prop_29 = _properties[29];
  const auto& _prop_30 = _properties[30];
  const auto& _prop_31 = _properties[31];
  const auto& _prop_32 = _properties[32];
  const auto& _prop_33 = _properties[33];
  const auto& _prop_34 = _properties[34];
  const auto& _prop_35 = _properties[35];
  const auto& _prop_36 = _properties[36];
  const auto& _prop_37 = _properties[37];
  const auto& _prop_38 = _properties[38];
  const auto& _prop_39 = _properties[39];
  const auto& _prop_40 = _properties[40];
  resultObj.setProperty(rt, _prop_0, (double)r.read_uvar());
  resultObj.setProperty(rt, _prop_1, (double)r.read_uvar());
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_2, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_6, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _tag = r.read_u8(); if (_tag == 0) { _obj.setProperty(rt, _prop_7, jsi::Value::null()); } else { { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_7, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_3, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_12, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_13, r.read_bool());
      _obj.setProperty(rt, _prop_14, r.read_bool());
      _obj.setProperty(rt, _prop_15, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_16, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_17, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_18, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_19, r.read_bool());
      _obj.setProperty(rt, _prop_20, [&]() -> jsi::Value { auto _v = r.read_uvar(); if (_v <= 9007199254740991ull) return jsi::Value(static_cast<double>(_v)); return jsi::Value(rt, jsi::BigInt::fromUint64(rt, _v)); }());
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_8, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_10, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_22, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_21, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_11, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_23, _arr); }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_4, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_9, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_5, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_25, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_26, (double)r.read_uvar());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_27, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_28, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_29, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_30, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_24, _arr); }
  { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_31, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
  { auto _tag = r.read_u8(); if (_tag == 0) { resultObj.setProperty(rt, _prop_32, jsi::Value::null()); } else { { auto _s = r.read_string_view(); resultObj.setProperty(rt, _prop_32, jsi::String::createFromUtf8(rt, _s.data, _s.size)); } } }
  { auto _n = r.read_uvar(); auto _arr = jsi::Array(rt, (size_t)_n);
    for (size_t _i = 0; _i < _n; _i++) { auto _obj = jsi::Object(rt);
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_34, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _obj.setProperty(rt, _prop_35, r.read_bool());
      _obj.setProperty(rt, _prop_36, r.read_bool());
      _obj.setProperty(rt, _prop_37, r.read_bool());
      _obj.setProperty(rt, _prop_38, r.read_bool());
      { auto _s = r.read_string_view(); _obj.setProperty(rt, _prop_39, jsi::String::createFromUtf8(rt, _s.data, _s.size)); }
      _arr.setValueAtIndex(rt, _i, std::move(_obj)); }
    resultObj.setProperty(rt, _prop_33, _arr); }
  resultObj.setProperty(rt, _prop_40, (double)r.read_uvar());
  return std::move(resultObj);
}
static jsi::Value decode_workspaceCreate(jsi::Runtime& rt, rc::Reader& r) {
  auto resultObj = jsi::Object(rt);
  const std::array<jsi::PropNameID, 41> _properties{jsi::PropNameID::forAscii(rt, "version"), jsi::PropNameID::forAscii(rt, "revision"), jsi::PropNameID::forAscii(rt, "lastExternalRequestId"), jsi::PropNameID::forAscii(rt, "workspaces"), jsi::PropNameID::forAscii(rt, "id"), jsi::PropNameID::forAscii(rt, "name"), jsi::PropNameID::forAscii(rt, "color"), jsi::PropNameID::forAscii(rt, "lastActiveTabId"), jsi::PropNameID::forAscii(rt, "tabs"), jsi::PropNameID::forAscii(rt, "workspaceId"), jsi::PropNameID::forAscii(rt, "url"), jsi::PropNameID::forAscii(rt, "title"), jsi::PropNameID::forAscii(rt, "customTitle"), jsi::PropNameID::forAscii(rt, "favorite"), jsi::PropNameID::forAscii(rt, "pinned"), jsi::PropNameID::forAscii(rt, "private"), jsi::PropNameID::forAscii(rt, "bookmarkId"), jsi::PropNameID::forAscii(rt, "homeUrl"), jsi::PropNameID::forAscii(rt, "homeTitle"), jsi::PropNameID::forAscii(rt, "suspended"), jsi::PropNameID::forAscii(rt, "updatedAt"), jsi::PropNameID::forAscii(rt, "bookmarks"), jsi::PropNameID::forAscii(rt, "folderId"), jsi::PropNameID::forAscii(rt, "bookmarkFolders"), jsi::PropNameID::forAscii(rt, "splitGroups"), jsi::PropNameID::forAscii(rt, "orientation"), jsi::PropNameID::forAscii(rt, "ratioMilli"), jsi::PropNameID::forAscii(rt, "firstTitle"), jsi::PropNameID::forAscii(rt, "firstUrl"), jsi::PropNameID::forAscii(rt, "secondTitle"), jsi::PropNameID::forAscii(rt, "secondUrl"), jsi::PropNameID::forAscii(rt, "activeWorkspaceId"), jsi::PropNameID::forAscii(rt, "activeTabId"), jsi::PropNameID::forAscii(rt, "keyBindings"), jsi::PropNameID::forAscii(rt, "key"), jsi::PropNameID::forAscii(rt, "meta"), jsi::PropNameID::forAscii(rt, "ctrl"), jsi::PropNameID::forAscii(rt, "alt"), jsi::PropNameID::forAscii(rt, "shift"), jsi::PropNameID::forAscii(rt, "command"), jsi::PropNameID::forAscii(rt, "keymapVersion")};
  return decode_body_workspaceCreate(rt, resultObj, r, _properties.data());
}

namespace rustra::generated {

bool encode_bound(Runtime& rt, const BoundCodecContext& context, const Value& args, rc::Writer& w) {
  switch (context.commandId) {
    case 20: {
      w.push_u8(20); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_bookmarkCreate(rt, argsObj, w, context.input.data()); return true;
    }
    case 24: {
      w.push_u8(24); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_bookmarkFolderCreate(rt, argsObj, w, context.input.data()); return true;
    }
    case 26: {
      w.push_u8(26); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_bookmarkFolderRemove(rt, argsObj, w, context.input.data()); return true;
    }
    case 25: {
      w.push_u8(25); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_bookmarkFolderRename(rt, argsObj, w, context.input.data()); return true;
    }
    case 23: {
      w.push_u8(23); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_bookmarkMove(rt, argsObj, w, context.input.data()); return true;
    }
    case 29: {
      w.push_u8(29); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_bookmarkOpen(rt, argsObj, w, context.input.data()); return true;
    }
    case 22: {
      w.push_u8(22); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_bookmarkRemove(rt, argsObj, w, context.input.data()); return true;
    }
    case 27: {
      w.push_u8(27); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_bookmarkSetFolder(rt, argsObj, w, context.input.data()); return true;
    }
    case 21: {
      w.push_u8(21); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_bookmarkUpdate(rt, argsObj, w, context.input.data()); return true;
    }
    case 1: {
      w.push_u8(1); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_browserSnapshot(rt, argsObj, w, context.input.data()); return true;
    }
    case 19: {
      w.push_u8(19); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_keymapDefaults(rt, argsObj, w, context.input.data()); return true;
    }
    case 18: {
      w.push_u8(18); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_keymapSet(rt, argsObj, w, context.input.data()); return true;
    }
    case 17: {
      w.push_u8(17); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_snapshotRestore(rt, argsObj, w, context.input.data()); return true;
    }
    case 31: {
      w.push_u8(31); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_splitGroupRemove(rt, argsObj, w, context.input.data()); return true;
    }
    case 30: {
      w.push_u8(30); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_splitGroupSave(rt, argsObj, w, context.input.data()); return true;
    }
    case 9: {
      w.push_u8(9); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_tabActivate(rt, argsObj, w, context.input.data()); return true;
    }
    case 10: {
      w.push_u8(10); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_tabClose(rt, argsObj, w, context.input.data()); return true;
    }
    case 7: {
      w.push_u8(7); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_tabCreate(rt, argsObj, w, context.input.data()); return true;
    }
    case 14: {
      w.push_u8(14); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_tabMove(rt, argsObj, w, context.input.data()); return true;
    }
    case 11: {
      w.push_u8(11); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_tabNavigated(rt, argsObj, w, context.input.data()); return true;
    }
    case 8: {
      w.push_u8(8); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_tabOpenExternal(rt, argsObj, w, context.input.data()); return true;
    }
    case 32: {
      w.push_u8(32); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_tabRename(rt, argsObj, w, context.input.data()); return true;
    }
    case 28: {
      w.push_u8(28); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_tabReset(rt, argsObj, w, context.input.data()); return true;
    }
    case 12: {
      w.push_u8(12); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_tabSetFavorite(rt, argsObj, w, context.input.data()); return true;
    }
    case 13: {
      w.push_u8(13); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_tabSetPinned(rt, argsObj, w, context.input.data()); return true;
    }
    case 15: {
      w.push_u8(15); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_tabSetWorkspace(rt, argsObj, w, context.input.data()); return true;
    }
    case 5: {
      w.push_u8(5); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_workArchiveImport(rt, argsObj, w, context.input.data()); return true;
    }
    case 4: {
      w.push_u8(4); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_workArchivePrepare(rt, argsObj, w, context.input.data()); return true;
    }
    case 3: {
      w.push_u8(3); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_workArchivePreview(rt, argsObj, w, context.input.data()); return true;
    }
    case 16: {
      w.push_u8(16); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_workspaceActivate(rt, argsObj, w, context.input.data()); return true;
    }
    case 6: {
      w.push_u8(6); w.push_u8(0);
      auto argsObj = args.asObject(rt);
      encode_body_workspaceCreate(rt, argsObj, w, context.input.data()); return true;
    }
    default: return false;
  }
}

Value decode_bound(Runtime& rt, const BoundCodecContext& context, rc::Reader& r) {
  switch (context.commandId) {
    case 20: {
      auto resultObj = jsi::Object(rt);
      return decode_body_bookmarkCreate(rt, resultObj, r, context.output.data());
    }
    case 24: {
      auto resultObj = jsi::Object(rt);
      return decode_body_bookmarkFolderCreate(rt, resultObj, r, context.output.data());
    }
    case 26: {
      auto resultObj = jsi::Object(rt);
      return decode_body_bookmarkFolderRemove(rt, resultObj, r, context.output.data());
    }
    case 25: {
      auto resultObj = jsi::Object(rt);
      return decode_body_bookmarkFolderRename(rt, resultObj, r, context.output.data());
    }
    case 23: {
      auto resultObj = jsi::Object(rt);
      return decode_body_bookmarkMove(rt, resultObj, r, context.output.data());
    }
    case 29: {
      auto resultObj = jsi::Object(rt);
      return decode_body_bookmarkOpen(rt, resultObj, r, context.output.data());
    }
    case 22: {
      auto resultObj = jsi::Object(rt);
      return decode_body_bookmarkRemove(rt, resultObj, r, context.output.data());
    }
    case 27: {
      auto resultObj = jsi::Object(rt);
      return decode_body_bookmarkSetFolder(rt, resultObj, r, context.output.data());
    }
    case 21: {
      auto resultObj = jsi::Object(rt);
      return decode_body_bookmarkUpdate(rt, resultObj, r, context.output.data());
    }
    case 1: {
      auto resultObj = jsi::Object(rt);
      return decode_body_browserSnapshot(rt, resultObj, r, context.output.data());
    }
    case 19: {
      auto resultObj = jsi::Object(rt);
      return decode_body_keymapDefaults(rt, resultObj, r, context.output.data());
    }
    case 18: {
      auto resultObj = jsi::Object(rt);
      return decode_body_keymapSet(rt, resultObj, r, context.output.data());
    }
    case 17: {
      auto resultObj = jsi::Object(rt);
      return decode_body_snapshotRestore(rt, resultObj, r, context.output.data());
    }
    case 31: {
      auto resultObj = jsi::Object(rt);
      return decode_body_splitGroupRemove(rt, resultObj, r, context.output.data());
    }
    case 30: {
      auto resultObj = jsi::Object(rt);
      return decode_body_splitGroupSave(rt, resultObj, r, context.output.data());
    }
    case 9: {
      auto resultObj = jsi::Object(rt);
      return decode_body_tabActivate(rt, resultObj, r, context.output.data());
    }
    case 10: {
      auto resultObj = jsi::Object(rt);
      return decode_body_tabClose(rt, resultObj, r, context.output.data());
    }
    case 7: {
      auto resultObj = jsi::Object(rt);
      return decode_body_tabCreate(rt, resultObj, r, context.output.data());
    }
    case 14: {
      auto resultObj = jsi::Object(rt);
      return decode_body_tabMove(rt, resultObj, r, context.output.data());
    }
    case 11: {
      auto resultObj = jsi::Object(rt);
      return decode_body_tabNavigated(rt, resultObj, r, context.output.data());
    }
    case 8: {
      auto resultObj = jsi::Object(rt);
      return decode_body_tabOpenExternal(rt, resultObj, r, context.output.data());
    }
    case 32: {
      auto resultObj = jsi::Object(rt);
      return decode_body_tabRename(rt, resultObj, r, context.output.data());
    }
    case 28: {
      auto resultObj = jsi::Object(rt);
      return decode_body_tabReset(rt, resultObj, r, context.output.data());
    }
    case 12: {
      auto resultObj = jsi::Object(rt);
      return decode_body_tabSetFavorite(rt, resultObj, r, context.output.data());
    }
    case 13: {
      auto resultObj = jsi::Object(rt);
      return decode_body_tabSetPinned(rt, resultObj, r, context.output.data());
    }
    case 15: {
      auto resultObj = jsi::Object(rt);
      return decode_body_tabSetWorkspace(rt, resultObj, r, context.output.data());
    }
    case 5: {
      auto resultObj = jsi::Object(rt);
      return decode_body_workArchiveImport(rt, resultObj, r, context.output.data());
    }
    case 4: {
      auto resultObj = jsi::Object(rt);
      return decode_body_workArchivePrepare(rt, resultObj, r, context.output.data());
    }
    case 3: {
      auto resultObj = jsi::Object(rt);
      return decode_body_workArchivePreview(rt, resultObj, r, context.output.data());
    }
    case 16: {
      auto resultObj = jsi::Object(rt);
      return decode_body_workspaceActivate(rt, resultObj, r, context.output.data());
    }
    case 6: {
      auto resultObj = jsi::Object(rt);
      return decode_body_workspaceCreate(rt, resultObj, r, context.output.data());
    }
    default: throw JSError(rt, "rustra: no bound codec");
  }
}

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
  if (name == "keymapDefaults") { encode_keymapDefaults(rt, args, w); return true; }
  if (name == "keymapSet") { encode_keymapSet(rt, args, w); return true; }
  if (name == "snapshotRestore") { encode_snapshotRestore(rt, args, w); return true; }
  if (name == "splitGroupRemove") { encode_splitGroupRemove(rt, args, w); return true; }
  if (name == "splitGroupSave") { encode_splitGroupSave(rt, args, w); return true; }
  if (name == "tabActivate") { encode_tabActivate(rt, args, w); return true; }
  if (name == "tabClose") { encode_tabClose(rt, args, w); return true; }
  if (name == "tabCreate") { encode_tabCreate(rt, args, w); return true; }
  if (name == "tabMove") { encode_tabMove(rt, args, w); return true; }
  if (name == "tabNavigated") { encode_tabNavigated(rt, args, w); return true; }
  if (name == "tabOpenExternal") { encode_tabOpenExternal(rt, args, w); return true; }
  if (name == "tabRename") { encode_tabRename(rt, args, w); return true; }
  if (name == "tabReset") { encode_tabReset(rt, args, w); return true; }
  if (name == "tabSetFavorite") { encode_tabSetFavorite(rt, args, w); return true; }
  if (name == "tabSetPinned") { encode_tabSetPinned(rt, args, w); return true; }
  if (name == "tabSetWorkspace") { encode_tabSetWorkspace(rt, args, w); return true; }
  if (name == "workArchiveImport") { encode_workArchiveImport(rt, args, w); return true; }
  if (name == "workArchivePrepare") { encode_workArchivePrepare(rt, args, w); return true; }
  if (name == "workArchivePreview") { encode_workArchivePreview(rt, args, w); return true; }
  if (name == "workspaceActivate") { encode_workspaceActivate(rt, args, w); return true; }
  if (name == "workspaceCreate") { encode_workspaceCreate(rt, args, w); return true; }
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
  if (name == "keymapDefaults") return decode_keymapDefaults(rt, r);
  if (name == "keymapSet") return decode_keymapSet(rt, r);
  if (name == "snapshotRestore") return decode_snapshotRestore(rt, r);
  if (name == "splitGroupRemove") return decode_splitGroupRemove(rt, r);
  if (name == "splitGroupSave") return decode_splitGroupSave(rt, r);
  if (name == "tabActivate") return decode_tabActivate(rt, r);
  if (name == "tabClose") return decode_tabClose(rt, r);
  if (name == "tabCreate") return decode_tabCreate(rt, r);
  if (name == "tabMove") return decode_tabMove(rt, r);
  if (name == "tabNavigated") return decode_tabNavigated(rt, r);
  if (name == "tabOpenExternal") return decode_tabOpenExternal(rt, r);
  if (name == "tabRename") return decode_tabRename(rt, r);
  if (name == "tabReset") return decode_tabReset(rt, r);
  if (name == "tabSetFavorite") return decode_tabSetFavorite(rt, r);
  if (name == "tabSetPinned") return decode_tabSetPinned(rt, r);
  if (name == "tabSetWorkspace") return decode_tabSetWorkspace(rt, r);
  if (name == "workArchiveImport") return decode_workArchiveImport(rt, r);
  if (name == "workArchivePrepare") return decode_workArchivePrepare(rt, r);
  if (name == "workArchivePreview") return decode_workArchivePreview(rt, r);
  if (name == "workspaceActivate") return decode_workspaceActivate(rt, r);
  if (name == "workspaceCreate") return decode_workspaceCreate(rt, r);
  throw JSError(rt, "rustra: no C++ codec for '" + name + "'");
}

bool encode_by_id(Runtime& rt, uint16_t cmd_id, const Value& args, rc::Writer& w) {
  switch (cmd_id) {
    case 20: encode_bookmarkCreate(rt, args, w); return true;
    case 24: encode_bookmarkFolderCreate(rt, args, w); return true;
    case 26: encode_bookmarkFolderRemove(rt, args, w); return true;
    case 25: encode_bookmarkFolderRename(rt, args, w); return true;
    case 23: encode_bookmarkMove(rt, args, w); return true;
    case 29: encode_bookmarkOpen(rt, args, w); return true;
    case 22: encode_bookmarkRemove(rt, args, w); return true;
    case 27: encode_bookmarkSetFolder(rt, args, w); return true;
    case 21: encode_bookmarkUpdate(rt, args, w); return true;
    case 1: encode_browserSnapshot(rt, args, w); return true;
    case 19: encode_keymapDefaults(rt, args, w); return true;
    case 18: encode_keymapSet(rt, args, w); return true;
    case 17: encode_snapshotRestore(rt, args, w); return true;
    case 31: encode_splitGroupRemove(rt, args, w); return true;
    case 30: encode_splitGroupSave(rt, args, w); return true;
    case 9: encode_tabActivate(rt, args, w); return true;
    case 10: encode_tabClose(rt, args, w); return true;
    case 7: encode_tabCreate(rt, args, w); return true;
    case 14: encode_tabMove(rt, args, w); return true;
    case 11: encode_tabNavigated(rt, args, w); return true;
    case 8: encode_tabOpenExternal(rt, args, w); return true;
    case 32: encode_tabRename(rt, args, w); return true;
    case 28: encode_tabReset(rt, args, w); return true;
    case 12: encode_tabSetFavorite(rt, args, w); return true;
    case 13: encode_tabSetPinned(rt, args, w); return true;
    case 15: encode_tabSetWorkspace(rt, args, w); return true;
    case 5: encode_workArchiveImport(rt, args, w); return true;
    case 4: encode_workArchivePrepare(rt, args, w); return true;
    case 3: encode_workArchivePreview(rt, args, w); return true;
    case 16: encode_workspaceActivate(rt, args, w); return true;
    case 6: encode_workspaceCreate(rt, args, w); return true;
    default: return false; // 동적/알 수 없는 cmd_id — JS 가 Tier 3 fallback 처리
  }
}

Value decode_by_id(Runtime& rt, uint16_t cmd_id, rc::Reader& r) {
  switch (cmd_id) {
    case 20: return decode_bookmarkCreate(rt, r);
    case 24: return decode_bookmarkFolderCreate(rt, r);
    case 26: return decode_bookmarkFolderRemove(rt, r);
    case 25: return decode_bookmarkFolderRename(rt, r);
    case 23: return decode_bookmarkMove(rt, r);
    case 29: return decode_bookmarkOpen(rt, r);
    case 22: return decode_bookmarkRemove(rt, r);
    case 27: return decode_bookmarkSetFolder(rt, r);
    case 21: return decode_bookmarkUpdate(rt, r);
    case 1: return decode_browserSnapshot(rt, r);
    case 19: return decode_keymapDefaults(rt, r);
    case 18: return decode_keymapSet(rt, r);
    case 17: return decode_snapshotRestore(rt, r);
    case 31: return decode_splitGroupRemove(rt, r);
    case 30: return decode_splitGroupSave(rt, r);
    case 9: return decode_tabActivate(rt, r);
    case 10: return decode_tabClose(rt, r);
    case 7: return decode_tabCreate(rt, r);
    case 14: return decode_tabMove(rt, r);
    case 11: return decode_tabNavigated(rt, r);
    case 8: return decode_tabOpenExternal(rt, r);
    case 32: return decode_tabRename(rt, r);
    case 28: return decode_tabReset(rt, r);
    case 12: return decode_tabSetFavorite(rt, r);
    case 13: return decode_tabSetPinned(rt, r);
    case 15: return decode_tabSetWorkspace(rt, r);
    case 5: return decode_workArchiveImport(rt, r);
    case 4: return decode_workArchivePrepare(rt, r);
    case 3: return decode_workArchivePreview(rt, r);
    case 16: return decode_workspaceActivate(rt, r);
    case 6: return decode_workspaceCreate(rt, r);
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
  if (name == "keymapDefaults") return true;
  if (name == "keymapSet") return true;
  if (name == "snapshotRestore") return true;
  if (name == "splitGroupRemove") return true;
  if (name == "splitGroupSave") return true;
  if (name == "tabActivate") return true;
  if (name == "tabClose") return true;
  if (name == "tabCreate") return true;
  if (name == "tabMove") return true;
  if (name == "tabNavigated") return true;
  if (name == "tabOpenExternal") return true;
  if (name == "tabRename") return true;
  if (name == "tabReset") return true;
  if (name == "tabSetFavorite") return true;
  if (name == "tabSetPinned") return true;
  if (name == "tabSetWorkspace") return true;
  if (name == "workArchiveImport") return true;
  if (name == "workArchivePrepare") return true;
  if (name == "workArchivePreview") return true;
  if (name == "workspaceActivate") return true;
  if (name == "workspaceCreate") return true;
  return false;
}

bool has_static_codec_id(uint16_t cmd_id) {
  switch (cmd_id) {
    case 20: return true;
    case 24: return true;
    case 26: return true;
    case 25: return true;
    case 23: return true;
    case 29: return true;
    case 22: return true;
    case 27: return true;
    case 21: return true;
    case 1: return true;
    case 19: return true;
    case 18: return true;
    case 17: return true;
    case 31: return true;
    case 30: return true;
    case 9: return true;
    case 10: return true;
    case 7: return true;
    case 14: return true;
    case 11: return true;
    case 8: return true;
    case 32: return true;
    case 28: return true;
    case 12: return true;
    case 13: return true;
    case 15: return true;
    case 5: return true;
    case 4: return true;
    case 3: return true;
    case 16: return true;
    case 6: return true;
    default: return false;
  }
}

/// (Tier 1) positional 인자를 직접 인코딩 가능한 cmd_id 집합 — JS 폴백 판별용.
bool has_pos_codec(uint16_t cmd_id) {
  if (cmd_id == 20) return true;
  if (cmd_id == 24) return true;
  if (cmd_id == 26) return true;
  if (cmd_id == 25) return true;
  if (cmd_id == 23) return true;
  if (cmd_id == 29) return true;
  if (cmd_id == 22) return true;
  if (cmd_id == 27) return true;
  if (cmd_id == 21) return true;
  if (cmd_id == 17) return true;
  if (cmd_id == 31) return true;
  if (cmd_id == 9) return true;
  if (cmd_id == 10) return true;
  if (cmd_id == 7) return true;
  if (cmd_id == 14) return true;
  if (cmd_id == 11) return true;
  if (cmd_id == 8) return true;
  if (cmd_id == 32) return true;
  if (cmd_id == 28) return true;
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
    case 20: encode_pos_bookmarkCreate(rt, argv, argc, w); return;
    case 24: encode_pos_bookmarkFolderCreate(rt, argv, argc, w); return;
    case 26: encode_pos_bookmarkFolderRemove(rt, argv, argc, w); return;
    case 25: encode_pos_bookmarkFolderRename(rt, argv, argc, w); return;
    case 23: encode_pos_bookmarkMove(rt, argv, argc, w); return;
    case 29: encode_pos_bookmarkOpen(rt, argv, argc, w); return;
    case 22: encode_pos_bookmarkRemove(rt, argv, argc, w); return;
    case 27: encode_pos_bookmarkSetFolder(rt, argv, argc, w); return;
    case 21: encode_pos_bookmarkUpdate(rt, argv, argc, w); return;
    case 17: encode_pos_snapshotRestore(rt, argv, argc, w); return;
    case 31: encode_pos_splitGroupRemove(rt, argv, argc, w); return;
    case 9: encode_pos_tabActivate(rt, argv, argc, w); return;
    case 10: encode_pos_tabClose(rt, argv, argc, w); return;
    case 7: encode_pos_tabCreate(rt, argv, argc, w); return;
    case 14: encode_pos_tabMove(rt, argv, argc, w); return;
    case 11: encode_pos_tabNavigated(rt, argv, argc, w); return;
    case 8: encode_pos_tabOpenExternal(rt, argv, argc, w); return;
    case 32: encode_pos_tabRename(rt, argv, argc, w); return;
    case 28: encode_pos_tabReset(rt, argv, argc, w); return;
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

Value decode_buffer_bound(Runtime& rt, const BoundCodecContext& context, Value buffer) {
  switch (context.commandId) {
    default: throw JSError(rt, "rustra: no bound buffer result codec");
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

Value decode_raw_bound(Runtime& rt, const BoundCodecContext& context, uint64_t slot) {
  switch (context.commandId) {
    default: throw JSError(rt, "rustra: no bound raw result codec");
  }
}

} // namespace rustra::generated
