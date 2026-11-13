import React from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { cn } from "@/ui/cn";
import { useI18n } from "@/i18nContext";
import { SettingsGroup, SettingsGroupRow, settingsClasses } from "@/components/settings/kit";
import type { SyncStoreState } from "@/syncStore";

function formatLastSync(atMs: number | null): string {
  if (atMs === null) return "";
  const seconds = Math.max(1, Math.round((Date.now() - atMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * Firefox Sync settings panel. Presentation only: the connection lifecycle
 * lives in the injected callbacks App wires to the sync store. States follow
 * §3: 미연결 → 연결 중 → 연결됨/동기화 중 → 오류.
 */
export function SyncSettingsSection({
  state,
  platformAvailable,
  onConnect,
  onCancelConnect,
  onSyncNow,
  onDisconnect,
}: {
  state: SyncStoreState;
  /** False on hosts without the native sync bridge (httpRequest etc.). */
  platformAvailable: boolean;
  onConnect: () => void;
  onCancelConnect: () => void;
  onSyncNow: () => void;
  onDisconnect: () => void;
}) {
  const { tr } = useI18n();
  const disabled = !platformAvailable || state.connection === "connecting";

  const disconnectWithConfirm = () =>
    Alert.alert(
      tr("sync.disconnectTitle"),
      tr("sync.disconnectConfirm"),
      [
        { text: tr("common.cancel"), style: "cancel" },
        { text: tr("sync.disconnectAction"), style: "destructive", onPress: onDisconnect },
      ]
    );

  if (!platformAvailable) {
    return (
      <SettingsGroup heading={tr("sync.title")}>
        <SettingsGroupRow last>
          <View className="flex-1 min-w-0 gap-sm py-xs">
            <Text className={settingsClasses.rowTitle}>{tr("sync.title")}</Text>
            <Text className={settingsClasses.rowDetail}>
              {tr("sync.unavailable")}
            </Text>
          </View>
        </SettingsGroupRow>
      </SettingsGroup>
    );
  }

  if (state.connection === "disconnected") {
    return (
      <SettingsGroup heading={tr("sync.title")}>
        <SettingsGroupRow last>
          <View className="flex-1 min-w-0 gap-sm py-xs">
            <Text className={settingsClasses.rowTitle}>{tr("sync.title")}</Text>
            <Text className={settingsClasses.rowDetail}>
              {tr("sync.connectDetail")}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr("sync.connect")}
            accessibilityState={{ disabled }}
            disabled={disabled}
            className={cn(settingsClasses.chip, "px-xxxl")}
            onPress={onConnect}
          >
            <Text className="text-ink text-input-plus font-semibold">
              {tr("sync.connect")}
            </Text>
          </Pressable>
        </SettingsGroupRow>
      </SettingsGroup>
    );
  }

  if (state.connection === "connecting") {
    return (
      <SettingsGroup heading={tr("sync.title")}>
        <SettingsGroupRow last>
          <View className="flex-1 min-w-0 gap-sm py-xs">
            <Text className={settingsClasses.rowTitle}>
              {tr("sync.connectingTitle")}
            </Text>
            <Text className={settingsClasses.rowDetail}>
              {tr("sync.connectingDetail")}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr("common.cancel")}
            className={settingsClasses.chip}
            onPress={onCancelConnect}
          >
            <Text className="text-ink text-input-plus">{tr("common.cancel")}</Text>
          </Pressable>
        </SettingsGroupRow>
      </SettingsGroup>
    );
  }

  // Connected: identity, last sync, manual sync, error line, disconnect.
  const errorText =
    state.lastResult && state.lastResult.kind !== "ok"
      ? tr(`sync.error.${state.lastResult.kind}`)
      : null;
  const backoffText =
    state.lastResult &&
    state.lastResult.kind !== "ok" &&
    state.lastResult.retryAfterSeconds !== null
      ? tr("sync.error.backoff", {
          seconds: Math.max(1, Math.round(state.lastResult.retryAfterSeconds)),
        })
      : null;

  const pendingUploads = state.pendingUploads;
  const okCounts =
    state.lastResult && state.lastResult.kind === "ok" ? state.lastResult : null;
  const received = okCounts?.received ?? 0;
  const uploaded = okCounts?.uploaded ?? 0;
  const resultSummary =
    state.lastSyncAtMs !== null && (received > 0 || uploaded > 0)
      ? tr("sync.resultSummary", { received, uploaded })
      : null;
  const lastSyncText =
    state.lastSyncAtMs === null
      ? tr("sync.neverSynced")
      : [
          tr("sync.lastSynced", { age: formatLastSync(state.lastSyncAtMs) }),
          resultSummary,
        ]
          .filter((part): part is string => part !== null)
          .join(" · ");
  const syncingText =
    pendingUploads > 0
      ? `${tr("sync.syncing")} · ${tr("sync.uploading", { count: pendingUploads })}`
      : tr("sync.syncing");

  return (
    <SettingsGroup heading={tr("sync.title")}>
      <SettingsGroupRow>
        <View className="flex-1 min-w-0 gap-sm py-xs">
          <Text className={settingsClasses.rowTitle} numberOfLines={1}>
            {state.email ?? tr("sync.accountFallback")}
          </Text>
          <Text className={settingsClasses.rowDetail}>{lastSyncText}</Text>
        </View>
      </SettingsGroupRow>
      {!!errorText && (
        <SettingsGroupRow>
          <Text className="flex-1 text-input-plus text-ink leading-[21px]">
            {backoffText ? `${errorText} ${backoffText}` : errorText}
          </Text>
        </SettingsGroupRow>
      )}
      <SettingsGroupRow last>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("sync.syncNow")}
          accessibilityState={{ disabled: state.syncing }}
          disabled={state.syncing}
          className={cn(settingsClasses.action, "flex-1")}
          onPress={onSyncNow}
        >
          <Text className="text-ink text-input-plus font-semibold">
            {state.syncing ? syncingText : tr("sync.syncNow")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("sync.disconnectAction")}
          accessibilityState={{ disabled: state.syncing }}
          disabled={state.syncing}
          className={cn(settingsClasses.actionSecondary, "flex-1")}
          onPress={disconnectWithConfirm}
        >
          <Text className="text-ink text-input-plus">
            {tr("sync.disconnectAction")}
          </Text>
        </Pressable>
      </SettingsGroupRow>
    </SettingsGroup>
  );
}
