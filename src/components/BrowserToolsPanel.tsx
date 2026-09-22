import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, DeviceEventEmitter, FlatList, Modal, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { platform } from "../platform";
import { useTheme } from "../themeContext";
import { useI18n } from "../i18nContext";
import { useReducedMotion } from "../chrome/useReducedMotion";
import { resetSitePreferences, updateSitePreference, type BrowserToolsConfig, type BrowserToolsUpdate, type TrackingProtection } from "../browserWorkflows";
import type { BrowserSecurity } from "../hooks/useBrowserWorkflows";
import type { Theme } from "../theme";
import { parseDownloadHistoryStatus, type DownloadHistoryStatus } from "../downloadHistory";
import { HapticSwitch } from "../chrome/HapticSwitch";

interface Download {
  id: string; filename: string; mimeType: string; state: string; bytes: number;
  totalBytes?: number; uri?: string; error?: string; createdAt: number; updatedAt: number;
}
const bytesLabel = (bytes: number) => bytes < 1024 ? `${Math.max(0, Math.round(bytes))} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const DOWNLOAD_STATES = { queued: "tools.state.queued", running: "tools.state.running", completed: "tools.state.completed",
  failed: "tools.state.failed", interrupted: "tools.state.interrupted", cancelled: "tools.state.cancelled" } as const;
const makeStyles = (t: Theme) => StyleSheet.create({
  section: { marginTop: 16, marginBottom: 6, fontSize: 12, fontWeight: "700", color: t.inkMuted },
  row: { minHeight: 48, paddingVertical: 9, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.inkFaint },
  horizontal: { flexDirection: "row", alignItems: "center", gap: 12 },
  text: { fontSize: 15, color: t.ink, lineHeight: 21 },
  detail: { fontSize: 14, color: t.inkMuted, lineHeight: 21 },
  grow: { flex: 1, minWidth: 0 },
  action: { minHeight: 48, justifyContent: "center", paddingHorizontal: 12, borderRadius: 8, backgroundColor: t.surfaceElevated },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  selected: { borderWidth: 1, borderColor: t.accent },
  disabled: { opacity: 0.5 },
  overlay: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: t.scrim, padding: 20 },
  dialog: { width: "100%", maxWidth: 640, height: "80%", borderRadius: 18, backgroundColor: t.surfaceElevated, padding: 18 },
  title: { fontSize: 18, fontWeight: "700", color: t.ink },
  search: { minHeight: 48, marginVertical: 10, paddingHorizontal: 12, borderRadius: 8, backgroundColor: t.sunken, color: t.ink, fontSize: 16 },
});

export type BrowserToolsSection = "browsing" | "website" | "privacy" | "memory" | "downloads";

export function BrowserToolsPanel({ section, config, onSave, tabId, url, security, privateTab = false, onError, onNotice }: {
  section?: BrowserToolsSection;
  config: BrowserToolsConfig | null;
  onSave(update: BrowserToolsUpdate): Promise<void>;
  privateTab?: boolean;
  tabId?: string;
  url?: string;
  security?: BrowserSecurity;
  onError(message: string): void;
  onNotice(message: string): void;
}) {
  const theme = useTheme();
  const { tr } = useI18n();
  const downloadStateLabel = (state: string) => state in DOWNLOAD_STATES
    ? tr(DOWNLOAD_STATES[state as keyof typeof DOWNLOAD_STATES]) : state;
  const reducedMotion = useReducedMotion();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [defaultBrowser, setDefaultBrowser] = useState<boolean | null>(null);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [downloadError, setDownloadError] = useState("");
  const [downloadHistory, setDownloadHistory] = useState<DownloadHistoryStatus | null>(null);
  const [downloadRefresh, setDownloadRefresh] = useState(0);
  const [resourceSummary, setResourceSummary] = useState("");
  const [sitePreferencesOpen, setSitePreferencesOpen] = useState(false);
  const [siteQuery, setSiteQuery] = useState("");
  const filteredSites = useMemo(() => {
    const query = siteQuery.trim().toLowerCase();
    return (config?.sites ?? []).filter((entry) => entry.origin.toLowerCase().includes(query))
      .slice().sort((a, b) => a.origin.localeCompare(b.origin));
  }, [config?.sites, siteQuery]);
  let origin: string | null = null, host: string | null = null;
  try {
    const parsed = new URL(url ?? "");
    if (["http:", "https:"].includes(parsed.protocol)) { origin = parsed.origin; host = parsed.hostname; }
  } catch { /* Blank tabs have no website settings. */ }
  const currentOrigin = origin;
  const site = config?.sites.find((entry) => entry.origin === currentOrigin);

  const perform = (operation: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    void operation().catch((error) => onError(String(error))).finally(() => { busyRef.current = false; setBusy(false); });
  };
  useEffect(() => {
    if (section && section !== "browsing") return;
    let live = true;
    const refresh = () => {
      void platform.getDefaultBrowserStatus().then((json) => {
        if (live) setDefaultBrowser(JSON.parse(json).held === true);
      }).catch((error) => { if (live) onError(String(error)); });
    };
    refresh();
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") refresh(); });
    return () => { live = false; subscription.remove(); };
  }, [onError, section]);
  useEffect(() => {
    if (!downloadsOpen) return;
    let live = true, running = false, dirty = false;
    const refresh = async () => {
      dirty = true;
      if (running) return;
      running = true;
      try {
        while (dirty && live) {
          dirty = false;
          const [recordsJson, statusJson] = await Promise.all([platform.listDownloads(), platform.getDownloadHistoryStatus()]);
          const records: Download[] = JSON.parse(recordsJson);
          const status = parseDownloadHistoryStatus(statusJson);
          if (live) { setDownloads(records); setDownloadHistory(status); setDownloadError(""); }
        }
      } catch (error) { if (live) setDownloadError(String(error)); }
      finally { running = false; }
    };
    const subscription = DeviceEventEmitter.addListener("BrowserDownloadsChanged", () => { void refresh(); });
    void refresh();
    return () => { live = false; subscription.remove(); };
  }, [downloadsOpen, downloadRefresh]);

  const recoverDownloadHistory = () => {
    if (!downloadHistory?.canReset) return;
    // perform invokes one user task; it is not a React state updater.
    // eslint-disable-next-line react-doctor/no-impure-state-updater
    const recover = () => perform(async () => {
      const status = parseDownloadHistoryStatus(await platform.recoverDownloadHistory());
      setDownloadHistory(status);
      if (status.state === "ready") onNotice(status.message || tr("tools.downloadReady"));
      else onError(status.message);
      setDownloadRefresh((value) => value + 1);
    });
    Alert.alert(tr("tools.recoverTitle"), tr("tools.recoverWarning"),
      [{ text: tr("common.cancel"), style: "cancel" }, { text: tr("tools.recover"), style: "destructive", onPress: recover }]);
  };

  const setSite = (patch: { desktop?: boolean; trackingProtection?: boolean | null; keepAlive?: boolean }) => {
    if (!config || !currentOrigin || privateTab) return;
    const update = updateSitePreference(currentOrigin, patch);
    perform(async () => {
      await onSave(update);
      onNotice(tr("tools.siteSaved"));
    });
  };
  const resetSites = (target?: string) => {
    if (!config || privateTab) return;
    perform(async () => {
      await onSave(resetSitePreferences(target));
      onNotice(tr(target ? "tools.siteReset" : "tools.allSitesReset"));
    });
  };
  const clear = (target: string | null) => Alert.alert(
    target ? tr("tools.clearTitle", { site: target }) : tr("tools.clearAllTitle"),
    tr("tools.clearWarning"),
    [{ text: tr("common.cancel"), style: "cancel" }, { text: tr("tools.clear"), style: "destructive", onPress: () => perform(async () => {
      await platform.clearBrowserData(target, "all-site-data");
      onNotice(tr("tools.cleared"));
    }) }],
  );
  const action = (label: string, onPress: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label === "−" ? tr("tools.decreaseText") : label === "＋" ? tr("tools.increaseText") : label} accessibilityState={{ disabled: disabled || busy }} disabled={disabled || busy} onPress={onPress} style={[s.action, (disabled || busy) && s.disabled]}>
      <Text style={s.text}>{label}</Text>
    </Pressable>
  );
  // perform invokes one user task; it is not a React state updater.
  // eslint-disable-next-line react-doctor/no-impure-state-updater
  const chooseDefaultBrowser = () => perform(async () => {
    const result = JSON.parse(await platform.requestDefaultBrowser());
    setDefaultBrowser(result.held === true);
  });
  // perform is a serialized event helper, not a React state setter (independently reviewed).
  // eslint-disable-next-line react-doctor/no-impure-state-updater
  const inspectMemoryProtection = () => perform(async () => {
    const value = JSON.parse(await platform.getBrowserDiagnostics());
    setResourceSummary(tr("tools.memorySummary", { tabs: value.metadataTabs, live: value.liveSessions,
      views: value.attachedSurfaces, suspended: value.suspendedSessions,
      reasons: Object.entries(value.protectionReasonCounts ?? {}).map(([reason, count]) => `${reason}: ${count}`).join("; ") }));
  });
  const show = (value: BrowserToolsSection) => !section || section === value;
  const switchColors = { trackColor: { false: theme.switchOff, true: theme.accent }, thumbColor: theme.surfaceElevated };
  return <>
    {show("browsing") && <>
    <Text style={s.section}>{tr("tools.browsing")}</Text>
    {action(tr(defaultBrowser ? "tools.defaultHeld" : "tools.setDefault"), chooseDefaultBrowser, defaultBrowser === true)}
    <View style={s.row}>
      <View style={s.horizontal}>
        <View style={s.grow}><Text style={s.text}>{tr("tools.restorePages")}</Text><Text style={s.detail}>{tr("tools.restoreHelp")}</Text></View>
        <HapticSwitch {...switchColors} accessibilityLabel={tr("tools.restorePages")} disabled={!config || busy} value={config?.restoreSessions ?? true} onValueChange={(enabled) => {
          if (!config) return;
          const save = () => perform(() => onSave((current) => ({ ...current, restoreSessions: enabled })));
          if (enabled) Alert.alert(tr("tools.rememberTitle"), tr("tools.rememberWarning"), [{ text: tr("common.cancel"), style: "cancel" }, { text: tr("tools.remember"), onPress: save }]);
          else save();
        }} />
      </View>
    </View>
    <View style={[s.row, s.horizontal]}>
      <View style={s.grow}><Text style={s.text}>{tr("tools.textSize")}</Text><Text style={s.detail}>{tr("tools.textSizeHelp", { percent: Math.round((config?.textScale ?? 1) * 100) })}</Text></View>
      {action("−", () => config && perform(() => onSave((current) => ({ ...current, textScale: Math.max(0.5, Math.round((current.textScale - 0.1) * 10) / 10) }))), !config || config.textScale <= 0.5)}
      {action("＋", () => config && perform(() => onSave((current) => ({ ...current, textScale: Math.min(2, Math.round((current.textScale + 0.1) * 10) / 10) }))), !config || config.textScale >= 2)}
    </View>
    {action(tr("tools.resetText"), () => perform(() => onSave((current) => ({ ...current, textScale: 1 }))), !config || config.textScale === 1)}
    </>}
    {show("website") && <>
    <Text style={s.section}>{tr("tools.website")}</Text>
    <Text selectable style={s.detail}>{origin ?? tr("tools.openSite")}</Text>
    {privateTab && <Text style={s.detail}>{tr("tools.privateSite")}</Text>}
    {!!origin && <>
      <View style={s.row}>
        <Text style={s.text}>{tr(origin.startsWith("http:") ? "tools.insecure" : security?.origin === origin && security.known !== false ? security.secure && !security.exception && !security.mixedActive ? "tools.secure" : "tools.attention" : "tools.securityLoading")}</Text>
        {!!security?.issuer && security.origin === origin && <Text style={s.detail}>{tr("tools.certificate", { issuer: security.issuer })}</Text>}
      </View>
    </>}
    {!!origin && !privateTab && <>
      <View style={[s.row, s.horizontal]}><View style={s.grow}><Text style={s.text}>{tr("tools.desktop")}</Text><Text style={s.detail}>{tr("tools.desktopHelp")}</Text></View><HapticSwitch {...switchColors} accessibilityLabel={tr("tools.desktopLabel")} disabled={!config || busy} value={site?.desktop ?? true} onValueChange={(desktop) => setSite({ desktop })} /></View>
      <Text style={s.detail}>{tr("tools.originHelp")}</Text>
      {action(tr("tools.resetSite"), () => resetSites(currentOrigin ?? undefined), !site)}
      {action(tr("tools.reload"), () => tabId && perform(() => platform.retryTab(tabId)), !tabId)}
      {action(tr("tools.clearSite"), () => clear(host), !host)}
    </>}
    {!privateTab && <>
      <Text style={s.section}>{tr("tools.allSites")}</Text>
      <Text style={s.detail}>{tr("tools.allSitesHelp")}</Text>
      {action(tr("tools.manageSites", { count: config?.sites.length ?? 0 }), () => { setSiteQuery(""); setSitePreferencesOpen(true); }, !config)}
    </>}
    </>}
    {show("privacy") && <>
    <Text style={s.section}>{tr("tools.privacy")}</Text>
    <Text style={s.detail}>{tr("tools.privacyHelp")}</Text>
    <View style={s.choices}>{(["engine-default", "standard", "strict"] as TrackingProtection[]).map((protection) => <Pressable key={protection} accessibilityRole="radio" accessibilityState={{ checked: config?.trackingProtection === protection, disabled: !config || busy }} disabled={!config || busy} onPress={() => config && perform(() => onSave((current) => ({ ...current, trackingProtection: protection })))} style={[s.action, config?.trackingProtection === protection && s.selected]}><Text style={s.text}>{tr(protection === "engine-default" ? "tools.protectionOff" : protection === "standard" ? "tools.protectionStandard" : "tools.protectionStrict")}</Text></Pressable>)}</View>
    {!!origin && !privateTab && <View style={s.row}><Text style={s.text}>{tr("tools.siteProtection")}</Text><View style={s.choices}>{([null, true, false] as const).map((value) => <Pressable key={String(value)} accessibilityRole="radio" accessibilityState={{ checked: (site?.trackingProtection ?? null) === value, disabled: !config || busy }} disabled={!config || busy} style={[s.action, (site?.trackingProtection ?? null) === value && s.selected]} onPress={() => setSite({ trackingProtection: value })}><Text style={s.text}>{tr(value === null ? "tools.useGlobal" : value ? "common.on" : "common.off")}</Text></Pressable>)}</View></View>}
    {!privateTab && action(tr("tools.clearAllAction"), () => clear(null))}
    </>}
    {show("memory") && <>
    <Text style={s.section}>{tr("tools.memory")}</Text>
    <View style={[s.row, s.horizontal]}><Text style={[s.text, s.grow]}>{tr("tools.autoMemory")}</Text><HapticSwitch {...switchColors} accessibilityLabel={tr("tools.autoMemory")} disabled={!config || busy} value={config?.automaticMemorySaving ?? false} onValueChange={(automaticMemorySaving) => perform(() => onSave((current) => ({ ...current, automaticMemorySaving })))} /></View>
    <Text style={s.detail}>{tr("tools.autoMemoryHelp")}</Text>
    {!!origin && !privateTab && <View style={[s.row, s.horizontal]}><Text style={[s.text, s.grow]}>{tr("tools.keepSite")}</Text><HapticSwitch {...switchColors} accessibilityLabel={tr("tools.keepSiteLabel")} disabled={!config || busy} value={site?.keepAlive ?? false} onValueChange={(keepAlive) => setSite({ keepAlive })} /></View>}
    {!privateTab && (config?.sites.filter((entry) => entry.keepAlive) ?? []).map((entry) => <View key={entry.origin} style={s.row}><Text style={s.detail}>{tr("tools.keepAlive", { site: entry.origin })}</Text>{action(tr("tools.removeKeepAlive"), () => perform(() => onSave(updateSitePreference(entry.origin, { keepAlive: false }))))}</View>)}
    {action(tr("tools.inspectMemory"), inspectMemoryProtection)}
    {!!resourceSummary && <Text style={s.detail}>{resourceSummary}</Text>}
    <Text style={s.detail}>{tr("tools.memoryWarning")}</Text>
    {action(tr("tools.release"), () => Alert.alert(tr("tools.releaseTitle"), tr("tools.releaseWarning"), [{ text: tr("common.cancel"), style: "cancel" }, { text: tr("tools.releaseConfirm"), onPress: () => perform(async () => {
      const result = JSON.parse(await platform.releaseInactiveTabs());
      onNotice(tr("tools.releaseResult", { released: result.released, protected: result.protected, failed: result.failed,
        reasons: Object.entries(result.reasons ?? {}).map(([reason, count]) => `${reason}: ${count}`).join("; ") }));
    }) }]))}
    </>}
    {show("downloads") && action(tr("tools.downloads"), () => setDownloadsOpen(true))}
    <Modal transparent animationType={reducedMotion ? "none" : "fade"} visible={sitePreferencesOpen && !privateTab} onRequestClose={() => setSitePreferencesOpen(false)}>
      <View style={s.overlay}><View style={s.dialog} accessibilityViewIsModal>
        <View style={[s.horizontal, { marginBottom: 12 }]}><Text accessibilityRole="header" style={[s.title, s.grow]}>{tr("tools.sitePreferences")}</Text>{action(tr("tools.closeSites"), () => setSitePreferencesOpen(false))}</View>
        <Text style={s.detail}>{tr("tools.siteDefaults")}</Text>
        <TextInput accessibilityLabel={tr("tools.searchSites")} placeholder={tr("tools.searchAddress")} placeholderTextColor={theme.inkMuted} value={siteQuery} onChangeText={setSiteQuery} autoCapitalize="none" autoCorrect={false} style={s.search} disableFullscreenUI />
        {action(tr("tools.resetAllSites"), () => resetSites(), !config?.sites.length)}
        <FlatList data={filteredSites} keyExtractor={(item) => item.origin} initialNumToRender={10} windowSize={5} keyboardShouldPersistTaps="handled" ListEmptyComponent={<Text style={[s.detail, { marginTop: 16 }]}>{tr(siteQuery.trim() ? "tools.noMatchingSites" : "tools.allDefaults")}</Text>} renderItem={({ item }) => <View style={s.row}>
          <Text selectable style={s.text}>{item.origin}</Text>
          {!item.desktop && <Text style={s.detail}>{tr("tools.mobile")}</Text>}
          {item.trackingProtection !== null && <Text style={s.detail}>{tr("tools.protectionStatus", { status: tr(item.trackingProtection ? "common.on" : "common.off") })}</Text>}
          {!!item.keepAlive && <Text style={s.detail}>{tr("tools.keepMemory")}</Text>}
          {action(tr("tools.resetOrigin", { origin: item.origin }), () => resetSites(item.origin))}
        </View>} />
      </View></View>
    </Modal>
    <Modal transparent animationType={reducedMotion ? "none" : "fade"} visible={downloadsOpen} onRequestClose={() => setDownloadsOpen(false)}>
      <View style={s.overlay}><View style={s.dialog} accessibilityViewIsModal>
        <View style={[s.horizontal, { marginBottom: 12 }]}><Text accessibilityRole="header" style={[s.title, s.grow]}>{tr("tools.downloads")}</Text>{action(tr("tools.closeDownloads"), () => setDownloadsOpen(false))}</View>
        {!!downloadError && <Text accessibilityRole="alert" style={s.detail}>{downloadError}</Text>}
        {!!downloadHistory?.message && <Text accessibilityRole={downloadHistory.state === "ready" ? undefined : "alert"} style={s.detail}>{downloadHistory.message}</Text>}
        {(!!downloadError || downloadHistory?.state !== "ready") && <View style={s.choices}>
          {action(tr("tools.retryHistory"), () => setDownloadRefresh((value) => value + 1))}
          {!!downloadHistory?.canReset && action(tr("tools.recover"), recoverDownloadHistory)}
        </View>}
        <FlatList data={downloads} keyExtractor={(item) => item.id} initialNumToRender={10} windowSize={5} ListEmptyComponent={<Text style={s.detail}>{tr(downloadError || (downloadHistory && downloadHistory.state !== "ready") ? "tools.historyUnavailable" : downloadHistory ? "tools.noDownloads" : "tools.loadingHistory")}</Text>} renderItem={({ item }) => <View style={s.row}>
          <Text numberOfLines={2} style={s.text}>{item.filename}</Text>
          <Text style={s.detail}>{downloadStateLabel(item.state)} · {bytesLabel(item.bytes)}{item.totalBytes ? ` / ${bytesLabel(item.totalBytes)}` : ""}</Text>
          {!!item.error && <Text style={s.detail}>{item.error}</Text>}
          {(item.state === "failed" || item.state === "interrupted") && <Text style={s.detail}>{tr("tools.downloadAgain")}</Text>}
          <View style={s.choices}>{item.state === "completed" && action(tr("tools.openFile"), () => perform(() => platform.openDownload(item.id)))}{["queued", "running"].includes(item.state) && action(tr("tools.cancelDownload"), () => perform(() => platform.cancelDownload(item.id)))}</View>
        </View>} />
      </View></View>
    </Modal>
  </>;
}
