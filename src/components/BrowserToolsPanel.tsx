import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, DeviceEventEmitter, FlatList, Modal, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { platform } from "../platform";
import { useTheme } from "../themeContext";
import { useReducedMotion } from "../chrome/useReducedMotion";
import { updateSitePreference, type BrowserToolsConfig, type BrowserToolsUpdate, type TrackingProtection } from "../browserWorkflows";
import type { BrowserSecurity } from "../hooks/useBrowserWorkflows";
import type { Theme } from "../theme";

interface Download {
  id: string; filename: string; mimeType: string; state: string; bytes: number;
  totalBytes?: number; uri?: string; error?: string; createdAt: number; updatedAt: number;
}
const bytesLabel = (bytes: number) => bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
const makeStyles = (t: Theme) => StyleSheet.create({
  section: { marginTop: 16, marginBottom: 6, fontSize: 12, fontWeight: "700", color: t.inkMuted },
  row: { minHeight: 44, paddingVertical: 9, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.inkFaint },
  horizontal: { flexDirection: "row", alignItems: "center", gap: 12 },
  text: { fontSize: 13, color: t.ink },
  detail: { fontSize: 12, color: t.inkMuted, lineHeight: 18 },
  grow: { flex: 1, minWidth: 0 },
  action: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 8, backgroundColor: t.surfaceElevated },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  selected: { borderWidth: 1, borderColor: t.accent },
  disabled: { opacity: 0.5 },
  overlay: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: t.scrim, padding: 20 },
  dialog: { width: "100%", maxWidth: 640, height: "80%", borderRadius: 18, backgroundColor: t.surfaceElevated, padding: 18 },
  title: { fontSize: 18, fontWeight: "700", color: t.ink },
});

