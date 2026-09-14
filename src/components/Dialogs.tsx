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
import { ActionMenu, type MenuAnchor, type MenuItem } from "./ActionMenu";
import { ChromeIcon } from "../chrome/ChromeIcon";
import type { HistoryEntry } from "../history";
import {
  PERMISSION_KINDS,
  PERMISSION_LABELS,
  type PermissionKind,
} from "../uiPreferences";
import { font, radius, size, space, type Theme } from "../theme";
import { useTheme } from "../themeContext";

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
    width: 32,
    height: 32,
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
    fontSize: font.bodyPlus,
    fontWeight: "700" as const,
  },
  rowMeta: { color: t.inkFaint, fontSize: font.micro, marginTop: 1 },
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
  return (
    <>
      <View style={styles.dialog}>
        <DialogHeader
          title={<Text style={[styles.title, { flex: 1 }]}>Spaces</Text>}
          closeLabel="Close spaces"
          onClose={onClose}
        />
        {workspaces.map((workspace) => (
          <Pressable
            key={workspace.id}
            accessibilityRole="button"
            accessibilityLabel={`Switch to ${workspace.name}`}
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
              <Text style={{ color: t.accentStrong, fontSize: font.bodyPlus }}>
                ✓
              </Text>
            )}
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New space"
          style={styles.row}
          onPress={onCreate}
        >
          <Text style={styles.rowTitle}>＋ New space</Text>
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
  onEdit?: () => void;
}) {
  if (!tab) return null;
  const items: MenuItem[] = [];
  if (onCopyLink)
    items.push({
      id: "copy",
      label: "Copy link",
      icon: "copy",
      onPress: onCopyLink,
      shortcut: "⌘⇧C",
    });
  if (onEdit)
    items.push({
      id: "edit",
      label: "Edit saved page",
      icon: "edit",
      onPress: onEdit,
    });
  if (onReset && (tab.favorite || tab.pinned))
    items.push({
      id: "reset",
      label: "Back to saved page",
      icon: "reload",
      onPress: onReset,
    });
  if (onSplit)
    items.push({
      id: "split",
      label: "Open in Split View",
      icon: "split",
      onPress: onSplit,
    });
  items.push({
    id: "duplicate",
    label: "Duplicate",
    icon: "copy",
    onPress: onDuplicate,
  });
  if (onToggleFavorite)
    items.push({
      id: "favorite",
      label: tab.favorite ? "Remove from Favorites" : "Move to Favorites",
      icon: "star",
      onPress: onToggleFavorite,
    });
  if (onTogglePin)
    items.push({
      id: "pin",
      label: tab.pinned ? "Remove pin" : "Pin to this Space",
      icon: "pin",
      onPress: onTogglePin,
      shortcut: "⌘D",
    });
  for (const workspace of workspaces) {
    if (workspace.id === tab.workspaceId) continue;
    items.push({
      id: `move-${workspace.id}`,
      label: `Move to ${workspace.name}`,
      icon: "space",
      onPress: () => onMoveToWorkspace(workspace.id),
    });
  }
  items.push({
    id: "close-others",
    label: "Close other tabs",
    icon: "close",
    onPress: onCloseOthers,
  });
  if (onCloseTab)
    items.push({
      id: "close",
      label: "Close tab",
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
  const open = useCallback(() => onOpen(entry.url), [entry.url, onOpen]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${entry.title}`}
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
          title={<Text style={[styles.title, { flex: 1 }]}>History</Text>}
          closeLabel="Close history"
          onClose={onClose}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear history"
            style={[styles.row, { minHeight: 34 }]}
            onPress={onClear}
          >
            <Text style={styles.rowTitle}>Clear</Text>
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
            <Text style={styles.emptyState}>No history yet.</Text>
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
  const [draft, setDraft] = useState<BoostDraft[]>(boosts);
  const update = (index: number, patch: Partial<BoostDraft>) =>
    setDraft((current) =>
      current.map((boost, i) => (i === index ? { ...boost, ...patch } : boost))
    );
  return (
    <>
      <View style={[styles.dialog, { maxWidth: 600 }]}>
        <DialogHeader
          title={<Text style={[styles.title, { flex: 1 }]}>Site boosts</Text>}
          closeLabel="Close site boosts"
          onClose={onClose}
        />
        <Text style={styles.rowMeta}>
          CSS is injected into matching sites on every load. Hosts are bare
          names like example.com.
        </Text>
        <ScrollView style={{ maxHeight: 420 }}>
          {draft.map((boost, index) => (
            <View key={index} style={styles.boostForm}>
              <View style={{ flexDirection: "row", gap: space.md }}>
                <TextInput
                  accessibilityLabel={`Boost ${index} host`}
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
                  accessibilityLabel={`Boost ${index} enabled`}
                  value={boost.enabled}
                  onValueChange={(enabled) => update(index, { enabled })}
                  trackColor={{ false: t.switchOff, true: t.accent }}
                  thumbColor={t.surfaceElevated}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove boost ${index}`}
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
              <TextInput
                accessibilityLabel={`Boost ${index} CSS`}
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
            </View>
          ))}
          {draft.length === 0 && (
            <Text style={styles.emptyState}>
              No boosts yet. Add one to restyle a site.
            </Text>
          )}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add site boost"
          style={styles.row}
          onPress={() =>
            setDraft((current) => [
              ...current,
              { host: "", css: "", enabled: true },
            ])
          }
        >
          <Text style={styles.rowTitle}>＋ Add site boost</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save site boosts"
          style={styles.row}
          onPress={() =>
            onSave(
              draft.filter((boost) => boost.host.trim() && boost.css.trim())
            )
          }
        >
          <Text style={styles.rowTitle}>Save boosts</Text>
        </Pressable>
      </View>
    </>
  );
}

const kindLabel = (kind: string) =>
  (PERMISSION_KINDS as string[]).includes(kind)
    ? PERMISSION_LABELS[kind as PermissionKind]
    : kind;

export interface PermissionRequestInfo {
  ephemeral?: boolean;
  origin: string;
  kinds: string[];
}

// A site asking for a device capability. The answer is per-site: "always"
// stores a rule, "once" grants just this request, and dismissing denies
// without storing anything.
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
  return (
    <View style={[styles.dialog, { maxWidth: 420 }]}>
      <DialogHeader
        title={
          <Text numberOfLines={1} style={[styles.title, { flex: 1 }]}>
            {request.origin.replace(/^https?:\/\//, "")}
          </Text>
        }
        closeLabel="Dismiss permission request"
        onClose={onDismiss}
      />
      <Text style={styles.rowMeta}>
        This site wants to use{" "}
        {request.kinds.map(kindLabel).join(" and ") || "a capability"}.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Allow this site once"
        style={styles.row}
        onPress={() => onDecide("once")}
      >
        <Text style={styles.rowTitle}>Allow once</Text>
      </Pressable>
      {!request.ephemeral && <Pressable
        accessibilityRole="button"
        accessibilityLabel="Always allow this site"
        style={styles.row}
        onPress={() => onDecide("always")}
      >
        <Text style={styles.rowTitle}>Always allow</Text>
      </Pressable>}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={request.ephemeral ? "Deny this request" : "Block this site"}
        style={styles.row}
        onPress={() => onDecide("block")}
      >
        <Text style={styles.rowTitle}>{request.ephemeral ? "Deny once" : "Block"}</Text>
      </Pressable>
    </View>
  );
}
