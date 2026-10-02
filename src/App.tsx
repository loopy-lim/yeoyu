import "@styles/global.css";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  FlatList,
  Switch,
  DeviceEventEmitter,
  Platform,
  Animated,
  AppState,
  BackHandler,
  PanResponder,
  PixelRatio,
  useWindowDimensions,
  useColorScheme,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView as NativeSafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import NativeSurface, {
  Commands,
  type Navigation,
} from "@modules/browser-surface/src/BrowserSurfaceNativeComponent";
import { controller } from "@/controllerRuntime";
import { focusBrowserWindow } from "@/browserFocus";
import { useBrowserWorkflows } from "@/hooks/useBrowserWorkflows";
import { usePictureInPicture } from "@/hooks/usePictureInPicture";
import { useExternalPictureInPicture } from "@/hooks/useExternalPictureInPicture";
import { useExternalPipReturnLayout } from "@/hooks/useExternalPipReturnLayout";
import { useContentFullscreen } from "@/hooks/useContentFullscreen";
import { usePipLayout, advanceSidebarWindow } from "@/hooks/usePipLayout";
import { PictureInPictureSettings } from "@/components/PictureInPictureSettings";
import { BrowserToolsPanel } from "@/components/BrowserToolsPanel";
import { BrowserDataPanel } from "@/components/BrowserDataPanel";
import { AppearanceSettings } from "@/components/AppearanceSettings";
import { ConsentSettings } from "@/components/ConsentSettings";
import { ExtensionsSettings } from "@/components/ExtensionsSettings";
import { ExtensionActionsBar } from "@/components/ExtensionActionsBar";
import {
  browserExtensions,
  extensionErrorMessage,
  localizeExtensionError,
} from "@/browserExtensions";
import {
  useExtensionActions,
  type ExtensionToolbarAction,
} from "@/browserExtensionActions";
import { SettingsDialog } from "@/components/SettingsDialog";
import { SettingsRow } from "@/components/SettingsRow";
import { I18nContext, useI18n } from "@/i18nContext";
import { resolveLanguage, translate, type TranslationKey } from "@/i18n";
import { useUiPreferencePersistence } from "@/hooks/useUiPreferencePersistence";
import { useWindowTabs } from "@/hooks/useWindowTabs";
import { useInputViewport } from "@/hooks/useInputViewport";
import { BrowserContentMenu } from "@/components/BrowserContentMenu";
import { retainLiveTabs } from "@/browserWorkflows";
import { NavigationEventOrder } from "@/navigationEvents";
import { NEW_TAB_URL } from "@/BrowserController";
import { favicons } from "@/favicons";
import { platform } from "@/platform";
import { history, type HistoryEntry } from "@/history";
import { SEARCH_ENGINES, type SearchEngineId } from "@/suggestions";
import { CommandRegistry, type ProductCommand } from "@/commandRegistry";
import { KeyboardSettings } from "@/components/KeyboardSettings";
import {
  defaultUiPreferences,
  resolveColorMode,
  FRAME_PX_MAX,
  FRAME_PX_MIN,
  FRAME_PX_STEP,
  FRAME_SIDES,
  loadUiPreferences,
  normalizeBoostHost,
  reduceUiPreferences,
  type PermissionKind,
} from "@/uiPreferences";
import { permissionKindsFromEvent } from "@/permissions";
import {
  sitePermissions,
  permissionRequests,
  listenBrowserPermissions,
  initializeBrowserPermissions,
  answerBrowserPermission,
  subscribeSitePermissionChanges,
} from "@/browserPermissionRuntime";
import { type PermissionChoice } from "@/permissionRequests";
import type { KeyBinding } from "@generated/types";
import { DragSource } from "@/chrome/DragSource";
import {
  SidebarLayer,
  SidebarPressable,
  useSidebarActive,
} from "@/chrome/SidebarInteraction";
import { ContextPressable } from "@/chrome/ContextPressable";
import { FrameCoalescer } from "@/chrome/FrameCoalescer";
import {
  clampSidebarWidth,
  sidebarSizing,
  SIDEBAR_WIDTH_STEP,
} from "@/sidebarSizing";
import { DragLifecycle } from "@/dragLifecycle";
import { registerSurfaceRef } from "@/surfaceRefs";
import { PaneLoadBar } from "@/chrome/PaneLoadBar";
import { ChromeIcon, type IconName } from "@/chrome/ChromeIcon";
import {
  ActionMenu,
  type MenuAnchor,
  type MenuItem,
} from "@/components/ActionMenu";
import {
  bookmarkTabsForSpace,
  libraryItemsForSpace,
  favoriteDropIndex,
  liveSplitLayout,
  sidebarTabMoveIndex,
  sidebarDropChange,
  favoriteMoveIndex,
  sidebarAddressLabel,
  type TileBounds,
} from "@/sidebarModel";
import { Overlay } from "@/chrome/Overlay";
import { useReducedMotion } from "@/chrome/useReducedMotion";
import {
  useSidebarMotion,
  useSpaceMotion,
  useSplitMotion,
} from "@/chrome/useChromeMotion";
import { FolderDisclosure } from "@/chrome/FolderDisclosure";
import { easing } from "@/chrome/motion";
import { appClasses as c } from "@/chrome/appStyles";
import { cn } from "@/ui/cn";
import { cva } from "class-variance-authority";
import { controlVariants, rowVariants } from "@/ui/variants";
import { ThemeScope } from "@/ui/ThemeScope";
import { withUniwind } from "uniwind";
import { motion as motionTokens, resolveTheme, size, space } from "@/theme";
import { ThemeContext } from "@/themeContext";
import { Favicon } from "@/components/Favicon";
import {
  SidebarFolderItem,
  SidebarPageMenu,
  SplitSidebarItem,
} from "@/components/SidebarCollections";
import { sidebarPresentation, type SidebarFolder } from "@/sidebarPresentation";
import { AddressBox } from "@/components/AddressBox";
import { AddressTrigger } from "@/components/AddressTrigger";
import { FindBar } from "@/components/FindBar";
import {
  BoostsDialog,
  HistoryDialog,
  PermissionDialog,
  SpaceSwitcherDialog,
  TabContextMenuDialog,
} from "@/components/Dialogs";
import {
  clampSplitRatio,
  commitSplitDrop,
  dropZoneAt,
  type Bounds,
  type DropZone,
  type SplitLayout,
} from "@/splitLayout";

// Custom/native hosts resolve classes before merging measured or animated styles.
const AnimatedView = withUniwind(Animated.View);
const SafeAreaView = withUniwind(NativeSafeAreaView);
const Surface = withUniwind(NativeSurface);

type SurfaceRef = React.ElementRef<typeof Surface>;
type SuggestionSources = {
  favorites: { id?: string; url: string; title: string }[];
  bookmarks: { url: string; title: string }[];
  tabs: { id?: string; url: string; title: string }[];
  history: HistoryEntry[];
};
const buttonClasses = cva(c.button, {
  variants: { disabled: { true: c.disabled } },
});
const favoriteClasses = cva(c.favorite, {
  variants: { selected: { true: c.favoriteActive } },
});
const paneClasses = cva(c.pane, {
  variants: {
    focused: { true: c.paneFocused },
    fullscreen: { true: c.paneFullscreen },
    hidden: { true: c.hidden },
  },
});
const settingsChoiceClasses = cva(c.settingsAction, {
  variants: { selected: { true: "bg-sunken-strong" } },
});