export function BrowserToolsPanel({ config, onSave, tabId, url, security, privateTab = false, onError, onNotice }: {
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
  const reducedMotion = useReducedMotion();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [defaultBrowser, setDefaultBrowser] = useState<boolean | null>(null);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [downloadError, setDownloadError] = useState("");
  const [resourceSummary, setResourceSummary] = useState("");
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
    let live = true;
    const refresh = () => {
      void platform.getDefaultBrowserStatus().then((json) => {
        if (live) setDefaultBrowser(JSON.parse(json).held === true);
      }).catch((error) => { if (live) onError(String(error)); });
    };
    refresh();
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") refresh(); });
    return () => { live = false; subscription.remove(); };
  }, [onError]);
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
          const records: Download[] = JSON.parse(await platform.listDownloads());
          if (live) { setDownloads(records); setDownloadError(""); }
        }
      } catch (error) { if (live) setDownloadError(String(error)); }
      finally { running = false; }
    };
    const subscription = DeviceEventEmitter.addListener("BrowserDownloadsChanged", () => { void refresh(); });
    void refresh();
    return () => { live = false; subscription.remove(); };
  }, [downloadsOpen]);

  const setSite = (patch: { desktop?: boolean; trackingProtection?: boolean | null; keepAlive?: boolean }) => {
    if (!config || !currentOrigin || privateTab) return;
    const update = updateSitePreference(currentOrigin, patch);
    perform(async () => {
      await onSave(update);
      onNotice("Site settings saved. Reload the page to apply them.");
    });
  };
  const clear = (target: string | null) => Alert.alert(
    target ? `Clear ${target}?` : "Clear all website data?",
    "Cookies, website storage and cached files will be removed. All open pages will stop, and unsaved page content may be lost. Saved tabs and bookmarks stay. You may need to sign in again.",
    [{ text: "Cancel", style: "cancel" }, { text: "Clear website data", style: "destructive", onPress: () => perform(async () => {
      await platform.clearBrowserData(target, "all-site-data");
      onNotice("Website data clearing finished. Reload a page when you are ready.");
    }) }],
  );
  const action = (label: string, onPress: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label === "−" ? "Decrease website text size" : label === "＋" ? "Increase website text size" : label} accessibilityState={{ disabled: disabled || busy }} disabled={disabled || busy} onPress={onPress} style={[s.action, (disabled || busy) && s.disabled]}>
      <Text style={s.text}>{label}</Text>
    </Pressable>
  );
  const chooseDefaultBrowser = () => perform(async () => {
    const result = JSON.parse(await platform.requestDefaultBrowser());
    setDefaultBrowser(result.held === true);
  });
  // perform is a serialized event helper, not a React state setter (independently reviewed).
  // eslint-disable-next-line react-doctor/no-impure-state-updater
  const inspectMemoryProtection = () => perform(async () => {
    const value = JSON.parse(await platform.getBrowserDiagnostics());
    setResourceSummary(`${value.metadataTabs} tabs; ${value.liveSessions} live pages; ${value.attachedSurfaces} attached views; ${value.suspendedSessions} released or paused. ${Object.entries(value.protectionReasonCounts ?? {}).map(([reason, count]) => `${reason}: ${count}`).join("; ")}`);
  });
  return <>
    <Text style={s.section}>BROWSING</Text>
    {action(defaultBrowser ? "Default browser on this device" : "Set as default browser", chooseDefaultBrowser, defaultBrowser === true)}
    <View style={s.row}>
      <View style={s.horizontal}>
        <View style={s.grow}><Text style={s.text}>Restore pages after restart</Text><Text style={s.detail}>Keeps navigation, scroll position and form state on this device.</Text></View>
        <Switch accessibilityLabel="Restore pages after restart" disabled={!config || busy} value={config?.restoreSessions ?? false} onValueChange={(enabled) => {
          if (!config) return;
          const save = () => perform(() => onSave((current) => ({ ...current, restoreSessions: enabled })));
          if (enabled) Alert.alert("Remember page state?", "Saved page state can include text entered in forms. It stays in this app's private storage. Turning this off removes saved page state.", [{ text: "Cancel", style: "cancel" }, { text: "Remember pages", onPress: save }]);
          else save();
        }} />
      </View>
    </View>
    <View style={[s.row, s.horizontal]}>
      <View style={s.grow}><Text style={s.text}>Text size on all websites</Text><Text style={s.detail}>{Math.round((config?.textScale ?? 1) * 100)}%</Text></View>
      {action("−", () => config && perform(() => onSave((current) => ({ ...current, textScale: Math.max(0.5, Math.round((current.textScale - 0.1) * 10) / 10) }))), !config || config.textScale <= 0.5)}
      {action("＋", () => config && perform(() => onSave((current) => ({ ...current, textScale: Math.min(2, Math.round((current.textScale + 0.1) * 10) / 10) }))), !config || config.textScale >= 2)}
    </View>
    <Text style={s.section}>THIS WEBSITE</Text>
    <Text selectable style={s.detail}>{origin ?? "Open a website to view its settings."}</Text>
    {privateTab && <Text style={s.detail}>Private site settings are temporary. Persistent site preferences and normal-profile data clearing are unavailable here.</Text>}
    {!!origin && !privateTab && <>
      <View style={s.row}>
        <Text style={s.text}>{origin.startsWith("http:") ? "Connection is not encrypted" : security?.origin === origin && security.known !== false ? security.secure && !security.exception && !security.mixedActive ? "Encrypted connection" : "Connection needs attention" : "Connection information is loading"}</Text>
        {!!security?.issuer && security.origin === origin && <Text style={s.detail}>Certificate: {security.issuer}</Text>}
      </View>
      <View style={[s.row, s.horizontal]}><Text style={[s.text, s.grow]}>Desktop website</Text><Switch accessibilityLabel="Desktop website for this site" disabled={!config || busy} value={site?.desktop ?? true} onValueChange={(desktop) => setSite({ desktop })} /></View>
      {action("Reload this page", () => tabId && perform(() => platform.retryTab(tabId)), !tabId)}
      {action("Clear this website's data", () => clear(host), !host)}
    </>}
    <Text style={s.section}>PRIVACY</Text>
    <Text style={s.detail}>Standard is on for new installs. Tracking protection can prevent some website features from working.</Text>
    <View style={s.choices}>{(["engine-default", "standard", "strict"] as TrackingProtection[]).map((protection) => <Pressable key={protection} accessibilityRole="radio" accessibilityState={{ checked: config?.trackingProtection === protection, disabled: !config || busy }} disabled={!config || busy} onPress={() => config && perform(() => onSave((current) => ({ ...current, trackingProtection: protection })))} style={[s.action, config?.trackingProtection === protection && s.selected]}><Text style={s.text}>{protection === "engine-default" ? "Off (engine default)" : protection === "standard" ? "Standard" : "Strict"}</Text></Pressable>)}</View>
    {!!origin && !privateTab && <View style={s.row}><Text style={s.text}>Protection for this website</Text><View style={s.choices}>{([null, true, false] as const).map((value) => <Pressable key={String(value)} accessibilityRole="radio" accessibilityState={{ checked: (site?.trackingProtection ?? null) === value, disabled: !config || busy }} disabled={!config || busy} style={[s.action, (site?.trackingProtection ?? null) === value && s.selected]} onPress={() => setSite({ trackingProtection: value })}><Text style={s.text}>{value === null ? "Use global" : value ? "On" : "Off"}</Text></Pressable>)}</View></View>}
    {!privateTab && action("Clear all website data", () => clear(null))}
    <Text style={s.section}>TABS & DOWNLOADS</Text>
    <View style={[s.row, s.horizontal]}><Text style={[s.text, s.grow]}>Automatic memory saving</Text><Switch accessibilityLabel="Automatic memory saving" disabled={!config || busy} value={config?.automaticMemorySaving ?? false} onValueChange={(automaticMemorySaving) => perform(() => onSave((current) => ({ ...current, automaticMemorySaving })))} /></View>
    <Text style={s.detail}>Off by default. Memory pressure only triggers a safety check. Pages with unknown unsaved state stay open.</Text>
    {!!origin && !privateTab && <View style={[s.row, s.horizontal]}><Text style={[s.text, s.grow]}>Always keep this site in memory</Text><Switch accessibilityLabel="Keep this site in memory" disabled={!config || busy} value={site?.keepAlive ?? false} onValueChange={(keepAlive) => setSite({ keepAlive })} /></View>}
    {(config?.sites.filter((entry) => entry.keepAlive) ?? []).map((entry) => <View key={entry.origin} style={s.row}><Text style={s.detail}>Keep alive: {entry.origin}</Text>{action("Remove keep-alive exception", () => perform(() => onSave(updateSitePreference(entry.origin, { keepAlive: false }))))}</View>)}
    {action("Inspect memory protection", inspectMemoryProtection)}
    {!!resourceSummary && <Text style={s.detail}>{resourceSummary}</Text>}
    <Text style={s.detail}>Current page-state detection cannot prove that a page has no unsaved changes. Those pages are protected even during manual release.</Text>
    {action("Release inactive pages", () => Alert.alert("Release inactive pages?", "Only pages with verified safe restoration can be released. Unknown page state, private tabs, media, input, uploads and busy pages are protected. Current pages may all remain protected.", [{ text: "Cancel", style: "cancel" }, { text: "Release pages", onPress: () => perform(async () => {
      const result = JSON.parse(await platform.releaseInactiveTabs());
      onNotice(`${result.released} pages released; ${result.protected} protected; ${result.failed} could not be released. ${Object.entries(result.reasons ?? {}).map(([reason, count]) => `${reason}: ${count}`).join("; ")}`);
    }) }]))}
    {action("Downloads", () => setDownloadsOpen(true))}
    <Modal transparent animationType={reducedMotion ? "none" : "fade"} visible={downloadsOpen} onRequestClose={() => setDownloadsOpen(false)}>
      <View style={s.overlay}><View style={s.dialog} accessibilityViewIsModal>
        <View style={[s.horizontal, { marginBottom: 12 }]}><Text accessibilityRole="header" style={[s.title, s.grow]}>Downloads</Text>{action("Close downloads", () => setDownloadsOpen(false))}</View>
        {!!downloadError && <Text accessibilityRole="alert" style={s.detail}>{downloadError}</Text>}
        <FlatList data={downloads} keyExtractor={(item) => item.id} initialNumToRender={10} windowSize={5} ListEmptyComponent={<Text style={s.detail}>No downloads yet.</Text>} renderItem={({ item }) => <View style={s.row}>
          <Text numberOfLines={2} style={s.text}>{item.filename}</Text>
          <Text style={s.detail}>{item.state} · {bytesLabel(item.bytes)}{item.totalBytes ? ` / ${bytesLabel(item.totalBytes)}` : ""}</Text>
          {!!item.error && <Text style={s.detail}>{item.error}</Text>}
          {(item.state === "failed" || item.state === "interrupted") && <Text style={s.detail}>Return to the website to download again.</Text>}
          <View style={s.choices}>{item.state === "completed" && action("Open file", () => perform(() => platform.openDownload(item.id)))}{["queued", "running"].includes(item.state) && action("Cancel download", () => perform(() => platform.cancelDownload(item.id)))}</View>
        </View>} />
      </View></View>
    </Modal>
  </>;
}
