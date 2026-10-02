import { cva } from "class-variance-authority";
import { cn } from "@/ui/cn";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Image,
  Pressable,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  extensionErrorMessage,
  extensionOriginLabel,
  extensionPermissionLabel,
  localizeExtensionError,
  parseBrowserExtensions,
  parseExtensionSearch,
  privateExtensionScope,
  requireBrowserExtensions,
  type BrowserExtensionsState,
  type ExtensionCatalogEntry,
  type ExtensionOperation,
  type ExtensionOptionalKind,
  type ExtensionSearchResult,
  type InstalledBrowserExtension,
} from "@/browserExtensions";
import { useTheme } from "@/themeContext";
import { useI18n } from "@/i18nContext";
import { mozillaExtensionSource } from "@/extensionLinks";
import { HapticSwitch } from "@/chrome/HapticSwitch";

const c = {
  section: "mt-[20px] mb-lg text-icon-size font-bold text-ink",
  card: "my-lg p-[14px] gap-xl rounded-tile bg-surface border-hairline border-hairline-width",
  title: "text-icon-size font-semibold text-ink",
  text: "text-input-plus leading-[21px] text-ink",
  detail: "text-input-plus leading-[21px] text-ink-muted",
  error: "text-input-plus leading-[21px] text-error-ink",
  row: "min-h-action-row flex-row items-center gap-xxl",
  grow: "flex-1 min-w-0",
  actions: "flex-row flex-wrap gap-lg",
  action:
    "min-h-action-row shrink justify-center px-xxl py-xl rounded-[8px] bg-sunken active:opacity-pressed",
  linkInput:
    "min-h-action-row px-xxl py-xl border border-hairline rounded-[8px] bg-sunken text-ink text-input-plus",
  permissionGroup: "gap-sm mt-lg",
  resultRow: "flex-row gap-xxl mt-xl",
  resultIcon: "size-[40px] rounded-[10px] bg-sunken",
  resultGrow: "flex-1 min-w-0 gap-xs",
  resultName: "text-[15px] font-semibold text-ink",
  headlineRow: "flex-row gap-xxl items-center",
  headlineIcon: "size-[36px] rounded-control bg-sunken",
} as const;
const actionClasses = cva(c.action, {
  variants: {
    disabled: { true: "opacity-50", false: "" },
  },
});