const Button = ({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) => {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      className={buttonClasses({ disabled })}
      onPress={onPress}
    >
      <Text className={c.buttonText}>{label}</Text>
    </Pressable>
  );
};
const IconButton = ({
  label,
  icon,
  onPress,
  disabled = false,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
}) => {
  const sidebarActive = useSidebarActive();
  const [scale] = useState(() => new Animated.Value(1));
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced || disabled || !sidebarActive) {
      scale.stopAnimation();
      scale.setValue(1);
    }
    return () => scale.stopAnimation();
  }, [reduced, disabled, sidebarActive, scale]);
  const pressIn = () => {
    if (reduced) return;
    scale.stopAnimation();
    Animated.timing(scale, {
      toValue: motionTokens.press.scale,
      duration: motionTokens.micro,
      easing: easing.standard,
      useNativeDriver: true,
    }).start();
  };
  const pressOut = () => {
    scale.stopAnimation();
    if (reduced) {
      scale.setValue(1);
      return;
    }
    Animated.timing(scale, {
      toValue: 1,
      duration: motionTokens.micro,
      easing: easing.enter,
      useNativeDriver: true,
    }).start();
  };
  return (
    <SidebarPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
    >
      <AnimatedView
        className={cn(
          controlVariants({ size: "icon", disabled }),
          c.iconButton
        )}
        style={[{ transform: [{ scale }] }]}
      >
        <ChromeIcon className={cn("size-[18px]")} name={icon} />
      </AnimatedView>
    </SidebarPressable>
  );
};
const NewTabPage = ({
  favorites,
  keyboardInset,
  visibleHeight,
  reducedMotion,
  engine,
  suggestions,
  commands,
  onCommand,
  onOpenUrl,
  onOpenFavorite,
}: {
  favorites: { id: string; title: string; url: string }[];
  keyboardInset: number;
  visibleHeight: number;
  reducedMotion: boolean;
  engine: SearchEngineId;
  suggestions: SuggestionSources;
  commands: ProductCommand[];
  onCommand: (id: string) => void;
  onOpenUrl: (url: string) => void;
  onOpenFavorite: (id: string) => void;
}) => {
  const { tr } = useI18n();
  const host = useRef<React.ComponentRef<typeof View>>(null);
  const [frame, setFrame] = useState({ y: 0, height: 0 });
  const measure = useCallback(() => {
    const measuredHost = host.current;
    measuredHost?.measureInWindow((_x, y, _width, height) => {
      if (host.current !== measuredHost) return;
      setFrame((current) =>
        current.y === y && current.height === height ? current : { y, height }
      );
    });
  }, []);
  useLayoutEffect(measure, [measure, keyboardInset, visibleHeight]);
  // A vertical split may already sit entirely above the IME. Only the overlap
  // of this pane and its Activity's confirmed keyboard changes input bounds.
  const newTabKeyboardInset =
    keyboardInset > 0 && frame.height > 0
      ? Math.max(
          0,
          Math.min(frame.height, frame.y + frame.height - visibleHeight)
        )
      : 0;
  return (
    <View
      ref={host}
      className="absolute inset-0"
      pointerEvents="box-none"
      onLayout={measure}
    >
      <View
        className={c.newTabOverlay}
        style={{ bottom: newTabKeyboardInset }}
        pointerEvents="box-none"
      >
        <View className={cn(c.newTabPanel, "max-h-full min-h-0")}>
          <AddressBox
            engine={engine}
            autoFocus={false}
            reducedMotion={reducedMotion}
            suggestions={suggestions}
            commands={commands}
            onCommand={onCommand}
            onOpenTab={onOpenFavorite}
            onSubmit={onOpenUrl}
          />
          {favorites.length > 0 ? (
            <>
              <Text className={c.newTabHeading}>{tr("chrome.favorites")}</Text>
              <View className={c.newTabGrid}>
                {favorites.slice(0, 12).map((tab) => (
                  <Pressable
                    key={tab.id}
                    accessibilityRole="button"
                    accessibilityLabel={tr("chrome.favoriteLabel", {
                      name: tab.title || tab.url,
                    })}
                    className={cn(c.newTabTile, "active:opacity-pressed")}
                    onPress={() => onOpenFavorite(tab.id)}
                  >
                    <View className={c.newTabTileIcon}>
                      <Favicon
                        url={tab.url}
                        fallback={(tab.title || tab.url)
                          .slice(0, 1)
                          .toUpperCase()}
                        size={32}
                        radius={8}
                      />
                    </View>
                    <Text numberOfLines={1} className={c.newTabTileLabel}>
                      {tab.title || tab.url}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : (
            <Text className={c.newTabHint}>{tr("chrome.newTabHint")}</Text>
          )}
        </View>
      </View>
    </View>
  );
};
export default function App() {
  return (
    <SafeAreaProvider>
      <BrowserApp />
    </SafeAreaProvider>
  );
}
favicons.attach(
  {
    read: (host) =>
      typeof platform.readFavicon === "function"
        ? platform.readFavicon(host)
        : Promise.resolve(null),
    save: (host, data) =>
      typeof platform.saveFavicon === "function"
        ? platform.saveFavicon(host, data)
        : Promise.resolve(),
    clear: (host) => {
      if (typeof platform.clearFavicon === "function")
        platform.clearFavicon(host);
    },
  },
  (url, options) => fetch(url, options)
);
// Per-site permission decisions persist through the native platform store.
// Browsing history persists through the same native store pattern.
history.attach({
  read: () =>
    typeof platform.readHistory === "function"
      ? platform.readHistory()
      : Promise.resolve(null),
  save: (json) =>
    typeof platform.saveHistory === "function"
      ? platform.saveHistory(json)
      : Promise.resolve(),
});
function BrowserApp() {
  // This owner-confirmed IME geometry bounds input overlays only. The browser
  // canvas and its native Gecko descendants retain their full measured frame.
  const inputViewport = useInputViewport("main");
  const { keyboardInset } = inputViewport;
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot
  );
  const [error, setError] = useState("");
  // Load failures are per tab: a background tab's DNS/security failure must
  // not blame whatever tab is focused. Cleared on the tab's next navigation.
  const [tabErrors, setTabErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [splitLayout, setSplitLayout] = useState<SplitLayout | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string[]>([]);
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickOpenPresentation, nextQuickOpenPresentation] = useReducer(
    (presentation: number) => presentation + 1,
    0
  );
  const quickOpenInputRef = useRef<React.ComponentRef<typeof TextInput> | null>(
    null
  );
  // Cmd/Ctrl+L reuses the centered dialog to edit the focused pane's URL:
  // the sidebar address field is too small to be comfortable.
  const [quickOpenEdit, setQuickOpenEdit] = useState(false);
  // Touch entry raises the soft keyboard; hardware-shortcut entry keeps it
  // suppressed (the adjustNothing/⌘T IME-flicker guard).
  const [quickOpenSoft, setQuickOpenSoft] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [spaceSwitcher, setSpaceSwitcher] = useState(false);
  const [ctxMenuTabId, setCtxMenuTabId] = useState<string | null>(null);
  const [ctxMenuAnchor, setCtxMenuAnchor] = useState<MenuAnchor | undefined>();
  const [sidebarMenu, setSidebarMenu] = useState<{
    kind:
      | "bookmark"
      | "bookmarkMove"
      | "folder"
      | "folderPages"
      | "split"
      | "create";
    id?: string;
    anchor?: MenuAnchor;
  } | null>(null);
  const [splitPickerTabId, setSplitPickerTabId] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const openTabMenu = (id: string, x: number, y: number) => {
    setCtxMenuTabId(id);
    setCtxMenuAnchor(x || y ? { x, y } : undefined);
  };
  const [findTab, setFindTab] = useState<string | null>(null);
  const [findResult, setFindResult] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [keys, setKeys] = useState(false);
  const [settings, setSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string | null>(null);
  const [settingsQuery, setSettingsQuery] = useState("");
  const [boostsOpen, setBoostsOpen] = useState(false);
  const [bookmarkManager, setBookmarkManager] = useState(false);
  const [bookmarkEditing, setBookmarkEditing] = useState<string | null>(null);
  const [bookmarkTitle, setBookmarkTitle] = useState("");
  const [bookmarkUrl, setBookmarkUrl] = useState("");
  const [bookmarkFolder, setBookmarkFolder] = useState("");
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  // Per-site permission requests raised by the native delegates, shown one
  // at a time; further requests queue behind the visible one.
  useEffect(listenBrowserPermissions, []);
  // Bumped when stored rules change so Settings and the native delegate
  // push re-read sitePermissions.
  const [permissionRulesVersion, setPermissionRulesVersion] = useState(0);
  useEffect(
    () =>
      subscribeSitePermissionChanges(() =>
        setPermissionRulesVersion((v) => v + 1)
      ),
    []
  );
  const siteRules = useMemo(
    () => sitePermissions.all(),
    [permissionRulesVersion]
  );
  // Which sidebar bookmark folders are expanded right now.
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set()
  );
  const toggleFolder = (id: string) =>
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [ui, updateUi] = useReducer(reduceUiPreferences, defaultUiPreferences);
  const [deviceLocale, setDeviceLocale] = useState("en");
  const language = resolveLanguage(ui.language, deviceLocale);
  const tr = useCallback(
    (key: TranslationKey, values?: Record<string, string | number>) =>
      translate(language, key, values),
    [language]
  );
  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      if (typeof platform.getDeviceLanguage !== "function") return;
      void platform
        .getDeviceLanguage()
        .then((locale) => {
          if (mounted) setDeviceLocale(locale);
        })
        .catch(() => {});
    };
    refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  const currentUi = useRef(ui);
  useLayoutEffect(() => {
    currentUi.current = ui;
  }, [ui]);
  const [uiHydrated, setUiHydrated] = useState(false);
  useEffect(() => {
    if (uiHydrated) platform.setAppLanguage?.(ui.language ?? "system");
  }, [ui.language, uiHydrated]);
  const uiPersistence = useUiPreferencePersistence(
    ui,
    uiHydrated,
    setError,
    tr("settings.failedGlobal")
  );
  // The explicit source chooses the base palette, active Space or custom seed.
  const activeWorkspace = state?.workspaces.find(
    (w) => w.id === state.activeWorkspaceId
  );
  const systemColorScheme = useColorScheme();
  const theme = useMemo(
    () =>
      resolveTheme(
        {
          appearance: ui.appearance,
          colorMode: ui.colorMode,
          colorSource: ui.colorSource,
          customColor: ui.customColor,
        },
        activeWorkspace?.color ?? "",
        systemColorScheme
      ),
    [
      ui.appearance,
      ui.colorMode,
      ui.colorSource,
      ui.customColor,
      activeWorkspace?.color,
      systemColorScheme,
    ]
  );
  // BrowserApp owns the provider, so useContext here would lag one render
  // behind a theme change; feed the fresh theme straight into the sheet.
  useEffect(() => {
    if (!uiHydrated) return;
    void platform
      .setAppearance?.(
        ui.colorMode ?? "system",
        resolveColorMode(ui.colorMode, systemColorScheme),
        theme.chrome
      )
      .catch((error) => setError(String(error)));
  }, [uiHydrated, ui.colorMode, systemColorScheme, theme.chrome]);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [navigation, setNavigation] = useState<Record<string, Navigation>>({});
  const [navigationOrder] = useState(() => new NavigationEventOrder());
  const panesRef = useRef<React.ElementRef<typeof View>>(null);
  const paneBounds = useRef<Bounds | null>(null);
  type DragPreview = {
    tabId: string;
    title: string;
    zone: DropZone | null;
    targetId: string | null;
    layout: SplitLayout | null;
    reorderIndex: number | null;
  };
  const [drag, setDrag] = useState<DragPreview | null>(null);
  const [dragLifecycle] = useState(() => new DragLifecycle<DragPreview>());
  const [ghostOpacity] = useState(() => new Animated.Value(0));
  const [ghostScale] = useState(() => new Animated.Value(0.96));
  const [ghostPosition] = useState(() => new Animated.ValueXY());
  const reducedMotion = useReducedMotion();
  const [dragFrames] = useState(
    () => new FrameCoalescer<{ x: number; y: number }>(() => {})
  );
  const [sidebarFrames] = useState(() => new FrameCoalescer<number>(() => {}));
  const dividerOwner = useRef<SplitLayout | null>(null);
  const [dividerFrames] = useState(
    () => new FrameCoalescer<{ owner: SplitLayout; ratio: number }>(() => {})
  );
  const refs = useRef(new Map<string, SurfaceRef>());
  const [registry] = useState(() => new CommandRegistry());
  const closedTabs = useRef<
    { url: string; title: string; workspaceId: string }[]
  >([]);
  const lastFindQuery = useRef("");
  const pinnedSectionRef = useRef<React.ElementRef<typeof View>>(null);
  const pinnedSectionBounds = useRef<Bounds | null>(null);
  const favoritesRowRef = useRef<React.ElementRef<typeof View>>(null);
  const favoritesRowBounds = useRef<Bounds | null>(null);
  const tabListRef = useRef<React.ElementRef<typeof View>>(null);
  const tabListBounds = useRef<Bounds | null>(null);
  const ordinarySectionRef = useRef<React.ElementRef<typeof View>>(null);
  const ordinarySectionBounds = useRef<Bounds | null>(null);
  const sidebarRowRefs = useRef(
    new Map<string, React.ElementRef<typeof View>>()
  );
  const sidebarRowBounds = useRef(new Map<string, Bounds>());
  const sidebarDropActive = useRef(false);
  const sidebarDropEpoch = useRef(0);
  const favoriteLayouts = useRef(new Map<string, TileBounds>());
  const favoriteScrollOffset = useRef(0);
  const sidebarMotion = useSidebarMotion(ui.sidebarCollapsed, reducedMotion);
  const sideP = sidebarMotion.progress;
  const spaceMotion = useSpaceMotion(
    state?.activeWorkspaceId ?? "",
    state?.workspaces.findIndex(
      (workspace) => workspace.id === state.activeWorkspaceId
    ) ?? 0,
    reducedMotion
  );
  const spaceStyle = {
    opacity: spaceMotion.opacity,
    transform: [{ translateX: spaceMotion.offset }],
  };
  const run = (promise: Promise<unknown>) => {
    void promise.catch((e) => setError(String(e)));
  };
  const toggleSidebar = () => {
    haptic("tick");
    updateUi({ type: "toggleSidebar" });
  };
  const settingsReturn = useRef<string | null>(null);
  const openSettingsChild = (child: string) => {
    settingsReturn.current = settings ? child : null;
    setSettings(false);
  };
  const closeSettingsChild = (child: string, close: () => void) => {
    close();
    if (settingsReturn.current === child) {
      settingsReturn.current = null;
      setSettings(true);
    }
  };
  const openKeyboard = () => {
    openSettingsChild("keyboard");
    setKeys(true);
  };
  const active = state?.tabs.find((t) => t.id === state.activeTabId);
  const activePrivate = !!active?.private;
  const extensionActions = useExtensionActions(activePrivate);
  const openExtensionAction = (
    action: ExtensionToolbarAction,
    anchor: { x: number; y: number }
  ) => {
    // Native re-checks the active tab and action availability; failures are
    // notices, not crashes, because the engine owns the real state.
    browserExtensions
      ?.openAction(action.id, anchor.x, anchor.y)
      .catch((failure) =>
        flashNotice(
          localizeExtensionError(extensionErrorMessage(failure), language)
        )
      );
  };
  // Memoized: a fresh array identity per render used to invalidate the
  // suggestion-sources memo on every render (including progress ticks).
  const favoriteTabs = useMemo(
    () => state?.tabs.filter((tab) => tab.favorite) ?? [],
    [state?.tabs]
  );
  // Private tabs form their own collection: they render in the dedicated
  // PRIVATE section, never in a Space's ordinary tab list.
  const privateTabs = useMemo(
    () => state?.tabs.filter((tab) => tab.private) ?? [],
    [state?.tabs]
  );
  const spaceBookmarks = useMemo(
    () =>
      libraryItemsForSpace(
        state?.bookmarks ?? [],
        state?.activeWorkspaceId ?? ""
      ),
    [state?.bookmarks, state?.activeWorkspaceId]
  );
  const spaceFolders = useMemo(
    () =>
      libraryItemsForSpace(
        state?.bookmarkFolders ?? [],
        state?.activeWorkspaceId ?? ""
      ),
    [state?.bookmarkFolders, state?.activeWorkspaceId]
  );
  useLayoutEffect(() => {
    // A dialog opened in the previous Space must never edit the new library.
    setSidebarMenu(null);
    setBookmarkManager(false);
    setNewFolderOpen(false);
    setBookmarkEditing(null);
    setBookmarkTitle("");
    setBookmarkUrl("");
    setBookmarkFolder("");
    setRenamingFolder(null);
    setFolderName("");
  }, [state?.activeWorkspaceId]);
  const bookmarkTabs = useMemo(
    () =>
      bookmarkTabsForSpace(state?.tabs ?? [], state?.activeWorkspaceId ?? ""),
    [state?.tabs, state?.activeWorkspaceId]
  );
  const [historyVersion, setHistoryVersion] = useState(0);
  useEffect(() => {
    const unsubscribe = history.subscribe(() =>
      setHistoryVersion((v) => v + 1)
    );
    void history.load();
    return unsubscribe;
  }, []);
  const tabLabel = (tab: { title: string; url: string }) =>
    tab.url === NEW_TAB_URL ? tr("chrome.newTab") : tab.title || tab.url;
  // The sidebar shows only the domain; the centered editor retains the full URL.
  const displayUrl = sidebarAddressLabel;
  const suggestionSources = useMemo<SuggestionSources>(
    () => ({
      favorites: favoriteTabs.map((t) => ({
        id: t.id,
        url: t.url,
        title: tabLabel(t),
      })),
      bookmarks: spaceBookmarks,
      tabs: (state?.tabs ?? [])
        .filter(
          (t) =>
            !t.suspended &&
            !t.private &&
            (t.favorite || t.workspaceId === state?.activeWorkspaceId)
        )
        .map((t) => ({
          id: t.id,
          url: t.url,
          title: tabLabel(t),
        })),
      history: history.entries.slice(0, 40),
    }),
    [
      favoriteTabs,
      spaceBookmarks,
      state?.tabs,
      state?.activeWorkspaceId,
      historyVersion,
      tr,
    ]
  );
  const splitSpace = useRef(state?.activeWorkspaceId);
  useLayoutEffect(() => {
    if (splitSpace.current === state?.activeWorkspaceId) return;
    splitSpace.current = state?.activeWorkspaceId;
    setSplitLayout(null);
    setFocused(state?.activeTabId ?? null);
  }, [state?.activeWorkspaceId, state?.activeTabId]);
  // Splits stay within one browsing mode: a mixed pair never validates, so
  // stale or cross-mode layouts cannot surface private content in a pane.
  const liveCandidateSplit =
    splitSpace.current === state?.activeWorkspaceId
      ? liveSplitLayout(
          splitLayout,
          (state?.tabs ?? []).filter(
            (tab) =>
              tab.favorite || tab.workspaceId === state?.activeWorkspaceId
          )
        )
      : null;
  const validSplit = (() => {
    if (!liveCandidateSplit) return null;
    const first = state?.tabs.find(
      (tab) => tab.id === liveCandidateSplit.first
    );
    const second = state?.tabs.find(
      (tab) => tab.id === liveCandidateSplit.second
    );
    return !!first && !!second && !!first.private === !!second.private
      ? liveCandidateSplit
      : null;
  })();
  const validSplitRef = useRef<SplitLayout | null>(null);
  useLayoutEffect(() => {
    validSplitRef.current = validSplit;
  }, [validSplit]);
  const pipReturnLayout = useExternalPipReturnLayout({
    controller,
    layoutRef: validSplitRef,
    workspaceRef: splitSpace,
    setSplitLayout,
    setFocused,
  });
  const splitRestoreToken = pipReturnLayout.settleTokenFor(
    validSplit,
    state?.activeWorkspaceId
  );
  const splitOpen = !!validSplit;
  const splitMotion = useSplitMotion(
    validSplit,
    state?.activeWorkspaceId ?? "",
    focused ?? state?.activeTabId,
    reducedMotion,
    splitRestoreToken
  );
  useLayoutEffect(() => {
    pipReturnLayout.didCommitSplit(
      validSplit,
      state?.activeWorkspaceId,
      splitRestoreToken
    );
  }, [
    pipReturnLayout,
    validSplit,
    state?.activeWorkspaceId,
    splitRestoreToken,
  ]);
  const splitP = splitMotion.progress;
  const liveRenderSplit = liveSplitLayout(
    splitMotion.layout,
    state?.tabs ?? []
  );
  const liveFirst = liveRenderSplit
    ? state?.tabs.find((t) => t.id === liveRenderSplit.first)
    : active;
  const liveSecond = liveRenderSplit
    ? state?.tabs.find((t) => t.id === liveRenderSplit.second)
    : undefined;
  const livePaneIds = [liveFirst?.id, liveSecond?.id];
  const liveTarget =
    focused && livePaneIds.includes(focused) ? focused : liveFirst?.id;
  const fullscreenPaneIds = useMemo(
    () => (validSplit ? [validSplit.first, validSplit.second] : [active?.id]),
    [validSplit?.first, validSplit?.second, active?.id]
  );
  const fullscreen = useContentFullscreen({
    navigation,
    visibleTabIds: fullscreenPaneIds,
    focusedTabId: liveTarget,
    exit: platform.exitContentFullscreen,
  });
  const haptic = (kind: "tick" | "click") => {
    if (typeof platform.haptic === "function") platform.haptic(kind);
  };
  const flashNotice = (message: string) => {
    setNotice(message);
    // Cancel the previous timer so consecutive notices each get their full
    // lifetime instead of being cleared by an earlier timeout.
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 4000);
  };
  const browser = useBrowserWorkflows({
    onError: setError,
    onNotice: flashNotice,
    onCommand: (command) => registry.execute(command),
    onExternalTab: (snapshot) => {
      setSplitLayout(null);
      setFocused(snapshot.activeTabId ?? null);
    },
  });
  // Tabs hosted in secondary OS windows. They stay in the global session;
  // tapping one in the sidebar closes its window and reveals it here.
  const {
    tabs: windowedTabs,
    ref: windowedTabsRef,
    loaded: windowTabsLoaded,
  } = useWindowTabs(browser.ready);
  const getPermissionRequest = useCallback(
    () =>
      windowTabsLoaded
        ? permissionRequests.getSnapshotFor(
            (request) => !windowedTabs.includes(request.tabId)
          )
        : null,
    [windowedTabs, windowTabsLoaded]
  );
  const permissionRequest = useSyncExternalStore(
    permissionRequests.subscribe,
    getPermissionRequest
  );
  const overlayOpen =
    quickOpen ||
    palette ||
    bookmarkManager ||
    settings ||
    keys ||
    spaceSwitcher ||
    historyOpen ||
    boostsOpen ||
    !!ctxMenuTabId ||
    !!sidebarMenu ||
    !!splitPickerTabId ||
    newFolderOpen;
  // Sheets are siblings of the canvas. Hide only the underlying sidebar/page
  // accessibility tree; in-page find intentionally keeps that tree available.
  const accessibilityBlocking = overlayOpen || !!permissionRequest;
  const pipTab = state?.tabs.find(
    (tab) =>
      tab.id === (fullscreen.tabId ?? liveTarget) &&
      !tab.suspended &&
      tab.url !== NEW_TAB_URL
  );
  const externalPip = useExternalPictureInPicture({
    enabled: uiHydrated && browser.ready && ui.autoPictureInPicture,
    visibleTabIds: fullscreen.tabId ? [fullscreen.tabId] : fullscreenPaneIds,
    blocked: !!permissionRequest || !!browser.context || !browser.ready,
    onState: pipReturnLayout.observeNative,
    onReturn: pipReturnLayout.onReturn,
    onError: setError,
  });
  const externalPipBusy =
    externalPip.state.active ||
    externalPip.state.transitioning ||
    externalPip.state.returnToken !== undefined;
  const pip = usePictureInPicture({
    enabled: uiHydrated && browser.ready && ui.autoPictureInPicture,
    tabId: pipTab?.id ?? null,
    blocked:
      overlayOpen ||
      !!permissionRequest ||
      !!browser.context ||
      !browser.ready ||
      externalPipBusy,
    onError: setError,
  });
  const pipVisible = pip.state.active || pip.state.transitioning;
  const { first, second, target, renderSplit, fullscreenTabId } = usePipLayout(
    {
      first: liveFirst,
      second: liveSecond,
      target: fullscreen.tabId ?? liveTarget,
      renderSplit: liveRenderSplit,
      fullscreenTabId: fullscreen.tabId,
    },
    pipVisible
  );
  // Keep the exact pane shares after ordinary motion finishes. A PiP return
  // also uses those final dimensions in its first commit.
  const fixedSplitGeometry =
    pipVisible || splitRestoreToken !== undefined || splitMotion.settled;
  const contentFullscreen = !!fullscreenTabId;
  const splitPaneIds = [first?.id, second?.id];
  const sidebar = useMemo(
    () =>
      sidebarPresentation({
        tabs: state?.tabs ?? [],
        bookmarks: state?.bookmarks ?? [],
        folders: state?.bookmarkFolders ?? [],
        workspaceId: state?.activeWorkspaceId ?? "",
        focusedId: target,
        split: validSplit,
      }),
    [
      state?.tabs,
      state?.bookmarks,
      state?.bookmarkFolders,
      state?.activeWorkspaceId,
      target,
      validSplit,
    ]
  );
  useLayoutEffect(() => {
    if (sidebarMenu?.kind === "split" && sidebarMenu.id !== sidebar.split?.key)
      setSidebarMenu(null);
    if (
      sidebarMenu?.kind === "folderPages" &&
      !sidebar.folders.some((item) => item.folder.id === sidebarMenu.id)
    )
      setSidebarMenu(null);
  }, [sidebarMenu, sidebar.split?.key, sidebar.folders]);
  const openSplitCollection = (anchor: MenuAnchor) => {
    if (sidebar.split)
      setSidebarMenu({ kind: "split", id: sidebar.split.key, anchor });
  };
  const targetUrl = state?.tabs.find((tab) => tab.id === target)?.url ?? "";
  const addressValue = targetUrl === NEW_TAB_URL ? "" : targetUrl;
  const enterPictureInPicture = () => {
    setSettings(false);
    setSidebarMenu(null);
    void pip.enter().then((result) => {
      if (result && !result.active && !result.transitioning)
        flashNotice(
          !result.allowed ? tr("chrome.pipNotAllowed") : tr("chrome.pipFailed")
        );
    });
  };
  useEffect(() => {
    const live = new Set((state?.tabs ?? []).map((tab) => tab.id));
    navigationOrder.retain(live);
    setNavigation((current) => retainLiveTabs(current, live));
    setTabErrors((current) => retainLiveTabs(current, live));
    setPlaying((current) =>
      current.every((id) => live.has(id))
        ? current
        : current.filter((id) => live.has(id))
    );
  }, [state?.tabs]);
  const invoke = (fn: (ref: SurfaceRef) => void) => {
    const ref = target ? refs.current.get(target) : null;
    if (ref) fn(ref);
  };
  const goBack = () => {
    if (!fullscreen.dismiss(() => false)) invoke(Commands.goBack);
  };
  const goHome = () => {
    void platform.goHome().catch((failure) => setError(String(failure)));
  };
  const loadInPane = (id: string, url: string) => {
    const ref = refs.current.get(id);
    if (ref) {
      Commands.loadUrl(ref, url);
      Commands.focusContent(ref);
    }
  };
  const closingWindows = useRef<Set<string>>(new Set());
  // Send closeWindowForTab exactly once per user action, then hand off.
  // finish() is sent before the bridge resolves, so the caller may activate
  // right away; re-entering the close would flood the dying activity with
  // duplicate finish requests, and retrying through a captured switchTab
  // closure re-read a frozen window list (the popout-killing loop).
  const bringWindowTabHome = (id: string, done: () => void) => {
    if (closingWindows.current.has(id)) return;
    closingWindows.current.add(id);
    haptic("tick");
    void platform
      .closeWindowForTab?.(id)
      .catch(() => {})
      .finally(() => {
        closingWindows.current.delete(id);
        done();
      });
  };
  const activateTab = (id: string) => {
    haptic("tick");
    const leaveSplit =
      !validSplit ||
      ![validSplit.first, validSplit.second].includes(id) ||
      (!!fullscreen.tabId && fullscreen.tabId !== id);
    run(
      controller
        .activate(id, leaveSplit ? [id] : [validSplit.first, validSplit.second])
        .then(() => {
          if (leaveSplit) setSplitLayout(null);
          setFocused(id);
        })
    );
  };
  const switchTab = (id: string) => {
    // Any activation path (quick-open, palette, rail, favorites, slots) must
    // bring a windowed tab home first, or the OS window would keep a dead
    // surface while the main browser steals the session. The ref, not the
    // render-captured state, decides — the event may land between renders.
    if (windowedTabsRef.current.includes(id)) {
      bringWindowTabHome(id, () => activateTab(id));
      return;
    }
    activateTab(id);
  };
  // A windowed tab returns home: close its OS window, then reveal it here.
  const revealTab = (id: string) => {
    if (!windowedTabsRef.current.includes(id)) {
      switchTab(id);
      return;
    }
    bringWindowTabHome(id, () => activateTab(id));
  };
  const createTabAndShow = (url?: string, workspaceId?: string) => {
    run(
      controller.createTab(url, workspaceId).then((snapshot) => {
        setSplitLayout(null);
        setFocused(snapshot.activeTabId ?? null);
      })
    );
  };
  const createPrivateTabAndShow = (url?: string) => {
    run(
      controller
        .createTab(url, undefined, { private: true })
        .then((snapshot) => {
          setSplitLayout(null);
          setFocused(snapshot.activeTabId ?? null);
        })
    );
  };
  // New tabs stay in the browsing mode the user is in: submitting an address
  // while a private tab is focused opens a private tab, like other browsers.
  const createTabInActiveMode = (url?: string) => {
    if (activePrivate) createPrivateTabAndShow(url);
    else createTabAndShow(url);
  };
  // Space icons switch directly; long-press opens the manager.
  const switchSpace = (id: string) => {
    if (!state || id === state.activeWorkspaceId) return;
    haptic("click");
    run(
      controller.activateWorkspace(id).then((snapshot) => {
        setSplitLayout(null);
        setFocused(snapshot.activeTabId ?? null);
      })
    );
  };
  const openBookmark = (bookmark: { id: string }) => {
    haptic("click");
    run(
      controller.openBookmark(bookmark.id).then((snapshot) => {
        setSplitLayout(null);
        setFocused(snapshot.activeTabId ?? null);
      })
    );
  };
  const editBookmark = (bookmark: {
    id: string;
    title: string;
    url: string;
    folderId?: string;
  }) => {
    setBookmarkEditing(bookmark.id);
    setBookmarkTitle(bookmark.title);
    setBookmarkUrl(bookmark.url);
    setBookmarkFolder(bookmark.folderId ?? "");
    setBookmarkManager(true);
  };
  const bookmarkTreeRow = (
    bookmark: { id: string; title: string; url: string; folderId?: string },
    indented: boolean
  ) => {
    const tab = bookmarkTabs.get(bookmark.id);
    // A promoted Favorite or deliberately unpinned page has its single row in
    // that region. The bookmark library still retains the saved link.
    if (tab && (tab.favorite || !tab.pinned)) return null;
    const isActive = !!tab && !tab.suspended && splitPaneIds.includes(tab.id);
    const title = bookmark.title || bookmark.url;
    return (
      <View
        key={bookmark.id}
        className={cn(
          rowVariants({ density: "tab", selected: isActive }),
          c.tab,
          indented && c.bookmarkTreeIndent
        )}
      >
        <ContextPressable
          accessibilityRole="button"
          accessibilityLabel={tr("chrome.pinnedTabLabel", { name: title })}
          accessibilityState={{ selected: isActive }}
          className={cn(c.tabDrag, "active:opacity-pressed")}
          onPress={() => (tab ? revealTab(tab.id) : openBookmark(bookmark))}
          contextOpen={
            sidebarMenu?.kind === "bookmark" && sidebarMenu.id === bookmark.id
          }
          onContextMenu={(x, y) =>
            setSidebarMenu({
              kind: "bookmark",
              id: bookmark.id,
              anchor: { x, y },
            })
          }
        >
          <View className={c.tabFavicon}>
            {tab && playing.includes(tab.id) ? (
              <ChromeIcon className={cn("size-[14px]")} name="play" />
            ) : (
              <Favicon
                url={tab?.url || bookmark.url}
                fallback="◌"
                size={16}
                radius={3}
              />
            )}
          </View>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.35}
            className={c.tabTitle}
          >
            {title}
          </Text>
          {!!validSplit && isActive && (
            <ChromeIcon
              className={cn("size-[14px]", "text-ink-muted")}
              name="split"
            />
          )}
          {windowedTabs.includes(tab?.id ?? bookmark.id) && (
            <ChromeIcon
              className={cn("size-[14px]", "text-ink-muted")}
              name="window"
            />
          )}
        </ContextPressable>
        {tab && !tab.suspended && (
          <SidebarPressable
            accessibilityRole="button"
            accessibilityLabel={tr("chrome.closeNamedTab", { name: title })}
            hitSlop={8}
            className={cn(c.tabClose, "active:bg-field-on-chrome")}
            onPress={() => closeTab(tab.id)}
          >
            <ChromeIcon
              className={cn("size-[15px]", "text-ink-muted")}
              name="close"
            />
          </SidebarPressable>
        )}
      </View>
    );
  };

  const splitCandidate =
    active &&
    state?.tabs.some(
      (t) =>
        t.id !== active.id &&
        !t.suspended &&
        (t.favorite || t.workspaceId === state.activeWorkspaceId) &&
        !!t.private === !!active.private
    );
  const toggleSplit = () => {
    if (validSplit) {
      const closing = validSplit;
      if (!target) return;
      setFocused(target);
      // Commit the survivor before retiring either surface, even when motion
      // is disabled or an earlier controller operation is still queued.
      run(
        controller.activate(target, [target]).then(() => {
          setSplitLayout((current) => (current === closing ? null : current));
        })
      );
    } else if (target) setSplitPickerTabId(target);
  };
  // Touch entry raises the soft keyboard (primary input on a keyboard-less
  // tablet); hardware shortcuts keep it suppressed to avoid the IME/⌘T
  // flicker under adjustNothing.
  const openQuickOpen = (mode: "touch" | "keyboard" = "keyboard") => {
    // Request a fallback snapshot for the focus transition. Capture completes
    // asynchronously; it cannot replace keeping the native page ancestors
    // mounted while the dialog changes pointerEvents.
    if (target && typeof platform.captureRendering === "function")
      platform.captureRendering(target);
    nextQuickOpenPresentation();
    setQuickOpenSoft(mode === "touch");
    setQuickOpenEdit(false);
    setQuickOpen(true);
  };
  // ⌘L and the address triggers share the centered dialog in edit mode:
  // submitting loads the URL in the same tab.
  const openLocationEditor = (mode: "touch" | "keyboard" = "keyboard") => {
    nextQuickOpenPresentation();
    setQuickOpenSoft(mode === "touch");
    setQuickOpenEdit(true);
    setQuickOpen(true);
  };
  const closeQuickOpen = () => {
    quickOpenInputRef.current?.blur();
    setQuickOpen(false);
    setQuickOpenEdit(false);
  };
  const favoriteCurrent = () => {
    const current = state?.tabs.find((t) => t.id === target);
    // A blank new tab has no saved destination, and private tabs are
    // forbidden saved roles by the domain.
    if (!current || current.url === NEW_TAB_URL || current.private) return;
    haptic("click");
    run(controller.setFavorite(current.id, !current.favorite));
  };
  const pinCurrent = () => {
    const current = state?.tabs.find((t) => t.id === target);
    if (!current || current.url === NEW_TAB_URL || current.private) return;
    haptic("click");
    run(controller.setPinned(current.id, !current.pinned));
  };
  const canGoBack = !!target && !!navigation[target]?.canGoBack;
  const canGoForward = !!target && !!navigation[target]?.canGoForward;
  const menuTab = ctxMenuTabId
    ? state?.tabs.find((t) => t.id === ctxMenuTabId) ?? null
    : null;
  const closeTab = (tabId: string) => {
    const closing = state?.tabs.find((t) => t.id === tabId);
    if (
      closing &&
      !closing.favorite &&
      !closing.pinned &&
      !closing.private &&
      closing.url !== NEW_TAB_URL
    )
      closedTabs.current = [
        {
          url: closing.url,
          title: closing.title,
          workspaceId: closing.workspaceId,
        },
        ...closedTabs.current.filter((item) => item.url !== closing.url),
      ].slice(0, 12);
    // The domain seeds the active space's replacement atomically when the
    // space empties; panes follow the published activeTabId.
    run(
      controller.close(tabId).then(() => {
        if (validSplit && [validSplit.first, validSplit.second].includes(tabId))
          setSplitLayout(null);
      })
    );
  };
  const stepTab = (delta: number) => {
    const tabs =
      state?.tabs.filter(
        (t) =>
          !t.suspended &&
          (t.favorite || t.workspaceId === state.activeWorkspaceId)
      ) ?? [];
    if (!tabs.length) return;
    const index = tabs.findIndex((t) => t.id === target);
    const next = tabs[(Math.max(index, 0) + delta + tabs.length) % tabs.length];
    switchTab(next.id);
  };
  registry.register("tab.new", openQuickOpen);
  registry.register("private.newTab", () => createPrivateTabAndShow());
  registry.register("window.new", () => {
    void platform.openInNewWindow?.(null).catch(() => {});
  });
  registry.register("tab.close", () => {
    if (target) closeTab(target);
  });
  registry.register("tab.reopen", () => {
    const [last] = closedTabs.current;
    if (!last) return;
    closedTabs.current = closedTabs.current.slice(1);
    const workspaceExists = state?.workspaces.some(
      (w) => w.id === last.workspaceId
    );
    createTabAndShow(last.url, workspaceExists ? last.workspaceId : undefined);
  });
  registry.register("tab.next", () => stepTab(1));
  registry.register("tab.prev", () => stepTab(-1));
  registry.register("location.focus", openLocationEditor);
  registry.register("commandPalette.open", () => setPalette((p) => !p));
  registry.register("history.open", () => setHistoryOpen(true));
  registry.register("find.open", () => {
    if (target) {
      setFindResult(null);
      lastFindQuery.current = "";
      setFindTab(target);
    }
  });
  registry.register("browser.copyUrl", () => {
    const current = state?.tabs.find((t) => t.id === target);
    if (!current) return;
    if (typeof platform.copyToClipboard === "function") {
      platform.copyToClipboard(current.url);
      flashNotice(tr("chrome.urlCopied"));
    }
  });
  registry.register("browser.back", goBack);
  registry.register("browser.forward", () => invoke(Commands.goForward));
  registry.register("browser.reload", () => invoke(Commands.reload));
  registry.register("sidebar.toggle", toggleSidebar);
  registry.register("favorites.toggle", favoriteCurrent);
  registry.register("favorites.addCurrent", () => {
    if (target && targetUrl !== NEW_TAB_URL)
      run(controller.setFavorite(target, true));
  });
  registry.register("pins.toggle", pinCurrent);
  registry.register("settings.open", () => setSettings(true));
  registry.register("space.manage", () => setSpaceSwitcher(true));
  registry.register("tab.reset", () => {
    if (target) run(controller.reset(target));
  });
  registry.register("browser.split", () => {
    if (!validSplit) toggleSplit();
  });
  registry.register("browser.split.close", () => {
    if (validSplit) toggleSplit();
  });
  registry.register("browser.focusPane.1", () => {
    if (first) setFocused(first.id);
  });
  registry.register("browser.focusPane.2", () => {
    if (second) setFocused(second.id);
  });
  for (let i = 1; i <= 9; i++)
    registry.register(`tab.activate.${i}`, () => {
      const tab = state?.tabs.filter(
        (t) =>
          !t.suspended &&
          (t.favorite || t.workspaceId === state.activeWorkspaceId)
      )[i - 1];
      if (tab) switchTab(tab.id);
    });
  useEffect(() => {
    run(initializeBrowserPermissions().then(() => controller.initialize()));
    return controller.subscribePersistenceError((failure) => {
      if (failure) setError(failure.message);
    });
  }, []);
  // Existing installs carry a pre-Tab-cycling keymap inside their snapshot,
  // so Rust's new defaults never load for them; append the TAB bindings
  // once if they are missing (controller.keymap persists the merged set).
  const keymapMigrated = useRef(false);
  const tabCycleBindings: KeyBinding[] = [
    {
      key: "TAB",
      meta: true,
      ctrl: false,
      alt: false,
      shift: false,
      command: "tab.next",
    },
    {
      key: "TAB",
      meta: true,
      ctrl: false,
      alt: false,
      shift: true,
      command: "tab.prev",
    },
    {
      key: "TAB",
      meta: false,
      ctrl: true,
      alt: false,
      shift: false,
      command: "tab.next",
    },
    {
      key: "TAB",
      meta: false,
      ctrl: true,
      alt: false,
      shift: true,
      command: "tab.prev",
    },
  ];
  const windowBindings: KeyBinding[] = [
    {
      key: "n",
      meta: true,
      ctrl: false,
      alt: false,
      shift: true,
      command: "window.new",
    },
    {
      key: "n",
      meta: false,
      ctrl: true,
      alt: false,
      shift: true,
      command: "window.new",
    },
    // Devices that swallow Ctrl/Cmd+Shift+N still get a chord.
    {
      key: "n",
      meta: false,
      ctrl: false,
      alt: true,
      shift: true,
      command: "window.new",
    },
  ];
  useEffect(() => {
    if (!state || keymapMigrated.current) return;
    keymapMigrated.current = true;
    const bindings = state.keyBindings ?? [];
    const additions: KeyBinding[] = [];
    if (!bindings.some((binding) => binding.key === "TAB"))
      additions.push(...tabCycleBindings);
    // Append only chords the snapshot keymap is actually missing, so an
    // earlier partial migration still receives the Alt fallback.
    additions.push(
      ...windowBindings.filter(
        (binding) =>
          !bindings.some(
            (existing) =>
              existing.key === binding.key &&
              existing.meta === binding.meta &&
              existing.ctrl === binding.ctrl &&
              existing.alt === binding.alt &&
              existing.shift === binding.shift &&
              existing.command === binding.command
          )
      )
    );
    if (additions.length) run(controller.keymap([...bindings, ...additions]));
  }, [state]);

  // The trailing snapshot save is forced to disk when the app backgrounds
  // so process death cannot lose the last mutation.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") run(controller.flush());
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    let mounted = true;
    const read =
      typeof platform.readUiPreferences === "function"
        ? platform.readUiPreferences.bind(platform)
        : undefined;
    void loadUiPreferences(read)
      .then((preferences) => {
        if (!mounted) return;
        updateUi({ type: "restore", preferences });
        setUiHydrated(true);
      })
      .catch((failure) => {
        if (mounted)
          setError(
            `Settings could not be read. Restart to retry; saved settings have been kept. ${String(
              failure
            )}`
          );
      });
    return () => {
      mounted = false;
    };
  }, []);
  // Site boosts stream to the native side as a flat host→css list; GeckoView
  // injects the matching css each time a page finishes loading.
  useEffect(() => {
    if (!uiHydrated) return;
    if (typeof platform.setBoosts !== "function") return;
    const map = ui.boosts
      .filter((boost) => boost.enabled && boost.css)
      .map((boost) => ({
        host: normalizeBoostHost(boost.host),
        css: boost.css,
      }))
      .filter((boost) => !!boost.host);
    platform.setBoosts(JSON.stringify(map));
  }, [ui.boosts, uiHydrated]);
  useEffect(() => {
    browserExtensions?.setActiveTab(target ?? null);
  }, [target, browser.ready]);
  // Per-site permission decisions live outside the Rust snapshot: load once
  // at startup, then stream the rule list to the native delegates whenever
  // it changes. No rule means the site's next request asks the user.
  useEffect(() => {
    if (typeof platform.setSitePermissionRules !== "function") return;
    // Native expects {origin, kind, allow}; the store keeps decision strings.
    platform.setSitePermissionRules(
      JSON.stringify(
        sitePermissions.all().map((rule) => ({
          origin: rule.origin,
          kind: rule.kind,
          allow: rule.decision === "allow",
        }))
      )
    );
  }, [permissionRulesVersion]);
  const decidePermission = (choice: PermissionChoice) => {
    if (!permissionRequest) return;
    run(answerBrowserPermission(permissionRequest.requestId, choice));
  };
  useEffect(() => {
    if (!uiHydrated || Platform.OS !== "android") return;
    if (typeof platform.setFullscreen === "function")
      platform.setFullscreen(ui.fullscreen);
  }, [ui.fullscreen, uiHydrated]);
  // Narrow windows (portrait, split screen) collapse the sidebar to the rail;
  // crossing back expands it. Manual toggles still apply between crossings.
  const {
    width: windowWidth,
    height: windowHeight,
    fontScale: windowFontScale,
  } = useWindowDimensions();
  const safeInsets = useSafeAreaInsets();
  const sidebarLimits = sidebarSizing(
    ui.sidebarWidth,
    windowWidth -
      safeInsets.left -
      safeInsets.right -
      (ui.framePx.left + ui.framePx.right) / PixelRatio.get() -
      space.sm,
    renderSplit?.orientation === "horizontal"
  );
  const favoriteColumns = Math.min(
    3,
    Math.max(1, Math.floor((sidebarLimits.width - 24) / 60))
  );
  // Render one screen first so a large Space cannot delay the incoming page.
  const initialSidebarRows = Math.max(1, Math.ceil(windowHeight / size.tabRow));
  useLayoutEffect(() => {
    sidebarDropActive.current = !ui.sidebarCollapsed && !contentFullscreen;
    ++sidebarDropEpoch.current;
    clearSidebarDropBounds();
  }, [
    ui.sidebarCollapsed,
    contentFullscreen,
    state?.activeWorkspaceId,
    sidebarLimits.width,
    windowWidth,
  ]);
  const compactWindow = windowWidth < 840;
  const [appLifecycleState, setAppLifecycleState] = useState(
    AppState.currentState
  );
  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      setAppLifecycleState
    );
    setAppLifecycleState(AppState.currentState);
    return () => subscription.remove();
  }, []);
  const sidebarWindow = useRef({
    acceptedCompact: compactWindow,
    recovering: false,
  });
  useEffect(() => {
    if (!uiHydrated) return;
    const next = advanceSidebarWindow(sidebarWindow.current, {
      width: windowWidth,
      appState: appLifecycleState ?? null,
      pipVisible,
      restoredWindowWidth: pip.state.restoredWindowWidth,
    });
    sidebarWindow.current = next.state;
    if (next.collapsed !== undefined)
      updateUi({ type: "setSidebarCollapsed", collapsed: next.collapsed });
  }, [
    windowWidth,
    uiHydrated,
    pipVisible,
    pip.state.restoredWindowWidth,
    appLifecycleState,
  ]);
  useEffect(() => {
    const subscriptions = [
      DeviceEventEmitter.addListener(
        "BrowserCommand",
        (event: { command: string }) => registry.execute(event.command)
      ),
      DeviceEventEmitter.addListener(
        "BrowserNavigation",
        // Detached/retired sessions report here, including fullscreen=false.
        // Keep the same UI state path as the mounted Surface callback.
        (event: Navigation) => onNavigation(event)
      ),
      DeviceEventEmitter.addListener(
        "BrowserFindResult",
        (event: { tabId: string; current: number; total: number }) => {
          if (findTab === event.tabId)
            setFindResult({ current: event.current, total: event.total });
        }
      ),
      DeviceEventEmitter.addListener(
        "BrowserDownload",
        (event: { filename: string; location?: string }) => {
          flashNotice(
            `Saved ${event.filename || "download"}${
              event.location ? ` to ${event.location}` : ""
            }`
          );
        }
      ),
      DeviceEventEmitter.addListener(
        "BrowserDownloadFailed",
        (event: { id?: string; error?: string }) => {
          flashNotice(event.error || tr("chrome.downloadFailed"));
        }
      ),
      DeviceEventEmitter.addListener(
        "BrowserFileSelectionFailed",
        (event: { error: string }) => {
          flashNotice(event.error || tr("chrome.fileFailed"));
        }
      ),
      DeviceEventEmitter.addListener(
        "BrowserLoadError",
        (event: { tabId: string; code: number; security: boolean }) => {
          if (
            !controller
              .getSnapshot()
              ?.tabs.some((tab) => tab.id === event.tabId && !tab.suspended)
          )
            return;
          setTabErrors((old) => ({
            ...old,
            [event.tabId]: event.security
              ? `Connection not secure (code ${event.code})`
              : `Page failed to load (code ${event.code})`,
          }));
        }
      ),
      DeviceEventEmitter.addListener(
        "BrowserNewWindow",
        (event: {
          requestId: number;
          openerTabId: string;
          uri: string;
          extension?: boolean;
        }) => {
          run(
            controller.openWindow(event).then((snapshot) => {
              if (event.extension) setSettings(false);
              setSplitLayout(null);
              setFocused(snapshot.activeTabId ?? null);
            })
          );
        }
      ),
      DeviceEventEmitter.addListener(
        "BrowserNewWindowFailed",
        (event: { error: string }) => {
          flashNotice(event.error || tr("chrome.popupFailed"));
        }
      ),
      DeviceEventEmitter.addListener(
        "BrowserExtensionError",
        (event: { error: string }) =>
          flashNotice(localizeExtensionError(event.error, language))
      ),
      DeviceEventEmitter.addListener(
        "BrowserFocusWindow",
        (event: { tabId: string }) => {
          run(
            focusBrowserWindow(controller, event.tabId, () => {
              setSplitLayout(null);
              setFocused(event.tabId);
            })
          );
        }
      ),
      DeviceEventEmitter.addListener(
        "BrowserExtensionTabRequest",
        (event: { requestId: number; tabId: string; action: string }) => {
          const apply = async () => {
            try {
              const tab = controller
                .getSnapshot()
                ?.tabs.find(
                  (item) => item.id === event.tabId && !item.suspended
                );
              if (!tab)
                throw new Error("Extension target tab is no longer available");
              if (event.action !== "close" && event.action !== "activate")
                throw new Error("Unsupported extension tab action");
              await controller.applyExtensionTabRequest(
                event.tabId,
                event.action,
                async () =>
                  (await browserExtensions?.claimTabRequest(event.requestId)) ??
                  false
              );
              if (event.action === "activate") {
                setSplitLayout(null);
                setFocused(event.tabId);
                browserExtensions?.setActiveTab(event.tabId);
              }
              browserExtensions?.resolveTabRequest(event.requestId, true);
            } catch (error) {
              browserExtensions?.resolveTabRequest(event.requestId, false);
              flashNotice(String(error));
            }
          };
          void apply();
        }
      ),
      DeviceEventEmitter.addListener(
        "BrowserCloseWindow",
        (event: { tabId: string }) => {
          // Script closure addresses its own session, never the currently focused pane.
          run(controller.close(event.tabId));
        }
      ),
      DeviceEventEmitter.addListener(
        "BrowserMedia",
        (event: { tabId: string; playing: boolean }) => {
          if (
            !controller
              .getSnapshot()
              ?.tabs.some((tab) => tab.id === event.tabId && !tab.suspended)
          )
            return;
          setPlaying((old) =>
            event.playing
              ? [...new Set([...old, event.tabId])]
              : old.filter((id) => id !== event.tabId)
          );
        }
      ),
    ];
    platform.refreshMedia();
    return () => subscriptions.forEach((sub) => sub.remove());
  }, [findTab, reducedMotion, language]);
  useEffect(() => {
    // Hardware back closes the topmost surface in this priority order and
    // only falls through to web-content goBack when nothing is open.
    const modals: [boolean, () => void][] = [
      [!!permissionRequest, () => decidePermission("dismiss")],
      [quickOpen, closeQuickOpen],
      [!!findTab, closeFind],
      [!!ctxMenuTabId, () => setCtxMenuTabId(null)],
      [!!sidebarMenu, () => setSidebarMenu(null)],
      [!!splitPickerTabId, () => setSplitPickerTabId(null)],
      [newFolderOpen, () => setNewFolderOpen(false)],
      [spaceSwitcher, () => setSpaceSwitcher(false)],
      [
        historyOpen,
        () => closeSettingsChild("history", () => setHistoryOpen(false)),
      ],
      [palette, () => setPalette(false)],
      [keys, () => closeSettingsChild("keyboard", () => setKeys(false))],
      [
        settings,
        () => {
          if (settingsQuery) setSettingsQuery("");
          else if (
            settingsSection &&
            (windowWidth < 820 || windowFontScale >= 1.5)
          )
            setSettingsSection(null);
          else setSettings(false);
        },
      ],
      [
        boostsOpen,
        () => closeSettingsChild("boosts", () => setBoostsOpen(false)),
      ],
      [
        bookmarkManager,
        () => closeSettingsChild("bookmarks", () => setBookmarkManager(false)),
      ],
    ];
    const closeTopModal = () => {
      for (const [open, close] of modals) {
        if (open) {
          close();
          return true;
        }
      }
      return false;
    };
    const dismissTop = () => fullscreen.dismiss(closeTopModal);
    const syncModalCapture = () =>
      platform.setChromeModalActive?.(
        modals.some(([open]) => open) || !!fullscreen.tabId
      );
    registry.register("chrome.dismiss", dismissTop);
    syncModalCapture();
    const focusSubscription = DeviceEventEmitter.addListener(
      "BrowserWindowFocus",
      (event: { focused: boolean }) => {
        if (event.focused) syncModalCapture();
      }
    );
    const appSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") syncModalCapture();
      else platform.setChromeModalActive?.(false);
    });
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (dismissTop()) return true;
        const surface = target ? refs.current.get(target) : null;
        if (surface && navigation[target!]?.canGoBack) {
          Commands.goBack(surface);
          return true;
        }
        return false;
      }
    );
    return () => {
      subscription.remove();
      focusSubscription.remove();
      appSubscription.remove();
      platform.setChromeModalActive?.(false);
    };
  }, [
    permissionRequest,
    quickOpen,
    findTab,
    ctxMenuTabId,
    sidebarMenu,
    splitPickerTabId,
    newFolderOpen,
    spaceSwitcher,
    historyOpen,
    palette,
    keys,
    settings,
    settingsSection,
    settingsQuery,
    windowWidth,
    windowFontScale,
    boostsOpen,
    bookmarkManager,
    target,
    navigation,
    fullscreen.dismiss,
    fullscreen.tabId,
  ]);
  const onNavigation = (event: Navigation) => {
    const publishedTab = controller
      .getSnapshot()
      ?.tabs.find((tab) => tab.id === event.tabId && !tab.suspended);
    if (!publishedTab) return;
    if (!navigationOrder.accept(event)) return;
    if (event.loading) pipReturnLayout.navigationStarted(event.tabId);
    setNavigation((old) => ({ ...old, [event.tabId]: event }));
    setTabErrors((old) => {
      if (!old[event.tabId]) return old;
      const next = { ...old };
      delete next[event.tabId];
      return next;
    });
    // Private navigation never enters ordinary history.
    if (event.url && event.url !== NEW_TAB_URL && !publishedTab.private) {
      history.record(event.url, event.title ?? "");
    }
    run(controller.navigated(event));
  };
  const closeFind = () => {
    if (findTab && typeof platform.findClose === "function")
      platform.findClose(findTab);
    setFindTab(null);
    setFindResult(null);
  };
  const clearSidebarDropBounds = () => {
    favoritesRowBounds.current = null;
    pinnedSectionBounds.current = null;
    tabListBounds.current = null;
    ordinarySectionBounds.current = null;
    sidebarRowBounds.current.clear();
  };
  const measurePanes = () => {
    const epoch = ++sidebarDropEpoch.current;
    clearSidebarDropBounds();
    panesRef.current?.measureInWindow((x, y, width, height) => {
      paneBounds.current = { x, y, width, height };
    });
    // Retained expanded refs can still report their previous native bounds.
    // Only the currently active expanded sidebar may accept sidebar drops.
    if (!sidebarDropActive.current) return;
    const current = () =>
      sidebarDropActive.current && sidebarDropEpoch.current === epoch;
    const measureSidebar = (
      ref: { current: React.ElementRef<typeof View> | null },
      accept: (bounds: Bounds) => void
    ) => {
      const view = ref.current;
      view?.measureInWindow((x, y, width, height) => {
        if (current() && ref.current === view && width > 0 && height > 0)
          accept({ x, y, width, height });
      });
    };
    measureSidebar(favoritesRowRef, (bounds) => {
      favoritesRowBounds.current = bounds;
    });
    measureSidebar(tabListRef, (bounds) => {
      tabListBounds.current = bounds;
    });
    measureSidebar(pinnedSectionRef, (bounds) => {
      pinnedSectionBounds.current = bounds;
    });
    measureSidebar(ordinarySectionRef, (bounds) => {
      ordinarySectionBounds.current = bounds;
    });
    sidebarRowRefs.current.forEach((row, id) => {
      row.measureInWindow((x, y, width, height) => {
        if (
          current() &&
          sidebarRowRefs.current.get(id) === row &&
          width > 0 &&
          height > 0
        )
          sidebarRowBounds.current.set(id, { x, y, width, height });
      });
    });
  };
  const within = (x: number, y: number, bounds: Bounds | null) =>
    !!bounds &&
    x >= bounds.x &&
    x <= bounds.x + bounds.width &&
    y >= bounds.y &&
    y <= bounds.y + bounds.height;
  // Drag ghost follows the finger from its center (half of appStyles
  // dragGhost, 144×36 — keep the two in sync).
  const ghostCenter = (x: number, y: number) => ({ x: x - 72, y: y - 18 });
  // Every centered dialog shares the same full-screen Overlay: it grows
  // from the center without dimming the page (Arc's floating sheets), and
  // its surface captures touches so the page behind can't scroll or take
  // selection. Tapping outside the card closes it (onClose); taps on the
  // card itself are swallowed by the card's responder wrapper. Children
  // freeze during the exit pass.
  const sheet = (open: boolean, onClose: () => void, node: React.ReactNode) => (
    <Overlay
      open={open}
      className={c.overlay}
      style={{ bottom: keyboardInset }}
      pop
      dim={false}
      reducedMotion={reducedMotion}
    >
      {open && (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr("common.close")}
            className={c.sheetUnderlay}
            onPress={onClose}
          />
          {/* The card must be a direct child of the full-screen centerer:
              its percent width/height resolve against that container. */}
          <View className={c.overlayTouch} pointerEvents="box-none">
            {node}
          </View>
        </>
      )}
    </Overlay>
  );
  const beginDrag = (tabId: string, title: string, x: number, y: number) => {
    dragFrames.cancel();
    measurePanes();
    const preview: DragPreview = {
      tabId,
      title,
      zone: null,
      targetId: target ?? null,
      layout: validSplit,
      reorderIndex: null,
    };
    dragLifecycle.begin(preview);
    setDrag(preview);
    ghostPosition.setValue(ghostCenter(x, y));
    ghostOpacity.stopAnimation();
    ghostScale.stopAnimation();
    ghostOpacity.setValue(0);
    ghostScale.setValue(reducedMotion ? 1 : 0.96);
    Animated.parallel([
      Animated.timing(ghostOpacity, {
        toValue: 1,
        duration: reducedMotion ? 0 : motionTokens.micro,
        useNativeDriver: true,
      }),
      Animated.timing(ghostScale, {
        toValue: 1,
        duration: reducedMotion ? 0 : motionTokens.micro,
        easing: easing.enter,
        useNativeDriver: true,
      }),
    ]).start();
  };
  const renderDrag = ({ x, y }: { x: number; y: number }) => {
    ghostPosition.setValue(ghostCenter(x, y));
    const zone = paneBounds.current
      ? dropZoneAt({ x, y }, paneBounds.current)
      : null;
    setDrag((current) => {
      if (!current) return current;
      const inFavoritesRow =
        sidebarDropActive.current && within(x, y, favoritesRowBounds.current);
      if (inFavoritesRow) {
        const row = favoritesRowBounds.current!;
        const tiles = sidebar.favorites
          .map((tab) => favoriteLayouts.current.get(tab.id))
          .filter((tile): tile is TileBounds => !!tile);
        const index = favoriteDropIndex(
          x - row.x,
          y - row.y + favoriteScrollOffset.current,
          tiles
        );
        return current.reorderIndex === index
          ? current
          : { ...current, zone: null, reorderIndex: index };
      }
      return current.zone === zone && current.reorderIndex === null
        ? current
        : { ...current, zone, reorderIndex: null };
    });
  };
  useLayoutEffect(() => {
    dragFrames.setConsumer(renderDrag);
  });
  const moveDrag = (x: number, y: number) => dragFrames.push({ x, y });
  const finishDrag = (x: number, y: number) => {
    dragFrames.flush({ x, y });
    const released = dragLifecycle.release();
    if (!released) return;
    const drag = released.value;
    if (paneBounds.current) {
      const draggedTab =
        drag.tabId.startsWith("bookmark:") || !state
          ? undefined
          : state.tabs.find((t) => t.id === drag.tabId);
      const inFavorites =
        sidebarDropActive.current && within(x, y, favoritesRowBounds.current);
      const inTabList =
        sidebarDropActive.current && within(x, y, tabListBounds.current);
      const inPinned = inTabList && within(x, y, pinnedSectionBounds.current);
      const inOrdinary =
        inTabList &&
        !!ordinarySectionBounds.current &&
        y >= ordinarySectionBounds.current.y;
      if (draggedTab && state && (inFavorites || inPinned || inOrdinary)) {
        const region = inFavorites
          ? "favorites"
          : inPinned
          ? "pinned"
          : "ordinary";
        const change = sidebarDropChange(draggedTab, region);
        let mutation: Promise<unknown> = Promise.resolve();
        if (change) haptic("click");
        if (change === "favorite")
          mutation = controller.setFavorite(draggedTab.id, true);
        if (change === "unfavorite")
          mutation = controller.setFavorite(draggedTab.id, false);
        if (change === "pin")
          mutation = controller.setPinned(draggedTab.id, true);
        if (change === "unpin")
          mutation = controller.setPinned(draggedTab.id, false);
        let index: number | null = null;
        if (inFavorites) {
          const grid = favoritesRowBounds.current!;
          const tiles = sidebar.favorites
            .map((tab) => favoriteLayouts.current.get(tab.id))
            .filter((tile): tile is TileBounds => !!tile);
          const slot = favoriteDropIndex(
            x - grid.x,
            y - grid.y + favoriteScrollOffset.current,
            tiles
          );
          index = favoriteMoveIndex(
            state.tabs,
            draggedTab.id,
            slot,
            sidebar.favorites.map((tab) => tab.id)
          );
        } else {
          const rows = state.tabs
            .filter(
              (tab) =>
                tab.workspaceId === state.activeWorkspaceId &&
                !tab.favorite &&
                (inPinned ? !!tab.pinned : !tab.pinned)
            )
            .flatMap((tab) => {
              const bounds = sidebarRowBounds.current.get(tab.id);
              return bounds
                ? [{ id: tab.id, y: bounds.y, height: bounds.height }]
                : [];
            });
          index = sidebarTabMoveIndex(state.tabs, draggedTab.id, y, rows);
        }
        const from = state.tabs.findIndex((tab) => tab.id === draggedTab.id);
        run(
          mutation.then(() =>
            index !== null && index !== from
              ? controller.moveTab(draggedTab.id, index)
              : undefined
          )
        );
      } else {
        const zone = dropZoneAt({ x, y }, paneBounds.current);
        const targetId = drag.targetId;
        if (zone && targetId) {
          const layoutFor = (tabId: string) =>
            commitSplitDrop(drag.layout, tabId, targetId, zone);
          const commit = (tabId: string) => {
            const next = layoutFor(tabId);
            if (!next) return;
            run(
              controller.activate(tabId, [next.first, next.second]).then(() => {
                setSplitLayout(next);
                setFocused(tabId);
              })
            );
          };
          if (drag.tabId.startsWith("bookmark:")) {
            run(
              controller
                .openBookmark(
                  drag.tabId.slice("bookmark:".length),
                  (snapshot) => {
                    const next = snapshot.activeTabId
                      ? layoutFor(snapshot.activeTabId)
                      : null;
                    return next
                      ? [next.first, next.second]
                      : snapshot.activeTabId
                      ? [snapshot.activeTabId]
                      : [];
                  }
                )
                .then((snapshot) => {
                  if (!snapshot.activeTabId) return;
                  setSplitLayout(layoutFor(snapshot.activeTabId));
                  setFocused(snapshot.activeTabId);
                })
            );
          } else commit(drag.tabId);
        }
      }
    }
    Animated.parallel([
      Animated.timing(ghostOpacity, {
        toValue: 0,
        duration: reducedMotion ? 0 : motionTokens.micro,
        useNativeDriver: true,
      }),
      Animated.timing(ghostScale, {
        toValue: 0.97,
        duration: reducedMotion ? 0 : motionTokens.micro,
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (dragLifecycle.finish(released.id)) setDrag(null);
    });
  };
  const cancelDrag = () => {
    dragFrames.cancel();
    dragLifecycle.cancel();
    ghostOpacity.stopAnimation();
    ghostScale.stopAnimation();
    ghostOpacity.setValue(0);
    setDrag(null);
  };
  useEffect(() => {
    if (reducedMotion) {
      dragFrames.cancel();
      ghostOpacity.stopAnimation();
      ghostScale.stopAnimation();
      dragLifecycle.cancel();
      ghostOpacity.setValue(0);
      ghostScale.setValue(1);
      setDrag(null);
    }
    return () => {
      ghostOpacity.stopAnimation();
      ghostScale.stopAnimation();
    };
  }, [reducedMotion, ghostOpacity, ghostScale, dragLifecycle]);
  // Sidebar drag-resize: direct manipulation like Arc's resizable sidebar.
  // The PanResponder identity stays stable for the whole gesture; the width
  // at grant is captured once and the delta applies per move.
  const sidebarWidthRef = useRef(sidebarLimits.width);
  const resizeSidebarTo = (width: number) => {
    if (!uiHydrated || !Number.isFinite(width)) return;
    const next = clampSidebarWidth(width, sidebarLimits.max);
    // A click or outward drag at the display cap must not erase the saved width.
    if (next !== sidebarWidthRef.current) {
      sidebarWidthRef.current = next;
      updateUi({ type: "setSidebarWidth", width: next });
    }
  };
  useLayoutEffect(() => {
    sidebarFrames.setConsumer(resizeSidebarTo);
  });
  useLayoutEffect(() => {
    sidebarWidthRef.current = sidebarLimits.width;
  }, [sidebarLimits.width]);
  const resizeOrigin = useRef({ x: 0, width: 0 });
  const dividerSpace = state?.activeWorkspaceId;
  const sameSplit = (a: SplitLayout | null, b: SplitLayout | null) =>
    !!a &&
    !!b &&
    a.first === b.first &&
    a.second === b.second &&
    a.orientation === b.orientation;
  useLayoutEffect(() => {
    dividerFrames.setConsumer(({ owner, ratio }) => {
      if (
        dividerOwner.current !== owner ||
        !sameSplit(validSplitRef.current, owner)
      )
        return;
      setSplitLayout((current) =>
        sameSplit(current, owner) && current!.ratio !== ratio
          ? { ...current!, ratio }
          : current
      );
    });
  });
  useLayoutEffect(() => {
    dividerFrames.cancel();
    dividerOwner.current = null;
  }, [
    dividerSpace,
    validSplit?.first,
    validSplit?.second,
    validSplit?.orientation,
    dividerFrames,
  ]);
  useEffect(
    () => () => {
      dragFrames.cancel();
      sidebarFrames.cancel();
      dividerFrames.cancel();
    },
    [dragFrames, sidebarFrames, dividerFrames]
  );
  const sidebarResize = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          sidebarFrames.cancel();
          resizeOrigin.current = {
            x: event.nativeEvent.pageX,
            width: sidebarWidthRef.current,
          };
        },
        // Gesture coordinates and sidebar width are both dp; frame preferences alone use physical px.
        onPanResponderMove: (event) =>
          sidebarFrames.push(
            resizeOrigin.current.width +
              event.nativeEvent.pageX -
              resizeOrigin.current.x
          ),
        onPanResponderRelease: (event) =>
          sidebarFrames.flush(
            resizeOrigin.current.width +
              event.nativeEvent.pageX -
              resizeOrigin.current.x
          ),
        onPanResponderTerminate: () => sidebarFrames.cancel(),
      }),
    [sidebarFrames]
  );
  const dividerPanResponder = useMemo(() => {
    const ratioAt = (pageX: number, pageY: number) => {
      const owner = dividerOwner.current;
      const bounds = paneBounds.current;
      if (!owner || !bounds || !sameSplit(validSplitRef.current, owner))
        return null;
      const ratio =
        owner.orientation === "horizontal"
          ? (pageX - bounds.x) / bounds.width
          : (pageY - bounds.y) / bounds.height;
      return Number.isFinite(ratio) ? { owner, ratio } : null;
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dividerFrames.cancel();
        dividerOwner.current = validSplitRef.current;
        measurePanes();
      },
      onPanResponderRelease: (event) => {
        const sample = ratioAt(
          event.nativeEvent.pageX,
          event.nativeEvent.pageY
        );
        if (!sample) {
          dividerFrames.cancel();
          dividerOwner.current = null;
          return;
        }
        if (sample.ratio < 0.15 || sample.ratio > 0.85) {
          dividerFrames.cancel();
          // The latest ratio may have replaced the grant object. Only this
          // exact released layout may collapse after activation completes.
          const releasedLayout = validSplitRef.current;
          const survivor =
            sample.ratio < 0.15 ? sample.owner.second : sample.owner.first;
          setFocused(survivor);
          run(
            controller.activate(survivor, [survivor]).then(() => {
              setSplitLayout((layout) =>
                layout === releasedLayout ? null : layout
              );
            })
          );
        } else
          dividerFrames.flush({
            ...sample,
            ratio: clampSplitRatio(sample.ratio),
          });
        dividerOwner.current = null;
      },
      onPanResponderMove: (event) => {
        const sample = ratioAt(
          event.nativeEvent.pageX,
          event.nativeEvent.pageY
        );
        if (sample)
          dividerFrames.push({
            ...sample,
            ratio: clampSplitRatio(sample.ratio),
          });
      },
      onPanResponderTerminate: () => {
        dividerFrames.cancel();
        dividerOwner.current = null;
      },
    });
  }, [dividerFrames]);
  const renderSurface = (id: string, url: string) => (
    <Surface
      key={id}
      ref={(ref) => {
        if (ref) return registerSurfaceRef(refs.current, id, ref);
      }}
      className={c.surface}
      tabId={id}
      initialUrl={url}
      active={id === target}
      onNavigation={(e) => onNavigation(e.nativeEvent)}
      onFocused={(e) => {
        setFocused(e.nativeEvent.tabId);
      }}
    />
  );
  // Outer frame per side in dp from the user's px preferences (Settings →
  // Layout): the whole chrome floats on the mat instead of touching the
  // edges. The left side defaults to none so the sidebar hugs the edge.
  const framePxToDp = (v: number) => v / PixelRatio.get();
  const frameStyle = {
    paddingLeft: framePxToDp(ui.framePx.left),
    paddingRight: framePxToDp(ui.framePx.right),
    paddingTop: framePxToDp(ui.framePx.top),
    paddingBottom: framePxToDp(ui.framePx.bottom),
  };
  // While a sheet is open the whole body behind it stops receiving touches
  // at the native level — a JS responder on the overlay alone doesn't stop
  // the GeckoView from scrolling/taking selection underneath. The flip is
  // DELAYED past the popup entrance: committing it in the same frame as the
  // sheet mount produced a one-frame full-screen white flash on ⌘T.
  const [bodyBlocking, setBodyBlocking] = useState(false);
  useEffect(() => {
    // Both flips wait out the sheet transition: committing pointerEvents in
    // the same frame as the sheet mount/exit flashed the GeckoView frame.
    if (reducedMotion) {
      setBodyBlocking(overlayOpen);
      return;
    }
    const id = setTimeout(
      () => setBodyBlocking(overlayOpen),
      overlayOpen ? motionTokens.split : motionTokens.fade + 60
    );
    return () => clearTimeout(id);
  }, [overlayOpen, reducedMotion]);
  const renderSidebarTab = (tab: NonNullable<typeof state>["tabs"][number]) => (
    <View
      key={tab.id}
      ref={(view) => {
        if (view) sidebarRowRefs.current.set(tab.id, view);
        else sidebarRowRefs.current.delete(tab.id);
      }}
      className={cn(
        rowVariants({
          density: "tab",
          selected: splitPaneIds.includes(tab.id) && !tab.suspended,
        }),
        c.tab
      )}
    >
      <DragSource
        reducedMotion={reducedMotion}
        accessibilityLabel={`${tr(
          tab.private
            ? "chrome.privateTab"
            : tab.pinned
            ? "chrome.pinnedTab"
            : "chrome.tab"
        )} ${tabLabel(tab)}`}
        className={c.tabDrag}
        onPress={() => revealTab(tab.id)}
        onDragStart={(x, y) => beginDrag(tab.id, tabLabel(tab), x, y)}
        onDragMove={moveDrag}
        onDragRelease={finishDrag}
        onDragCancel={cancelDrag}
        onLongPress={(x, y) => openTabMenu(tab.id, x, y)}
      >
        <View className={c.tabFavicon}>
          {playing.includes(tab.id) ? (
            <ChromeIcon className={cn("size-[14px]")} name="play" />
          ) : (
            // Private tabs use a local fallback: nothing about the
            // visit may reach the shared disk cache.
            <Favicon
              url={tab.url}
              fallback="◌"
              size={16}
              radius={3}
              persist={!tab.private}
            />
          )}
        </View>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.35}
          className={c.tabTitle}
        >
          {tabLabel(tab)}
        </Text>
        {!!validSplit && splitPaneIds.includes(tab.id) && (
          <ChromeIcon
            className={cn("size-[14px]", "text-ink-muted")}
            name="split"
          />
        )}
        {windowedTabs.includes(tab.id) && (
          <ChromeIcon
            className={cn("size-[14px]", "text-ink-muted")}
            name="window"
          />
        )}
      </DragSource>
      <SidebarPressable
        accessibilityRole="button"
        accessibilityLabel={tr("chrome.closeNamedTab", { name: tabLabel(tab) })}
        accessibilityState={{ disabled: !!tab.suspended }}
        disabled={!!tab.suspended}
        hitSlop={8}
        className={cn(
          c.tabClose,
          tab.suspended && c.disabled,
          "active:bg-field-on-chrome"
        )}
        onPress={() => closeTab(tab.id)}
      >
        <ChromeIcon
          className={cn("size-[15px]", "text-ink-muted")}
          name="close"
        />
      </SidebarPressable>
    </View>
  );
  const renderRailFolder = (item: SidebarFolder) => (
    <SidebarFolderItem
      key={item.folder.id}
      title={item.folder.title}
      count={item.bookmarks.length}
      open={
        sidebarMenu?.kind === "folderPages" && sidebarMenu.id === item.folder.id
      }
      collapsed
      containsFocused={item.containsFocused}
      contextOpen={
        sidebarMenu?.kind === "folder" && sidebarMenu.id === item.folder.id
      }
      onPress={() =>
        setSidebarMenu({ kind: "folderPages", id: item.folder.id })
      }
      onContextMenu={(x, y) =>
        setSidebarMenu({ kind: "folder", id: item.folder.id, anchor: { x, y } })
      }
    />
  );
  const createSpace = () =>
    run(
      controller
        .workspace(`Space ${(state?.workspaces.length ?? 0) + 1}`)
        .then((snapshot) => {
          setSplitLayout(null);
          setFocused(snapshot.activeTabId ?? null);
        })
    );
  const sidebarActions = (): MenuItem[] => {
    if (!sidebarMenu) return [];
    if (sidebarMenu.kind === "create")
      return [
        {
          id: "new-tab",
          label: tr("chrome.newTab"),
          icon: "plus",
          onPress: () => openQuickOpen("touch"),
        },
        {
          id: "new-folder",
          label: tr("chrome.newFolder"),
          icon: "folder",
          onPress: () => {
            setFolderName("");
            setNewFolderOpen(true);
          },
        },
        {
          id: "new-space",
          label: tr("chrome.newSpace"),
          icon: "space",
          onPress: createSpace,
        },
        {
          id: "favorite",
          label: tr("chrome.addFavorite"),
          icon: "star",
          disabled:
            !target ||
            targetUrl === NEW_TAB_URL ||
            !!state?.tabs.find((tab) => tab.id === target)?.favorite,
          onPress: () => {
            if (target) run(controller.setFavorite(target, true));
          },
        },
        {
          id: "history",
          label: tr("chrome.history"),
          icon: "history",
          onPress: () => setHistoryOpen(true),
        },
        {
          id: "picture-in-picture",
          label: tr("chrome.pip"),
          icon: "external",
          disabled: !pip.state.supported || !pip.state.allowed || !pipTab,
          onPress: enterPictureInPicture,
        },
        {
          id: "extensions",
          label: tr("chrome.extensions"),
          icon: "settings",
          onPress: () => {
            setSettingsQuery("");
            setSettingsSection("extensions");
            setSettings(true);
          },
        },
        {
          id: "settings",
          label: tr("chrome.settings"),
          icon: "settings",
          onPress: () => setSettings(true),
        },
      ];
    if (
      sidebarMenu.kind === "bookmark" ||
      sidebarMenu.kind === "bookmarkMove"
    ) {
      const bookmark = spaceBookmarks.find(
        (item) => item.id === sidebarMenu.id
      );
      if (!bookmark) return [];
      const destinations: MenuItem[] = spaceFolders
        .filter((folder) => folder.id !== bookmark.folderId)
        .map((folder) => ({
          id: `move-${folder.id}`,
          label: tr("chrome.moveToFolder", { folder: folder.title }),
          icon: "folder",
          onPress: () =>
            run(controller.bookmarkSetFolder(bookmark.id, folder.id)),
        }));
      if (bookmark.folderId)
        destinations.push({
          id: "move-root",
          label: tr("chrome.moveOut"),
          icon: "folder",
          onPress: () => run(controller.bookmarkSetFolder(bookmark.id, "")),
        });
      if (sidebarMenu.kind === "bookmarkMove") return destinations;
      const tab = bookmarkTabs.get(bookmark.id);
      return [
        ...(tab
          ? [
              {
                id: "close",
                label: tr("chrome.closeTab"),
                icon: "close" as const,
                disabled: !!tab.suspended,
                onPress: () => closeTab(tab.id),
              },
              {
                id: "reset",
                label: tr("chrome.savedPage"),
                icon: "reload" as const,
                onPress: () => run(controller.reset(tab.id)),
              },
              {
                id: "split",
                label: tr("chrome.openSplit"),
                icon: "split" as const,
                disabled: !!tab.suspended,
                onPress: () => setSplitPickerTabId(tab.id),
              },
              {
                id: "duplicate",
                label: tr("chrome.duplicateTab"),
                icon: "copy" as const,
                onPress: () => createTabAndShow(tab.url),
              },
            ]
          : []),
        {
          id: "open",
          label: tr("chrome.open"),
          icon: "external",
          onPress: () => openBookmark(bookmark),
        },
        {
          id: "edit",
          label: tr("chrome.editSaved"),
          icon: "edit",
          onPress: () => editBookmark(bookmark),
        },
        {
          id: "copy",
          label: tr("chrome.copyLink"),
          icon: "copy",
          onPress: () => {
            platform.copyToClipboard(bookmark.url);
            flashNotice(tr("chrome.linkCopied"));
          },
        },
        ...destinations,
        {
          id: "remove",
          label: tr("chrome.removePin"),
          icon: "trash",
          destructive: true,
          onPress: () => run(controller.bookmarkRemove(bookmark.id)),
        },
      ];
    }
    const folder = spaceFolders.find((item) => item.id === sidebarMenu.id);
    if (!folder) return [];
    return [
      {
        id: "toggle",
        label: tr(
          expandedFolders.has(folder.id)
            ? "chrome.collapseFolder"
            : "chrome.expandFolder"
        ),
        icon: "folder",
        onPress: () => toggleFolder(folder.id),
      },
      {
        id: "rename",
        label: tr("chrome.renameFolder"),
        icon: "edit",
        onPress: () => {
          setBookmarkFolder(folder.id);
          setRenamingFolder(folder.id);
          setFolderName(folder.title);
          setBookmarkManager(true);
        },
      },
      {
        id: "delete",
        label: tr("chrome.removeFolder"),
        icon: "trash",
        destructive: true,
        onPress: () => run(controller.bookmarkFolderRemove(folder.id)),
      },
    ];
  };
  if (Platform.OS !== "android")
    return (
      <SafeAreaView>
        <Text>
          WKWebView BrowserSurface is reserved for Phase 2. Android POC only.
        </Text>
      </SafeAreaView>
    );
  if (!browser.ready)
    return (
      <I18nContext.Provider value={language}>
        <ThemeContext.Provider value={theme}>
          <ThemeScope theme={theme}>
            <SafeAreaView
              className={cn(
                c.app,
                "justify-center",
                "items-center",
                "p-[24px]"
              )}
            >
              <Text className={c.dialogTitle}>
                {browser.startupError
                  ? tr("chrome.startupError")
                  : tr("chrome.opening")}
              </Text>
              {!!browser.startupError && (
                <>
                  <Text className={c.dialogHelp}>{browser.startupError}</Text>
                  <Button
                    label={tr("common.retry")}
                    onPress={browser.retryStartup}
                  />
                </>
              )}
            </SafeAreaView>
          </ThemeScope>
        </ThemeContext.Provider>
      </I18nContext.Provider>
    );
  return (
    <I18nContext.Provider value={language}>
      <ThemeContext.Provider value={theme}>
        <ThemeScope theme={theme}>
          <SafeAreaView
            className={c.app}
            edges={contentFullscreen ? ["left", "right", "bottom"] : undefined}
          >
            {!!error && !contentFullscreen && (
              <Pressable onPress={() => setError("")}>
                <Text selectable className={c.error}>
                  {error}
                </Text>
              </Pressable>
            )}
            {!!target && !!tabErrors[target] && !contentFullscreen && (
              <View className={cn("flex-row", "items-center")}>
                <Pressable
                  className={"flex-1"}
                  onPress={() =>
                    setTabErrors((old) => {
                      if (!target) return old;
                      const next = { ...old };
                      delete next[target];
                      return next;
                    })
                  }
                >
                  <Text selectable className={c.error}>
                    {tabErrors[target]}
                  </Text>
                </Pressable>
                <Button
                  label={tr("common.retry")}
                  onPress={() => {
                    setTabErrors((old) => {
                      if (!target) return old;
                      const next = { ...old };
                      delete next[target];
                      return next;
                    });
                    invoke(Commands.reload);
                  }}
                />
              </View>
            )}
            {/* pointerEvents must not flatten/unflatten the native Gecko ancestors. */}
            <View
              collapsable={false}
              className={c.body}
              style={[!contentFullscreen && frameStyle]}
              pointerEvents={bodyBlocking ? "none" : "auto"}
              accessibilityElementsHidden={accessibilityBlocking}
              importantForAccessibility={
                accessibilityBlocking ? "no-hide-descendants" : "auto"
              }
            >
              <AnimatedView
                className={cn(c.sidebar, contentFullscreen && c.hidden)}
                style={[
                  {
                    width: sideP.interpolate({
                      inputRange: [0, 1],
                      outputRange: [size.rail, sidebarLimits.width],
                    }),
                  },
                ]}
              >
                <SidebarLayer
                  visible={sidebarMotion.expanded && !contentFullscreen}
                  active={!ui.sidebarCollapsed && !contentFullscreen}
                  className={cn(c.sidebarLayer, c.sidebarLayerExpanded)}
                  style={[
                    {
                      width: sidebarLimits.width,
                      opacity: sideP,
                      transform: [
                        {
                          translateX: sideP.interpolate({
                            inputRange: [0, 1],
                            outputRange: [-12, 0],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <View className={c.sidebarTop}>
                    <View className={c.navigationRow}>
                      <IconButton
                        label={tr("chrome.collapseSidebar")}
                        icon="sidebar"
                        onPress={toggleSidebar}
                        disabled={!uiHydrated}
                      />
                      <View className={c.navSpacer} />
                      <IconButton
                        label={tr("chrome.back")}
                        icon="back"
                        onPress={goBack}
                        disabled={!canGoBack}
                      />
                      <IconButton
                        label={tr("chrome.forward")}
                        icon="forward"
                        onPress={() => invoke(Commands.goForward)}
                        disabled={!canGoForward}
                      />
                      <IconButton
                        label={tr("chrome.reload")}
                        icon="reload"
                        onPress={() => invoke(Commands.reload)}
                      />
                    </View>
                    {activePrivate && (
                      <View
                        className={c.privateBadge}
                        accessibilityLabel={tr("chrome.privateActive")}
                        accessibilityRole="text"
                      >
                        <ChromeIcon
                          className={cn("size-[13px]", "text-ink")}
                          name="private"
                        />
                        <Text className={c.privateBadgeText}>
                          {tr("chrome.private")}
                        </Text>
                      </View>
                    )}
                    <AddressTrigger
                      url={addressValue}
                      security={target ? browser.security[target] : undefined}
                      onPress={() => openLocationEditor("touch")}
                    />
                    <ExtensionActionsBar
                      actions={extensionActions}
                      onOpen={openExtensionAction}
                    />
                    <View
                      ref={favoritesRowRef}
                      className={c.favoritesDropTarget}
                    >
                      <ScrollView
                        className={c.favoritesScroll}
                        contentContainerClassName={c.favorites}
                        showsVerticalScrollIndicator={false}
                        onScroll={(event) => {
                          favoriteScrollOffset.current =
                            event.nativeEvent.contentOffset.y;
                        }}
                        scrollEventThrottle={16}
                      >
                        {sidebar.favorites.map((tab) => (
                          <View
                            key={tab.id}
                            style={{
                              width:
                                (sidebarLimits.width -
                                  24 -
                                  6 * (favoriteColumns - 1)) /
                                favoriteColumns,
                            }}
                            onLayout={(event) => {
                              favoriteLayouts.current.set(
                                tab.id,
                                event.nativeEvent.layout
                              );
                            }}
                          >
                            <DragSource
                              reducedMotion={reducedMotion}
                              accessibilityLabel={tr("chrome.favoriteLabel", {
                                name: tabLabel(tab),
                              })}
                              className={favoriteClasses({
                                selected:
                                  splitPaneIds.includes(tab.id) &&
                                  !tab.suspended,
                              })}
                              onPress={() => revealTab(tab.id)}
                              onDragStart={(x, y) =>
                                beginDrag(tab.id, tabLabel(tab), x, y)
                              }
                              onDragMove={moveDrag}
                              onDragRelease={finishDrag}
                              onDragCancel={cancelDrag}
                              onLongPress={(x, y) => openTabMenu(tab.id, x, y)}
                            >
                              {playing.includes(tab.id) ? (
                                <ChromeIcon
                                  className={cn("size-[20px]")}
                                  name="play"
                                />
                              ) : (
                                <Favicon
                                  url={tab.url}
                                  fallback={tabLabel(tab)
                                    .slice(0, 1)
                                    .toUpperCase()}
                                  size={22}
                                  radius={5}
                                />
                              )}
                            </DragSource>
                          </View>
                        ))}
                      </ScrollView>
                    </View>
                  </View>
                  <AnimatedView
                    ref={tabListRef}
                    className={c.tabScrollWrap}
                    style={[spaceStyle]}
                  >
                    <FlatList
                      key={state?.activeWorkspaceId}
                      data={sidebar.ordinaryTabs}
                      keyExtractor={(tab) => tab.id}
                      renderItem={({ item }) => renderSidebarTab(item)}
                      initialNumToRender={initialSidebarRows}
                      maxToRenderPerBatch={8}
                      windowSize={3}
                      removeClippedSubviews={false}
                      className={c.tabScroll}
                      contentContainerClassName={c.tabScrollContent}
                      showsVerticalScrollIndicator={false}
                      ListHeaderComponent={
                        <View>
                          {sidebar.split && (
                            <SplitSidebarItem
                              split={sidebar.split}
                              collapsed={false}
                              open={sidebarMenu?.kind === "split"}
                              onOpen={openSplitCollection}
                            />
                          )}
                          <View
                            ref={pinnedSectionRef}
                            className={c.persistentSection}
                          >
                            <SidebarPressable
                              accessibilityRole="button"
                              accessibilityLabel={`Manage space ${
                                activeWorkspace?.name ?? "Space"
                              }`}
                              className={cn(
                                c.spaceHeader,
                                "active:opacity-pressed"
                              )}
                              onPress={() => setSpaceSwitcher(true)}
                            >
                              <ChromeIcon
                                className={cn("size-[12px]", "text-ink-muted")}
                                name="space"
                              />
                              <Text
                                numberOfLines={1}
                                className={c.spaceHeaderTitle}
                              >
                                {activeWorkspace?.name ?? "Space"}
                              </Text>
                              <ChromeIcon
                                className={cn("size-[10px]", "text-ink-muted")}
                                name="chevronDown"
                              />
                            </SidebarPressable>
                            {sidebar.folders.map(
                              ({
                                folder,
                                bookmarks,
                                visibleBookmarks,
                                containsFocused,
                              }) => {
                                const open = expandedFolders.has(folder.id);
                                return (
                                  <View key={folder.id}>
                                    <SidebarFolderItem
                                      title={folder.title}
                                      count={bookmarks.length}
                                      open={open}
                                      containsFocused={containsFocused}
                                      onPress={() => toggleFolder(folder.id)}
                                      contextOpen={
                                        sidebarMenu?.kind === "folder" &&
                                        sidebarMenu.id === folder.id
                                      }
                                      onContextMenu={(x, y) =>
                                        setSidebarMenu({
                                          kind: "folder",
                                          id: folder.id,
                                          anchor: { x, y },
                                        })
                                      }
                                    />
                                    <FolderDisclosure
                                      open={open}
                                      reducedMotion={reducedMotion}
                                    >
                                      <View className={c.folderChildren}>
                                        {visibleBookmarks.map((bookmark) =>
                                          bookmarkTreeRow(bookmark, true)
                                        )}
                                        {bookmarks.length === 0 && (
                                          <Text className={c.emptyFolder}>
                                            {tr("chrome.emptyFolder")}
                                          </Text>
                                        )}
                                      </View>
                                    </FolderDisclosure>
                                  </View>
                                );
                              }
                            )}
                            {sidebar.looseBookmarks.map((bookmark) =>
                              bookmarkTreeRow(bookmark, false)
                            )}
                            {sidebar.pinnedTabs.map((tab) =>
                              renderSidebarTab(tab)
                            )}
                            {privateTabs.length > 0 && (
                              <View className={c.privateSection}>
                                <View className={c.privateHeader}>
                                  <ChromeIcon
                                    className={cn(
                                      "size-[12px]",
                                      "text-accent-strong"
                                    )}
                                    name="private"
                                  />
                                  <Text
                                    numberOfLines={1}
                                    className={c.privateHeaderText}
                                  >
                                    {tr("chrome.privateTabs")}
                                  </Text>
                                  <SidebarPressable
                                    accessibilityRole="button"
                                    accessibilityLabel={tr(
                                      "chrome.privateNewTab"
                                    )}
                                    hitSlop={8}
                                    className={cn(
                                      c.privateNewTab,
                                      "active:bg-field-on-chrome"
                                    )}
                                    onPress={() => createPrivateTabAndShow()}
                                  >
                                    <ChromeIcon
                                      className={cn(
                                        "size-[15px]",
                                        "text-ink-muted"
                                      )}
                                      name="plus"
                                    />
                                  </SidebarPressable>
                                </View>
                                {/* One collection across Spaces: private tabs
                                vanish with the session, wherever they were
                                opened. */}
                                {sidebar.privateTabs.map((tab) =>
                                  renderSidebarTab(tab)
                                )}
                              </View>
                            )}
                          </View>
                          <View className={c.sectionRule} />
                          <View
                            ref={ordinarySectionRef}
                            className={
                              !sidebar.ordinaryTabs.length
                                ? c.ordinarySection
                                : undefined
                            }
                          >
                            <SidebarPressable
                              accessibilityRole="button"
                              accessibilityLabel={tr("chrome.newTabIn", {
                                space: activeWorkspace?.name ?? "Space",
                              })}
                              className={cn(
                                c.newTab,
                                "active:bg-field-on-chrome"
                              )}
                              onPress={() => openQuickOpen("touch")}
                            >
                              <ChromeIcon
                                className={cn("size-[18px]", "text-ink-muted")}
                                name="plus"
                              />
                              <Text className={c.newTabText}>
                                {tr("chrome.newTab")}
                              </Text>
                            </SidebarPressable>
                          </View>
                        </View>
                      }
                    />
                  </AnimatedView>
                  <View className={c.sidebarBottom}>
                    <IconButton
                      label={tr("chrome.androidHome")}
                      icon="home"
                      onPress={goHome}
                    />
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      className={c.spaceRailScroll}
                      contentContainerClassName={c.spaceRail}
                    >
                      {(state?.workspaces ?? []).map((workspace) => (
                        <SidebarPressable
                          key={workspace.id}
                          accessibilityRole="button"
                          accessibilityLabel={tr("chrome.switchSpace", {
                            space: workspace.name,
                          })}
                          accessibilityState={{
                            selected: workspace.id === state?.activeWorkspaceId,
                          }}
                          hitSlop={8}
                          className={cn(
                            c.spaceChip,
                            workspace.id === state?.activeWorkspaceId &&
                              c.spaceChipActive,
                            "active:opacity-pressed"
                          )}
                          onPress={() => switchSpace(workspace.id)}
                          onLongPress={() => setSpaceSwitcher(true)}
                        >
                          <ChromeIcon
                            className={cn(
                              "size-[17px]",
                              workspace.id === state?.activeWorkspaceId
                                ? "text-ink"
                                : "text-ink-muted"
                            )}
                            name="space"
                          />
                          {workspace.id === state?.activeWorkspaceId && (
                            <View className={c.spaceIndicator} />
                          )}
                        </SidebarPressable>
                      ))}
                    </ScrollView>
                    <SidebarPressable
                      accessibilityRole="button"
                      accessibilityLabel={tr("chrome.settings")}
                      className={c.iconButton}
                      onPress={() => setSettings(true)}
                    >
                      <ChromeIcon
                        className={cn("size-[20px]")}
                        name="settings"
                      />
                    </SidebarPressable>
                    <SidebarPressable
                      accessibilityRole="button"
                      accessibilityLabel={tr("chrome.addSidebar")}
                      className={c.iconButton}
                      onPress={(event) =>
                        setSidebarMenu({
                          kind: "create",
                          anchor: {
                            x: event.nativeEvent.pageX,
                            y: event.nativeEvent.pageY,
                          },
                        })
                      }
                    >
                      <ChromeIcon className={cn("size-[20px]")} name="plus" />
                    </SidebarPressable>
                  </View>
                </SidebarLayer>
                <SidebarLayer
                  visible={sidebarMotion.rail && !contentFullscreen}
                  active={ui.sidebarCollapsed && !contentFullscreen}
                  className={cn(c.sidebarLayer, c.sidebarLayerRail, "w-[48px]")}
                  style={[
                    {
                      opacity: sideP.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 0],
                      }),
                      transform: [
                        {
                          // Rest state (collapsed, progress 0) must sit at 0; the
                          // 24px offset only exists while expanded so the rail
                          // slides left into place during the collapse fade.
                          translateX: sideP.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, 12],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <View className={cn(c.identityRow, c.identityRowCollapsed)}>
                    <IconButton
                      label={tr("chrome.expandSidebar")}
                      icon="sidebar"
                      onPress={toggleSidebar}
                      disabled={!uiHydrated}
                    />
                  </View>
                  <View className={c.tabScrollWrap}>
                    <FlatList
                      key={state?.activeWorkspaceId}
                      data={sidebar.railTabs}
                      keyExtractor={(tab) => tab.id}
                      renderItem={({ item: t }) => (
                        <DragSource
                          reducedMotion={reducedMotion}
                          key={t.id}
                          accessibilityLabel={tr("chrome.tabNamed", {
                            name: tabLabel(t),
                          })}
                          className={cn(
                            c.railItem,
                            splitPaneIds.includes(t.id) &&
                              !t.suspended &&
                              c.railTabActive
                          )}
                          onPress={() => revealTab(t.id)}
                          onDragStart={(x, y) =>
                            beginDrag(t.id, tabLabel(t), x, y)
                          }
                          onDragMove={moveDrag}
                          onDragRelease={finishDrag}
                          onDragCancel={cancelDrag}
                          onLongPress={(x, y) => openTabMenu(t.id, x, y)}
                        >
                          <View className={c.railIcon}>
                            {playing.includes(t.id) ? (
                              <ChromeIcon
                                className={cn("size-[16px]")}
                                name="play"
                              />
                            ) : (
                              <Favicon
                                url={t.url}
                                fallback={tabLabel(t).slice(0, 1).toUpperCase()}
                                size={18}
                                radius={5}
                              />
                            )}
                          </View>
                        </DragSource>
                      )}
                      initialNumToRender={initialSidebarRows}
                      maxToRenderPerBatch={8}
                      windowSize={3}
                      removeClippedSubviews={false}
                      className={c.tabScroll}
                      contentContainerClassName={c.railContent}
                      showsVerticalScrollIndicator={false}
                      ListHeaderComponent={
                        <View className={c.railHeader}>
                          {sidebar.split && (
                            <SplitSidebarItem
                              split={sidebar.split}
                              collapsed
                              open={sidebarMenu?.kind === "split"}
                              onOpen={openSplitCollection}
                            />
                          )}
                          {sidebar.favorites.map((tab) => (
                            <DragSource
                              reducedMotion={reducedMotion}
                              key={tab.id}
                              accessibilityLabel={tr("chrome.favoriteLabel", {
                                name: tabLabel(tab),
                              })}
                              className={cn(
                                c.railItem,
                                splitPaneIds.includes(tab.id) &&
                                  !tab.suspended &&
                                  c.railTabActive
                              )}
                              onPress={() => revealTab(tab.id)}
                              onDragStart={(x, y) =>
                                beginDrag(tab.id, tabLabel(tab), x, y)
                              }
                              onDragMove={moveDrag}
                              onDragRelease={finishDrag}
                              onDragCancel={cancelDrag}
                              onLongPress={(x, y) => openTabMenu(tab.id, x, y)}
                            >
                              <View className={c.railIcon}>
                                {playing.includes(tab.id) ? (
                                  <ChromeIcon
                                    className={cn("size-[16px]")}
                                    name="play"
                                  />
                                ) : (
                                  <Favicon
                                    url={tab.url}
                                    fallback={tabLabel(tab)
                                      .slice(0, 1)
                                      .toUpperCase()}
                                    size={18}
                                    radius={5}
                                  />
                                )}
                              </View>
                            </DragSource>
                          ))}
                          <View className={c.railSeparator} />
                          {sidebar.folders.map(renderRailFolder)}
                        </View>
                      }
                    />
                  </View>
                  <View className={c.sidebarBottomCollapsed}>
                    <IconButton
                      label={tr("chrome.androidHome")}
                      icon="home"
                      onPress={goHome}
                    />
                    <SidebarPressable
                      accessibilityRole="button"
                      accessibilityLabel={tr("chrome.newTab")}
                      hitSlop={8}
                      className={cn(c.railItem, "active:opacity-pressed")}
                      onPress={() => openQuickOpen("touch")}
                    >
                      <View className={c.railIcon}>
                        <ChromeIcon className={cn("size-[18px]")} name="plus" />
                      </View>
                    </SidebarPressable>
                    <IconButton
                      label={tr("chrome.settings")}
                      icon="settings"
                      onPress={() => setSettings(true)}
                    />
                  </View>
                </SidebarLayer>
                {!ui.sidebarCollapsed && (
                  <View
                    accessibilityRole="adjustable"
                    accessibilityLabel={tr("chrome.resizeSidebar")}
                    accessibilityHint={tr("chrome.resizeSidebarHint")}
                    accessibilityState={{ disabled: !uiHydrated }}
                    accessibilityValue={{
                      min: sidebarLimits.min,
                      max: sidebarLimits.max,
                      now: sidebarLimits.width,
                    }}
                    accessibilityActions={[
                      { name: "increment", label: tr("chrome.wider") },
                      { name: "decrement", label: tr("chrome.narrower") },
                    ]}
                    onAccessibilityAction={({ nativeEvent }) => {
                      if (nativeEvent.actionName === "increment")
                        resizeSidebarTo(
                          sidebarLimits.width + SIDEBAR_WIDTH_STEP
                        );
                      else if (nativeEvent.actionName === "decrement")
                        resizeSidebarTo(
                          sidebarLimits.width - SIDEBAR_WIDTH_STEP
                        );
                    }}
                    className={c.sidebarResizeHandle}
                    {...sidebarResize.panHandlers}
                  >
                    <View
                      pointerEvents="none"
                      className={c.sidebarResizeGrip}
                    />
                  </View>
                )}
              </AnimatedView>
              <AnimatedView
                className={cn(
                  c.content,
                  contentFullscreen && c.contentFullscreen
                )}
                style={[{ opacity: spaceMotion.opacity }]}
              >
                <SidebarLayer
                  visible={sidebarMotion.rail && !contentFullscreen}
                  active={ui.sidebarCollapsed && !contentFullscreen}
                  className={cn(
                    contentFullscreen ? "hidden" : "flex",
                    "overflow-hidden"
                  )}
                  style={{
                    height: sideP.interpolate({
                      inputRange: [0, 1],
                      outputRange: [size.toolbar, 0],
                    }),
                    opacity: sideP.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 0],
                    }),
                  }}
                >
                  <View className={c.canvasToolbar}>
                    <View className={c.compactNavigation}>
                      <IconButton
                        label={tr("chrome.back")}
                        icon="back"
                        onPress={goBack}
                        disabled={!canGoBack}
                      />
                      <IconButton
                        label={tr("chrome.forward")}
                        icon="forward"
                        onPress={() => invoke(Commands.goForward)}
                        disabled={!canGoForward}
                      />
                      <AddressTrigger
                        compact
                        url={addressValue}
                        security={target ? browser.security[target] : undefined}
                        onPress={() => openLocationEditor("touch")}
                      />
                      <ExtensionActionsBar
                        actions={extensionActions}
                        onOpen={openExtensionAction}
                      />
                    </View>
                    <IconButton
                      label={tr(
                        validSplit ? "chrome.unsplitButton" : "chrome.split"
                      )}
                      icon="split"
                      onPress={toggleSplit}
                      disabled={!validSplit && !splitCandidate}
                    />
                  </View>
                </SidebarLayer>
                <View
                  ref={panesRef}
                  collapsable={false}
                  accessible={false}
                  accessibilityLabel={tr("chrome.splitCanvas")}
                  className={cn(
                    c.panes,
                    renderSplit?.orientation === "vertical" && c.panesVertical
                  )}
                >
                  {[first, second].filter(Boolean).map((tab, index) => {
                    const item = tab!;
                    const hiddenByFullscreen =
                      contentFullscreen && item.id !== fullscreenTabId;
                    const ratio = contentFullscreen
                      ? 1
                      : renderSplit
                      ? fixedSplitGeometry
                        ? index === 0
                          ? renderSplit.ratio
                          : 1 - renderSplit.ratio
                        : index === 0
                        ? splitMotion.firstFraction
                        : splitMotion.firstFraction.interpolate({
                            inputRange: [0, 1],
                            outputRange: [1, 0],
                          })
                      : 1;
                    // Geometry and chrome share the transition so no pane jumps
                    // to its final bounds before its content appears.
                    const joiner =
                      !contentFullscreen &&
                      !fixedSplitGeometry &&
                      splitOpen &&
                      index === 1;
                    const leaving =
                      !contentFullscreen &&
                      !fixedSplitGeometry &&
                      !splitOpen &&
                      !!renderSplit &&
                      item.id !== target;
                    const vertical = renderSplit?.orientation === "vertical";
                    const contentMotion =
                      joiner || leaving
                        ? {
                            opacity: splitP,
                            transform: [
                              vertical
                                ? {
                                    translateY: splitP.interpolate({
                                      inputRange: [0, 1],
                                      outputRange: [index === 0 ? -16 : 16, 0],
                                    }),
                                  }
                                : {
                                    translateX: splitP.interpolate({
                                      inputRange: [0, 1],
                                      outputRange: [index === 0 ? -16 : 16, 0],
                                    }),
                                  },
                            ],
                          }
                        : null;
                    return (
                      <React.Fragment key={item.id}>
                        {index === 1 && renderSplit && (
                          <AnimatedView
                            className={cn(contentFullscreen && c.hidden)}
                            style={[
                              { opacity: fixedSplitGeometry ? 1 : splitP },
                              vertical
                                ? {
                                    height: fixedSplitGeometry
                                      ? 2
                                      : splitP.interpolate({
                                          inputRange: [0, 1],
                                          outputRange: [0, 2],
                                        }),
                                  }
                                : {
                                    width: fixedSplitGeometry
                                      ? 2
                                      : splitP.interpolate({
                                          inputRange: [0, 1],
                                          outputRange: [0, 2],
                                        }),
                                  },
                            ]}
                            pointerEvents={splitOpen ? "auto" : "none"}
                          >
                            <View
                              accessibilityRole="adjustable"
                              accessibilityLabel={tr("chrome.resizeSplit")}
                              accessibilityActions={[
                                {
                                  name: "increment",
                                  label: tr("chrome.growFirst"),
                                },
                                {
                                  name: "decrement",
                                  label: tr("chrome.shrinkFirst"),
                                },
                              ]}
                              onAccessibilityAction={(event) => {
                                const delta =
                                  event.nativeEvent.actionName === "increment"
                                    ? 0.05
                                    : -0.05;
                                if (validSplit)
                                  setSplitLayout({
                                    ...validSplit,
                                    ratio: clampSplitRatio(
                                      validSplit.ratio + delta
                                    ),
                                  });
                              }}
                              hitSlop={8}
                              className={cn(
                                c.divider,
                                !vertical && "h-full",
                                renderSplit.orientation === "vertical" &&
                                  c.dividerVertical
                              )}
                              {...dividerPanResponder.panHandlers}
                            >
                              <View
                                className={cn(
                                  c.dividerHandle,
                                  renderSplit.orientation === "vertical" &&
                                    c.dividerHandleVertical
                                )}
                              />
                            </View>
                          </AnimatedView>
                        )}
                        <AnimatedView
                          pointerEvents={
                            leaving || hiddenByFullscreen ? "none" : "auto"
                          }
                          importantForAccessibility={
                            leaving || hiddenByFullscreen
                              ? "no-hide-descendants"
                              : "auto"
                          }
                          className={paneClasses({
                            focused: !!renderSplit && target === item.id,
                            fullscreen: contentFullscreen,
                            hidden: hiddenByFullscreen,
                          })}
                          style={[{ flex: ratio }]}
                        >
                          {renderSplit && (
                            <AnimatedView
                              className={"overflow-hidden"}
                              style={{
                                height: contentFullscreen
                                  ? 0
                                  : fixedSplitGeometry
                                  ? size.row
                                  : splitP.interpolate({
                                      inputRange: [0, 1],
                                      outputRange: [0, size.row],
                                    }),
                                opacity: fixedSplitGeometry ? 1 : splitP,
                              }}
                            >
                              <DragSource
                                reducedMotion={reducedMotion}
                                accessibilityLabel={tabLabel(item)}
                                className={cn(
                                  c.paneHeader,
                                  target === item.id && c.paneHeaderFocused
                                )}
                                onPress={() => setFocused(item.id)}
                                onDragStart={(x, y) =>
                                  beginDrag(item.id, tabLabel(item), x, y)
                                }
                                onDragMove={moveDrag}
                                onDragRelease={finishDrag}
                                onDragCancel={cancelDrag}
                              >
                                <Favicon
                                  url={item.url}
                                  fallback={tabLabel(item)
                                    .slice(0, 1)
                                    .toUpperCase()}
                                  size={16}
                                  radius={4}
                                />
                                <Text
                                  numberOfLines={1}
                                  className={c.paneHeaderTitle}
                                >
                                  {tabLabel(item)}
                                </Text>
                                <ChromeIcon
                                  className={cn(
                                    "size-[16px]",
                                    "text-ink-muted"
                                  )}
                                  name="more"
                                />
                              </DragSource>
                            </AnimatedView>
                          )}
                          <AnimatedView
                            className={c.paneContent}
                            style={contentMotion ? [contentMotion] : undefined}
                          >
                            <PaneLoadBar
                              tabId={item.id}
                              theme={theme}
                              reducedMotion={reducedMotion}
                            />
                            {renderSurface(item.id, item.url)}
                            <Overlay
                              open={
                                item.url === NEW_TAB_URL &&
                                !controller.isPopupTab(item.id)
                              }
                              className={c.newTabOverlay}
                              pop
                              reducedMotion={reducedMotion}
                            >
                              {item.url === NEW_TAB_URL &&
                                !controller.isPopupTab(item.id) && (
                                  <NewTabPage
                                    favorites={favoriteTabs}
                                    keyboardInset={keyboardInset}
                                    visibleHeight={
                                      inputViewport.visibleHeight ||
                                      windowHeight - keyboardInset
                                    }
                                    reducedMotion={reducedMotion}
                                    engine={ui.searchEngine}
                                    suggestions={suggestionSources}
                                    commands={registry.entries(language)}
                                    onCommand={(id) => registry.execute(id)}
                                    onOpenUrl={(url) =>
                                      loadInPane(item.id, url)
                                    }
                                    onOpenFavorite={(id) => {
                                      const blank = item.id;
                                      switchTab(id);
                                      if (blank !== id)
                                        run(controller.close(blank));
                                    }}
                                  />
                                )}
                            </Overlay>
                          </AnimatedView>
                        </AnimatedView>
                      </React.Fragment>
                    );
                  })}
                  {drag?.zone && (
                    <View
                      pointerEvents="none"
                      className={cn(
                        c.dropPreview,
                        drag.zone === "left" && c.dropLeft,
                        drag.zone === "right" && c.dropRight,
                        drag.zone === "top" && c.dropTop,
                        drag.zone === "bottom" && c.dropBottom
                      )}
                    />
                  )}
                </View>
                <Overlay
                  open={!!findTab}
                  className={c.findOverlay}
                  touchThrough
                  dim={false}
                  reducedMotion={reducedMotion}
                >
                  {findTab && (
                    <FindBar
                      key={findTab}
                      onFind={(text) => {
                        lastFindQuery.current = text;
                        if (typeof platform.findInPage === "function")
                          platform.findInPage(findTab, text, false);
                      }}
                      onStep={(backward) => {
                        if (typeof platform.findInPage === "function")
                          platform.findInPage(
                            findTab,
                            lastFindQuery.current,
                            backward
                          );
                      }}
                      onClose={closeFind}
                      result={findResult}
                    />
                  )}
                </Overlay>
              </AnimatedView>
            </View>
            <Overlay
              open={notice !== ""}
              className={c.noticeBanner}
              lift={-12}
              touchThrough
              reducedMotion={reducedMotion}
            >
              <View pointerEvents="none">
                <Text className={c.noticeText}>{notice}</Text>
              </View>
            </Overlay>
            {sheet(
              !!menuTab,
              () => setCtxMenuTabId(null),
              menuTab && state && (
                <TabContextMenuDialog
                  tab={
                    menuTab
                      ? {
                          id: menuTab.id,
                          title: tabLabel(menuTab),
                          workspaceId: menuTab.favorite
                            ? state.activeWorkspaceId
                            : menuTab.workspaceId,
                          favorite: !!menuTab.favorite,
                          pinned: !!menuTab.pinned,
                        }
                      : null
                  }
                  anchor={ctxMenuAnchor}
                  workspaces={state.workspaces}
                  onCloseTab={() => closeTab(menuTab.id)}
                  onSplit={() => setSplitPickerTabId(menuTab.id)}
                  onCopyLink={() => {
                    platform.copyToClipboard(menuTab.url);
                    flashNotice(tr("chrome.linkCopied"));
                  }}
                  onReset={
                    menuTab.favorite || menuTab.pinned
                      ? () => run(controller.reset(menuTab.id))
                      : undefined
                  }
                  onToggleFavorite={
                    menuTab.private
                      ? undefined
                      : () => {
                          if (!menuTab) return;
                          run(
                            controller.setFavorite(
                              menuTab.id,
                              !menuTab.favorite
                            )
                          );
                        }
                  }
                  onTogglePin={
                    menuTab.private
                      ? undefined
                      : () => {
                          if (!menuTab) return;
                          run(
                            controller.setPinned(menuTab.id, !menuTab.pinned)
                          );
                        }
                  }
                  onDuplicate={() => {
                    if (!menuTab) return;
                    const workspaceId = menuTab.favorite
                      ? state.activeWorkspaceId
                      : menuTab.workspaceId;
                    // Duplicating a private tab keeps the browsing mode.
                    if (menuTab.private) {
                      run(
                        controller
                          .createTab(menuTab.url, workspaceId, {
                            private: true,
                          })
                          .then((snapshot) => {
                            setSplitLayout(null);
                            setFocused(snapshot.activeTabId ?? null);
                          })
                      );
                    } else createTabAndShow(menuTab.url, workspaceId);
                  }}
                  onOpenInNewWindow={
                    // The focused pane can pop out only when another live tab can
                    // take its place, so the main browser never shows a stolen pane.
                    menuTab &&
                    !menuTab.suspended &&
                    (menuTab.id !== target ||
                      (state?.tabs ?? []).some(
                        (t) =>
                          !t.suspended &&
                          t.id !== menuTab.id &&
                          (t.favorite ||
                            t.workspaceId ===
                              (menuTab.favorite
                                ? state.activeWorkspaceId
                                : menuTab.workspaceId))
                      ))
                      ? () => {
                          if (!menuTab) return;
                          setCtxMenuTabId(null);
                          if (menuTab.id !== target) {
                            void platform
                              .openInNewWindow?.(menuTab.id)
                              .catch(() => {});
                            return;
                          }
                          const workspaceId = menuTab.favorite
                            ? state.activeWorkspaceId
                            : menuTab.workspaceId;
                          const replacement = (state?.tabs ?? []).find(
                            (t) =>
                              !t.suspended &&
                              t.id !== menuTab.id &&
                              (t.favorite || t.workspaceId === workspaceId)
                          );
                          if (!replacement) return;
                          void platform
                            .openInNewWindow?.(menuTab.id)
                            .then(() => switchTab(replacement.id))
                            .catch(() => {});
                        }
                      : undefined
                  }
                  onMoveToWorkspace={(workspaceId) => {
                    if (!menuTab) return;
                    // Preserve the outgoing pane until native claims its display.
                    run(
                      controller
                        .setTabWorkspace(menuTab.id, workspaceId)
                        .then((snapshot) => {
                          setSplitLayout(null);
                          setFocused(snapshot.activeTabId ?? null);
                        })
                    );
                  }}
                  onCloseOthers={() => {
                    if (!menuTab) return;
                    state.tabs
                      .filter(
                        (t) =>
                          t.workspaceId ===
                            (menuTab.favorite
                              ? state.activeWorkspaceId
                              : menuTab.workspaceId) &&
                          t.id !== menuTab.id &&
                          !t.favorite &&
                          !t.pinned
                      )
                      .forEach((t) => closeTab(t.id));
                  }}
                  onClose={() => setCtxMenuTabId(null)}
                />
              )
            )}
            {sheet(
              !!sidebarMenu,
              () => setSidebarMenu(null),
              sidebarMenu &&
                (sidebarMenu.kind === "split" && sidebar.split ? (
                  <SidebarPageMenu
                    title={tr(
                      sidebar.split.pages[0].private
                        ? "chrome.privateSplit"
                        : "chrome.splitView"
                    )}
                    anchor={sidebarMenu.anchor}
                    onClose={() => setSidebarMenu(null)}
                    pages={sidebar.split.pages.map((page, index) => ({
                      ...page,
                      detail: tr(
                        sidebar.split!.orientation === "horizontal"
                          ? index
                            ? "side.right"
                            : "side.left"
                          : index
                          ? "side.bottom"
                          : "side.top"
                      ),
                      selected: page.id === sidebar.split!.focusedId,
                      onPress: () => switchTab(page.id),
                      onMenu: (anchor) =>
                        openTabMenu(page.id, anchor.x, anchor.y),
                    }))}
                    actions={[
                      {
                        id: "orientation",
                        label: tr(
                          sidebar.split.orientation === "horizontal"
                            ? "chrome.arrangeVertical"
                            : "chrome.arrangeHorizontal"
                        ),
                        icon: "split",
                        onPress: () =>
                          setSplitLayout((current) =>
                            current &&
                            current.first === sidebar.split?.pages[0].id &&
                            current.second === sidebar.split?.pages[1].id
                              ? {
                                  ...current,
                                  orientation:
                                    current.orientation === "horizontal"
                                      ? "vertical"
                                      : "horizontal",
                                }
                              : current
                          ),
                      },
                      {
                        id: "unsplit",
                        label: tr("chrome.unsplit"),
                        icon: "sidebar",
                        onPress: toggleSplit,
                      },
                    ]}
                  />
                ) : sidebarMenu.kind === "folderPages" ? (
                  <SidebarPageMenu
                    title={
                      sidebar.folders.find(
                        (item) => item.folder.id === sidebarMenu.id
                      )?.folder.title ?? tr("chrome.folder")
                    }
                    anchor={sidebarMenu.anchor}
                    onClose={() => setSidebarMenu(null)}
                    pages={(
                      sidebar.folders.find(
                        (item) => item.folder.id === sidebarMenu.id
                      )?.bookmarks ?? []
                    ).map((bookmark) => {
                      const tab = bookmarkTabs.get(bookmark.id);
                      return {
                        id: bookmark.id,
                        title: bookmark.title,
                        url: tab?.url || bookmark.url,
                        private: !!tab?.private,
                        selected: !!tab && !tab.suspended && tab.id === target,
                        onPress: () =>
                          tab ? switchTab(tab.id) : openBookmark(bookmark),
                        onMenu: (anchor) =>
                          setSidebarMenu({
                            kind: "bookmark",
                            id: bookmark.id,
                            anchor,
                          }),
                      };
                    })}
                    actions={[
                      {
                        id: "manage",
                        label: tr("chrome.folderActions"),
                        icon: "folder",
                        onPress: () =>
                          setSidebarMenu({
                            kind: "folder",
                            id: sidebarMenu.id,
                            anchor: sidebarMenu.anchor,
                          }),
                      },
                    ]}
                  />
                ) : (
                  <ActionMenu
                    title={
                      sidebarMenu.kind === "create"
                        ? tr("chrome.addSidebar")
                        : sidebarMenu.kind === "folder"
                        ? tr("chrome.folder")
                        : sidebarMenu.kind === "bookmarkMove"
                        ? tr("chrome.moveBookmark")
                        : tr("chrome.bookmark")
                    }
                    anchor={sidebarMenu.anchor}
                    items={sidebarActions()}
                    onClose={() => setSidebarMenu(null)}
                  />
                ))
            )}
            {sheet(
              !!splitPickerTabId,
              () => setSplitPickerTabId(null),
              splitPickerTabId && (
                <ActionMenu
                  title={tr("chrome.chooseSplitTab")}
                  onClose={() => setSplitPickerTabId(null)}
                  items={(state?.tabs ?? [])
                    .filter(
                      (tab) =>
                        tab.id !== splitPickerTabId &&
                        !tab.suspended &&
                        (tab.favorite ||
                          tab.workspaceId === state?.activeWorkspaceId) &&
                        // Splits never cross the browsing-mode boundary.
                        !!tab.private ===
                          !!state?.tabs.find(
                            (origin) => origin.id === splitPickerTabId
                          )?.private
                    )
                    .map((tab) => ({
                      id: tab.id,
                      label: tabLabel(tab),
                      icon: "split",
                      onPress: () => {
                        const origin = splitPickerTabId;
                        if (!origin) return;
                        run(
                          controller
                            .activate(origin, [origin, tab.id])
                            .then(() => {
                              setSplitLayout({
                                first: origin,
                                second: tab.id,
                                orientation: "horizontal",
                                ratio: 0.5,
                              });
                              setFocused(origin);
                            })
                        );
                      },
                    }))}
                />
              )
            )}
            {sheet(
              newFolderOpen,
              () => setNewFolderOpen(false),
              newFolderOpen && (
                <View className={cn(c.dialog, c.settingsDialog)}>
                  <Text className={c.dialogTitle}>
                    {tr("chrome.newFolder")}
                  </Text>
                  <TextInput
                    accessibilityLabel={tr("chrome.folderName")}
                    autoFocus
                    value={folderName}
                    onChangeText={setFolderName}
                    className={c.commandInput}
                    placeholder={tr("chrome.folderName")}
                    placeholderTextColorClassName="accent-ink-faint"
                  />
                  <Button
                    label={tr("chrome.createFolder")}
                    disabled={!folderName.trim()}
                    onPress={() => {
                      if (!folderName.trim()) return;
                      run(
                        controller
                          .bookmarkFolderCreate(folderName.trim())
                          .then(() => {
                            setNewFolderOpen(false);
                            setFolderName("");
                          })
                      );
                    }}
                  />
                </View>
              )
            )}
            {sheet(
              !!spaceSwitcher,
              () => setSpaceSwitcher(false),
              state && (
                <SpaceSwitcherDialog
                  workspaces={state.workspaces}
                  activeWorkspaceId={state.activeWorkspaceId}
                  counts={Object.fromEntries(
                    state.workspaces.map((w) => [
                      w.id,
                      state.tabs.filter((t) => t.workspaceId === w.id).length,
                    ])
                  )}
                  onSwitch={(id) => {
                    setSpaceSwitcher(false);
                    switchSpace(id);
                  }}
                  onCreate={() => {
                    run(
                      controller
                        .workspace(
                          `Space ${(state.workspaces.length ?? 0) + 1}`
                        )
                        .then((snapshot) => {
                          setSplitLayout(null);
                          setFocused(snapshot.activeTabId ?? null);
                          setSpaceSwitcher(false);
                        })
                    );
                  }}
                  onClose={() => setSpaceSwitcher(false)}
                />
              )
            )}
            {sheet(
              !!historyOpen,
              () => closeSettingsChild("history", () => setHistoryOpen(false)),
              <HistoryDialog
                entries={history.entries}
                onOpen={(url) => {
                  settingsReturn.current = null;
                  createTabAndShow(url);
                }}
                onClear={() => {
                  void history.clear().then((ok) => {
                    if (!ok) setError(tr("chrome.historyClearFailed"));
                  });
                }}
                onClose={() =>
                  closeSettingsChild("history", () => setHistoryOpen(false))
                }
              />
            )}
            {drag && (
              <AnimatedView
                pointerEvents="none"
                className={c.dragGhost}
                style={[
                  {
                    opacity: ghostOpacity,
                    transform: [
                      { translateX: ghostPosition.x },
                      { translateY: ghostPosition.y },
                      { scale: ghostScale },
                    ],
                  },
                ]}
              >
                <Text numberOfLines={1} className={c.dragGhostText}>
                  {drag.title}
                </Text>
              </AnimatedView>
            )}
            {sheet(
              !!quickOpen,
              closeQuickOpen,
              quickOpen && (
                <View className={cn(c.dialog, c.quickOpenDialog)}>
                  <AddressBox
                    key={quickOpenPresentation}
                    ref={quickOpenInputRef}
                    autoFocus
                    softInput={quickOpenSoft}
                    reducedMotion={reducedMotion}
                    engine={ui.searchEngine}
                    value={
                      quickOpenEdit && targetUrl !== NEW_TAB_URL
                        ? targetUrl
                        : undefined
                    }
                    suggestions={suggestionSources}
                    commands={quickOpenEdit ? [] : registry.entries(language)}
                    onDismiss={closeQuickOpen}
                    onOpenTab={
                      quickOpenEdit
                        ? undefined
                        : (id) => {
                            closeQuickOpen();
                            switchTab(id);
                          }
                    }
                    onCommand={(id) => {
                      closeQuickOpen();
                      registry.execute(id);
                    }}
                    onSubmit={(url) => {
                      closeQuickOpen();
                      if (quickOpenEdit) {
                        invoke((ref) => Commands.loadUrl(ref, url));
                        invoke(Commands.focusContent);
                      } else {
                        createTabInActiveMode(url);
                      }
                    }}
                  />
                  {favoriteTabs.length > 0 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerClassName={c.quickOpenRow}
                    >
                      {favoriteTabs.map((tab) => (
                        <Pressable
                          key={tab.id}
                          accessibilityRole="button"
                          accessibilityLabel={tr("chrome.favoriteLabel", {
                            name: tab.title || tab.url,
                          })}
                          className={cn(
                            c.quickOpenTile,
                            "active:opacity-pressed"
                          )}
                          onPress={() => {
                            closeQuickOpen();
                            switchTab(tab.id);
                          }}
                        >
                          <View className={c.quickOpenTileIcon}>
                            <Favicon
                              url={tab.url}
                              fallback={(tab.title || tab.url)
                                .slice(0, 1)
                                .toUpperCase()}
                              size={22}
                              radius={6}
                            />
                          </View>
                          <Text
                            numberOfLines={1}
                            maxFontSizeMultiplier={1.35}
                            className={c.quickOpenTileLabel}
                          >
                            {tab.title || tab.url}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  ) : (
                    <Text className={c.quickOpenHint}>
                      {tr("chrome.quickOpenLinkHint")}
                    </Text>
                  )}
                </View>
              )
            )}
            {sheet(
              !!permissionRequest,
              () => decidePermission("dismiss"),
              permissionRequest && (
                <PermissionDialog
                  request={{
                    origin: permissionRequest.origin,
                    kinds: permissionKindsFromEvent(permissionRequest.kind),
                    ephemeral: permissionRequest.ephemeral,
                  }}
                  onDecide={decidePermission}
                  onDismiss={() => decidePermission("dismiss")}
                />
              )
            )}
            {sheet(
              !!palette,
              () => setPalette(false),
              palette && (
                <View className={c.dialog}>
                  <Text className={c.dialogTitle}>{tr("chrome.commands")}</Text>
                  <TextInput
                    accessibilityLabel={tr("chrome.findCommand")}
                    value={query}
                    onChangeText={setQuery}
                    className={c.commandInput}
                    disableFullscreenUI
                  />
                  <ScrollView>
                    {registry
                      .entries(language)
                      .filter((command) => {
                        const haystack = `${command.title} ${
                          command.keywords ?? ""
                        }`;
                        return haystack
                          .toLowerCase()
                          .includes(query.toLowerCase());
                      })
                      .map(({ id, title }) => (
                        <Button
                          key={id}
                          label={title}
                          onPress={() => {
                            setPalette(false);
                            registry.execute(id);
                          }}
                        />
                      ))}
                  </ScrollView>
                  <Button
                    label={tr("chrome.closeCommands")}
                    onPress={() => setPalette(false)}
                  />
                </View>
              )
            )}
            {sheet(
              !!bookmarkManager,
              () =>
                closeSettingsChild("bookmarks", () =>
                  setBookmarkManager(false)
                ),
              bookmarkManager && (
                <View className={cn(c.dialog, c.bookmarkDialog)}>
                  <View className={c.dialogHeader}>
                    <Text className={cn(c.dialogTitle, "flex-1")}>
                      {tr("chrome.bookmarks")}
                    </Text>
                    <IconButton
                      label={tr("chrome.closeBookmarks")}
                      icon="close"
                      onPress={() =>
                        closeSettingsChild("bookmarks", () =>
                          setBookmarkManager(false)
                        )
                      }
                    />
                  </View>
                  <Text className={c.dialogHelp}>
                    {bookmarkFolder
                      ? tr("chrome.bookmarkInside", {
                          folder:
                            spaceFolders.find(
                              (folder) => folder.id === bookmarkFolder
                            )?.title ?? tr("chrome.folderFallback"),
                        })
                      : tr("chrome.bookmarkSavedIn", {
                          space:
                            activeWorkspace?.name ?? tr("chrome.thisSpace"),
                        })}
                  </Text>
                  <Text className={c.dialogHelp}>
                    {tr("chrome.bookmarkPrivateNote")}
                  </Text>
                  <View className={c.bookmarkForm}>
                    <TextInput
                      accessibilityLabel={tr("chrome.bookmarkTitle")}
                      value={bookmarkTitle}
                      onChangeText={setBookmarkTitle}
                      placeholder={tr("chrome.bookmarkName")}
                      placeholderTextColorClassName="accent-ink-faint"
                      className={c.commandInput}
                      autoCorrect={false}
                      disableFullscreenUI
                    />
                    <TextInput
                      accessibilityLabel={tr("chrome.bookmarkUrl")}
                      value={bookmarkUrl}
                      onChangeText={setBookmarkUrl}
                      placeholder="https://"
                      placeholderTextColorClassName="accent-ink-faint"
                      className={c.commandInput}
                      autoCapitalize="none"
                      autoCorrect={false}
                      disableFullscreenUI
                      keyboardType="url"
                    />
                    <View className={c.bookmarkActions}>
                      <Button
                        label={tr(
                          bookmarkEditing
                            ? "chrome.saveBookmark"
                            : "chrome.addBookmark"
                        )}
                        onPress={() => {
                          if (!bookmarkTitle.trim() || !bookmarkUrl.trim())
                            return;
                          run(
                            (bookmarkEditing
                              ? controller.bookmarkUpdate(
                                  bookmarkEditing,
                                  bookmarkTitle.trim(),
                                  bookmarkUrl.trim()
                                )
                              : controller.bookmarkCreate(
                                  bookmarkTitle.trim(),
                                  bookmarkUrl.trim(),
                                  bookmarkFolder
                                )
                            ).then(() => {
                              setBookmarkEditing(null);
                              setBookmarkTitle("");
                              setBookmarkUrl("");
                            })
                          );
                        }}
                      />
                      <Button
                        label={tr("chrome.addPage")}
                        onPress={() => {
                          const current = state?.tabs.find(
                            (tab) => tab.id === target
                          );
                          if (!current) return;
                          run(
                            controller.bookmarkCreate(
                              current.title || current.url,
                              current.url,
                              bookmarkFolder
                            )
                          );
                        }}
                      />
                    </View>
                  </View>
                  {!bookmarkFolder && (
                    <View className={c.bookmarkActions}>
                      <TextInput
                        accessibilityLabel={tr("chrome.newFolderName")}
                        value={folderName}
                        onChangeText={setFolderName}
                        placeholder={tr("chrome.newFolderName")}
                        placeholderTextColorClassName="accent-ink-faint"
                        className={cn(c.commandInput, "flex-1")}
                        autoCorrect={false}
                        autoCapitalize="none"
                        disableFullscreenUI
                      />
                      <Button
                        label={tr("chrome.addFolder")}
                        onPress={() => {
                          const name = folderName.trim();
                          if (!name) return;
                          run(
                            controller
                              .bookmarkFolderCreate(name)
                              .then(() => setFolderName(""))
                          );
                        }}
                      />
                    </View>
                  )}
                  <ScrollView className={c.bookmarkList}>
                    {!bookmarkFolder &&
                      spaceFolders.map((folder) => (
                        <View key={folder.id} className={c.bookmarkRow}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={tr("chrome.openFolder", {
                              name: folder.title,
                            })}
                            className={c.folderRow}
                            onPress={() => setBookmarkFolder(folder.id)}
                          >
                            <ChromeIcon
                              className={cn("size-[18px]")}
                              name="folder"
                            />
                            <Text numberOfLines={1} className={c.optionTitle}>
                              {folder.title}
                            </Text>
                            <Text className={c.workspaceCount}>
                              {
                                spaceBookmarks.filter(
                                  (bookmark) =>
                                    (bookmark.folderId ?? "") === folder.id
                                ).length
                              }
                            </Text>
                          </Pressable>
                          <IconButton
                            label={tr("chrome.renameFolderNamed", {
                              name: folder.title,
                            })}
                            icon="edit"
                            onPress={() => {
                              setRenamingFolder(folder.id);
                              setFolderName(folder.title);
                            }}
                          />
                          <IconButton
                            label={tr("chrome.deleteFolderNamed", {
                              name: folder.title,
                            })}
                            icon="close"
                            onPress={() =>
                              run(controller.bookmarkFolderRemove(folder.id))
                            }
                          />
                        </View>
                      ))}
                    {renamingFolder && (
                      <View className={c.bookmarkActions}>
                        <TextInput
                          accessibilityLabel={tr("chrome.renameFolder")}
                          value={folderName}
                          onChangeText={setFolderName}
                          placeholder={tr("chrome.folderName")}
                          placeholderTextColorClassName="accent-ink-faint"
                          className={cn(c.commandInput, "flex-1")}
                          autoCorrect={false}
                          autoCapitalize="none"
                          disableFullscreenUI
                        />
                        <Button
                          label={tr("chrome.saveName")}
                          onPress={() => {
                            const name = folderName.trim();
                            if (!name || !renamingFolder) return;
                            run(
                              controller
                                .bookmarkFolderRename(renamingFolder, name)
                                .then(() => {
                                  setRenamingFolder(null);
                                  setFolderName("");
                                })
                            );
                          }}
                        />
                      </View>
                    )}
                    {bookmarkFolder && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={tr("chrome.backBookmarks")}
                        className={c.bookmarkRow}
                        onPress={() => setBookmarkFolder("")}
                      >
                        <ChromeIcon className={cn("size-[18px]")} name="back" />
                        <Text className={c.optionTitle}>
                          {spaceFolders.find(
                            (folder) => folder.id === bookmarkFolder
                          )?.title ?? tr("chrome.folder")}
                        </Text>
                      </Pressable>
                    )}
                    {spaceBookmarks
                      .filter(
                        (bookmark) =>
                          (bookmark.folderId ?? "") === bookmarkFolder
                      )
                      .map((bookmark, index, list) => {
                        const all = state?.bookmarks ?? [];
                        const folders = spaceFolders;
                        const globalIndex = all.findIndex(
                          (item) => item.id === bookmark.id
                        );
                        // Up/down swap with the VISIBLE neighbor (same folder), so
                        // reordering reads honestly instead of jumping global slots.
                        const globalIndexOf = (row: { id: string }) =>
                          all.findIndex((item) => item.id === row.id);
                        const upTarget =
                          index > 0 ? globalIndexOf(list[index - 1]) : -1;
                        const downTarget =
                          index < list.length - 1
                            ? globalIndexOf(list[index + 1])
                            : -1;
                        return (
                          <View key={bookmark.id} className={c.bookmarkRow}>
                            <View className={c.bookmarkCopy}>
                              <Text numberOfLines={1} className={c.optionTitle}>
                                {bookmark.title}
                              </Text>
                              <Text
                                numberOfLines={1}
                                className={c.optionDescription}
                              >
                                {bookmark.url}
                              </Text>
                            </View>
                            {folders.length > 0 && (
                              <IconButton
                                label={tr("chrome.moveBookmarkNamed", {
                                  name: bookmark.title,
                                })}
                                icon="folder"
                                onPress={() => {
                                  setBookmarkManager(false);
                                  setSidebarMenu({
                                    kind: "bookmarkMove",
                                    id: bookmark.id,
                                  });
                                }}
                              />
                            )}
                            <IconButton
                              label={tr("chrome.moveBookmarkUp", {
                                name: bookmark.title,
                              })}
                              icon="chevronUp"
                              disabled={index === 0 || upTarget < 0}
                              onPress={() =>
                                run(
                                  controller.bookmarkMove(bookmark.id, upTarget)
                                )
                              }
                            />
                            <IconButton
                              label={tr("chrome.moveBookmarkDown", {
                                name: bookmark.title,
                              })}
                              icon="chevronDown"
                              disabled={
                                index === list.length - 1 || downTarget < 0
                              }
                              onPress={() =>
                                run(
                                  controller.bookmarkMove(
                                    bookmark.id,
                                    downTarget
                                  )
                                )
                              }
                            />
                            <IconButton
                              label={tr("chrome.editBookmarkNamed", {
                                name: bookmark.title,
                              })}
                              icon="edit"
                              onPress={() => {
                                setBookmarkEditing(bookmark.id);
                                setBookmarkTitle(bookmark.title);
                                setBookmarkUrl(bookmark.url);
                              }}
                            />
                            <IconButton
                              label={tr("chrome.removeBookmarkNamed", {
                                name: bookmark.title,
                              })}
                              icon="close"
                              onPress={() =>
                                run(controller.bookmarkRemove(bookmark.id))
                              }
                            />
                          </View>
                        );
                      })}
                  </ScrollView>
                </View>
              )
            )}
            {sheet(
              !!settings,
              () => setSettings(false),
              settings && (
                <SettingsDialog
                  query={settingsQuery}
                  onQueryChange={setSettingsQuery}
                  selectedId={settingsSection}
                  onSelect={setSettingsSection}
                  onClose={() => setSettings(false)}
                  saveStatus={uiPersistence.status}
                  onRetrySave={uiPersistence.retry}
                  sections={[
                    {
                      id: "browsing",
                      title: tr("category.browsing"),
                      description: tr("category.browsingDetail"),
                      keywords:
                        "language 언어 한국어 English search engine google naver duckduckgo restore pages text scale default browser 검색 엔진 기본 브라우저 글자 크기",
                      content: (
                        <>
                          <SettingsRow
                            title={tr("language.title")}
                            summary={tr("language.detail")}
                            value={tr("language.current", {
                              language: tr(`language.${language}`),
                            })}
                          >
                            <View
                              className={cn("flex-row", "flex-wrap", "gap-lg")}
                            >
                              {(["system", "ko", "en"] as const).map(
                                (choice) => (
                                  <Pressable
                                    key={choice}
                                    accessibilityRole="radio"
                                    accessibilityState={{
                                      checked:
                                        (ui.language ?? "system") === choice,
                                      disabled: !uiHydrated,
                                    }}
                                    disabled={!uiHydrated}
                                    onPress={() =>
                                      updateUi({
                                        type: "setLanguage",
                                        language: choice,
                                      })
                                    }
                                    className={cn(
                                      c.settingsAction,
                                      "min-h-[48px]",
                                      "border",
                                      "border-hairline",
                                      (ui.language ?? "system") === choice &&
                                        "bg-sunken-strong"
                                    )}
                                  >
                                    <Text className={c.optionTitle}>
                                      {tr(`language.${choice}`)}
                                    </Text>
                                  </Pressable>
                                )
                              )}
                            </View>
                          </SettingsRow>
                          <BrowserToolsPanel
                            section="browsing"
                            config={browser.config}
                            onSave={browser.saveConfig}
                            tabId={target ?? undefined}
                            url={targetUrl}
                            privateTab={
                              !!state?.tabs.find((tab) => tab.id === target)
                                ?.private
                            }
                            security={
                              target ? browser.security[target] : undefined
                            }
                            onError={setError}
                            onNotice={flashNotice}
                          />
                          <Text className={c.settingsSection}>
                            {tr("browsing.searchEngine")}
                          </Text>
                          <Text className={c.dialogHelp}>
                            {tr("browsing.searchEngineHelp")}
                          </Text>
                          {(["google", "naver", "duckduckgo"] as const).map(
                            (searchEngine) => (
                              <Pressable
                                key={searchEngine}
                                accessibilityRole="radio"
                                accessibilityState={{
                                  checked: ui.searchEngine === searchEngine,
                                  disabled: !uiHydrated,
                                }}
                                disabled={!uiHydrated}
                                className={settingsChoiceClasses({
                                  selected: ui.searchEngine === searchEngine,
                                })}
                                onPress={() =>
                                  updateUi({
                                    type: "setSearchEngine",
                                    searchEngine,
                                  })
                                }
                              >
                                <Text className={c.optionTitle}>
                                  {SEARCH_ENGINES[searchEngine].label}
                                </Text>
                                {ui.searchEngine === searchEngine && (
                                  <View
                                    className={cn(
                                      "flex-row",
                                      "items-center",
                                      "gap-md"
                                    )}
                                  >
                                    <ChromeIcon
                                      className={cn(
                                        "size-[14px]",
                                        "text-accent-strong"
                                      )}
                                      name="check"
                                    />
                                    <Text className={c.optionTitle}>
                                      {tr("common.selected")}
                                    </Text>
                                  </View>
                                )}
                              </Pressable>
                            )
                          )}
                        </>
                      ),
                    },
                    {
                      id: "appearance",
                      title: tr("category.appearance"),
                      description: tr("category.appearanceDetail"),
                      keywords:
                        "custom hex colour color theme palette space lavender warm padding px dp size layout display fullscreen 색 컬러 테마 여백 사이드바 크기 화면",
                      content: (
                        <>
                          <AppearanceSettings
                            ui={ui}
                            hydrated={uiHydrated}
                            spaceColor={activeWorkspace?.color ?? ""}
                            spaceName={
                              activeWorkspace?.name ?? "the current Space"
                            }
                            onChange={updateUi}
                          />
                          <Text className={c.settingsSection}>
                            {tr("appearance.sidebar")}
                          </Text>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={tr(
                              ui.sidebarCollapsed
                                ? "appearance.expandSidebar"
                                : "appearance.collapseSidebar"
                            )}
                            className={c.settingsAction}
                            accessibilityState={{ disabled: !uiHydrated }}
                            disabled={!uiHydrated}
                            onPress={toggleSidebar}
                          >
                            <View className={c.settingsToggleCopy}>
                              <Text className={c.optionTitle}>
                                {tr(
                                  ui.sidebarCollapsed
                                    ? "appearance.expandSidebar"
                                    : "appearance.collapseSidebar"
                                )}
                              </Text>
                              <Text className={c.optionDescription}>
                                {tr(
                                  ui.sidebarCollapsed
                                    ? "appearance.expandDetail"
                                    : "appearance.collapseDetail"
                                )}
                              </Text>
                            </View>
                            <Text className={c.chevron}>›</Text>
                          </Pressable>
                          <View className={c.settingsAction}>
                            <View className={c.settingsToggleCopy}>
                              <Text className={c.optionTitle}>
                                {tr("appearance.sidebarWidth")}
                              </Text>
                              <Text className={c.optionDescription}>
                                {sidebarLimits.width < ui.sidebarWidth
                                  ? tr("appearance.fittedWidth", {
                                      width: ui.sidebarWidth,
                                    })
                                  : tr("appearance.sidebarWidthDetail")}
                              </Text>
                            </View>
                            <View className={c.stepperRow}>
                              <IconButton
                                label={tr("appearance.decreaseWidth")}
                                icon="minus"
                                disabled={
                                  !uiHydrated ||
                                  sidebarLimits.width <= sidebarLimits.min
                                }
                                onPress={() =>
                                  resizeSidebarTo(
                                    sidebarLimits.width - SIDEBAR_WIDTH_STEP
                                  )
                                }
                              />
                              <Text className={c.stepperValue}>
                                {sidebarLimits.width}dp
                              </Text>
                              <IconButton
                                label={tr("appearance.increaseWidth")}
                                icon="plus"
                                disabled={
                                  !uiHydrated ||
                                  sidebarLimits.width >= sidebarLimits.max
                                }
                                onPress={() =>
                                  resizeSidebarTo(
                                    sidebarLimits.width + SIDEBAR_WIDTH_STEP
                                  )
                                }
                              />
                            </View>
                          </View>
                          <Text className={c.settingsSection}>
                            {tr("appearance.layout")}
                          </Text>
                          {FRAME_SIDES.map((side) => (
                            <View key={side} className={c.settingsAction}>
                              <View className={c.settingsToggleCopy}>
                                <Text className={c.optionTitle}>
                                  {tr("appearance.framePadding", {
                                    side: tr(`side.${side}`),
                                  })}
                                </Text>
                                <Text className={c.optionDescription}>
                                  {tr("appearance.frameDetail")}
                                </Text>
                              </View>
                              <View className={c.stepperRow}>
                                <IconButton
                                  label={tr("appearance.decreaseFrame", {
                                    side: tr(`side.${side}`),
                                  })}
                                  icon="minus"
                                  disabled={
                                    !uiHydrated ||
                                    ui.framePx[side] <= FRAME_PX_MIN
                                  }
                                  onPress={() =>
                                    updateUi({
                                      type: "setFramePx",
                                      side,
                                      value: ui.framePx[side] - FRAME_PX_STEP,
                                    })
                                  }
                                />
                                <Text className={c.stepperValue}>
                                  {ui.framePx[side]}px
                                </Text>
                                <IconButton
                                  label={tr("appearance.increaseFrame", {
                                    side: tr(`side.${side}`),
                                  })}
                                  icon="plus"
                                  disabled={
                                    !uiHydrated ||
                                    ui.framePx[side] >= FRAME_PX_MAX
                                  }
                                  onPress={() =>
                                    updateUi({
                                      type: "setFramePx",
                                      side,
                                      value: ui.framePx[side] + FRAME_PX_STEP,
                                    })
                                  }
                                />
                              </View>
                            </View>
                          ))}
                          <Text className={c.settingsSection}>
                            {tr("appearance.display")}
                          </Text>
                          <Pressable
                            accessibilityRole="switch"
                            accessibilityLabel={tr("appearance.hideStatus")}
                            accessibilityState={{
                              checked: ui.fullscreen,
                              disabled: !uiHydrated,
                            }}
                            disabled={!uiHydrated}
                            className={cn(
                              c.settingsToggle,
                              "active:opacity-pressed"
                            )}
                            onPress={() =>
                              updateUi({
                                type: "setFullscreen",
                                fullscreen: !ui.fullscreen,
                              })
                            }
                          >
                            <View className={c.settingsToggleCopy}>
                              <Text className={c.optionTitle}>
                                {tr("appearance.hideStatus")}
                              </Text>
                              <Text className={c.optionDescription}>
                                {tr("appearance.hideStatusDetail")}
                              </Text>
                            </View>
                            <View
                              pointerEvents="none"
                              importantForAccessibility="no-hide-descendants"
                            >
                              <Switch
                                accessible={false}
                                value={ui.fullscreen}
                                trackColor={{
                                  false: theme.switchOff,
                                  true: theme.accent,
                                }}
                                thumbColor={theme.surfaceElevated}
                              />
                            </View>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ disabled: !uiHydrated }}
                            disabled={!uiHydrated}
                            className={c.settingsAction}
                            onPress={() => updateUi({ type: "resetLayout" })}
                          >
                            <Text className={c.optionTitle}>
                              {tr("appearance.resetLayout")}
                            </Text>
                          </Pressable>
                        </>
                      ),
                    },
                    {
                      id: "website",
                      title: tr("category.website"),
                      description: tr("category.websiteDetail"),
                      keywords:
                        "desktop reload connection certificate location camera microphone notifications autoplay 사이트 권한 카메라 마이크 위치 데스크톱",
                      content: (
                        <>
                          <BrowserToolsPanel
                            section="website"
                            config={browser.config}
                            onSave={browser.saveConfig}
                            tabId={target ?? undefined}
                            url={targetUrl}
                            privateTab={
                              !!state?.tabs.find((tab) => tab.id === target)
                                ?.private
                            }
                            security={
                              target ? browser.security[target] : undefined
                            }
                            onError={setError}
                            onNotice={flashNotice}
                          />
                        </>
                      ),
                    },
                    {
                      id: "permissions",
                      title: tr("category.permissions"),
                      description: tr("category.permissionsDetail"),
                      keywords:
                        "permission camera microphone location notifications autoplay 권한 허용 카메라 마이크 위치 알림 자동 재생",
                      content: (
                        <>
                          <ConsentSettings
                            rules={siteRules}
                            siteUrl={targetUrl}
                            privateSite={
                              !!state?.tabs.find((tab) => tab.id === target)
                                ?.private
                            }
                            onAutoplayChange={async (origin, decision) => {
                              if (!platform.resetSitePermission)
                                throw new Error(tr("consent.rebuildRequired"));
                              await platform.resetSitePermission(
                                origin,
                                "autoplay"
                              );
                              if (decision)
                                await sitePermissions.decide(
                                  origin,
                                  "autoplay",
                                  decision
                                );
                              else
                                await sitePermissions.revoke(
                                  origin,
                                  "autoplay"
                                );
                              setPermissionRulesVersion((v) => v + 1);
                            }}
                            onRevoke={async (origin, kind) => {
                              if (!platform.resetSitePermission)
                                throw new Error(tr("consent.rebuildRequired"));
                              await platform.resetSitePermission(origin, kind);
                              await sitePermissions.revoke(origin, kind);
                              setPermissionRulesVersion((v) => v + 1);
                            }}
                            onClearAll={async () => {
                              if (!platform.resetSitePermission)
                                throw new Error(tr("consent.rebuildRequired"));
                              await platform.resetSitePermission(null, null);
                              await sitePermissions.clearAll();
                              setPermissionRulesVersion((v) => v + 1);
                            }}
                          />
                        </>
                      ),
                    },
                    {
                      id: "extensions",
                      title: tr("category.extensions"),
                      description: tr("category.extensionsDetail"),
                      keywords:
                        "extension addons ublock ads blocker permissions 확장 광고 차단 설치 권한",
                      content: (
                        <ExtensionsSettings
                          tabId={target ?? null}
                          privateTab={
                            !!state?.tabs.find((tab) => tab.id === target)
                              ?.private
                          }
                        />
                      ),
                    },
                    {
                      id: "privacy",
                      title: tr("category.privacy"),
                      description: tr("category.privacyDetail"),
                      keywords:
                        "cookies storage cache clear standard strict tracking protection 개인정보 보안 쿠키 추적 데이터 삭제",
                      content: (
                        <>
                          <BrowserToolsPanel
                            section="privacy"
                            config={browser.config}
                            onSave={browser.saveConfig}
                            tabId={target ?? undefined}
                            url={targetUrl}
                            privateTab={
                              !!state?.tabs.find((tab) => tab.id === target)
                                ?.private
                            }
                            security={
                              target ? browser.security[target] : undefined
                            }
                            onError={setError}
                            onNotice={flashNotice}
                          />
                        </>
                      ),
                    },
                    {
                      id: "data",
                      title: tr("category.data"),
                      description: tr("category.dataDetail"),
                      keywords:
                        "downloads history bookmarks favorites archive backup restore 파일 다운로드 기록 북마크 백업 내보내기 가져오기",
                      content: (
                        <>
                          <BrowserToolsPanel
                            section="downloads"
                            config={browser.config}
                            onSave={browser.saveConfig}
                            tabId={target ?? undefined}
                            url={targetUrl}
                            privateTab={
                              !!state?.tabs.find((tab) => tab.id === target)
                                ?.private
                            }
                            security={
                              target ? browser.security[target] : undefined
                            }
                            onError={setError}
                            onNotice={flashNotice}
                          />
                          <BrowserDataPanel
                            controller={controller}
                            ui={ui}
                            hydrated={uiHydrated}
                            onPresentation={async ({
                              schema: _schema,
                              ...appearance
                            }) => {
                              const {
                                colorSource: _source,
                                customColor: _color,
                                ...current
                              } = currentUi.current;
                              const next = { ...current, ...appearance };
                              await uiPersistence.persist(next);
                              // Keep non-presentation changes made while the import was saving.
                              const {
                                colorSource: _latestSource,
                                customColor: _latestColor,
                                ...latest
                              } = currentUi.current;
                              updateUi({
                                type: "restore",
                                preferences: { ...latest, ...appearance },
                              });
                            }}
                            onError={setError}
                            onNotice={flashNotice}
                          />
                          <Text className={c.settingsSection}>
                            {tr("data.title")}
                          </Text>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={tr("data.history")}
                            className={c.settingsAction}
                            onPress={() => {
                              openSettingsChild("history");
                              setHistoryOpen(true);
                            }}
                          >
                            <View className={c.settingsToggleCopy}>
                              <Text className={c.optionTitle}>
                                {tr("data.history")}
                              </Text>
                              <Text className={c.optionDescription}>
                                {tr("data.historyDetail")}
                              </Text>
                            </View>
                            <Text className={c.chevron}>›</Text>
                          </Pressable>
                          <Text className={c.settingsSection}>
                            {tr("data.bookmarksTitle")}
                          </Text>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={tr("data.bookmarks")}
                            className={c.settingsAction}
                            onPress={() => {
                              openSettingsChild("bookmarks");
                              setBookmarkManager(true);
                            }}
                          >
                            <View className={c.settingsToggleCopy}>
                              <Text className={c.optionTitle}>
                                {tr("data.bookmarks")}
                              </Text>
                              <Text className={c.optionDescription}>
                                {tr("data.bookmarksDetail")}
                              </Text>
                            </View>
                            <Text className={c.chevron}>›</Text>
                          </Pressable>
                        </>
                      ),
                    },
                    {
                      id: "media",
                      title: tr("category.media"),
                      description: tr("category.mediaDetail"),
                      keywords:
                        "video pip auto media picture in picture playback 영상 비디오 미디어 재생",
                      content: (
                        <>
                          <PictureInPictureSettings
                            state={pip.state}
                            externalBusy={externalPipBusy}
                            enabled={ui.autoPictureInPicture}
                            hydrated={uiHydrated}
                            hasTab={!!pipTab && browser.ready}
                            onToggle={() =>
                              updateUi({
                                type: "setAutoPictureInPicture",
                                enabled: !ui.autoPictureInPicture,
                              })
                            }
                            onEnter={enterPictureInPicture}
                            onOpenSettings={() => {
                              void pip.openSettings();
                            }}
                          />
                        </>
                      ),
                    },
                    {
                      id: "advanced",
                      title: tr("category.advanced"),
                      description: tr("category.advancedDetail"),
                      keywords:
                        "memory keep alive release tabs boosts css commands keyboard shortcuts 메모리 탭 단축키 키보드",
                      content: (
                        <>
                          <BrowserToolsPanel
                            section="memory"
                            config={browser.config}
                            onSave={browser.saveConfig}
                            tabId={target ?? undefined}
                            url={targetUrl}
                            privateTab={
                              !!state?.tabs.find((tab) => tab.id === target)
                                ?.private
                            }
                            security={
                              target ? browser.security[target] : undefined
                            }
                            onError={setError}
                            onNotice={flashNotice}
                          />
                          <Text className={c.settingsSection}>
                            {tr("advanced.boostsTitle")}
                          </Text>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={tr("advanced.boosts")}
                            className={c.settingsAction}
                            onPress={() => {
                              openSettingsChild("boosts");
                              setBoostsOpen(true);
                            }}
                          >
                            <View className={c.settingsToggleCopy}>
                              <Text className={c.optionTitle}>
                                {tr("advanced.boosts")}
                              </Text>
                              <Text className={c.optionDescription}>
                                {tr("advanced.boostsDetail")}
                              </Text>
                            </View>
                            <Text className={c.chevron}>
                              {ui.boosts.length > 0
                                ? `${ui.boosts.length} ›`
                                : "›"}
                            </Text>
                          </Pressable>
                          <Text className={c.settingsSection}>
                            {tr("advanced.commandsTitle")}
                          </Text>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={tr("advanced.commands")}
                            className={c.settingsAction}
                            onPress={() => {
                              setSettings(false);
                              setPalette(true);
                            }}
                          >
                            <View className={c.settingsToggleCopy}>
                              <Text className={c.optionTitle}>
                                {tr("advanced.commands")}
                              </Text>
                              <Text className={c.optionDescription}>
                                {tr("advanced.commandsDetail")}
                              </Text>
                            </View>
                            <Text className={c.chevron}>›</Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={tr("advanced.keyboard")}
                            className={c.settingsAction}
                            onPress={openKeyboard}
                          >
                            <View className={c.settingsToggleCopy}>
                              <Text className={c.optionTitle}>
                                {tr("advanced.keyboard")}
                              </Text>
                              <Text className={c.optionDescription}>
                                {tr("advanced.keyboardDetail")}
                              </Text>
                            </View>
                            <Text className={c.chevron}>›</Text>
                          </Pressable>
                        </>
                      ),
                    },
                  ]}
                />
              )
            )}
            {sheet(
              !!boostsOpen,
              () => closeSettingsChild("boosts", () => setBoostsOpen(false)),
              <BoostsDialog
                boosts={ui.boosts}
                onSave={(boosts) => {
                  updateUi({ type: "setBoosts", boosts });
                  closeSettingsChild("boosts", () => setBoostsOpen(false));
                }}
                onClose={() =>
                  closeSettingsChild("boosts", () => setBoostsOpen(false))
                }
              />
            )}
            {sheet(
              !!keys,
              () => closeSettingsChild("keyboard", () => setKeys(false)),
              keys && (
                <KeyboardSettings
                  bindings={state?.keyBindings ?? []}
                  commands={registry.entries(language)}
                  onDefaults={() => controller.defaultKeymap()}
                  onSave={(bindings) => controller.keymap(bindings)}
                  onClose={() =>
                    closeSettingsChild("keyboard", () => setKeys(false))
                  }
                />
              )
            )}
          </SafeAreaView>
          <BrowserContentMenu
            request={browser.context}
            onClose={browser.closeContext}
            onChoose={browser.selectContext}
          />
        </ThemeScope>
      </ThemeContext.Provider>
    </I18nContext.Provider>
  );
}
