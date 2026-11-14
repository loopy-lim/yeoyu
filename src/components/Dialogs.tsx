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
import { Separator } from "@unikit-bridge/ui";
import { Favicon } from "@/components/Favicon";
import { josaRo } from "@/i18n";
import { ActionMenu, type MenuAnchor, type MenuItem } from "@/components/ActionMenu";
import { ChromeIcon } from "@/chrome/ChromeIcon";
import { DialogCard } from "@/components/DialogCard";
import { DialogHeader } from "@/components/DialogHeader";
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

const spaceRowVariants = cva(
  "min-h-[40px] px-lg rounded-control flex-row items-center gap-md border border-transparent",
  {
    variants: {
      selected: {
        true: "bg-sunken-strong",
        false: "bg-transparent active:bg-sunken",
      },
    },
    defaultVariants: { selected: false },
  }
);
const dialogClasses = {
  title: "text-ink text-title font-bold",
  closeButton: "size-action-row rounded-control items-center justify-center",
  row: spaceRowVariants(),
  rowTitle: "text-ink text-input-plus font-medium",
  rowMeta: "text-ink-muted text-input leading-[19px] mt-xs",
  spaceDot: "size-[10px] rounded-full",
  input:
    "min-h-input px-xxl rounded-field text-ink bg-surface-elevated border border-hairline text-input-plus",
  inputMultiline:
    "min-h-[84px] p-xl rounded-field text-ink bg-surface-elevated border border-hairline text-body [text-align-vertical:top]",
  boostForm: "p-lg rounded-tile bg-sunken border border-hairline gap-md mb-md",
  emptyState: "text-ink-faint text-body p-lg",
  historyList: "max-h-[420px]",
  historyRow:
    "min-h-bookmark-row flex-row items-center gap-lg px-lg py-sm border-b-hairline-width border-b-hairline active:bg-sunken",
  grow: "flex-1",
  permissionScroll: "grow-0",
  permissionContent: "gap-xxxl",
  permissionOrigin: "text-ink text-icon-size leading-[24px] font-semibold",
  permissionSite: "p-xxxl rounded-card bg-sunken border border-hairline gap-lg",
  permissionDescription: "text-ink-muted text-input-plus leading-[21px]",
  permissionActions: "gap-lg",
  permissionButton:
    "min-h-action-row px-xl py-md rounded-field justify-center items-center bg-surface-elevated border border-hairline active:opacity-[0.65]",
  permissionPrimary: "bg-ink border-ink",
  permissionPrimaryText:
    "text-surface-elevated text-[15px] leading-[22px] font-semibold",
  permissionButtonText: "text-ink text-[15px] leading-[22px] font-semibold",
};

// One Space row, shared by the centered switcher dialog and the phone
// bottom sheet (issue #19) so both present the same dot/count/active mark.
function SpaceRow({
  workspace,
  selected,
  count,
  onSwitch,
  onManage,
}: {
  workspace: { id: string; name: string; color?: string };
  selected: boolean;
  count: number;
  onSwitch: () => void;
  onManage: (anchor: MenuAnchor) => void;
}) {
  const { tr } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr("dialog.switchSpace", {
        name: workspace.name,
        ro: josaRo(workspace.name),
      })}
      className={cn(spaceRowVariants({ selected }))}
      onPress={onSwitch}
      onLongPress={(event) => {
        const { pageX, pageY } = event.nativeEvent;
        onManage({ x: pageX, y: pageY, width: 1, height: 1 });
      }}
    >
      <View
        className={cn(dialogClasses.spaceDot, !workspace.color && "bg-accent")}
        // Workspace colors are user/domain data, independent of the theme palette.
        style={workspace.color ? { backgroundColor: workspace.color } : undefined}
      />
      <View className="flex-1">
        <Text className={dialogClasses.rowTitle}>{workspace.name}</Text>
      </View>
      <Text className={dialogClasses.rowMeta}>{count}</Text>
      {selected && (
        <ChromeIcon name="check" className="size-[16px] text-accent-strong" />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr("dialog.manageSpace", { name: workspace.name })}
        hitSlop={8}
        className={dialogClasses.closeButton}
        onPress={(event) => {
          const { pageX, pageY } = event.nativeEvent;
          onManage({ x: pageX, y: pageY, width: 1, height: 1 });
        }}
      >
        <ChromeIcon name="more" className="size-[16px] text-icon" />
      </Pressable>
    </Pressable>
  );
}

function NewSpaceRow({ onPress }: { onPress: () => void }) {
  const { tr } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tr("dialog.newSpace")}
      className={cn(
        "min-h-[38px] px-lg rounded-control flex-row items-center gap-md bg-transparent active:bg-sunken"
      )}
      onPress={onPress}
    >
      <ChromeIcon name="plus" className="size-[15px] text-icon" />
      <Text className={dialogClasses.rowTitle}>{tr("dialog.newSpace")}</Text>
    </Pressable>
  );
}

