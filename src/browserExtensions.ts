import { NativeModules } from "react-native";
import { translate, type AppLanguage } from "./i18n";
export type ExtensionOperation = "enabled" | "private" | "update" | "remove";
export type ExtensionOptionalKind = "permission" | "origin" | "data";
export interface BrowserExtensionsBridge {
  list(): Promise<string>;
  install(slug: string): Promise<string>;
  search(query: string): Promise<string>;
  revokeOptional(
    id: string,
    kind: ExtensionOptionalKind,
    value: string
  ): Promise<string>;
  modify(
    id: string,
    operation: ExtensionOperation,
    value: boolean
  ): Promise<string>;
  openAction(id: string, anchorX: number, anchorY: number): Promise<void>;
  openOptions(id: string): Promise<void>;
  setActiveTab(id: string | null): void;
  claimTabRequest(id: number): Promise<boolean>;
  resolveTabRequest(id: number, success: boolean): void;
}
export interface ExtensionCatalogEntry {
  slug: string;
  id: string;
  name: string;
  description: string;
  sourceUrl: string;
}
export interface InstalledBrowserExtension {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  privateAllowed: boolean;
  disabledFlags: number;
  hasOptions: boolean;
  hasAction: boolean;
  actionEnabled: boolean;
  badge: string;
  badgeBackgroundColor: string;
  badgeTextColor: string;
  icon: string;
  permissions: string[];
  origins: string[];
  dataPermissions: string[];
  optionalPermissions: string[];
  optionalOrigins: string[];
  optionalDataPermissions: string[];
}
export interface BrowserExtensionsState {
  busy: boolean;
  catalog: ExtensionCatalogEntry[];
  extensions: InstalledBrowserExtension[];
}
export interface ExtensionSearchResult {
  slug: string;
  name: string;
  summary: string;
  guid?: string;
  iconUrl?: string;
}

const moduleCandidate = NativeModules.BrowserExtensions as
  | Partial<BrowserExtensionsBridge>
  | undefined;
const bridgeMethods: (keyof BrowserExtensionsBridge)[] = [
  "list",
  "install",
  "search",
  "revokeOptional",
  "modify",
  "openAction",
  "openOptions",
  "setActiveTab",
  "claimTabRequest",
  "resolveTabRequest",
];
export const browserExtensions: BrowserExtensionsBridge | undefined =
  moduleCandidate &&
  bridgeMethods.every((method) => typeof moduleCandidate[method] === "function")
    ? (moduleCandidate as BrowserExtensionsBridge)
    : undefined;

export function requireBrowserExtensions(): BrowserExtensionsBridge {
  if (!browserExtensions)
    throw new Error(
      "Extension support is unavailable in this app build. Rebuild and install the updated Yeoyu Android app, then reopen Settings."
    );
  return browserExtensions;
}

const unreadable = () =>
  new Error(
    "Extension status could not be read. Refresh the list or update Yeoyu."
  );
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw unreadable();
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 2048): string {
  if (typeof value !== "string" || value.length > max) throw unreadable();
  return value;
}
function identifier(value: unknown): string {
  const text = string(value, 256);
  if (!text || /[\u0000-\u0020\u007f]/.test(text)) throw unreadable();
  return text;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw unreadable();
  return value;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw unreadable();
  return value;
}
function strings(value: unknown): string[] {
  return array(value, 4096).map((entry) => string(entry));
}
const iconHosts = new Set(["addons.cdn.mozilla.net", "addons.mozilla.org"]);

/** Installed-extension icons arrive as Gecko-rendered PNG data URIs; empty
 * means "no icon yet" and the interface shows a letter tile. */
function icon(value: unknown): string {
  if (value == null) return "";
  const text = string(value, 128 * 1024);
  if (text === "") return "";
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(text))
    throw unreadable();
  return text;
}

