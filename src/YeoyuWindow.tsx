import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentRef,
} from "react";
import {
  AppState,
  DeviceEventEmitter,
  Pressable,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useResolveClassNames, withUniwind } from "uniwind";
import "@styles/global.css";
import { ThemeScope } from "@/ui/ThemeScope";
import { cn } from "@/ui/cn";
import { controlVariants } from "@/ui/variants";
import Surface, {
  Commands,
  type Navigation,
} from "@modules/browser-surface/src/BrowserSurfaceNativeComponent";
import { controller } from "@/controllerRuntime";
import { platform } from "@/platform";
import { normalizeInput, type SearchEngineId } from "@/suggestions";
import {
  answerBrowserPermission,
  initializeBrowserPermissions,
  listenBrowserPermissions,
  permissionRequests,
} from "@/browserPermissionRuntime";
import { permissionKindsFromEvent } from "@/permissions";
import { PermissionDialog } from "@/components/Dialogs";
import type { PermissionChoice } from "@/permissionRequests";
import { NEW_TAB_URL } from "@/BrowserController";
import { ChromeIcon, type IconName } from "@/chrome/ChromeIcon";
import { addressShield } from "@/components/AddressTrigger";
import type { BrowserSecurity } from "@/hooks/useBrowserWorkflows";
import { ThemeContext } from "@/themeContext";
import { I18nContext, useI18n } from "@/i18nContext";
import { type Theme } from "@/theme";
import { useInputViewport } from "@/hooks/useInputViewport";
import { resolveTheme } from "@/theme";
import { resolveLanguage } from "@/i18n";
import {
  defaultUiPreferences,
  loadUiPreferences,
  type ResolvedColorMode,
  type UiPreferences,
} from "@/uiPreferences";

// Compact OS-window chrome: one tab, no sidebar. The main Activity remains
// the Arc browser; this root only mirrors chrome state for its own tab.
const WindowSafeArea = withUniwind(SafeAreaView);

export default function YeoyuWindow(props: {
  tabId?: string;
  windowId?: string;
}) {
  const [prefs, setPrefs] = useState<UiPreferences | null>(null);
  const [preferencesFailed, setPreferencesFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [deviceLocale, setDeviceLocale] = useState("en");
  const systemScheme = useColorScheme();

  useEffect(() => {
    let live = true;
    let readGeneration = 0;
    const refresh = () => {
      const read = ++readGeneration;
      setPreferencesFailed(false);
      void Promise.all([
        loadUiPreferences(platform.readUiPreferences?.bind(platform)),
        initializeBrowserPermissions().then(() => controller.initialize()),
      ]).then(
        ([next]) => {
          if (live && read === readGeneration) setPrefs(next);
        },
        () => {
          if (live && read === readGeneration) setPreferencesFailed(true);
        }
      );
      if (typeof platform.getDeviceLanguage === "function") {
        void platform
          .getDeviceLanguage()
          .then((locale) => {
            if (live) setDeviceLocale(locale);
          })
          .catch(() => {});
      }
    };
    refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      live = false;
      subscription.remove();
    };
  }, [refreshKey]);

  const resolved = resolveTheme(
    prefs ?? defaultUiPreferences,
    "",
    (systemScheme ?? null) as ResolvedColorMode | null
  );
  const language = resolveLanguage(
    (prefs ?? defaultUiPreferences).language,
    deviceLocale
  );
  return (
    <SafeAreaProvider>
      <ThemeContext.Provider value={resolved}>
        <ThemeScope theme={resolved}>
          <I18nContext.Provider value={language}>
            {prefs ? (
              <WindowBody
                initialTabId={props.tabId}
                windowId={props.windowId}
                theme={resolved}
                searchEngine={prefs.searchEngine}
              />
            ) : (
              <WindowStartup
                failed={preferencesFailed}
                onRetry={() => setRefreshKey((value) => value + 1)}
              />
            )}
          </I18nContext.Provider>
        </ThemeScope>
      </ThemeContext.Provider>
    </SafeAreaProvider>
  );
}

