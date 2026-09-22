import { NativeModules } from "react-native";
export interface BrowserRuntime {
  getDeviceLanguage?(): Promise<string>;
  setAppLanguage?(language: "system" | "ko" | "en"): void;
  goHome(): Promise<void>;
  exitContentFullscreen(id: string): void;
  prepareColdSpaceTransition?(
    previousTabId: string,
    nextTabId: string,
    nextUrl: string
  ): Promise<void>;
  prepareSpaceTransition?(
    previousTabId: string | null,
    nextTabId: string | null
  ): Promise<void>;
  prepareTabTransition?(
    previousTabId: string | null,
    nextTabId: string | null,
    nextVisibleTabIdsJson: string | null
  ): Promise<void>;
  configureExternalPictureInPicture?(
    enabled: boolean,
    visibleTabIdsJson: string,
    blocked: boolean
  ): void;
  getExternalPictureInPictureState?(): Promise<string>;
  acknowledgeExternalPictureInPictureReturn?(token: number): void;
  getPictureInPictureState?(): Promise<string>;
  configurePictureInPicture?(
    enabled: boolean,
    tabId: string | null,
    blocked: boolean
  ): void;
  enterPictureInPicture?(): Promise<string>;
  openPictureInPictureSettings?(): Promise<void>;
  addListener?(name: string): void;
  removeListeners?(count: number): void;
  initializeBrowserTools(): Promise<string>;
  configureBrowserTools(json: string): Promise<void>;
  getBrowserDiagnostics(): Promise<string>;
  clearBrowserData(
    host: string | null,
    category: "cookies" | "storage" | "cache" | "all-site-data"
  ): Promise<void>;
  releaseInactiveTabs(): Promise<string>;
  retryTab(tabId: string): Promise<void>;
  pendingExternalLinks(): Promise<string>;
  pendingShortcutCommands?(): Promise<string>;
  openInNewWindow?(tabId: string | null): Promise<void>;
  bindWindowTab?(tabId: string): Promise<void>;
  closeWindowForTab?(tabId: string): Promise<boolean>;
  closeWindow?(): Promise<void>;
  windowTabs?(): Promise<string>;
  windowMission?(): Promise<string>;
  acknowledgeExternalLink(id: string): Promise<void>;
  rejectExternalLink(id: string): Promise<void>;
  getDefaultBrowserStatus(): Promise<string>;
  requestDefaultBrowser(): Promise<string>;
  setAppearance?(
    colorMode: string,
    resolvedMode: string,
    chromeColor: string
  ): Promise<void>;
  getDownloadHistoryStatus(): Promise<string>;
  recoverDownloadHistory(): Promise<string>;
  listDownloads(): Promise<string>;
  cancelDownload(id: string): Promise<boolean>;
  openDownload(id: string): Promise<void>;
  shareUrl(url: string): Promise<void>;
  consumeContentContext(
    requestId: string,
    target: "link" | "image"
  ): Promise<string>;
  configureKeys(json: string): void;
  setAddressInputActive?(enabled: boolean): void;
  setChromeModalActive?(enabled: boolean): void;
  reconcileTabs(tabs: { id: string; private: boolean }[]): void;
  setTabMetadataCount?(count: number): void;
  loadTabUrl?(id: string, url: string): void;
  resolveNewSession?(
    requestId: number,
    tabId: string,
    isPrivate: boolean
  ): Promise<void>;
  cancelNewSession?(requestId: number): void;
  refreshMedia(): void;
  pauseMedia(id: string): void;
  setFullscreen(enabled: boolean): void;
  findInPage(tabId: string, text: string, backward: boolean): void;
  findClose(tabId: string): void;
  zoom(tabId: string, direction: "in" | "out" | "reset"): void;
  copyToClipboard(text: string): void;
  haptic(kind: "tick" | "click"): void;
  setBoosts(json: string): void;
  setSitePermissionRules(json: string): void;
  resolvePermission(requestId: number, allow: boolean, rememberDenial: boolean): void;
  captureRendering(tabId: string): void;
  requestAndroidPermission(
    kind: "geolocation" | "notifications" | "camera" | "microphone"
  ): Promise<boolean>;
  readFavicon(host: string): Promise<string | null>;
  saveFavicon(host: string, data: string): Promise<void>;
  clearFavicon(host: string): void;
  readHistory(): Promise<string | null>;
  saveHistory(json: string): Promise<void>;
  getAndroidPermissionStatus?(): Promise<string>;
  openAndroidPermissionSettings?(): Promise<void>;
  resetSitePermission?(
    origin: string | null,
    kind: import("./uiPreferences").PermissionKind | null
  ): Promise<void>;
  readSitePermissions(): Promise<string | null>;
  saveSitePermissions(json: string): Promise<void>;
  readUiPreferences(): Promise<string | null>;
  saveUiPreferences(json: string): Promise<void>;
  readSnapshot(): Promise<string | null>;
  saveSnapshot(json: string): Promise<void>;
  readLastGoodSnapshot(): Promise<string | null>;
  quarantineSnapshot(json: string): Promise<void>;
}
export const platform = NativeModules.BrowserRuntime as BrowserRuntime;
