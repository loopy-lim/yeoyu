import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  AppState,
  Image,
  Pressable,
  StyleSheet,
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
} from "../browserExtensions";
import { useTheme } from "../themeContext";
import { useI18n } from "../i18nContext";
import { mozillaExtensionSource } from "../extensionLinks";
import { HapticSwitch } from "../chrome/HapticSwitch";

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
  const s = useMemo(
    () =>
      StyleSheet.create({
        section: {
          marginTop: 20,
          marginBottom: 8,
          fontSize: 16,
          fontWeight: "700",
          color: theme.ink,
        },
        card: {
          marginVertical: 8,
          padding: 14,
          gap: 10,
          borderRadius: 12,
          backgroundColor: theme.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.hairline,
        },
        title: { fontSize: 16, fontWeight: "600", color: theme.ink },
        text: { fontSize: 14, lineHeight: 21, color: theme.ink },
        detail: { fontSize: 14, lineHeight: 21, color: theme.inkMuted },
        error: { fontSize: 14, lineHeight: 21, color: theme.errorInk },
        row: {
          minHeight: 48,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        },
        grow: { flex: 1, minWidth: 0 },
        actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
        action: {
          minHeight: 48,
          flexShrink: 1,
          justifyContent: "center",
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: 8,
          backgroundColor: theme.sunken,
        },
        disabled: { opacity: 0.5 },
        linkInput: {
          minHeight: 48,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderWidth: 1,
          borderColor: theme.hairline,
          borderRadius: 8,
          backgroundColor: theme.sunken,
          color: theme.ink,
          fontSize: 14,
        },
        permissionGroup: { gap: 4, marginTop: 8 },
        resultRow: { flexDirection: "row", gap: 12, marginTop: 10 },
        resultIcon: {
          width: 40,
          height: 40,
          borderRadius: 10,
          backgroundColor: theme.sunken,
        },
        resultGrow: { flex: 1, minWidth: 0, gap: 2 },
        resultName: { fontSize: 15, fontWeight: "600", color: theme.ink },
        headlineRow: { flexDirection: "row", gap: 12, alignItems: "center" },
        headlineIcon: {
          width: 36,
          height: 36,
          borderRadius: 9,
          backgroundColor: theme.sunken,
        },
      }),
    [theme]
  );
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
  const report = useCallback((failure: unknown) => {
    const message = extensionErrorMessage(failure);
    const localized = tr("extension.error", { detail: localizeExtensionError(message, language) });
    setError(localized);
    errorCallback.current?.(localized);
  }, [tr, language]);

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
      tr(kind === "update" ? "extension.checkingUpdates" : "extension.saving", { name: extension.name }),
      () => requireBrowserExtensions().modify(extension.id, kind, value),
      (next) =>
        kind === "remove" &&
        !next.extensions.some((entry) => entry.id === extension.id)
          ? tr("extension.removed", { name: extension.name })
          : kind === "update"
          ? tr("extension.updateDone", { version: next.extensions.find((entry) => entry.id === extension.id)?.version ?? extension.version })
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
      () =>
        tr("extension.installDone")
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
        setSearchError(tr("extension.error", { detail: localizeExtensionError(extensionErrorMessage(failure), language) }));
      }
    } finally {
      if (live.current) setSearching(false);
    }
  };
  const searchEntry = (result: ExtensionSearchResult): ExtensionCatalogEntry => ({
    slug: result.slug,
    id: result.guid ?? "",
    name: result.name,
    description: result.summary,
    sourceUrl: `https://addons.mozilla.org/firefox/addon/${result.slug}/`,
  });
  const revoke = (extension: InstalledBrowserExtension, kind: ExtensionOptionalKind, value: string) =>
    perform(
      tr("extension.revoking", { name: extension.name }),
      () => requireBrowserExtensions().revokeOptional(extension.id, kind, value),
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
      if (kind === "action") await native.openAction(extension.id, anchor.x, anchor.y);
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
      style={[s.action, disabled && s.disabled]}
    >
      <Text style={s.text}>{label}</Text>
    </Pressable>
  );
  const permissionGroup = (
    label: string,
    values: string[],
    format = (value: string) => extensionPermissionLabel(value, language)
  ) => (
    <View style={s.permissionGroup}>
      <Text style={s.title}>{label}</Text>
      {values.length ? (
        [...new Set(values)].map((value) => (
          <Text key={value} selectable style={s.detail}>
            • {format(value)}
          </Text>
        ))
      ) : (
        <Text style={s.detail}>{tr("extension.none")}</Text>
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
      <View style={s.permissionGroup}>
        <Text style={s.title}>{label}</Text>
        {uniqueValues.length ? (
          uniqueValues.map((value) => (
            <View key={value} style={s.row}>
              <Text selectable style={[s.detail, s.grow]}>
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
                style={[s.action, locked && s.disabled]}
              >
                <Text style={s.text}>{tr("extension.revoke")}</Text>
              </Pressable>
            </View>
          ))
        ) : (
          <Text style={s.detail}>{tr("extension.none")}</Text>
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
      <Text style={s.text}>
        {tr("extension.intro")}
      </Text>
      <Text style={[s.detail, { marginTop: 8 }]}>
        {tr("extension.storage")}
      </Text>
      {!!pending && (
        <Text
          accessibilityLiveRegion="polite"
          style={[s.detail, { marginVertical: 10 }]}
        >
          {pending}
        </Text>
      )}
      {!!state?.busy && !pending && (
        <Text accessibilityLiveRegion="polite" style={s.detail}>
          {tr("extension.busy")}
        </Text>
      )}
      {!!error && (
        <View style={s.card}>
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
          {stale && !!state && (
            <Text style={s.detail}>
              {tr("extension.stale")}
            </Text>
          )}
        </View>
      )}
      {!!notice && (
        <Text
          accessibilityLiveRegion="polite"
          style={[s.detail, { marginVertical: 10 }]}
        >
          {notice}
        </Text>
      )}
      <View style={[s.actions, { marginVertical: 10 }]}>
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
          <Text accessibilityRole="header" style={s.section}>
            {tr("extension.searchTitle")}
          </Text>
          <View style={s.card}>
            <Text style={s.detail}>
              {tr("extension.searchHelp")}
            </Text>
            <TextInput
              accessibilityLabel={tr("extension.searchLabel")}
              placeholder={tr("extension.searchPlaceholder")}
              placeholderTextColor={theme.inkMuted}
              style={s.linkInput}
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
              <Text accessibilityLiveRegion="polite" style={s.detail}>
                {tr("extension.searching")}
              </Text>
            )}
            {!!searchError && (
              <Text accessibilityRole="alert" style={s.error}>
                {searchError}
              </Text>
            )}
            {searchResults !== null && searchResults.length === 0 && (
              <Text style={s.detail}>{tr("extension.searchEmpty")}</Text>
            )}
            {searchResults !== null &&
              searchResults.map((result) => {
                const installedHere = !!result.guid &&
                  state.extensions.some((entry) => entry.id === result.guid);
                return (
                  <View key={result.slug} style={s.resultRow}>
                    {result.iconUrl ? (
                      <Image
                        source={{ uri: result.iconUrl }}
                        style={s.resultIcon}
                      />
                    ) : (
                      <View style={[s.resultIcon, { alignItems: "center", justifyContent: "center" }]}>
                        <Text style={{ fontSize: 17, fontWeight: "600", color: theme.ink }}>
                          {result.name.trim().slice(0, 1).toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View style={s.resultGrow}>
                      <Text style={s.resultName}>{result.name}</Text>
                      {!!result.summary && (
                        <Text numberOfLines={2} style={s.detail}>
                          {result.summary}
                        </Text>
                      )}
                      <View style={s.actions}>
                        {installedHere ? (
                          <Text style={[s.detail, { paddingVertical: 10 }]}>
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
              <Text accessibilityRole="header" style={[s.section, { marginTop: 8, fontSize: 14 }]}>
                {tr("extension.recommended")}
              </Text>
            )}
            {state.catalog.map((entry) => {
              const installedHere = state.extensions.some(
                (extension) => extension.id === entry.id
              );
              return (
                <View key={entry.slug} style={s.resultRow}>
                  <View style={[s.resultIcon, { alignItems: "center", justifyContent: "center" }]}>
                    <Text style={{ fontSize: 17, fontWeight: "600", color: theme.ink }}>
                      {entry.name.trim().slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View style={s.resultGrow}>
                    <Text style={s.resultName}>{entry.name}</Text>
                    {!!entry.description && (
                      <Text numberOfLines={2} style={s.detail}>
                        {entry.description}
                      </Text>
                    )}
                    <View style={s.actions}>
                      {installedHere ? (
                        <Text style={[s.detail, { paddingVertical: 10 }]}>
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
          <Text accessibilityRole="header" style={s.section}>
            {tr("extension.installedTitle")}
          </Text>
          {state.extensions.length === 0 && (
            <Text style={s.detail}>{tr("extension.empty")}</Text>
          )}
          {state.extensions.map((extension) => {
            const usableHere =
              extension.enabled && (!privateTab || extension.privateAllowed);
            return (
              <View key={extension.id} style={s.card}>
                <View style={s.headlineRow}>
                  {extension.icon !== "" ? (
                    <Image source={{ uri: extension.icon }} style={s.headlineIcon} />
                  ) : (
                    <View style={[s.headlineIcon, { alignItems: "center", justifyContent: "center" }]}>
                      <Text style={{ fontSize: 15, fontWeight: "600", color: theme.ink }}>
                        {extension.name.trim().slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={s.grow}>
                    <Text style={s.title}>{extension.name}</Text>
                    <Text style={s.detail}>
                      {tr("extension.version", { version: extension.version,
                        status: tr(extension.enabled ? "extension.enabled" : "extension.disabled") })}
                    </Text>
                  </View>
                </View>
                {!!extension.description && (
                  <Text numberOfLines={4} style={s.detail}>
                    {extension.description}
                  </Text>
                )}
                <View style={s.row}>
                  <Text style={[s.text, s.grow]}>{tr("extension.enabled")}</Text>
                  <HapticSwitch
                    {...switchColors}
                    accessibilityLabel={tr("extension.enableLabel", { name: extension.name })}
                    disabled={locked}
                    value={extension.enabled}
                    onValueChange={(enabled) =>
                      modify(extension, "enabled", enabled)
                    }
                  />
                </View>
                <View style={s.row}>
                  <View style={s.grow}>
                    <Text style={s.text}>{tr("extension.private")}</Text>
                    <Text style={s.detail}>
                      {tr("extension.privateDetail")}
                    </Text>
                  </View>
                  <HapticSwitch
                    {...switchColors}
                    accessibilityLabel={tr("extension.privateLabel", { name: extension.name })}
                    disabled={locked}
                    value={extension.privateAllowed}
                    onValueChange={(allowed) => setPrivate(extension, allowed)}
                  />
                </View>
                {!extension.enabled && extension.disabledFlags !== 0 && (
                  <Text style={s.detail}>
                    {tr("extension.disabledHelp")}
                  </Text>
                )}
                {privateTab && !extension.privateAllowed && (
                  <Text style={s.detail}>
                    {tr("extension.privateUnavailable")}
                  </Text>
                )}
                {!tabId && (
                  <Text style={s.detail}>
                    {tr("extension.openPage")}
                  </Text>
                )}
                {!!extension.badge && usableHere && (
                  <Text style={s.detail}>
                    {tr("extension.badge", { badge: extension.badge })}
                  </Text>
                )}
                <View style={s.actions}>
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
                  style={s.action}
                >
                  <Text style={s.text}>
                    {tr(expanded[extension.id] ? "extension.hidePermissions" : "extension.viewPermissions")}
                  </Text>
                </Pressable>
                {!!expanded[extension.id] && (
                  <>
                    <Text style={s.detail}>
                      {tr("extension.permissionsHelp")}
                    </Text>
                    {permissionGroup(tr("extension.capabilities"), extension.permissions)}
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
                      (permission) => extensionPermissionLabel(permission, language)
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
                      (permission) => extensionPermissionLabel(permission, language)
                    )}
                  </>
                )}
              </View>
            );
          })}
          <Text accessibilityRole="header" style={s.section}>
            {tr("extension.linkTitle")}
          </Text>
          <View style={s.card}>
            <Text style={s.detail}>
              {tr("extension.linkHelp")}
            </Text>
            <TextInput
              accessibilityLabel={tr("extension.linkLabel")}
              placeholder="https://addons.mozilla.org/…/addon/…/"
              placeholderTextColor={theme.inkMuted}
              style={s.linkInput}
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
          <Text accessibilityRole="header" style={s.section}>
            {tr("extension.compatTitle")}
          </Text>
          <View style={s.card}>
            <Text style={s.detail}>
              {tr("extension.compatIntro")}
            </Text>
            <Text style={s.detail}>• {tr("extension.compatStore")}</Text>
            <Text style={s.detail}>• {tr("extension.compatServiceWorker")}</Text>
            <Text style={s.detail}>• {tr("extension.compatApis")}</Text>
            <Text style={s.detail}>• {tr("extension.compatGrant")}</Text>
          </View>
        </>
      )}
    </View>
  );
}