function WindowStartup({
  failed,
  onRetry,
}: {
  failed: boolean;
  onRetry: () => void;
}) {
  const { tr } = useI18n();
  return (
    <WindowSafeArea className="flex-1 bg-chrome p-xxl justify-center items-center gap-xl">
      <Text
        accessibilityRole={failed ? "alert" : "text"}
        className="text-ink text-input-plus"
      >
        {tr(failed ? "window.preferencesFailed" : "chrome.opening")}
      </Text>
      {failed && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("common.retry")}
          onPress={onRetry}
          className={cn(
            controlVariants({ size: "action", tone: "sunken" }),
            "p-xxl active:opacity-pressed"
          )}
        >
          <Text className="text-ink text-input">{tr("common.retry")}</Text>
        </Pressable>
      )}
    </WindowSafeArea>
  );
}

function WindowBody({
  initialTabId,
  windowId,
  theme,
  searchEngine,
}: {
  initialTabId?: string;
  windowId?: string;
  theme: Theme;
  searchEngine: SearchEngineId;
}) {
  const { tr } = useI18n();
  // The generated Fabric host receives the compiled layout at its native seam.
  const surfaceStyle = useResolveClassNames("flex-1");
  const [tabId, setTabId] = useState<string | null>(initialTabId ?? null);
  const { keyboardInset } = useInputViewport(tabId ?? "");
  const [nav, setNav] = useState<Navigation>({
    tabId: initialTabId ?? "",
    url: "",
    title: "",
    loading: false,
    canGoBack: false,
    canGoForward: false,
  });
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [security, setSecurity] = useState<BrowserSecurity | null>(null);
  const surfaceRef = useRef<ComponentRef<typeof Surface>>(null);
  useEffect(listenBrowserPermissions, []);
  const getPermissionRequest = useCallback(
    () =>
      permissionRequests.getSnapshotFor((request) => request.tabId === tabId),
    [tabId]
  );
  const permissionRequest = useSyncExternalStore(
    permissionRequests.subscribe,
    getPermissionRequest
  );
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const decidePermission = (choice: PermissionChoice) => {
    if (!permissionRequest) return;
    setPermissionError(null);
    void answerBrowserPermission(permissionRequest.requestId, choice).catch(
      (failure) =>
        setPermissionError(
          failure instanceof Error ? failure.message : String(failure)
        )
    );
  };
  useEffect(() => {
    if (!tabId) return;
    platform.configureWindowPermissionPrompt?.(tabId, !!permissionRequest);
    const subscription = DeviceEventEmitter.addListener(
      "BrowserWindowPermissionDismiss",
      (event: { tabId: string }) => {
        if (event.tabId === tabId && permissionRequest)
          decidePermission("dismiss");
      }
    );
    return () => {
      subscription.remove();
      platform.configureWindowPermissionPrompt?.(tabId, false);
    };
  }, [tabId, permissionRequest]);

  // Every native launch carries its Activity's immutable token. Focus changes
  // cannot lend another root's mission to this delayed lookup.
  const [missionResolved, setMissionResolved] = useState(!!initialTabId);
  const [missionFailed, setMissionFailed] = useState(false);
  const [missionAttempt, setMissionAttempt] = useState(0);
  const unboundTab = useRef<string | null>(null);
  useEffect(() => {
    if (initialTabId || tabId || missionResolved) return;
    let live = true;
    let attempts = 0;
    setMissionFailed(false);
    let timer: ReturnType<typeof setTimeout>;
    const pull = () => {
      if (!live || tabId || missionResolved) return;
      void Promise.resolve()
        .then(() =>
          windowId && platform.windowMissionFor
            ? platform.windowMissionFor(windowId)
            : null
        )
        .then((mission) => {
          if (!live || tabId || missionResolved) return;
          if (mission != null) {
            setMissionResolved(true);
            if (mission !== "") setTabId(mission);
            return;
          }
          if (++attempts <= 8) timer = setTimeout(pull, 350);
          else setMissionFailed(true);
        })
        .catch(() => {
          if (live && ++attempts <= 8) timer = setTimeout(pull, 350);
          else if (live) setMissionFailed(true);
        });
    };
    timer = setTimeout(pull, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [initialTabId, windowId, tabId, missionResolved, missionAttempt]);

  // A fresh window mints its own tab in the global session, then binds it so
  // the coordinator (and the main sidebar) knows this tab lives in a window.
  // Tab creation activates globally, so main's previous focus is restored.
  useEffect(() => {
    if (tabId || !missionResolved) return;
    let live = true;
    const previous = controller.snapshot?.activeTabId ?? null;
    const created = unboundTab.current
      ? Promise.resolve({ activeTabId: unboundTab.current })
      : controller.createTab(
          NEW_TAB_URL,
          controller.snapshot?.activeWorkspaceId,
          {}
        );
    void created
      .then(async (snapshot) => {
        if (!live) return;
        const id = snapshot.activeTabId ?? null;
        if (id) {
          unboundTab.current = id;
          if (!windowId || !platform.bindWindowTabFor)
            throw new Error("Window owner is unavailable");
          await platform.bindWindowTabFor(windowId, id);
          if (!live) return;
          unboundTab.current = null;
          setTabId(id);
          if (previous && previous !== id)
            controller.activate(previous, [previous]).catch(() => {});
        }
      })
      .catch(() => {
        if (live) setMissionFailed(true);
      });
    return () => {
      live = false;
    };
  }, [tabId, windowId, missionResolved]);

  const applyNavigation = useCallback(
    (event: Navigation) => {
      if (event.tabId !== tabId) return;
      setNav(event);
      if (!editing) setDraft(event.url === NEW_TAB_URL ? "" : event.url);
    },
    [tabId, editing]
  );

  useEffect(() => {
    if (!tabId) return;
    const sync = () => {
      const tab = controller.snapshot?.tabs.find((item) => item.id === tabId);
      if (tab) {
        setNav((old) => ({
          tabId,
          url: tab.url,
          title: tab.title,
          loading: false,
          canGoBack: old.canGoBack,
          canGoForward: old.canGoForward,
        }));
        if (!editing) setDraft(tab.url === NEW_TAB_URL ? "" : tab.url);
      }
    };
    sync();
    const unsubscribe = controller.subscribe(sync);
    const subscription = DeviceEventEmitter.addListener(
      "BrowserNavigation",
      applyNavigation
    );
    const securitySubscription = DeviceEventEmitter.addListener(
      "BrowserSecurity",
      (event: BrowserSecurity) => {
        if (event.tabId === tabId) setSecurity(event);
      }
    );
    return () => {
      unsubscribe();
      subscription.remove();
      securitySubscription.remove();
    };
  }, [tabId, applyNavigation, editing]);

  const submitAddress = () => {
    if (!tabId) return;
    const url = normalizeInput(draft, searchEngine);
    if (!url) return;
    setEditing(false);
    platform.loadTabUrl?.(tabId, url);
  };

  // The surface mounts once per tab: its initialUrl must be the tab's real
  // address. nav.url is still empty at mount time, and passing the new-tab
  // placeholder would navigate the adopted session to about:blank.
  const boundUrl =
    controller.snapshot?.tabs.find((item) => item.id === tabId)?.url ?? "";
  const isPrivate =
    tabId != null &&
    controller.snapshot?.tabs.find((item) => item.id === tabId)?.private ===
      true;

  // Same trust read as the main browser's address pill.
  const shield = addressShield(nav.url || boundUrl, security ?? undefined);
  const shieldGlyph: IconName | null =
    shield === "secure" ? "lock" : shield === "attention" ? "warning" : null;

  const iconButton = (
    icon: "back" | "forward" | "reload" | "close",
    label: string,
    disabled: boolean,
    onPress: () => void
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      className={cn(
        controlVariants({ disabled }),
        !disabled && "active:opacity-pressed"
      )}
    >
      <ChromeIcon name={icon} size={18} />
    </Pressable>
  );

  return (
    <WindowSafeArea
      className="flex-1 bg-chrome"
      edges={["top", "left", "right", "bottom"]}
    >
      <View
        className="flex-1"
        pointerEvents={permissionRequest ? "none" : "auto"}
        importantForAccessibility={
          permissionRequest ? "no-hide-descendants" : "auto"
        }
      >
        <View className="flex-row items-center gap-sm px-md h-input border-b-hairline-width border-hairline-on-chrome bg-chrome">
          {iconButton("back", tr("chrome.back"), !nav.canGoBack, () => {
            const ref = surfaceRef.current;
            if (ref) Commands.goBack(ref);
          })}
          {iconButton(
            "forward",
            tr("chrome.forward"),
            !nav.canGoForward,
            () => {
              const ref = surfaceRef.current;
              if (ref) Commands.goForward(ref);
            }
          )}
          {iconButton("reload", tr("chrome.reload"), false, () => {
            const ref = surfaceRef.current;
            if (ref) Commands.reload(ref);
          })}
          {isPrivate && (
            <View
              accessibilityRole="text"
              accessibilityLabel={tr("chrome.private")}
              className="flex-row items-center px-xs h-address-compact rounded-control bg-sunken"
            >
              <ChromeIcon name="private" size={15} color={theme.inkMuted} />
            </View>
          )}
          <View className="flex-1 min-w-0 flex-row items-center h-address-compact px-md gap-sm rounded-control bg-sunken">
            {shieldGlyph && (
              <ChromeIcon
                name={shieldGlyph}
                size={15}
                color={
                  shieldGlyph === "warning" ? theme.errorInk : theme.inkMuted
                }
              />
            )}
            <TextInput
              accessibilityLabel={tr("address.edit")}
              value={editing ? draft : nav.url === NEW_TAB_URL ? "" : nav.url}
              onChangeText={(value) => {
                setEditing(true);
                setDraft(value);
              }}
              onFocus={() => {
                setEditing(true);
                setDraft(nav.url === NEW_TAB_URL ? "" : nav.url);
              }}
              onSubmitEditing={submitAddress}
              onEndEditing={() => setEditing(false)}
              autoCapitalize="none"
              autoCorrect={false}
              disableFullscreenUI
              keyboardType="url"
              maxFontSizeMultiplier={1.35}
              placeholder={tr("address.placeholder")}
              placeholderTextColor={theme.inkFaint}
              numberOfLines={1}
              className="flex-1 min-w-0 text-ink text-input"
            />
          </View>
          {iconButton("close", tr("common.close"), false, () => {
            void (
              windowId && platform.closeWindowFor
                ? platform.closeWindowFor(windowId)
                : tabId
                ? platform.closeWindowForTab?.(tabId)
                : undefined
            )?.catch((failure) => setPermissionError(String(failure)));
          })}
        </View>
        <View className="flex-1 bg-canvas">
          {tabId ? (
            <Surface
              key={tabId}
              ref={surfaceRef}
              style={surfaceStyle}
              tabId={tabId}
              initialUrl={nav.url || boundUrl || NEW_TAB_URL}
              active
              onNavigation={(e) => applyNavigation(e.nativeEvent)}
            />
          ) : (
            <View className="flex-1 items-center justify-center">
              <Text
                className="text-ink-faint text-body"
                accessibilityRole={missionFailed ? "alert" : "text"}
              >
                {tr(
                  missionFailed ? "window.preferencesFailed" : "chrome.opening"
                )}
              </Text>
              {missionFailed && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={tr("common.retry")}
                  className={cn(
                    controlVariants({ size: "action", tone: "sunken" }),
                    "px-xxl active:opacity-pressed"
                  )}
                  onPress={() => {
                    setMissionResolved(false);
                    setMissionAttempt((value) => value + 1);
                  }}
                >
                  <Text className="text-ink text-input">
                    {tr("common.retry")}
                  </Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
        {permissionError && (
          <Text accessibilityRole="alert" className="text-error-ink p-xl">
            {permissionError}
          </Text>
        )}
      </View>
      {permissionRequest && (
        <View
          className="absolute inset-0 z-40 bg-scrim justify-center items-center"
          style={{ bottom: keyboardInset }}
        >
          <PermissionDialog
            request={{
              origin: permissionRequest.origin,
              kinds: permissionKindsFromEvent(permissionRequest.kind),
              ephemeral: permissionRequest.ephemeral,
            }}
            onDecide={decidePermission}
            onDismiss={() => decidePermission("dismiss")}
          />
        </View>
      )}
    </WindowSafeArea>
  );
}
