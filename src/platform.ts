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
  windowMissionFor?(windowId: string): Promise<string>;
  bindWindowTabFor?(windowId: string, tabId: string): Promise<void>;
  closeWindowFor?(windowId: string): Promise<void>;
  closeWindowForTab?(tabId: string): Promise<boolean>;
  closeWindow?(): Promise<void>;
  windowTabs?(): Promise<string>;
  getInputViewport?(scope: string): Promise<string>;
  windowMission?(): Promise<string>;
  configureWindowPermissionPrompt?(tabId: string, enabled: boolean): void;
  minimizeToCaller?(): Promise<boolean>;
  setWindowTranslucent?(translucent: boolean): Promise<boolean>;
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
  /** Saves a link/image URL outside page navigation (content-menu download).
   *  The promise resolves when the download is *initiated* — for private tabs
   *  that is before the save confirmation dialog is answered; transfer
   *  failures surface later via the download list and notification events. */
  downloadUrl(tabId: string, url: string): Promise<void>;
  configureKeys(json: string): void;
  setAddressInputActive?(enabled: boolean): void;
  ensureAddressImeSession?(): void;
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
  setReaderMode?(tabId: string, enabled: boolean): Promise<boolean>;
  configureReaderStyle?(json: string): void;
  copyToClipboard(text: string): void;
  haptic(kind: "tick" | "click"): void;
  setBoosts(json: string): void;
  setSitePermissionRules(json: string): void;
  resolvePermission(requestId: number, allow: boolean, rememberDenial: boolean): void;
  captureRendering(tabId: string): void;
  /** Renders the tab to a PDF file and resolves with its absolute path. */
  capturePagePdf?(tabId: string): Promise<string>;
  /** Opens the Android share sheet for a captured PDF file path. */
  sharePagePdf?(path: string): Promise<void>;
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
    kind: import("@/uiPreferences").PermissionKind | null
  ): Promise<void>;
  readSitePermissions(): Promise<string | null>;
  saveSitePermissions(json: string): Promise<void>;
  readUiPreferences(): Promise<string | null>;
  saveUiPreferences(json: string): Promise<void>;
  readSnapshot(): Promise<string | null>;
  saveSnapshot(json: string): Promise<void>;
  readLastGoodSnapshot(): Promise<string | null>;
  quarantineSnapshot(json: string): Promise<void>;
  /** Firefox Sync (receive-only). httpRequest takes a JSON string
   *  {method:"GET"|"POST", url, headers?, body?} and resolves with a JSON
   *  string {status, headers (lowercased), body}; runs on Gecko's network
   *  stack with no cookie/cache reuse. All optional: absent on non-Android
   *  hosts so sync simply reports "unavailable". */
  httpRequest?(requestJson: string): Promise<string>;
  readSyncSecrets?(): Promise<string | null>;
  saveSyncSecrets?(json: string): Promise<void>;
  clearSyncSecrets?(): Promise<void>;
  readSyncTree?(): Promise<string | null>;
  saveSyncTree?(json: string): Promise<void>;
  clearSyncTree?(): Promise<void>;
  /** Outbound sync bookkeeping channel (guid mappings, dirty log, last
   *  received cleartexts) — same plaintext-file contract as the tree
   *  channel: load returns null when absent/corrupt, clear wipes it. */
  loadOutbound?(): Promise<string | null>;
  saveOutbound?(json: string): Promise<void>;
  clearOutbound?(): Promise<void>;
  /** URL-safe unpadded base64 of `count` secure-random bytes (max 1024). */
  secureRandomB64?(count: number): Promise<string>;
  /** Arms/disarms interception of the FxA webchannel redirect URN; a captured
   *  code+state pair arrives as a "BrowserSyncLoginCode" device event. When
   *  armed with a tabId, only that tab's navigation is intercepted. */
  setSyncLoginCapture?(enabled: boolean, tabId?: string | null): void;
}
export const platform = NativeModules.BrowserRuntime as BrowserRuntime;
