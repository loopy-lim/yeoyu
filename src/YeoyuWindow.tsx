import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentRef,
} from "react";
import {
  AppState,
  DeviceEventEmitter,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Surface, {
  Commands,
  type Navigation,
} from "../modules/browser-surface/src/BrowserSurfaceNativeComponent";
import { controller } from "./controllerRuntime";
import { platform } from "./platform";
import { NEW_TAB_URL } from "./BrowserController";
import { ChromeIcon, type IconName } from "./chrome/ChromeIcon";
import { addressShield } from "./components/AddressTrigger";
import type { BrowserSecurity } from "./hooks/useBrowserWorkflows";
import { ThemeContext, useTheme } from "./themeContext";
import { I18nContext, useI18n } from "./i18nContext";
import { font, radius, size, space, type Theme } from "./theme";
import { resolveTheme } from "./theme";
import { resolveLanguage } from "./i18n";
import {
  defaultUiPreferences,
  loadUiPreferences,
  type ResolvedColorMode,
  type UiPreferences,
} from "./uiPreferences";

// Compact OS-window chrome: one tab, no sidebar. The main Activity remains
// the Arc browser; this root only mirrors chrome state for its own tab.
export default function YeoyuWindow(props: { tabId?: string }) {
  const [prefs, setPrefs] = useState<UiPreferences | null>(null);
  const [deviceLocale, setDeviceLocale] = useState("en");
  const systemScheme = useColorScheme();

  useEffect(() => {
    let live = true;
    const refresh = () => {
      void loadUiPreferences(platform.readUiPreferences?.bind(platform)).then(
        (next) => {
          if (live) setPrefs(next);
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
  }, []);

  const resolved =
    prefs === null
      ? null
      : resolveTheme(prefs, "", (systemScheme ?? null) as ResolvedColorMode | null);
  if (!resolved) return null;
  const language = resolveLanguage(prefs!.language, deviceLocale);
  return (
    <ThemeContext.Provider value={resolved}>
      <I18nContext.Provider value={language}>
        <WindowBody initialTabId={props.tabId} theme={resolved} />
      </I18nContext.Provider>
    </ThemeContext.Provider>
  );
}

function WindowBody({
  initialTabId,
  theme,
}: {
  initialTabId?: string;
  theme: Theme;
}) {
  const { tr } = useI18n();
  const [tabId, setTabId] = useState<string | null>(initialTabId ?? null);
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

  // Initial props may not survive every bridgeless surface path, and the
  // bridge fallback only answers once THIS activity is the current one. The
  // mission pull retries until the coordinator can identify us: an existing
  // tab id binds it, "" means a fresh window, null keeps retrying.
  const [missionResolved, setMissionResolved] = useState(!!initialTabId);
  useEffect(() => {
    if (initialTabId || tabId || missionResolved) return;
    let live = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const pull = () => {
      if (!live || tabId || missionResolved) return;
      void Promise.resolve()
        .then(() => platform.windowMission?.() ?? null)
        .then((mission) => {
          if (!live || tabId || missionResolved) return;
          if (mission != null) {
            setMissionResolved(true);
            if (mission !== "") setTabId(mission);
            return;
          }
          if (++attempts <= 8) timer = setTimeout(pull, 350);
        })
        .catch(() => {
          if (live && ++attempts <= 8) timer = setTimeout(pull, 350);
        });
    };
    timer = setTimeout(pull, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [initialTabId, tabId, missionResolved]);

  // A fresh window mints its own tab in the global session, then binds it so
  // the coordinator (and the main sidebar) knows this tab lives in a window.
  // Tab creation activates globally, so main's previous focus is restored.
  useEffect(() => {
    if (tabId || !missionResolved) return;
    let live = true;
    const previous = controller.snapshot?.activeTabId ?? null;
    void controller
      .createTab(NEW_TAB_URL, controller.snapshot?.activeWorkspaceId, {})
      .then((snapshot) => {
        if (!live) return;
        const id = snapshot.activeTabId ?? null;
        if (id) {
          setTabId(id);
          void platform.bindWindowTab?.(id);
          if (previous && previous !== id)
            controller.activate(previous, [previous]).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [tabId, missionResolved]);

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
    const typed = draft.trim();
    if (!typed) return;
    const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`;
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
  const shield = addressShield(
    nav.url || boundUrl,
    security ?? undefined
  );
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
      style={({ pressed }) => ({
        width: size.iconButton,
        height: size.iconButton,
        borderRadius: radius.control,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        opacity: disabled ? 0.35 : pressed ? 0.6 : 1,
      })}
    >
      <ChromeIcon name={icon} size={18} />
    </Pressable>
  );

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.chrome }}
      edges={["top"]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.md,
          height: size.input,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.hairlineOnChrome,
          backgroundColor: theme.chrome,
        }}
      >
        {iconButton("back", tr("chrome.back"), !nav.canGoBack, () => {
          const ref = surfaceRef.current;
          if (ref) Commands.goBack(ref);
        })}
        {iconButton("forward", tr("chrome.forward"), !nav.canGoForward, () => {
          const ref = surfaceRef.current;
          if (ref) Commands.goForward(ref);
        })}
        {iconButton("reload", tr("chrome.reload"), false, () => {
          const ref = surfaceRef.current;
          if (ref) Commands.reload(ref);
        })}
        {isPrivate && (
          <View
            accessibilityRole="text"
            accessibilityLabel={tr("chrome.private")}
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: space.xs,
              height: size.addressCompact,
              borderRadius: radius.control,
              backgroundColor: theme.sunken,
            }}
          >
            <ChromeIcon name="private" size={15} color={theme.inkMuted} />
          </View>
        )}
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            height: size.addressCompact,
            paddingHorizontal: space.md,
            gap: space.sm,
            borderRadius: radius.control,
            backgroundColor: theme.sunken,
          }}
        >
          {shieldGlyph && (
            <ChromeIcon
              name={shieldGlyph}
              size={15}
              color={shieldGlyph === "warning" ? theme.errorInk : theme.inkMuted}
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
            style={{
              flex: 1,
              color: theme.ink,
              fontSize: font.input,
            }}
          />
        </View>
        {iconButton("close", tr("common.close"), false, () =>
          platform.closeWindow?.()
        )}
      </View>
      <View style={{ flex: 1, backgroundColor: theme.canvas }}>
        {tabId ? (
              <Surface
                key={tabId}
                ref={surfaceRef}
                style={{ flex: 1 }}
                tabId={tabId}
                initialUrl={nav.url || boundUrl || NEW_TAB_URL}
                active
                onNavigation={(e) => applyNavigation(e.nativeEvent)}
              />
        ) : (
          <View
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: theme.inkFaint, fontSize: font.body }}>
              {tr("chrome.opening")}
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