export function ExtensionsSettings({
  tabId,
  privateTab,
  onError,
}: {
  tabId: string | null;
  privateTab: boolean;
  onError?(message: string): void;
}) {
  const theme = useTheme();
  const { language, tr } = useI18n();
  const [state, setState] = useState<BrowserExtensionsState | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stale, setStale] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [link, setLink] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    ExtensionSearchResult[] | null
  >(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const live = useRef(false);
  const operation = useRef(false);
  const errorCallback = useRef(onError);
  const currentTab = useRef(tabId);
  useEffect(() => {
    currentTab.current = tabId;
  }, [tabId]);
  useEffect(() => {
    errorCallback.current = onError;
  }, [onError]);
  const report = useCallback(
    (failure: unknown) => {
      const message = extensionErrorMessage(failure);
      const localized = tr("extension.error", {
        detail: localizeExtensionError(message, language),
      });
      setError(localized);
      errorCallback.current?.(localized);
    },
    [tr, language]
  );

  const refresh = useCallback(async () => {
    if (operation.current) return;
    operation.current = true;
    setPending(tr("extension.loading"));
    setError("");
    try {
      const native = requireBrowserExtensions();
      native.setActiveTab(currentTab.current);
      const next = parseBrowserExtensions(await native.list());
      if (live.current) {
        setState(next);
        setStale(false);
      }
    } catch (failure) {
      if (live.current) {
        setStale(true);
        report(failure);
      }
    } finally {
      operation.current = false;
      if (live.current) setPending(null);
    }
  }, [report, tr]);

  useEffect(() => {
    live.current = true;
    void refresh();
    const subscription = AppState.addEventListener("change", (value) => {
      if (value === "active") void refresh();
    });
    // Native list refresh itself emits BrowserExtensionsChanged. Do not subscribe
    // with another list call, which would create a self-sustaining refresh loop.
    return () => {
      live.current = false;
      subscription.remove();
    };
  }, [refresh]);

  const locked = !!pending || !!state?.busy || stale;
  const perform = (
    label: string,
    task: () => Promise<string | void>,
    success?: (next: BrowserExtensionsState) => string
  ) => {
    if (operation.current || state?.busy || stale) return;
    operation.current = true;
    setPending(label);
    setError("");
    setNotice("");
    void (async () => {
      try {
        const json = await task();
        const next = parseBrowserExtensions(
          typeof json === "string"
            ? json
            : await requireBrowserExtensions().list()
        );
        if (live.current) {
          setState(next);
          setStale(false);
          if (success) setNotice(success(next));
        }
      } catch (failure) {
        if (live.current) report(failure);
        // Native may have changed the extension before a later step failed.
        // Read back actual state before allowing another setting mutation.
        try {
          const next = parseBrowserExtensions(
            await requireBrowserExtensions().list()
          );
          if (live.current) {
            setState(next);
            setStale(false);
          }
        } catch {
          if (live.current) setStale(true);
        }
      } finally {
        operation.current = false;
        if (live.current) setPending(null);
      }
    })();
  };
  const modify = (
    extension: InstalledBrowserExtension,
    kind: ExtensionOperation,
    value: boolean
  ) => {
    perform(
      tr(kind === "update" ? "extension.checkingUpdates" : "extension.saving", {
        name: extension.name,
      }),
      () => requireBrowserExtensions().modify(extension.id, kind, value),
      (next) =>
        kind === "remove" &&
        !next.extensions.some((entry) => entry.id === extension.id)
          ? tr("extension.removed", { name: extension.name })
          : kind === "update"
          ? tr("extension.updateDone", {
              version:
                next.extensions.find((entry) => entry.id === extension.id)
                  ?.version ?? extension.version,
            })
          : tr("extension.preferencesRefreshed")
    );
  };
  const install = (entry: ExtensionCatalogEntry) =>
    Alert.alert(
      tr("extension.installTitle", { name: entry.name }),
      tr("extension.installDetail"),
      [
        { text: tr("common.cancel"), style: "cancel" },
        {
          text: tr("extension.reviewInstall"),
          onPress: () =>
            perform(
              tr("extension.installing", { name: entry.name }),
              () => requireBrowserExtensions().install(entry.slug),
              (next) =>
                next.extensions.some((extension) => extension.id === entry.id)
                  ? tr("extension.installedNotice", { name: entry.name })
                  : tr("extension.listRefreshed")
            ),
        },
      ]
    );
  const installLink = () => {
    if (locked || !live.current || operation.current || !link.trim()) return;
    setNotice("");
    let source: string;
    try {
      source = mozillaExtensionSource(link);
    } catch (failure) {
      report(failure);
      return;
    }
    perform(
      tr("extension.compatibility"),
      () => requireBrowserExtensions().install(source),
      () => tr("extension.installDone")
    );
  };
  const runSearch = async () => {
    if (locked || !live.current || searching || !searchQuery.trim()) return;
    setSearching(true);
    setSearchError("");
    try {
      const results = parseExtensionSearch(
        await requireBrowserExtensions().search(searchQuery)
      );
      if (live.current) setSearchResults(results);
    } catch (failure) {
      if (live.current) {
        setSearchResults(null);
        setSearchError(
          tr("extension.error", {
            detail: localizeExtensionError(
              extensionErrorMessage(failure),
              language
            ),
          })
        );
      }
    } finally {
      if (live.current) setSearching(false);
    }
  };
  const searchEntry = (
    result: ExtensionSearchResult
  ): ExtensionCatalogEntry => ({
    slug: result.slug,
    id: result.guid ?? "",
    name: result.name,
    description: result.summary,
    sourceUrl: `https://addons.mozilla.org/firefox/addon/${result.slug}/`,
  });
  const revoke = (
    extension: InstalledBrowserExtension,
    kind: ExtensionOptionalKind,
    value: string
  ) =>
    perform(
      tr("extension.revoking", { name: extension.name }),
      () =>
        requireBrowserExtensions().revokeOptional(extension.id, kind, value),
      () => tr("extension.revoked")
    );
  const setPrivate = (
    extension: InstalledBrowserExtension,
    allowed: boolean
  ) => {
    if (!allowed) {
      modify(extension, "private", false);
      return;
    }
    Alert.alert(
      tr("extension.privateTitle", { name: extension.name }),
      privateExtensionScope(extension, language),
      [
        { text: tr("common.cancel"), style: "cancel" },
        {
          text: tr("extension.private"),
          onPress: () => modify(extension, "private", true),
        },
      ]
    );
  };
  const open = (
    extension: InstalledBrowserExtension,
    kind: "action" | "options",
    anchor: { x: number; y: number }
  ) => {
    const target = tabId;
    perform(tr("extension.opening", { name: extension.name }), async () => {
      const native = requireBrowserExtensions();
      native.setActiveTab(target);
      if (kind === "action")
        await native.openAction(extension.id, anchor.x, anchor.y);
      else await native.openOptions(extension.id);
    });
  };
  const button = (
    label: string,
    onPress: (anchor: { x: number; y: number }) => void,
    disabled = locked,
    accessibilityLabel = label
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={(event) =>
        onPress({
          x: event?.nativeEvent?.pageX ?? 0,
          y: event?.nativeEvent?.pageY ?? 0,
        })
      }
      className={cn(actionClasses({ disabled: disabled }))}
    >
      <Text className={c.text}>{label}</Text>
    </Pressable>
  );
  const permissionGroup = (
    label: string,
    values: string[],
    format = (value: string) => extensionPermissionLabel(value, language)
  ) => (
    <View className={c.permissionGroup}>
      <Text className={c.title}>{label}</Text>
      {values.length ? (
        [...new Set(values)].map((value) => (
          <Text key={value} selectable className={c.detail}>
            • {format(value)}
          </Text>
        ))
      ) : (
        <Text className={c.detail}>{tr("extension.none")}</Text>
      )}
    </View>
  );
  const optionalGroup = (
    extension: InstalledBrowserExtension,
    label: string,
    values: string[],
    kind: ExtensionOptionalKind,
    format: (value: string) => string
  ) => {
    const uniqueValues = [...new Set(values)];
    return (
      <View className={c.permissionGroup}>
        <Text className={c.title}>{label}</Text>
        {uniqueValues.length ? (
          uniqueValues.map((value) => (
            <View key={value} className={c.row}>
              <Text selectable className={cn(c.detail, c.grow)}>
                • {format(value)}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tr("extension.revokeLabel", {
                  name: extension.name,
                  permission: format(value),
                })}
                disabled={locked}
                onPress={() => revoke(extension, kind, value)}
                className={cn(actionClasses({ disabled: locked }))}
              >
                <Text className={c.text}>{tr("extension.revoke")}</Text>
              </Pressable>
            </View>
          ))
        ) : (
          <Text className={c.detail}>{tr("extension.none")}</Text>
        )}
      </View>
    );
  };
  const switchColors = {
    trackColor: { false: theme.switchOff, true: theme.accent },
    thumbColor: theme.surfaceElevated,
  };

  return (
    <View>
      <Text className={c.text}>{tr("extension.intro")}</Text>
      <Text className={cn(c.detail, "mt-lg")}>{tr("extension.storage")}</Text>
      {!!pending && (
        <Text
          accessibilityLiveRegion="polite"
          className={cn(c.detail, "my-xl")}
        >
          {pending}
        </Text>
      )}
      {!!state?.busy && !pending && (
        <Text accessibilityLiveRegion="polite" className={c.detail}>
          {tr("extension.busy")}
        </Text>
      )}
      {!!error && (
        <View className={c.card}>
          <Text accessibilityRole="alert" className={c.error}>
            {error}
          </Text>
          {stale && !!state && (
            <Text className={c.detail}>{tr("extension.stale")}</Text>
          )}
        </View>
      )}
      {!!notice && (
        <Text
          accessibilityLiveRegion="polite"
          className={cn(c.detail, "my-xl")}
        >
          {notice}
        </Text>
      )}
      <View className={cn(c.actions, "my-xl")}>
        {button(
          tr(error ? "extension.retry" : "extension.refresh"),
          () => {
            void refresh();
          },
          !!pending
        )}
      </View>

      {!!state && (
        <>
          <Text accessibilityRole="header" className={c.section}>
            {tr("extension.searchTitle")}
          </Text>
          <View className={c.card}>
            <Text className={c.detail}>{tr("extension.searchHelp")}</Text>
            <TextInput
              accessibilityLabel={tr("extension.searchLabel")}
              placeholder={tr("extension.searchPlaceholder")}
              placeholderTextColor={theme.inkMuted}
              className={c.linkInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              editable={!locked && !searching}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={100}
              returnKeyType="search"
              onSubmitEditing={runSearch}
              disableFullscreenUI
            />
            {button(
              tr("extension.searchAction"),
              () => void runSearch(),
              locked || !searchQuery.trim(),
              tr("extension.searchSubmitLabel")
            )}
            {searching && (
              <Text accessibilityLiveRegion="polite" className={c.detail}>
                {tr("extension.searching")}
              </Text>
            )}
            {!!searchError && (
              <Text accessibilityRole="alert" className={c.error}>
                {searchError}
              </Text>
            )}
            {searchResults !== null && searchResults.length === 0 && (
              <Text className={c.detail}>{tr("extension.searchEmpty")}</Text>
            )}
            {searchResults !== null &&
              searchResults.map((result) => {
                const installedHere =
                  !!result.guid &&
                  state.extensions.some((entry) => entry.id === result.guid);
                return (
                  <View key={result.slug} className={c.resultRow}>
                    {result.iconUrl ? (
                      <Image
                        source={{ uri: result.iconUrl }}
                        className={c.resultIcon}
                      />
                    ) : (
                      <View
                        className={cn(
                          c.resultIcon,
                          "items-center justify-center"
                        )}
                      >
                        <Text className="text-[17px] font-semibold text-ink">
                          {result.name.trim().slice(0, 1).toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View className={c.resultGrow}>
                      <Text className={c.resultName}>{result.name}</Text>
                      {!!result.summary && (
                        <Text numberOfLines={2} className={c.detail}>
                          {result.summary}
                        </Text>
                      )}
                      <View className={c.actions}>
                        {installedHere ? (
                          <Text className={cn(c.detail, "py-xl")}>
                            {tr("extension.installedShort")}
                          </Text>
                        ) : (
                          button(
                            tr("extension.install", { name: result.name }),
                            () => install(searchEntry(result)),
                            locked,
                            tr("extension.installLabel", { name: result.name })
                          )
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
            {state.catalog.length > 0 && (
              <Text
                accessibilityRole="header"
                className={cn(c.section, "mt-lg text-input-plus")}
              >
                {tr("extension.recommended")}
              </Text>
            )}
            {state.catalog.map((entry) => {
              const installedHere = state.extensions.some(
                (extension) => extension.id === entry.id
              );
              return (
                <View key={entry.slug} className={c.resultRow}>
                  <View
                    className={cn(c.resultIcon, "items-center justify-center")}
                  >
                    <Text className="text-[17px] font-semibold text-ink">
                      {entry.name.trim().slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View className={c.resultGrow}>
                    <Text className={c.resultName}>{entry.name}</Text>
                    {!!entry.description && (
                      <Text numberOfLines={2} className={c.detail}>
                        {entry.description}
                      </Text>
                    )}
                    <View className={c.actions}>
                      {installedHere ? (
                        <Text className={cn(c.detail, "py-xl")}>
                          {tr("extension.installedShort")}
                        </Text>
                      ) : (
                        button(
                          tr("extension.install", { name: entry.name }),
                          () => install(entry),
                          locked,
                          tr("extension.installLabel", { name: entry.name })
                        )
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
          <Text accessibilityRole="header" className={c.section}>
            {tr("extension.installedTitle")}
          </Text>
          {state.extensions.length === 0 && (
            <Text className={c.detail}>{tr("extension.empty")}</Text>
          )}
          {state.extensions.map((extension) => {
            const usableHere =
              extension.enabled && (!privateTab || extension.privateAllowed);
            return (
              <View key={extension.id} className={c.card}>
                <View className={c.headlineRow}>
                  {extension.icon !== "" ? (
                    <Image
                      source={{ uri: extension.icon }}
                      className={c.headlineIcon}
                    />
                  ) : (
                    <View
                      className={cn(
                        c.headlineIcon,
                        "items-center justify-center"
                      )}
                    >
                      <Text className="text-[15px] font-semibold text-ink">
                        {extension.name.trim().slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View className={c.grow}>
                    <Text className={c.title}>{extension.name}</Text>
                    <Text className={c.detail}>
                      {tr("extension.version", {
                        version: extension.version,
                        status: tr(
                          extension.enabled
                            ? "extension.enabled"
                            : "extension.disabled"
                        ),
                      })}
                    </Text>
                  </View>
                </View>
                {!!extension.description && (
                  <Text numberOfLines={4} className={c.detail}>
                    {extension.description}
                  </Text>
                )}
                <View className={c.row}>
                  <Text className={cn(c.text, c.grow)}>
                    {tr("extension.enabled")}
                  </Text>
                  <HapticSwitch
                    {...switchColors}
                    accessibilityLabel={tr("extension.enableLabel", {
                      name: extension.name,
                    })}
                    disabled={locked}
                    value={extension.enabled}
                    onValueChange={(enabled) =>
                      modify(extension, "enabled", enabled)
                    }
                  />
                </View>
                <View className={c.row}>
                  <View className={c.grow}>
                    <Text className={c.text}>{tr("extension.private")}</Text>
                    <Text className={c.detail}>
                      {tr("extension.privateDetail")}
                    </Text>
                  </View>
                  <HapticSwitch
                    {...switchColors}
                    accessibilityLabel={tr("extension.privateLabel", {
                      name: extension.name,
                    })}
                    disabled={locked}
                    value={extension.privateAllowed}
                    onValueChange={(allowed) => setPrivate(extension, allowed)}
                  />
                </View>
                {!extension.enabled && extension.disabledFlags !== 0 && (
                  <Text className={c.detail}>
                    {tr("extension.disabledHelp")}
                  </Text>
                )}
                {privateTab && !extension.privateAllowed && (
                  <Text className={c.detail}>
                    {tr("extension.privateUnavailable")}
                  </Text>
                )}
                {!tabId && (
                  <Text className={c.detail}>{tr("extension.openPage")}</Text>
                )}
                {!!extension.badge && usableHere && (
                  <Text className={c.detail}>
                    {tr("extension.badge", { badge: extension.badge })}
                  </Text>
                )}
                <View className={c.actions}>
                  {button(
                    tr("extension.controls"),
                    (anchor) => open(extension, "action", anchor),
                    locked ||
                      !tabId ||
                      !usableHere ||
                      !extension.hasAction ||
                      !extension.actionEnabled,
                    tr("extension.controlsLabel", { name: extension.name })
                  )}
                  {button(
                    tr("extension.dashboard"),
                    () => open(extension, "options", { x: 0, y: 0 }),
                    locked || !usableHere || !extension.hasOptions,
                    tr("extension.dashboardLabel", { name: extension.name })
                  )}
                  {button(
                    tr("extension.updates"),
                    () => modify(extension, "update", true),
                    locked,
                    tr("extension.updatesLabel", { name: extension.name })
                  )}
                  {button(
                    tr("extension.remove"),
                    () =>
                      Alert.alert(
                        tr("extension.removeTitle", { name: extension.name }),
                        tr("extension.removeDetail"),
                        [
                          { text: tr("common.cancel"), style: "cancel" },
                          {
                            text: tr("extension.removeConfirm"),
                            style: "destructive",
                            onPress: () => modify(extension, "remove", true),
                          },
                        ]
                      ),
                    locked,
                    tr("extension.removeLabel", { name: extension.name })
                  )}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !!expanded[extension.id] }}
                  onPress={() =>
                    setExpanded((current) => ({
                      ...current,
                      [extension.id]: !current[extension.id],
                    }))
                  }
                  className={c.action}
                >
                  <Text className={c.text}>
                    {tr(
                      expanded[extension.id]
                        ? "extension.hidePermissions"
                        : "extension.viewPermissions"
                    )}
                  </Text>
                </Pressable>
                {!!expanded[extension.id] && (
                  <>
                    <Text className={c.detail}>
                      {tr("extension.permissionsHelp")}
                    </Text>
                    {permissionGroup(
                      tr("extension.capabilities"),
                      extension.permissions
                    )}
                    {permissionGroup(
                      tr("extension.websites"),
                      extension.origins,
                      (origin) => extensionOriginLabel(origin, language)
                    )}
                    {permissionGroup(
                      tr("extension.declaredData"),
                      extension.dataPermissions
                    )}
                    {optionalGroup(
                      extension,
                      tr("extension.optionalCapabilities"),
                      extension.optionalPermissions,
                      "permission",
                      (permission) =>
                        extensionPermissionLabel(permission, language)
                    )}
                    {optionalGroup(
                      extension,
                      tr("extension.optionalWebsites"),
                      extension.optionalOrigins,
                      "origin",
                      (origin) => extensionOriginLabel(origin, language)
                    )}
                    {optionalGroup(
                      extension,
                      tr("extension.optionalData"),
                      extension.optionalDataPermissions,
                      "data",
                      (permission) =>
                        extensionPermissionLabel(permission, language)
                    )}
                  </>
                )}
              </View>
            );
          })}
          <Text accessibilityRole="header" className={c.section}>
            {tr("extension.linkTitle")}
          </Text>
          <View className={c.card}>
            <Text className={c.detail}>{tr("extension.linkHelp")}</Text>
            <TextInput
              accessibilityLabel={tr("extension.linkLabel")}
              placeholder="https://addons.mozilla.org/…/addon/…/"
              placeholderTextColor={theme.inkMuted}
              className={c.linkInput}
              value={link}
              onChangeText={setLink}
              editable={!locked}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              maxLength={2048}
              returnKeyType="go"
              onSubmitEditing={installLink}
              disableFullscreenUI
            />
            {button(
              tr("extension.reviewInstall"),
              installLink,
              locked || !link.trim(),
              tr("extension.reviewLabel")
            )}
          </View>
          <Text accessibilityRole="header" className={c.section}>
            {tr("extension.compatTitle")}
          </Text>
          <View className={c.card}>
            <Text className={c.detail}>{tr("extension.compatIntro")}</Text>
            <Text className={c.detail}>• {tr("extension.compatStore")}</Text>
            <Text className={c.detail}>
              • {tr("extension.compatServiceWorker")}
            </Text>
            <Text className={c.detail}>• {tr("extension.compatApis")}</Text>
            <Text className={c.detail}>• {tr("extension.compatGrant")}</Text>
          </View>
        </>
      )}
    </View>
  );
}
