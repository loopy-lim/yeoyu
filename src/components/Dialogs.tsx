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
import { Favicon } from "@/components/Favicon";
import { josaRo } from "@/i18n";
import { ActionMenu, type MenuAnchor, type MenuItem } from "@/components/ActionMenu";
import { ChromeIcon } from "@/chrome/ChromeIcon";
import type { HistoryEntry } from "@/history";
import {
  PERMISSION_KINDS,
  validateBoostDrafts,
  type PermissionKind,
} from "@/uiPreferences";
import { cva } from "class-variance-authority";
import { cn } from "@/ui/cn";
import { permissionSupportsOnce } from "@/permissionRequests";
import { useI18n } from "@/i18nContext";

const spaceRowVariants = cva("min-h-bookmark-row px-xxl rounded-field flex-row items-center gap-xl", {
  variants: { selected: { true: "bg-sunken-strong", false: "bg-sunken" } },
  defaultVariants: { selected: false },
});
const dialogClasses = {
  dialog: "w-[92%] max-w-[520px] max-h-[80%] p-xxxl bg-surface-elevated rounded-dialog gap-lg shadow-dialog",
  title: "text-ink text-title font-bold",
  closeButton: "size-action-row rounded-control items-center justify-center",
  row: spaceRowVariants(),
  rowTitle: "text-ink text-input-plus font-semibold",
  rowMeta: "text-ink-muted text-input leading-[19px] mt-xs",
  spaceDot: "size-[14px] rounded-[7px]",
  input: "min-h-input px-xxl rounded-field text-ink bg-sunken text-input",
  inputMultiline: "min-h-[84px] p-xl rounded-field text-ink bg-sunken text-body [text-align-vertical:top]",
  boostForm: "gap-md",
  emptyState: "text-ink-faint text-body p-lg",
  historyList: "max-h-[420px]",
  historyRow: "min-h-bookmark-row flex-row items-center gap-xl pl-xl pr-sm border-b border-hairline",
  grow: "flex-1",
  permissionScroll: "grow-0",
  permissionContent: "gap-xxxl",
  permissionOrigin: "text-ink text-icon-size leading-[24px] font-semibold",
  permissionSite: "p-xxxl rounded-card bg-sunken gap-lg",
  permissionDescription: "text-ink-muted text-input-plus leading-[21px]",
  permissionActions: "gap-lg",
  permissionButton: "min-h-action-row p-[14px] rounded-field justify-center items-center border border-hairline active:opacity-[0.65]",
  permissionPrimary: "bg-ink border-ink",
  permissionPrimaryText: "text-surface-elevated text-[15px] leading-[22px] font-semibold",
  permissionButtonText: "text-ink text-[15px] leading-[22px] font-semibold",
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
  return (
    <View className="flex-row items-center">
      {title}
      {children}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        hitSlop={8}
        className={dialogClasses.closeButton}
        onPress={onClose}
      >
        <ChromeIcon name="close" className="size-[16px] text-icon" />
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
  const { tr } = useI18n();
  return (
    <>
      <View className={dialogClasses.dialog}>
        <DialogHeader
          title={<Text className={cn(dialogClasses.title, "flex-1")}>{tr("dialog.spaces")}</Text>}
          closeLabel={tr("dialog.closeSpaces")}
          onClose={onClose}
        />
        <ScrollView
          className="grow-0 shrink"
          contentContainerClassName="gap-lg"
          keyboardShouldPersistTaps="handled"
        >
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
              className={cn(spaceRowVariants({ selected: workspace.id === activeWorkspaceId }))}
              onPress={() => onSwitch(workspace.id)}
            >
              <View
                className={cn(dialogClasses.spaceDot, !workspace.color && "bg-accent")}
                // Workspace colors are user/domain data, independent of the theme palette.
                style={workspace.color ? { backgroundColor: workspace.color } : undefined}
              />
              <View className="flex-1">
                <Text className={dialogClasses.rowTitle}>{workspace.name}</Text>
              </View>
              <Text className={dialogClasses.rowMeta}>{counts[workspace.id] ?? 0}</Text>
              {workspace.id === activeWorkspaceId && (
                <ChromeIcon name="check" className="size-[16px] text-accent-strong" />
              )}
            </Pressable>
          ))}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("dialog.newSpace")}
          className={dialogClasses.row}
          onPress={onCreate}
        >
          <Text className={dialogClasses.rowTitle}>＋ {tr("dialog.newSpace")}</Text>
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
  const { tr } = useI18n();
  const open = useCallback(() => onOpen(entry.url), [entry.url, onOpen]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr("dialog.openHistoryEntry", { title: entry.title })}
      className={dialogClasses.historyRow}
      onPress={open}
    >
      <Favicon
        url={entry.url}
        fallback={(entry.title || entry.url).slice(0, 1).toUpperCase()}
        size={16}
        radius={4}
      />
      <View className={dialogClasses.grow}>
        <Text numberOfLines={1} className={dialogClasses.rowTitle}>
          {entry.title || entry.url}
        </Text>
        <Text numberOfLines={1} className={dialogClasses.rowMeta}>
          {entry.url}
        </Text>
      </View>
      <Text className={dialogClasses.rowMeta}>
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
      <View className={cn(dialogClasses.dialog, "max-w-[560px]")}>
        <DialogHeader
          title={<Text className={cn(dialogClasses.title, "flex-1")}>{tr("dialog.history")}</Text>}
          closeLabel={tr("dialog.closeHistory")}
          onClose={onClose}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr("dialog.clearHistory")}
            className={cn(dialogClasses.row, "min-h-address")}
            onPress={onClear}
          >
            <Text className={dialogClasses.rowTitle}>{tr("common.clear")}</Text>
          </Pressable>
        </DialogHeader>
        <FlatList
          className={dialogClasses.historyList}
          data={entries}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          windowSize={5}
          maxToRenderPerBatch={12}
          keyExtractor={historyKey}
          ListEmptyComponent={
            <Text className={dialogClasses.emptyState}>{tr("dialog.noHistory")}</Text>
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
      <View className={cn(dialogClasses.dialog, "max-w-[600px]")}>
        <DialogHeader
          title={<Text className={cn(dialogClasses.title, "flex-1")}>{tr("dialog.siteBoosts")}</Text>}
          closeLabel={tr("dialog.closeBoosts")}
          onClose={onClose}
        />
        <Text className={dialogClasses.rowMeta}>
          {tr("dialog.boostHelp")}
        </Text>
        <ScrollView className="max-h-[420px]">
          {draft.map((boost, index) => (
            <View key={index} className={dialogClasses.boostForm}>
              <View className="flex-row gap-md">
                <TextInput
                  accessibilityLabel={tr("dialog.boostHost", { number: index + 1 })}
                  value={boost.host}
                  onChangeText={(host) => update(index, { host })}
                  placeholder="example.com"
                  placeholderTextColorClassName="accent-ink-faint"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className={cn(dialogClasses.input, "flex-1")}
                  disableFullscreenUI
                />
                <Switch
                  accessibilityLabel={tr("dialog.boostEnabled", { number: index + 1 })}
                  value={boost.enabled}
                  onValueChange={(enabled) => update(index, { enabled })}
                  trackColorOffClassName="accent-switch-off"
                  trackColorOnClassName="accent-accent"
                  thumbColorClassName="accent-surface-elevated"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={tr("dialog.removeBoost", { number: index + 1 })}
                  className={dialogClasses.closeButton}
                  onPress={() =>
                    setDraft((current) => current.filter((_, i) => i !== index))
                  }
                >
                  <ChromeIcon
                    name="close"
                    className="size-[16px] text-icon"
                  />
                </Pressable>
              </View>
              {!!validation.errors[index]?.host && <Text accessibilityRole="alert" className={cn(dialogClasses.rowMeta, "text-error-ink")}>{hostError(index)}</Text>}
              {!validation.errors[index]?.host && <Text className={dialogClasses.rowMeta}>{tr("dialog.boostHostValue", { host: validation.boosts[index].host })}</Text>}
              <TextInput
                accessibilityLabel={tr("dialog.boostCss", { number: index + 1 })}
                value={boost.css}
                onChangeText={(css) => update(index, { css })}
                placeholder={"body { background: #222; }"}
                placeholderTextColorClassName="accent-ink-faint"
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                className={dialogClasses.inputMultiline}
                disableFullscreenUI
              />
              {!!validation.errors[index]?.css && <Text accessibilityRole="alert" className={cn(dialogClasses.rowMeta, "text-error-ink")}>{tr("dialog.boostCssRequired")}</Text>}
            </View>
          ))}
          {draft.length === 0 && (
            <Text className={dialogClasses.emptyState}>
              {tr("dialog.noBoosts")}
            </Text>
          )}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("dialog.addBoost")}
          className={dialogClasses.row}
          onPress={() =>
            setDraft((current) => [
              ...current,
              { host: "", css: "", enabled: true },
            ])
          }
        >
          <Text className={dialogClasses.rowTitle}>＋ {tr("dialog.addBoost")}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("dialog.saveBoosts")}
          accessibilityState={{ disabled: !validation.valid }}
          disabled={!validation.valid}
          className={cn(dialogClasses.row, !validation.valid && "opacity-50")}
          onPress={() => { if (validation.valid) onSave(validation.boosts); }}
        >
          <Text className={dialogClasses.rowTitle}>{tr("dialog.saveBoosts")}</Text>
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
  return <View className={cn(dialogClasses.dialog, "max-w-[460px]")} accessibilityViewIsModal>
    <DialogHeader title={<Text className={cn(dialogClasses.title, "flex-1")}>{tr("permission.title")}</Text>}
      closeLabel={tr("permission.dismiss")} onClose={onDismiss} />
    <ScrollView className={dialogClasses.permissionScroll} contentContainerClassName={dialogClasses.permissionContent} keyboardShouldPersistTaps="handled">
      <View className={dialogClasses.permissionSite}>
        <Text selectable className={dialogClasses.permissionOrigin}>{request.origin}</Text>
        <Text className={dialogClasses.permissionDescription}>{tr("permission.wants", { kinds })}</Text>
      </View>
      <Text className={dialogClasses.permissionDescription}>
        {tr(persistentStorage ? "permission.storageWarning" : privateMedia ? "permission.onceHelp" : request.ephemeral ? "permission.privateScope" : "permission.savedScope")}
      </Text>
      <View className={dialogClasses.permissionActions}>
        <Pressable accessibilityRole="button" accessibilityLabel={allowLabel}
          className={cn(dialogClasses.permissionButton, dialogClasses.permissionPrimary)}
          onPress={() => onDecide(privateMedia ? "once" : "always")}>
          <Text className={dialogClasses.permissionPrimaryText}>{allowLabel}</Text>
        </Pressable>
        {!request.ephemeral && oneTimePermission && <Pressable accessibilityRole="button" accessibilityLabel={tr("permission.allowOnce")}
          className={dialogClasses.permissionButton}
          onPress={() => onDecide("once")}>
          <Text className={dialogClasses.permissionButtonText}>{tr("permission.allowOnce")}</Text>
        </Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel={blockLabel}
          className={dialogClasses.permissionButton}
          onPress={() => onDecide("block")}>
          <Text className={dialogClasses.permissionButtonText}>{blockLabel}</Text>
        </Pressable>
      </View>
      <Text className={dialogClasses.permissionDescription}>{tr("permission.dismissHelp")}</Text>
    </ScrollView>
  </View>;
}
