import React, { memo, useCallback, useState } from "react";
import {
  Pressable,
  FlatList,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { Favicon } from "./Favicon";
import { josaRo } from "../i18n";
import { ActionMenu, type MenuAnchor, type MenuItem } from "./ActionMenu";
import { ChromeIcon } from "../chrome/ChromeIcon";
import type { HistoryEntry } from "../history";
import {
  PERMISSION_KINDS,
  validateBoostDrafts,
  type PermissionKind,
} from "../uiPreferences";
import { font, radius, size, space, type Theme } from "../theme";
import { useTheme } from "../themeContext";
import { permissionSupportsOnce } from "../permissionRequests";
import { useI18n } from "../i18nContext";

const makeStyles = (t: Theme) => ({
  overlay: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: t.scrim,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  dialog: {
    width: "92%" as const,
    maxWidth: 520,
    maxHeight: "80%" as const,
    padding: space.xxxl,
    backgroundColor: t.surfaceElevated,
    borderRadius: radius.dialog,
    gap: space.lg,
    shadowColor: t.ringShadow,
    shadowOpacity: 0.24,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  title: { color: t.ink, fontSize: font.title, fontWeight: "700" as const },
  closeIcon: { color: t.icon, fontSize: font.icon },
  closeButton: {
    width: 48,
    height: 48,
    borderRadius: radius.control,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  row: {
    minHeight: size.bookmarkRow,
    paddingHorizontal: space.xxl,
    borderRadius: radius.field,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: space.xl,
    backgroundColor: t.sunken,
  },
  rowActive: { backgroundColor: t.sunkenStrong },
  rowTitle: {
    color: t.ink,
    fontSize: 14,
    fontWeight: "600" as const,
  },
  rowMeta: { color: t.inkMuted, fontSize: 13, lineHeight: 19, marginTop: 2 },
  section: {
    marginTop: space.lg,
    color: t.inkFaint,
    fontSize: font.micro,
    fontWeight: "800" as const,
    letterSpacing: 0.9,
  },
  spaceDot: { width: 14, height: 14, borderRadius: 7 },
  input: {
    minHeight: size.input,
    paddingHorizontal: space.xxl,
    borderRadius: radius.field,
    color: t.ink,
    backgroundColor: t.sunken,
    fontSize: font.input,
  },
  inputMultiline: {
    minHeight: 84,
    padding: space.xl,
    borderRadius: radius.field,
    color: t.ink,
    backgroundColor: t.sunken,
    fontSize: font.body,
    textAlignVertical: "top" as const,
  },
  boostForm: { gap: space.md },
  emptyState: { color: t.inkFaint, fontSize: font.body, padding: space.lg },
  historyList: { maxHeight: 420 },
  historyRow: {
    minHeight: size.bookmarkRow,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: space.xl,
    paddingLeft: space.xl,
    paddingRight: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: t.hairline,
  },
  grow: { flex: 1 },
  permissionScroll: { flexGrow: 0 },
  permissionContent: { gap: 16 },
  permissionOrigin: { color: t.ink, fontSize: 16, lineHeight: 24, fontWeight: "600" as const },
  permissionSite: { padding: 16, borderRadius: radius.card, backgroundColor: t.sunken, gap: 8 },
  permissionDescription: { color: t.inkMuted, fontSize: 14, lineHeight: 21 },
  permissionActions: { gap: 8 },
  permissionButton: { minHeight: 48, padding: 14, borderRadius: radius.field, justifyContent: "center" as const, alignItems: "center" as const, borderWidth: 1, borderColor: t.hairline },
  permissionPrimary: { backgroundColor: t.ink, borderColor: t.ink },
  permissionPrimaryText: { color: t.surfaceElevated, fontSize: 15, lineHeight: 22, fontWeight: "600" as const },
  permissionButtonText: { color: t.ink, fontSize: 15, lineHeight: 22, fontWeight: "600" as const },
  permissionPressed: { opacity: 0.65 },
});
const cache = new WeakMap<Theme, ReturnType<typeof makeStyles>>();
const useStyles = () => {
  const t = useTheme();
  let styles = cache.get(t);
  if (!styles) {
    styles = makeStyles(t);
    cache.set(t, styles);
  }
  return { t, styles };
};

// Shared dialog scaffold: the caller supplies the full title node (so it can
// override font size or truncation) plus optional actions before the close ×.
function DialogHeader({
  title,
  closeLabel,
  onClose,
  children,
}: {
  title: React.ReactNode;
  closeLabel: string;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const { styles } = useStyles();
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {title}
      {children}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        hitSlop={8}
        style={styles.closeButton}
        onPress={onClose}
      >
        <ChromeIcon name="close" color={styles.closeIcon.color} size={16} />
      </Pressable>
    </View>
  );
}

export function SpaceSwitcherDialog({
  workspaces,
  activeWorkspaceId,
  counts,
  onSwitch,
  onCreate,
  onClose,
}: {
  workspaces: { id: string; name: string; color?: string }[];
  activeWorkspaceId: string;
  counts: Record<string, number>;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const { t, styles } = useStyles();
  const { tr } = useI18n();
  return (
    <>
      <View style={styles.dialog}>
        <DialogHeader
          title={<Text style={[styles.title, { flex: 1 }]}>{tr("dialog.spaces")}</Text>}
          closeLabel={tr("dialog.closeSpaces")}
          onClose={onClose}
        />
        {workspaces.map((workspace) => (
          <Pressable
            key={workspace.id}
            accessibilityRole="button"
            accessibilityLabel={
              tr("dialog.switchSpace", {
                name: workspace.name,
                ro: josaRo(workspace.name),
              })
            }
            style={[
              styles.row,
              workspace.id === activeWorkspaceId && styles.rowActive,
            ]}
            onPress={() => onSwitch(workspace.id)}
          >
            <View
              style={[
                styles.spaceDot,
                { backgroundColor: workspace.color || t.accent },
              ]}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{workspace.name}</Text>
            </View>
            <Text style={styles.rowMeta}>{counts[workspace.id] ?? 0}</Text>
            {workspace.id === activeWorkspaceId && (
              <ChromeIcon name="check" size={16} color={t.accentStrong} />
            )}
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("dialog.newSpace")}
          style={styles.row}
          onPress={onCreate}
        >
          <Text style={styles.rowTitle}>＋ {tr("dialog.newSpace")}</Text>
        </Pressable>
      </View>
    </>
  );
}

export interface TabMenuTab {
  id: string;
  title: string;
  workspaceId: string;
  favorite: boolean;
  pinned: boolean;
}

export function TabContextMenuDialog({
  tab,
  workspaces,
  onToggleFavorite,
  onTogglePin,
  onDuplicate,
  onMoveToWorkspace,
  onCloseOthers,
  onClose,
  anchor,
  onCloseTab,
  onSplit,
  onReset,
  onCopyLink,
  onEdit,
  onOpenInNewWindow,
}: {
  tab: TabMenuTab | null;
  workspaces: { id: string; name: string }[];
  /** Absent for tabs that can never take a saved role (private browsing). */
  onToggleFavorite?: () => void;
  onTogglePin?: () => void;
  onDuplicate: () => void;
  onMoveToWorkspace: (id: string) => void;
  onCloseOthers: () => void;
  onClose: () => void;
  anchor?: MenuAnchor;
  onCloseTab?: () => void;
  onSplit?: () => void;
  onReset?: () => void;
  onCopyLink?: () => void;
  /** Absent for private tabs and the focused pane. */
  onOpenInNewWindow?: () => void;
  onEdit?: () => void;
}) {
  const { tr } = useI18n();
  if (!tab) return null;
  const items: MenuItem[] = [];
  if (onCopyLink)
    items.push({
      id: "copy",
      label: tr("chrome.copyLink"),
      icon: "link",
      onPress: onCopyLink,
      shortcut: "⌘⇧C",
    });
  if (onEdit)
    items.push({
      id: "edit",
      label: tr("chrome.editSaved"),
      icon: "edit",
      onPress: onEdit,
    });
  if (onReset && (tab.favorite || tab.pinned))
    items.push({
      id: "reset",
      label: tr("chrome.savedPage"),
      icon: "reload",
      onPress: onReset,
    });
  if (onSplit)
    items.push({
      id: "split",
      label: tr("chrome.openSplit"),
      icon: "split",
      onPress: onSplit,
    });
  items.push({
    id: "duplicate",
    label: tr("chrome.duplicateTab"),
    icon: "copy",
    onPress: onDuplicate,
  });
  if (onOpenInNewWindow)
    items.push({
      id: "window",
      label: tr("window.open"),
      icon: "external",
      onPress: onOpenInNewWindow,
    });
  if (onToggleFavorite)
    items.push({
      id: "favorite",
      label: tr(tab.favorite ? "dialog.removeFavorite" : "dialog.moveFavorite"),
      icon: "star",
      onPress: onToggleFavorite,
    });
  if (onTogglePin)
    items.push({
      id: "pin",
      label: tr(tab.pinned ? "chrome.removePin" : "dialog.pinTab"),
      icon: "pin",
      onPress: onTogglePin,
      shortcut: "⌘D",
    });
  for (const workspace of workspaces) {
    if (workspace.id === tab.workspaceId) continue;
    items.push({
      id: `move-${workspace.id}`,
      label: tr("dialog.moveSpace", {
        name: workspace.name,
        ro: josaRo(workspace.name),
      }),
      icon: "space",
      onPress: () => onMoveToWorkspace(workspace.id),
    });
  }
  items.push({
    id: "close-others",
    label: tr("dialog.closeOtherTabs"),
    icon: "closeOthers",
    onPress: onCloseOthers,
  });
  if (onCloseTab)
    items.push({
      id: "close",
      label: tr("chrome.closeTab"),
      icon: "close",
      onPress: onCloseTab,
      shortcut: "⌘W",
    });
  return (
    <ActionMenu
      title={tab.title}
      anchor={anchor}
      items={items}
      onClose={onClose}
    />
  );
}

const historyKey = (entry: HistoryEntry) => `${entry.at}:${entry.url}`;
const HistoryRow = memo(function HistoryRow({
  entry,
  onOpen,
}: {
  entry: HistoryEntry;
  onOpen: (url: string) => void;
}) {
  const { styles } = useStyles();
  const { tr } = useI18n();
  const open = useCallback(() => onOpen(entry.url), [entry.url, onOpen]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr("dialog.openHistoryEntry", { title: entry.title })}
      style={styles.historyRow}
      onPress={open}
    >
      <Favicon
        url={entry.url}
        fallback={(entry.title || entry.url).slice(0, 1).toUpperCase()}
        size={16}
        radius={4}
      />
      <View style={styles.grow}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {entry.title || entry.url}
        </Text>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {entry.url}
        </Text>
      </View>
      <Text style={styles.rowMeta}>
        {new Date(entry.at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </Text>
    </Pressable>
  );
});

export function HistoryDialog({
  entries,
  onOpen,
  onClear,
  onClose,
}: {
  entries: HistoryEntry[];
  onOpen: (url: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { styles } = useStyles();
  const { tr } = useI18n();
  const open = useCallback(
    (url: string) => {
      onClose();
      onOpen(url);
    },
    [onClose, onOpen]
  );
  const renderEntry = useCallback(
    ({ item }: ListRenderItemInfo<HistoryEntry>) => (
      <HistoryRow entry={item} onOpen={open} />
    ),
    [open]
  );
  return (
    <>
      <View style={[styles.dialog, { maxWidth: 560 }]}>
        <DialogHeader
          title={<Text style={[styles.title, { flex: 1 }]}>{tr("dialog.history")}</Text>}
          closeLabel={tr("dialog.closeHistory")}
          onClose={onClose}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr("dialog.clearHistory")}
            style={[styles.row, { minHeight: 34 }]}
            onPress={onClear}
          >
            <Text style={styles.rowTitle}>{tr("common.clear")}</Text>
          </Pressable>
        </DialogHeader>
        <FlatList
          style={styles.historyList}
          data={entries}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          windowSize={5}
          maxToRenderPerBatch={12}
          keyExtractor={historyKey}
          ListEmptyComponent={
            <Text style={styles.emptyState}>{tr("dialog.noHistory")}</Text>
          }
          renderItem={renderEntry}
        />
      </View>
    </>
  );
}

export interface BoostDraft {
  host: string;
  css: string;
  enabled: boolean;
}

export function BoostsDialog({
  boosts,
  onSave,
  onClose,
}: {
  boosts: BoostDraft[];
  onSave: (boosts: BoostDraft[]) => void;
  onClose: () => void;
}) {
  const { t, styles } = useStyles();
  const { tr } = useI18n();
  const [draft, setDraft] = useState<BoostDraft[]>(boosts);
  const validation = validateBoostDrafts(draft);
  const hostError = (index: number) => {
    const code = validation.errors[index]?.hostCode;
    if (code === "duplicate") return tr("dialog.boostDuplicate", { host: validation.boosts[index].host.replace(/^www\./, "") });
    if (code === "invalid") return tr("dialog.boostHostInvalid");
    return tr("dialog.boostHostRequired");
  };
  const update = (index: number, patch: Partial<BoostDraft>) =>
    setDraft((current) =>
      current.map((boost, i) => (i === index ? { ...boost, ...patch } : boost))
    );
  return (
    <>
      <View style={[styles.dialog, { maxWidth: 600 }]}>
        <DialogHeader
          title={<Text style={[styles.title, { flex: 1 }]}>{tr("dialog.siteBoosts")}</Text>}
          closeLabel={tr("dialog.closeBoosts")}
          onClose={onClose}
        />
        <Text style={styles.rowMeta}>
          {tr("dialog.boostHelp")}
        </Text>
        <ScrollView style={{ maxHeight: 420 }}>
          {draft.map((boost, index) => (
            <View key={index} style={styles.boostForm}>
              <View style={{ flexDirection: "row", gap: space.md }}>
                <TextInput
                  accessibilityLabel={tr("dialog.boostHost", { number: index + 1 })}
                  value={boost.host}
                  onChangeText={(host) => update(index, { host })}
                  placeholder="example.com"
                  placeholderTextColor={t.inkFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.input, { flex: 1 }]}
                  disableFullscreenUI
                />
                <Switch
                  accessibilityLabel={tr("dialog.boostEnabled", { number: index + 1 })}
                  value={boost.enabled}
                  onValueChange={(enabled) => update(index, { enabled })}
                  trackColor={{ false: t.switchOff, true: t.accent }}
                  thumbColor={t.surfaceElevated}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={tr("dialog.removeBoost", { number: index + 1 })}
                  style={styles.closeButton}
                  onPress={() =>
                    setDraft((current) => current.filter((_, i) => i !== index))
                  }
                >
                  <ChromeIcon
                    name="close"
                    color={styles.closeIcon.color}
                    size={16}
                  />
                </Pressable>
              </View>
              {!!validation.errors[index]?.host && <Text accessibilityRole="alert" style={[styles.rowMeta, { color: t.errorInk }]}>{hostError(index)}</Text>}
              {!validation.errors[index]?.host && <Text style={styles.rowMeta}>{tr("dialog.boostHostValue", { host: validation.boosts[index].host })}</Text>}
              <TextInput
                accessibilityLabel={tr("dialog.boostCss", { number: index + 1 })}
                value={boost.css}
                onChangeText={(css) => update(index, { css })}
                placeholder={"body { background: #222; }"}
                placeholderTextColor={t.inkFaint}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.inputMultiline}
                disableFullscreenUI
              />
              {!!validation.errors[index]?.css && <Text accessibilityRole="alert" style={[styles.rowMeta, { color: t.errorInk }]}>{tr("dialog.boostCssRequired")}</Text>}
            </View>
          ))}
          {draft.length === 0 && (
            <Text style={styles.emptyState}>
              {tr("dialog.noBoosts")}
            </Text>
          )}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("dialog.addBoost")}
          style={styles.row}
          onPress={() =>
            setDraft((current) => [
              ...current,
              { host: "", css: "", enabled: true },
            ])
          }
        >
          <Text style={styles.rowTitle}>＋ {tr("dialog.addBoost")}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("dialog.saveBoosts")}
          accessibilityState={{ disabled: !validation.valid }}
          disabled={!validation.valid}
          style={[styles.row, !validation.valid && { opacity: 0.5 }]}
          onPress={() => { if (validation.valid) onSave(validation.boosts); }}
        >
          <Text style={styles.rowTitle}>{tr("dialog.saveBoosts")}</Text>
        </Pressable>
      </View>
    </>
  );
}

export interface PermissionRequestInfo {
  ephemeral?: boolean;
  origin: string;
  kinds: string[];
}

// Gecko remembers content grants. Only camera/microphone callbacks support
// one-request permission; saved media rules can still grant later requests.
export function PermissionDialog({
  request,
  onDecide,
  onDismiss,
}: {
  request: PermissionRequestInfo;
  onDecide: (choice: "once" | "always" | "block") => void;
  onDismiss: () => void;
}) {
  const { styles } = useStyles();
  const { tr } = useI18n();
  const persistentStorage = request.kinds.includes("persistent-storage");
  const oneTimePermission = permissionSupportsOnce(request.kinds);
  const privateMedia = !!request.ephemeral && oneTimePermission;
  const allowLabel = tr(persistentStorage ? "permission.allowStorage" : privateMedia ? "permission.allowOnce" : request.ephemeral ? "permission.allowPrivate" : "permission.allowSite");
  const blockLabel = tr(request.ephemeral ? privateMedia ? "permission.denyOnce" : "permission.blockPrivate" : "permission.blockSite");
  const kinds = request.kinds.map((kind) =>
    (PERMISSION_KINDS as string[]).includes(kind)
      ? tr(`consent.kind.${kind as PermissionKind}`)
      : kind
  ).join(tr("permission.and")) || tr("permission.capability");
  return <View style={[styles.dialog, { maxWidth: 460 }]} accessibilityViewIsModal>
    <DialogHeader title={<Text style={[styles.title, { flex: 1 }]}>{tr("permission.title")}</Text>}
      closeLabel={tr("permission.dismiss")} onClose={onDismiss} />
    <ScrollView style={styles.permissionScroll} contentContainerStyle={styles.permissionContent} keyboardShouldPersistTaps="handled">
      <View style={styles.permissionSite}>
        <Text selectable style={styles.permissionOrigin}>{request.origin}</Text>
        <Text style={styles.permissionDescription}>{tr("permission.wants", { kinds })}</Text>
      </View>
      <Text style={styles.permissionDescription}>
        {tr(persistentStorage ? "permission.storageWarning" : privateMedia ? "permission.onceHelp" : request.ephemeral ? "permission.privateScope" : "permission.savedScope")}
      </Text>
      <View style={styles.permissionActions}>
        <Pressable accessibilityRole="button" accessibilityLabel={allowLabel}
          style={({ pressed }) => [styles.permissionButton, styles.permissionPrimary, pressed && styles.permissionPressed]}
          onPress={() => onDecide(privateMedia ? "once" : "always")}>
          <Text style={styles.permissionPrimaryText}>{allowLabel}</Text>
        </Pressable>
        {!request.ephemeral && oneTimePermission && <Pressable accessibilityRole="button" accessibilityLabel={tr("permission.allowOnce")}
          style={({ pressed }) => [styles.permissionButton, pressed && styles.permissionPressed]}
          onPress={() => onDecide("once")}>
          <Text style={styles.permissionButtonText}>{tr("permission.allowOnce")}</Text>
        </Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel={blockLabel}
          style={({ pressed }) => [styles.permissionButton, pressed && styles.permissionPressed]}
          onPress={() => onDecide("block")}>
          <Text style={styles.permissionButtonText}>{blockLabel}</Text>
        </Pressable>
      </View>
      <Text style={styles.permissionDescription}>{tr("permission.dismissHelp")}</Text>
    </ScrollView>
  </View>;
}