/** Search-result icons load straight from Mozilla's CDN; other hosts are refused. */
function iconUrl(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = string(value, 2048);
  const url = new URL(text);
  if (
    url.protocol !== "https:" ||
    !iconHosts.has(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    !url.pathname ||
    url.pathname === "/" ||
    url.search ||
    url.hash
  )
    throw unreadable();
  return text;
}

function badgeColor(value: unknown): string {
  if (value == null) return "";
  const text = string(value, 9);
  if (!/^#[0-9A-F]{8}$/.test(text)) throw unreadable();
  return text;
}
function unique<T>(values: T[], key: (value: T) => string): T[] {
  if (new Set(values.map(key)).size !== values.length) throw unreadable();
  return values;
}

/** Read actual engine state; malformed or missing native data is never an empty install list. */
export function parseBrowserExtensions(json: string): BrowserExtensionsState {
  try {
    if (json.length > 2 * 1024 * 1024) throw unreadable();
    const state = object(JSON.parse(json));
    const catalog = unique(
      array(state.catalog, 64).map((value): ExtensionCatalogEntry => {
        const entry = object(value);
        const sourceUrl = string(entry.sourceUrl);
        const url = new URL(sourceUrl);
        if (
          url.protocol !== "https:" ||
          url.hostname !== "addons.mozilla.org" ||
          url.username ||
          url.password ||
          url.port ||
          url.search ||
          url.hash
        )
          throw unreadable();
        return {
          slug: identifier(entry.slug),
          id: identifier(entry.id),
          name: string(entry.name),
          description: string(entry.description, 16_384),
          sourceUrl,
        };
      }),
      (entry) => entry.slug
    );
    unique(catalog, (entry) => entry.id);
    const extensions = unique(
      array(state.extensions, 128).map((value): InstalledBrowserExtension => {
        const entry = object(value);
        if (
          typeof entry.disabledFlags !== "number" ||
          !Number.isSafeInteger(entry.disabledFlags) ||
          entry.disabledFlags < 0
        )
          throw unreadable();
        return {
          id: identifier(entry.id),
          name: string(entry.name),
          version: string(entry.version, 128),
          description:
            entry.description == null ? "" : string(entry.description, 16_384),
          enabled: boolean(entry.enabled),
          privateAllowed: boolean(entry.privateAllowed),
          disabledFlags: entry.disabledFlags,
          hasOptions: boolean(entry.hasOptions),
          hasAction: boolean(entry.hasAction),
          actionEnabled: boolean(entry.actionEnabled),
          badge: entry.badge == null ? "" : string(entry.badge, 256),
          badgeBackgroundColor: entry.badgeBackgroundColor == null ? "" : badgeColor(entry.badgeBackgroundColor),
          badgeTextColor: entry.badgeTextColor == null ? "" : badgeColor(entry.badgeTextColor),
          icon: icon(entry.icon),
          permissions: strings(entry.permissions),
          origins: strings(entry.origins),
          dataPermissions: strings(entry.dataPermissions),
          optionalPermissions: strings(entry.optionalPermissions),
          optionalOrigins: strings(entry.optionalOrigins),
          optionalDataPermissions: strings(entry.optionalDataPermissions),
        };
      }),
      (entry) => entry.id
    );
    return { busy: boolean(state.busy), catalog, extensions };
  } catch {
    throw unreadable();
  }
}

export function extensionErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The extension operation could not finish. Refresh the list and try again.";
}

/** Native throws stable English messages; the reachable ones are mapped to
 * localized strings here. Unknown messages pass through untranslated so a
 * missed mapping can never blank an error. */
const nativeErrorKeys: Record<string, string> = {
  "Mozilla changed the add-on metadata address. Update Yeoyu before trying again.":
    "extension.native.metadataAddressMoved",
  "The extension is currently unavailable from Mozilla Add-ons. Try again later.":
    "extension.native.unavailable",
  "Mozilla did not return add-on details. Try again later.": "extension.native.noJson",
  "Mozilla add-on details exceed the supported size. Update Yeoyu and try again.":
    "extension.native.tooLarge",
  "Mozilla Add-ons took too long to respond. Check your connection and try again.":
    "extension.native.timeout",
  "Could not contact Mozilla Add-ons. Check your connection and try again.":
    "extension.native.unreachable",
  "Mozilla returned invalid add-on details. Try again later.": "extension.native.invalidDetails",
  "Mozilla did not return the requested extension. Themes and other add-on types are not supported.":
    "extension.native.notExtension",
  "Mozilla returned an invalid extension identity. Installation was stopped.":
    "extension.native.badIdentity",
  "Mozilla returned a different extension. Installation was stopped.":
    "extension.native.identityMismatch",
  "The extension is unavailable or disabled on Mozilla Add-ons.":
    "extension.native.disabledOnAmo",
  "Mozilla has no current extension version available. Try again later.":
    "extension.native.noVersion",
  "The current extension version is disabled. Try again later.":
    "extension.native.versionDisabled",
  "The current extension version does not declare Android support.":
    "extension.native.noAndroidCompat",
  "The current extension version does not support this browser version. Update Yeoyu and try again.":
    "extension.native.engineTooOld",
  "Mozilla has no downloadable extension package. Try again later.":
    "extension.native.noPackage",
  "The extension package is not publicly approved by Mozilla.":
    "extension.native.notApproved",
  "Mozilla returned an invalid extension version. Try again later.":
    "extension.native.badVersion",
  "Mozilla returned an unsupported extension download address. Update Yeoyu before trying again.":
    "extension.native.badDownloadUrl",
  "Mozilla add-on details were incomplete or unreadable. Try again later.":
    "extension.native.incomplete",
  "Mozilla returned an unreadable extension name. Installation was stopped.":
    "extension.native.badName",
  "Paste a Mozilla Add-ons extension page link. Direct files and other stores are not supported.":
    "extension.native.pasteLinkOnly",
  "Search words are too long or unreadable. Shorten the query and try again.":
    "extension.native.badQuery",
  "Mozilla returned an unreadable extension list. Try again later.":
    "extension.native.badList",
  "Another extension operation is still running": "extension.native.busy",
  "This extension is already installed": "extension.native.alreadyInstalled",
  "The browser window changed; start installation again": "extension.native.windowChanged",
  "Extension is no longer installed; refresh the list": "extension.native.gone",
  "Extension is not installed": "extension.native.notInstalled",
  "Open a website before using extension controls": "extension.native.openPageFirst",
  "Extension is disabled or unavailable in this private tab":
    "extension.native.unavailableInPrivate",
  "Extension controls are still starting; refresh and try again":
    "extension.native.actionStarting",
  "This extension action is unavailable on the current page":
    "extension.native.actionUnavailableHere",
  "Extension controls did not open. Try again or open extension settings.":
    "extension.native.popupTimeout",
  "The active tab changed; open extension controls again": "extension.native.tabChanged",
  "Extension controls could not open in this window": "extension.native.popupUnavailable",
  "Extension settings could not open in this window": "extension.native.optionsUnavailable",
  "This extension has no available settings page": "extension.native.noOptionsPage",
  "That permission is not currently granted to this extension":
    "extension.native.notGranted",
};

export function localizeExtensionError(message: string, language: AppLanguage): string {
  const key = nativeErrorKeys[message];
  if (key) return translate(language, key as never);
  const http = /^Mozilla Add-ons returned HTTP (\d+)\. Try again later\.$/.exec(message);
  if (http) return translate(language, "extension.native.http", { status: http[1] });
  return message;
}

const searchSlug = /^[\p{L}\p{N}_~-]{1,200}$/u;

/** Display-only search results from the native AMO query. Malformed payloads
 * are an error, never a silently empty list. */
export function parseExtensionSearch(json: string): ExtensionSearchResult[] {
  try {
    if (json.length > 1024 * 1024) throw unreadable();
    const results = array(object(JSON.parse(json)).results, 20).map(
      (value): ExtensionSearchResult => {
        const entry = object(value);
        const slug = identifier(entry.slug);
        if (!searchSlug.test(slug) || /^\p{N}+$/u.test(slug))
          throw unreadable();
        const name = string(entry.name, 256);
        if (!name.trim()) throw unreadable();
        const summary =
          entry.summary == null ? "" : string(entry.summary, 512);
        const guid =
          entry.guid == null ? undefined : identifier(entry.guid);
        const resultIconUrl = iconUrl(entry.icon_url);
        const base: ExtensionSearchResult = {
          slug,
          name,
          summary,
          ...(guid === undefined ? {} : { guid }),
          ...(resultIconUrl === undefined ? {} : { iconUrl: resultIconUrl }),
        };
        return base;
      }
    );
    return unique(results, (result) => result.slug);
  } catch {
    throw unreadable();
  }
}

const permissionLabels = {
  tabs: "Read open tabs and their addresses",
  activeTab: "Access the current tab after you use the extension",
  webNavigation: "Observe page navigation",
  webRequest: "Read website network requests",
  webRequestBlocking: "Block or change website network requests",
  storage: "Store extension preferences",
  unlimitedStorage: "Store extension data without the usual quota",
  privacy: "Change browser privacy settings",
  cookies: "Read and change website cookies",
  history: "Read and change browsing history",
  downloads: "Manage downloads",
  bookmarks: "Read and change bookmarks",
  clipboardRead: "Read the clipboard",
  clipboardWrite: "Write to the clipboard",
  notifications: "Show notifications",
  menus: "Add page menu commands",
  alarms: "Schedule extension background tasks",
  dns: "Look up domain addresses",
  none: "No data collection declared",
  browsingActivity: "Browsing activity",
  searchTerms: "Search terms",
  websiteContent: "Website content",
  locationInfo: "Location information",
  technicalAndInteraction: "Technical and interaction data",
  personalInfo: "Personal information",
  authenticationInfo: "Authentication information",
  financialAndPaymentInfo: "Financial and payment information",
  healthInfo: "Health information",
  personalCommunications: "Personal communications",
} as const satisfies Record<string, string>;
const koreanPermissionLabels: Record<keyof typeof permissionLabels, string> = {
  tabs: "열린 탭과 주소 읽기", activeTab: "확장을 사용한 뒤 현재 탭 접근", webNavigation: "페이지 이동 관찰",
  webRequest: "웹사이트 네트워크 요청 읽기", webRequestBlocking: "웹사이트 네트워크 요청 차단 또는 변경",
  storage: "확장 설정 저장", unlimitedStorage: "일반 할당량을 넘겨 확장 데이터 저장",
  privacy: "브라우저 개인정보 설정 변경", cookies: "웹사이트 쿠키 읽기 및 변경",
  history: "탐색 기록 읽기 및 변경", downloads: "다운로드 관리", bookmarks: "북마크 읽기 및 변경",
  clipboardRead: "클립보드 읽기", clipboardWrite: "클립보드에 쓰기", notifications: "알림 표시",
  menus: "페이지 메뉴 명령 추가", alarms: "확장 백그라운드 작업 예약", dns: "도메인 주소 조회",
  none: "데이터 수집 선언 없음", browsingActivity: "탐색 활동", searchTerms: "검색어",
  websiteContent: "웹사이트 콘텐츠", locationInfo: "위치 정보",
  technicalAndInteraction: "기술·상호작용 데이터", personalInfo: "개인정보",
  authenticationInfo: "인증 정보", financialAndPaymentInfo: "금융·결제 정보",
  healthInfo: "건강 정보", personalCommunications: "개인 간 통신",
};
export const extensionPermissionLabel = (permission: string, language: AppLanguage = "en"): string =>
  (language === "ko" ? koreanPermissionLabels : permissionLabels)[permission as keyof typeof permissionLabels] ?? permission;
export const extensionOriginLabel = (origin: string, language: AppLanguage = "en"): string =>
  origin === "<all_urls>" || origin === "*://*/*"
    ? translate(language, "extension.allWebsites")
    : origin === "http://*/*"
    ? translate(language, "extension.allHttp")
    : origin === "https://*/*"
    ? translate(language, "extension.allHttps")
    : origin;

export function privateExtensionScope(
  extension: InstalledBrowserExtension,
  language: AppLanguage = "en"
): string {
  const websites = [
    ...new Set(
      [...extension.origins, ...extension.optionalOrigins].map((origin) => extensionOriginLabel(origin, language))
    ),
  ];
  const permissions = [
    ...new Set(
      [...extension.permissions, ...extension.optionalPermissions].map((permission) => extensionPermissionLabel(permission, language))
    ),
  ];
  const data = [
    ...new Set(
      [...extension.dataPermissions, ...extension.optionalDataPermissions].map((permission) => extensionPermissionLabel(permission, language))
    ),
  ];
  const summarize = (values: string[]) =>
    values.slice(0, 4).join("; ") +
    (values.length > 4
      ? translate(language, "extension.privateScopeMore", { count: values.length - 4 })
      : "");
  return [
    translate(language, "extension.privateScopeIntro"),
    websites.length
      ? translate(language, "extension.privateScopeWebsites", { items: summarize(websites) })
      : translate(language, "extension.privateScopeNoWebsites"),
    permissions.length ? translate(language, "extension.privateScopeCapabilities", { items: summarize(permissions) }) : "",
    data.length ? translate(language, "extension.privateScopeData", { items: summarize(data) }) : "",
    translate(language, "extension.privateScopeAfter"),
  ]
    .filter(Boolean)
    .join("\n\n");
}