export interface SpaceSwitcherProps {
  workspaces: { id: string; name: string; color?: string }[];
  activeWorkspaceId: string;
  counts: Record<string, number>;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onReorder: (id: string, index: number) => void;
  onClose: () => void;
}

function SpaceSwitcherContent({
  workspaces,
  activeWorkspaceId,
  counts,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  onReorder,
  onClose,
  variant,
}: SpaceSwitcherProps & { variant: "dialog" | "sheet" }) {
  const { tr } = useI18n();
  const [menu, setMenu] = useState<{
    id: string;
    anchor?: MenuAnchor;
  } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(
    null
  );
  const menuWorkspace = menu
    ? workspaces.find((workspace) => workspace.id === menu.id)
    : undefined;
  const menuIndex = menu
    ? workspaces.findIndex((workspace) => workspace.id === menu.id)
    : -1;
  return (
    <DialogCard
      variant={variant}
      className={
        variant === "dialog"
          ? "w-[268px] p-lg rounded-tile gap-xs"
          : undefined
      }
    >
      <DialogHeader
        title={
          <Text className={cn(dialogClasses.title, "flex-1")}>
            {tr("dialog.spaces")}
          </Text>
        }
        closeLabel={tr("dialog.closeSpaces")}
        onClose={onClose}
      />
      {renaming ? (
        <View className="gap-lg">
          <TextInput
            accessibilityLabel={tr("dialog.renameSpace")}
            value={renaming.value}
            onChangeText={(value) =>
              setRenaming((current) =>
                current ? { ...current, value } : current
              )
            }
            autoFocus
            className={dialogClasses.input}
            disableFullscreenUI
          />
          <View className="flex-row gap-md">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr("common.cancel")}
              className={cn(dialogClasses.permissionButton, "flex-1")}
              onPress={() => setRenaming(null)}
            >
              <Text className={dialogClasses.permissionButtonText}>
                {tr("common.cancel")}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr("common.save")}
              disabled={!renaming.value.trim()}
              className={cn(
                dialogClasses.permissionButton,
                dialogClasses.permissionPrimary,
                "flex-1",
                !renaming.value.trim() && "opacity-disabled"
              )}
              onPress={() => {
                const value = renaming.value.trim();
                if (!value) return;
                onRename(renaming.id, value);
                setRenaming(null);
              }}
            >
              <Text className={dialogClasses.permissionPrimaryText}>
                {tr("common.save")}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <ScrollView
            className="grow-0 shrink"
            contentContainerClassName="gap-[2px]"
            keyboardShouldPersistTaps="handled"
          >
            {workspaces.map((workspace) => (
              <SpaceRow
                key={workspace.id}
                workspace={workspace}
                selected={workspace.id === activeWorkspaceId}
                count={counts[workspace.id] ?? 0}
                onSwitch={() => onSwitch(workspace.id)}
                onManage={(anchor) => setMenu({ id: workspace.id, anchor })}
              />
            ))}
          </ScrollView>
          <Separator className="my-xs bg-hairline" />
          <NewSpaceRow onPress={onCreate} />
        </>
      )}
      {menu && menuWorkspace && (
        <ActionMenu
          title={menuWorkspace.name}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          items={[
            {
              id: "rename",
              label: tr("dialog.renameSpace"),
              icon: "edit",
              onPress: () => {
                setRenaming({
                  id: menuWorkspace.id,
                  value: menuWorkspace.name,
                });
              },
            },
            {
              id: "up",
              label: tr("dialog.moveSpaceUp"),
              icon: "chevronUp",
              disabled: menuIndex <= 0,
              onPress: () => onReorder(menuWorkspace.id, menuIndex - 1),
            },
            {
              id: "down",
              label: tr("dialog.moveSpaceDown"),
              icon: "chevronDown",
              disabled: menuIndex < 0 || menuIndex >= workspaces.length - 1,
              onPress: () => onReorder(menuWorkspace.id, menuIndex + 1),
            },
            {
              id: "delete",
              label: tr("dialog.deleteSpace"),
              icon: "trash",
              destructive: true,
              disabled: workspaces.length <= 1,
              onPress: () => onDelete(menuWorkspace.id),
            },
          ]}
        />
      )}
    </DialogCard>
  );
}

export function SpaceSwitcherDialog(props: SpaceSwitcherProps) {
  return <SpaceSwitcherContent {...props} variant="dialog" />;
}

