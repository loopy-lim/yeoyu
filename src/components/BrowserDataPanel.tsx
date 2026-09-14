import React, { useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import type { BrowserController } from "../BrowserController";
import type { WorkArchivePreview } from "../../generated/types";
import type { UiPreferences } from "../uiPreferences";
import { portableFiles } from "../portableFiles";
import { bookmarkHtmlToArchive, bookmarksToHtml, checkArchiveSize, parsePresentation, portablePresentation, type PortablePresentation } from "../workArchive";
import { useTheme } from "../themeContext";

type Preview = { json: string; counts: WorkArchivePreview; presentation: PortablePresentation | null; shortcuts: string[]; spaces: string[] };
export function BrowserDataPanel({ controller, ui, hydrated, onPresentation, onError, onNotice }: {
  controller: BrowserController; ui: UiPreferences; hydrated: boolean;
  onPresentation(value: PortablePresentation): Promise<void>;
  onError(message: string): void; onNotice(message: string): void;
}) {
  const t = useTheme();
  const s = useMemo(() => StyleSheet.create({
    section: { marginTop: 20, marginBottom: 6, fontSize: 12, fontWeight: "700", color: t.inkMuted },
    detail: { fontSize: 12, color: t.inkMuted, lineHeight: 18 },
    text: { fontSize: 13, color: t.ink },
    action: { minHeight: 48, justifyContent: "center", padding: 12, borderRadius: 8, backgroundColor: t.surfaceElevated },
    actions: { gap: 8, marginVertical: 8 },
    preview: { borderWidth: 1, borderColor: t.inkFaint, borderRadius: 8, padding: 12, gap: 8 },
    row: { flexDirection: "row", gap: 12, alignItems: "center" },
    grow: { flex: 1, minWidth: 0 },
    disabled: { opacity: 0.5 },
  }), [t]);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [favorites, setFavorites] = useState(true);
  const [keymap, setKeymap] = useState(false);
  const [presentation, setPresentation] = useState(false);
  const perform = (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    void action().catch((error) => onError(error instanceof Error ? error.message : "The file operation could not be completed.")).finally(() => { lock.current = false; setBusy(false); });
  };
  const button = (label: string, onPress: () => void, unavailable = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: busy || !hydrated || unavailable }} disabled={busy || !hydrated || unavailable} style={[s.action, (busy || !hydrated || unavailable) && s.disabled]} onPress={onPress}><Text style={s.text}>{label}</Text></Pressable>;
  const exportFile = (html: boolean) => Alert.alert(
    html ? "Export bookmarks?" : "Export your work?",
    "This readable file contains website addresses and titles. Choose a destination you trust. Private tabs, passwords, cookies and page form state are excluded.",
    [{ text: "Cancel", style: "cancel" }, { text: "Choose destination", onPress: () => perform(async () => {
      if (!portableFiles) throw new Error("Rebuild the browser to use portable files.");
      const archive = await controller.exportArchive(html ? null : portablePresentation(ui));
      const result = await portableFiles.chooseExport(html ? bookmarksToHtml(archive) : archive, html);
      if (result) onNotice(html ? "Bookmarks exported." : "Work archive exported.");
    }) }],
  );
  const chooseImport = () => perform(async () => {
    if (!portableFiles) throw new Error("Rebuild the browser to use portable files.");
    const contents = await portableFiles.chooseImport();
    if (contents === null) return;
    setPreview(null);
    const raw = contents.replace(/^\uFEFF/, "").trim();
    checkArchiveSize(raw);
    const json = raw.startsWith("{") ? raw : bookmarkHtmlToArchive(raw);
    const counts = await controller.previewArchive(json);
    let parsedPresentation: PortablePresentation | null;
    try { parsedPresentation = parsePresentation(counts.presentation ?? null); }
    catch { throw new Error("The archive contains unsupported appearance settings. Existing data has been kept."); }
    const archive = JSON.parse(json);
    const shortcuts = (archive.keyBindings as {key: string; meta:boolean; ctrl:boolean; alt:boolean; shift:boolean; command:string}[]).map((k) => [k.meta && "Meta", k.ctrl && "Ctrl", k.alt && "Alt", k.shift && "Shift", k.key].filter(Boolean).join("+") + " → " + k.command);
    setPreview({ json, counts, presentation: parsedPresentation, shortcuts, spaces: archive.spaces.map((v: {name:string}) => v.name) });
    setFavorites(true); setKeymap(false); setPresentation(false);
  });
  const applyImport = () => {
    if (!preview) return;
    const selected = preview;
    Alert.alert("Add imported data?", "New Spaces will be added. Existing tabs and bookmarks are kept. Duplicate addresses are kept as separate entries." + (keymap ? " Your current keyboard shortcuts will be replaced." : "") + (presentation ? " Appearance settings will be applied separately after the data is saved." : ""), [
      { text: "Cancel", style: "cancel" },
      { text: "Import", onPress: () => perform(async () => {
        await controller.importArchive(selected.json, favorites, keymap);
        // Clear the preview once data is committed; a failed appearance write
        // must never invite retrying the entire append and duplicating Spaces.
        setPreview(null);
        if (presentation && selected.presentation) {
          try { await onPresentation(selected.presentation); }
          catch { throw new Error("Your data was imported. Appearance settings could not be saved; current appearance was kept."); }
        }
        onNotice("Imported data was added in new Spaces.");
      }) },
    ]);
  };
  return <>
    <Text style={s.section}>YOUR DATA</Text>
    <Text style={s.detail}>Export bookmarks or a work archive of ordinary Spaces, tabs, pins, Favorites and shortcuts. Login sessions and unfinished forms are not included.</Text>
    <View style={s.actions}>
      {button("Export bookmarks as HTML", () => exportFile(true))}
      {button("Export work archive", () => exportFile(false))}
      {button("Import bookmarks or work archive", chooseImport)}
    </View>
    {preview && <View style={s.preview}>
      <Text accessibilityRole="header" style={s.text}>Import preview</Text>
      <Text style={s.detail}>{preview.counts.spaces} Spaces · {preview.counts.tabs} tabs · {preview.counts.bookmarks} bookmarks · {preview.counts.folders} folders</Text>
      <Text style={s.detail}>{preview.counts.duplicateUrls} repeated addresses. Nothing is overwritten.</Text>
      <Text style={s.detail}>{preview.spaces.slice(0, 20).join(", ")}{preview.spaces.length > 20 ? ` and ${preview.spaces.length - 20} more` : ""}</Text>
      {preview.counts.favorites > 0 && <View style={s.row}><Text style={[s.text, s.grow]}>Add {preview.counts.favorites} Favorites to the global collection</Text><Switch accessibilityLabel="Add imported Favorites" disabled={busy} value={favorites} onValueChange={setFavorites} /></View>}
      {preview.counts.hasKeyBindings && <>
        <View style={s.row}><Text style={[s.text, s.grow]}>Replace keyboard shortcuts</Text><Switch accessibilityLabel="Replace keyboard shortcuts" disabled={busy} value={keymap} onValueChange={setKeymap} /></View>
        {keymap && <Text style={s.detail}>{preview.shortcuts.slice(0, 30).join("\n")}{preview.shortcuts.length > 30 ? `\n${preview.shortcuts.length - 30} more shortcuts` : ""}</Text>}
      </>}
      {preview.presentation && <>
        <View style={s.row}><Text style={[s.text, s.grow]}>Apply imported appearance</Text><Switch accessibilityLabel="Apply imported appearance" disabled={busy} value={presentation} onValueChange={setPresentation} /></View>
        {presentation && <Text style={s.detail}>Appearance: {ui.appearance} → {preview.presentation.appearance}{"\n"}Sidebar width: {ui.sidebarWidth} → {preview.presentation.sidebarWidth}{"\n"}Sidebar: {preview.presentation.sidebarCollapsed ? "collapsed" : "expanded"}{"\n"}Frame: left {preview.presentation.framePx.left}, right {preview.presentation.framePx.right}, top {preview.presentation.framePx.top}, bottom {preview.presentation.framePx.bottom} px</Text>}
      </>}
      {button("Add imported data", applyImport)}
      {button("Cancel import", () => setPreview(null))}
    </View>}
  </>;
}