// Phone-docked Space picker (issue #19): the same rows as the centered
// dialog in a full-width bottom card; the list scrolls between the fixed
// header and the new-Space action so long sets stay reachable.
export function SpaceSheet(props: SpaceSwitcherProps) {
  return <SpaceSwitcherContent {...props} variant="sheet" />;
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
  onRename,
  onEnterSelection,
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
  onRename?: () => void;
  /** Enters the sidebar's multi-select mode with this tab pre-selected. */
  onEnterSelection?: () => void;
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
  if (onRename)
    items.push({
      id: "rename",
      label: tr("chrome.renameTab"),
      icon: "edit",
      onPress: onRename,
    });
  if (onEnterSelection)
    items.push({
      id: "select",
      label: tr("chrome.selectTabs"),
      icon: "check",
      onPress: onEnterSelection,
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
      dividerBefore: true,
    });
  if (onTogglePin)
    items.push({
      id: "pin",
      label: tr(tab.pinned ? "chrome.removePin" : "dialog.pinTab"),
      icon: "pin",
      onPress: onTogglePin,
      shortcut: "⌘D",
      dividerBefore: !onToggleFavorite,
    });
  let firstMove = true;
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
      dividerBefore: firstMove,
    });
    firstMove = false;
  }
  items.push({
    id: "close-others",
    label: tr("dialog.closeOtherTabs"),
    icon: "closeOthers",
    onPress: onCloseOthers,
    dividerBefore: true,
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
    <DialogCard variant="dialog" className="max-w-[560px]">
      <DialogHeader
        title={<Text className={cn(dialogClasses.title, "flex-1")}>{tr("dialog.history")}</Text>}
        closeLabel={tr("dialog.closeHistory")}
        onClose={onClose}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("dialog.clearHistory")}
          className="min-h-[36px] px-xl rounded-control bg-sunken border border-hairline items-center justify-center active:opacity-pressed"
          onPress={onClear}
        >
          <Text className="text-ink text-body font-semibold">{tr("common.clear")}</Text>
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
    </DialogCard>
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
    <DialogCard variant="dialog" className="max-w-[600px]">
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
            <View className="flex-row items-center gap-md">
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
      <View className="flex-row gap-md">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("dialog.addBoost")}
          className={cn(dialogClasses.permissionButton, "flex-1 flex-row gap-sm")}
          onPress={() =>
            setDraft((current) => [
              ...current,
              { host: "", css: "", enabled: true },
            ])
          }
        >
          <ChromeIcon name="plus" className="size-[16px] text-icon" />
          <Text className={dialogClasses.permissionButtonText}>{tr("dialog.addBoost")}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("dialog.saveBoosts")}
          accessibilityState={{ disabled: !validation.valid }}
          disabled={!validation.valid}
          className={cn(
            dialogClasses.permissionButton,
            dialogClasses.permissionPrimary,
            "flex-1",
            !validation.valid && "opacity-disabled"
          )}
          onPress={() => { if (validation.valid) onSave(validation.boosts); }}
        >
          <Text className={dialogClasses.permissionPrimaryText}>{tr("dialog.saveBoosts")}</Text>
        </Pressable>
      </View>
    </DialogCard>
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
  return (
    <DialogCard variant="dialog" className="max-w-[460px]">
      <DialogHeader
        title={
          <Text className={cn(dialogClasses.title, "flex-1")}>
            {tr("permission.title")}
          </Text>
        }
        closeLabel={tr("permission.dismiss")}
        onClose={onDismiss}
      />
      <ScrollView
        className={dialogClasses.permissionScroll}
        contentContainerClassName={dialogClasses.permissionContent}
        keyboardShouldPersistTaps="handled"
      >
        <View className={dialogClasses.permissionSite}>
          <Text selectable className={dialogClasses.permissionOrigin}>
            {request.origin}
          </Text>
          <Text className={dialogClasses.permissionDescription}>
            {tr("permission.wants", { kinds })}
          </Text>
        </View>
        <Text className={dialogClasses.permissionDescription}>
          {tr(
            persistentStorage
              ? "permission.storageWarning"
              : privateMedia
                ? "permission.onceHelp"
                : request.ephemeral
                  ? "permission.privateScope"
                  : "permission.savedScope"
          )}
        </Text>
        <View className={dialogClasses.permissionActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={allowLabel}
            className={cn(
              dialogClasses.permissionButton,
              dialogClasses.permissionPrimary
            )}
            onPress={() => onDecide(privateMedia ? "once" : "always")}
          >
            <Text className={dialogClasses.permissionPrimaryText}>
              {allowLabel}
            </Text>
          </Pressable>
          {!request.ephemeral && oneTimePermission && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr("permission.allowOnce")}
              className={dialogClasses.permissionButton}
              onPress={() => onDecide("once")}
            >
              <Text className={dialogClasses.permissionButtonText}>
                {tr("permission.allowOnce")}
              </Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={blockLabel}
            className={dialogClasses.permissionButton}
            onPress={() => onDecide("block")}
          >
            <Text className={dialogClasses.permissionButtonText}>
              {blockLabel}
            </Text>
          </Pressable>
        </View>
        <Text className={dialogClasses.permissionDescription}>
          {tr("permission.dismissHelp")}
        </Text>
      </ScrollView>
    </DialogCard>
  );
}
