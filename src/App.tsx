import React, {
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
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import Surface, {
  Commands,
  type Navigation,
} from "../modules/browser-surface/src/BrowserSurfaceNativeComponent";
import { controller } from "./controllerRuntime";
import { useBrowserWorkflows } from "./hooks/useBrowserWorkflows";
import { usePictureInPicture } from "./hooks/usePictureInPicture";
import { useExternalPictureInPicture } from "./hooks/useExternalPictureInPicture";
import { useExternalPipReturnLayout } from "./hooks/useExternalPipReturnLayout";
import { useContentFullscreen } from "./hooks/useContentFullscreen";
import { usePipLayout, advanceSidebarWindow } from "./hooks/usePipLayout";
import { PictureInPictureSettings } from "./components/PictureInPictureSettings";
import { BrowserToolsPanel } from "./components/BrowserToolsPanel";
import { BrowserDataPanel } from "./components/BrowserDataPanel";
import { BrowserContentMenu } from "./components/BrowserContentMenu";
import { retainLiveTabs } from "./browserWorkflows";
import { NavigationEventOrder } from "./navigationEvents";
import { NEW_TAB_URL } from "./BrowserController";
import { favicons } from "./favicons";
import { platform } from "./platform";
import { history, type HistoryEntry } from "./history";
import { SEARCH_ENGINES, type SearchEngineId } from "./suggestions";
import { CommandRegistry, type ProductCommand } from "./commandRegistry";
import { withCtrlAlternativesFromDraft } from "./keyboardProfiles";
import {
  defaultUiPreferences,
  FRAME_PX_MAX,
  FRAME_PX_MIN,
  FRAME_PX_STEP,
  FRAME_SIDES,
  loadUiPreferences,
  normalizeBoostHost,
  PERMISSION_LABELS,
  reduceUiPreferences,
  saveUiPreferences,
  type FrameSide,
  type PermissionKind,
} from "./uiPreferences";
import { SitePermissions, permissionKindsFromEvent } from "./permissions";
import {
  PermissionRequests,
  answerPermission,
  type PermissionChoice,
  type PermissionRequest,
} from "./permissionRequests";
import type { KeyBinding } from "../generated/types";
import { DragSource } from "./chrome/DragSource";
import {
  SidebarLayer,
  SidebarPressable,
  useSidebarActive,
} from "./chrome/SidebarInteraction";
import { ContextPressable } from "./chrome/ContextPressable";
import { DragLifecycle } from "./dragLifecycle";
import { registerSurfaceRef } from "./surfaceRefs";
import { PaneLoadBar } from "./chrome/PaneLoadBar";
import { ChromeIcon, type IconName } from "./chrome/ChromeIcon";
import {
  ActionMenu,
  type MenuAnchor,
  type MenuItem,
} from "./components/ActionMenu";
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
} from "./sidebarModel";
import { Overlay } from "./chrome/Overlay";
import { useReducedMotion } from "./chrome/useReducedMotion";
import {
  useSidebarMotion,
  useSpaceMotion,
  useSplitMotion,
} from "./chrome/useChromeMotion";
import { FolderDisclosure } from "./chrome/FolderDisclosure";
import { easing } from "./chrome/motion";
import { useStyles, useThemedStyles } from "./chrome/appStyles";
import { motion as motionTokens, retintTheme, size, themes } from "./theme";
import { ThemeContext } from "./themeContext";
import { Favicon } from "./components/Favicon";
import { AddressBox } from "./components/AddressBox";
import { AddressTrigger } from "./components/AddressTrigger";
import { FindBar } from "./components/FindBar";
import {
  BoostsDialog,
  HistoryDialog,
  PermissionDialog,
  SpaceSwitcherDialog,
  TabContextMenuDialog,
} from "./components/Dialogs";
import {
  clampSplitRatio,
  commitSplitDrop,
  dropZoneAt,
  type Bounds,
  type DropZone,
  type SplitLayout,
} from "./splitLayout";

type SurfaceRef = React.ElementRef<typeof Surface>;
type SuggestionSources = {
  favorites: { id?: string; url: string; title: string }[];
  bookmarks: { url: string; title: string }[];
  tabs: { id?: string; url: string; title: string }[];
  history: HistoryEntry[];
};
const FRAME_SIDE_LABELS: Record<FrameSide, string> = {
  left: "Left",
  right: "Right",
  top: "Top",
  bottom: "Bottom",
};
const Button = ({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) => {
  const s = useThemedStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={[s.button, disabled && s.disabled]}
      onPress={onPress}
    >
      <Text style={s.buttonText}>{label}</Text>
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
  const s = useThemedStyles();
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
      <Animated.View
        style={[
          s.iconButton,
          { transform: [{ scale }] },
          disabled && s.disabled,
        ]}
      >
        <ChromeIcon name={icon} size={18} />
      </Animated.View>
    </SidebarPressable>
  );
};
const NewTabPage = ({
  favorites,
  reducedMotion,
  engine,
  suggestions,
  commands,
  onCommand,
  onOpenUrl,
  onOpenFavorite,
}: {
  favorites: { id: string; title: string; url: string }[];
  reducedMotion: boolean;
  engine: SearchEngineId;
  suggestions: SuggestionSources;
  commands: ProductCommand[];
  onCommand: (id: string) => void;
  onOpenUrl: (url: string) => void;
  onOpenFavorite: (id: string) => void;
}) => {
  const s = useThemedStyles();
  return (
    <View style={s.newTabOverlay} pointerEvents="box-none">
      <View style={s.newTabPanel}>
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
            <Text style={s.newTabHeading}>FAVORITES</Text>
            <View style={s.newTabGrid}>
              {favorites.slice(0, 12).map((tab) => (
                <Pressable
                  key={tab.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Favorite ${tab.title || tab.url}`}
                  style={({ pressed }) => [s.newTabTile, pressed && s.pressed]}
                  onPress={() => onOpenFavorite(tab.id)}
                >
                  <View style={s.newTabTileIcon}>
                    <Favicon
                      url={tab.url}
                      fallback={(tab.title || tab.url)
                        .slice(0, 1)
                        .toUpperCase()}
                      size={32}
                      radius={8}
                    />
                  </View>
                  <Text numberOfLines={1} style={s.newTabTileLabel}>
                    {tab.title || tab.url}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <Text style={s.newTabHint}>
            Search or enter a link. Add favorite sites from a tab’s menu.
          </Text>
        )}
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
const sitePermissions = new SitePermissions(platform);
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
    kind: "bookmark" | "bookmarkMove" | "folder" | "create";
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
  const [permissionRequests] = useState(() => new PermissionRequests());
  const permissionRequest = useSyncExternalStore(
    permissionRequests.subscribe,
    permissionRequests.getSnapshot
  );
  // Bumped when stored rules change so Settings and the native delegate
  // push re-read sitePermissions.
  const [permissionRulesVersion, setPermissionRulesVersion] = useState(0);
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
  const currentUi = useRef(ui);
  useLayoutEffect(() => { currentUi.current = ui; }, [ui]);
  const [uiHydrated, setUiHydrated] = useState(false);
  // The active Space tints the chrome while contrast stays at the base appearance's
  // ratios (luminance-preserving retint in src/theme.ts).
  const activeWorkspace = state?.workspaces.find(
    (w) => w.id === state.activeWorkspaceId
  );
  const theme = useMemo(
    () => retintTheme(themes[ui.appearance], activeWorkspace?.color ?? ""),
    [ui.appearance, activeWorkspace?.color]
  );
  // BrowserApp owns the provider, so useContext here would lag one render
  // behind a theme change; feed the fresh theme straight into the sheet.
  const s = useStyles(theme);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
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
  const dividerFrame = useRef<number | null>(null);
  const pendingRatio = useRef(0.5);
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
  const favoriteColumns = Math.min(
    3,
    Math.max(1, Math.floor((ui.sidebarWidth - 24) / 60))
  );
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
  const openKeyboard = () => {
    setKeyDraft(JSON.stringify(state?.keyBindings ?? [], null, 2));
    setSettings(false);
    setKeys(true);
  };
  const active = state?.tabs.find((t) => t.id === state.activeTabId);
  const activePrivate = !!active?.private;
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
  const railTabs = useMemo(
    () =>
      state?.tabs.filter(
        (tab) =>
          tab.workspaceId === state.activeWorkspaceId &&
          !tab.favorite &&
          !tab.private
      ) ?? [],
    [state?.tabs, state?.activeWorkspaceId]
  );
  const ordinaryTabs = useMemo(
    () => railTabs.filter((tab) => !tab.pinned),
    [railTabs]
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
    tab.url === NEW_TAB_URL ? "New tab" : tab.title || tab.url;
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
    onExternalTab: (snapshot) => {
      setSplitLayout(null);
      setFocused(snapshot.activeTabId ?? null);
    },
  });
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
  const targetUrl = state?.tabs.find((tab) => tab.id === target)?.url ?? "";
  const addressValue = targetUrl === NEW_TAB_URL ? "" : displayUrl(targetUrl);
  const enterPictureInPicture = () => {
    setSettings(false);
    setSidebarMenu(null);
    void pip.enter().then((result) => {
      if (result && !result.active && !result.transitioning)
        flashNotice(
          !result.allowed
            ? "Allow picture-in-picture for Yeoyu in Android settings."
            : "Picture-in-picture could not open. Return to the tab and try again."
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
  const switchTab = (id: string) => {
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
        style={[
          s.tab,
          indented && s.bookmarkTreeIndent,
          isActive && s.tabSelected,
        ]}
      >
        <ContextPressable
          accessibilityRole="button"
          accessibilityLabel={`Pinned tab ${title}`}
          accessibilityState={{ selected: isActive }}
          style={({ pressed }) => [s.tabDrag, pressed && s.pressed]}
          onPress={() => (tab ? switchTab(tab.id) : openBookmark(bookmark))}
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
          <View style={s.tabFavicon}>
            {tab && playing.includes(tab.id) ? (
              <ChromeIcon name="play" size={14} />
            ) : (
              <Favicon
                url={tab?.url || bookmark.url}
                fallback="◌"
                size={16}
                radius={3}
              />
            )}
          </View>
          <Text numberOfLines={1} style={s.tabTitle}>
            {title}
          </Text>
          {!!validSplit && isActive && (
            <ChromeIcon name="split" size={14} color={theme.inkMuted} />
          )}
        </ContextPressable>
        {tab && !tab.suspended && (
          <SidebarPressable
            accessibilityRole="button"
            accessibilityLabel={`Close ${title}`}
            style={({ pressed }) => [s.tabClose, pressed && s.rowPressed]}
            onPress={() => closeTab(tab.id)}
          >
            <ChromeIcon name="close" size={15} color={theme.inkMuted} />
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
    setQuickOpenSoft(mode === "touch");
    setQuickOpenEdit(false);
    setQuickOpen(true);
  };
  // ⌘L and the address triggers share the centered dialog in edit mode:
  // submitting loads the URL in the same tab.
  const openLocationEditor = (mode: "touch" | "keyboard" = "keyboard") => {
    setQuickOpenSoft(mode === "touch");
    setQuickOpenEdit(true);
    setQuickOpen(true);
  };
  const closeQuickOpen = () => {
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
      flashNotice("URL copied");
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
    run(controller.initialize());
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
  useEffect(() => {
    if (!state || keymapMigrated.current) return;
    keymapMigrated.current = true;
    const bindings = state.keyBindings ?? [];
    if (bindings.some((binding) => binding.key === "TAB")) return;
    run(controller.keymap([...bindings, ...tabCycleBindings]));
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
  useEffect(() => {
    if (!uiHydrated) return;
    const save =
      typeof platform.saveUiPreferences === "function"
        ? platform.saveUiPreferences.bind(platform)
        : undefined;
    run(saveUiPreferences(save, ui));
  }, [ui, uiHydrated]);
  // Site boosts stream to the native side as a flat host→css list; GeckoView
  // injects the matching css each time a page finishes loading.
  useEffect(() => {
    if (!uiHydrated) return;
    if (typeof platform.setBoosts !== "function") return;
    const map = ui.boosts
      .filter((boost) => boost.enabled && boost.host && boost.css)
      .map((boost) => ({
        host: normalizeBoostHost(boost.host),
        css: boost.css,
      }));
    platform.setBoosts(JSON.stringify(map));
  }, [ui.boosts, uiHydrated]);
  // Per-site permission decisions live outside the Rust snapshot: load once
  // at startup, then stream the rule list to the native delegates whenever
  // it changes. No rule means the site's next request asks the user.
  useEffect(() => {
    run(
      sitePermissions.load().then(() => setPermissionRulesVersion((v) => v + 1))
    );
  }, []);
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
  // Device-backed kinds ask Android first; a system denial surfaces an
  // honest notice instead of a web grant the OS would veto anyway.
  const requestPermission = (kind: PermissionKind): Promise<boolean> => {
    if (
      kind !== "geolocation" &&
      kind !== "notifications" &&
      kind !== "camera" &&
      kind !== "microphone"
    )
      return Promise.resolve(true);
    if (typeof platform.requestAndroidPermission !== "function")
      return Promise.resolve(false);
    return platform.requestAndroidPermission(kind).catch(() => false);
  };
  const resolvePermissionRequest = (requestId: number, allow: boolean) => {
    if (typeof platform.resolvePermission === "function")
      platform.resolvePermission(requestId, allow);
  };
  // One dialog answer: "always"/"block" persist a per-site rule, "once"
  // grants just this request, and dismissing (back / outside tap) denies
  // without storing anything.
  const decidePermission = (choice: PermissionChoice) => {
    // Use the ID displayed by this render: a double click must not answer
    // the next site's request before that dialog has actually been shown.
    if (!permissionRequest) return;
    run(
      answerPermission(
        permissionRequests,
        permissionRequest.requestId,
        choice,
        {
          requestAndroid: requestPermission,
          save: (origin, kinds, decision) =>
            sitePermissions.decideMany(origin, kinds, decision),
          resolve: resolvePermissionRequest,
        }
      ).finally(() => setPermissionRulesVersion((v) => v + 1))
    );
  };
  useEffect(
    () => () => {
      permissionRequests
        .cancelAll()
        .forEach((id) => resolvePermissionRequest(id, false));
    },
    [permissionRequests]
  );
  useEffect(() => {
    if (!uiHydrated || Platform.OS !== "android") return;
    if (typeof platform.setFullscreen === "function")
      platform.setFullscreen(ui.fullscreen);
  }, [ui.fullscreen, uiHydrated]);
  // Narrow windows (portrait, split screen) collapse the sidebar to the rail;
  // crossing back expands it. Manual toggles still apply between crossings.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
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
    ui.sidebarWidth,
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
        "BrowserPermissionRequest",
        (event: PermissionRequest) => permissionRequests.enqueue(event)
      ),
      DeviceEventEmitter.addListener(
        "BrowserPermissionCancelled",
        (event: { requestId: number }) =>
          permissionRequests.cancel(event.requestId)
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
        (event: { uri: string }) => {
          flashNotice("Download failed");
        }
      ),
      DeviceEventEmitter.addListener(
        "BrowserFileSelectionFailed",
        (event: { error: string }) => {
          flashNotice(event.error || "The selected file could not be opened");
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
        (event: { requestId: number; openerTabId: string; uri: string }) => {
          run(
            controller.openWindow(event).then((snapshot) => {
              setSplitLayout(null);
              setFocused(snapshot.activeTabId ?? null);
            })
          );
        }
      ),
      DeviceEventEmitter.addListener(
        "BrowserNewWindowFailed",
        (event: { error: string }) => {
          flashNotice(event.error || "Popup could not be opened");
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
  }, [findTab, reducedMotion]);
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
      [historyOpen, () => setHistoryOpen(false)],
      [palette, () => setPalette(false)],
      [keys, () => setKeys(false)],
      [settings, () => setSettings(false)],
      [boostsOpen, () => setBoostsOpen(false)],
      [bookmarkManager, () => setBookmarkManager(false)],
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
      style={s.overlay}
      pop
      dim={false}
      reducedMotion={reducedMotion}
    >
      {open && (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={s.sheetUnderlay}
            onPress={onClose}
          />
          {/* The card must be a direct child of the full-screen centerer:
              its percent width/height resolve against that container. */}
          <View style={s.overlayTouch} pointerEvents="box-none">
            {node}
          </View>
        </>
      )}
    </Overlay>
  );
  const applyKeymap = (bindings: KeyBinding[]) => {
    try {
      run(controller.keymap(bindings).then(() => setKeys(false)));
    } catch (e) {
      setError(String(e));
    }
  };
  // Draft parsing runs inside the same guard as the apply: a hand-edited
  // JSON error shows as an editing error instead of crashing the sheet.
  const applyKeymapDraft = (parse: () => KeyBinding[]) => {
    try {
      applyKeymap(parse());
    } catch (e) {
      setError(String(e));
    }
  };
  const keymapFromDraft = (): KeyBinding[] => {
    const parsed: unknown = JSON.parse(keyDraft);
    if (!Array.isArray(parsed)) throw new Error("Keymap JSON must be an array");
    return parsed as KeyBinding[];
  };
  const beginDrag = (tabId: string, title: string, x: number, y: number) => {
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
  const moveDrag = (x: number, y: number) => {
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
        const tiles = favoriteTabs
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
  const finishDrag = (x: number, y: number) => {
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
          const tiles = favoriteTabs
            .map((tab) => favoriteLayouts.current.get(tab.id))
            .filter((tile): tile is TileBounds => !!tile);
          const slot = favoriteDropIndex(
            x - grid.x,
            y - grid.y + favoriteScrollOffset.current,
            tiles
          );
          index = favoriteMoveIndex(state.tabs, draggedTab.id, slot);
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
    dragLifecycle.cancel();
    ghostOpacity.stopAnimation();
    ghostScale.stopAnimation();
    ghostOpacity.setValue(0);
    setDrag(null);
  };
  useEffect(() => {
    if (reducedMotion) {
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
  const sidebarWidthRef = useRef(ui.sidebarWidth);
  useLayoutEffect(() => {
    sidebarWidthRef.current = ui.sidebarWidth;
  }, [ui.sidebarWidth]);
  const resizeOrigin = useRef({ x: 0, width: 0 });
  const sidebarResize = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          resizeOrigin.current = {
            x: event.nativeEvent.pageX,
            width: sidebarWidthRef.current,
          };
        },
        onPanResponderMove: (event) => {
          // RN pageX is already dp and ui.sidebarWidth is dp too; dividing
          // by PixelRatio here made the divider crawl at half finger speed
          // on denser screens. Only the stored framePx prefs are physical.
          updateUi({
            type: "setSidebarWidth",
            width:
              resizeOrigin.current.width +
              (event.nativeEvent.pageX - resizeOrigin.current.x),
          });
        },
      }),
    []
  );
  const dividerPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: measurePanes,
        onPanResponderRelease: (event) => {
          const current = validSplitRef.current;
          if (!current || !paneBounds.current) return;
          const { pageX, pageY } = event.nativeEvent;
          // Dragging the divider to a screen edge collapses the split and
          // keeps the pane that survived, like Arc.
          const raw =
            current.orientation === "horizontal"
              ? (pageX - paneBounds.current.x) / paneBounds.current.width
              : (pageY - paneBounds.current.y) / paneBounds.current.height;
          if (raw < 0.15 || raw > 0.85) {
            const survivor = raw < 0.15 ? current.second : current.first;
            if (dividerFrame.current !== null) {
              cancelAnimationFrame(dividerFrame.current);
              dividerFrame.current = null;
            }
            setFocused(survivor);
            run(
              controller.activate(survivor, [survivor]).then(() => {
                setSplitLayout((layout) =>
                  layout === current ? null : layout
                );
              })
            );
          }
        },
        onPanResponderMove: (event) => {
          const current = validSplitRef.current;
          if (!current || !paneBounds.current) return;
          const { pageX, pageY } = event.nativeEvent;
          const ratio =
            current.orientation === "horizontal"
              ? (pageX - paneBounds.current.x) / paneBounds.current.width
              : (pageY - paneBounds.current.y) / paneBounds.current.height;
          pendingRatio.current = clampSplitRatio(ratio);
          if (dividerFrame.current !== null) return;
          dividerFrame.current = requestAnimationFrame(() => {
            setSplitLayout((current) =>
              current ? { ...current, ratio: pendingRatio.current } : current
            );
            dividerFrame.current = null;
          });
        },
      }),
    []
  );
  const renderSurface = (id: string, url: string) => (
    <Surface
      key={id}
      ref={(ref) => {
        if (ref) return registerSurfaceRef(refs.current, id, ref);
      }}
      style={s.surface}
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
  // The page-find bar lives inside the body, so it can't ride the sheet
  // blocker: while find is open only the page canvas loses touches and the
  // bar's own input/buttons stay interactive.
  const [findBlocking, setFindBlocking] = useState(false);
  useEffect(() => {
    const open = !!findTab;
    if (reducedMotion) {
      setFindBlocking(open);
      return;
    }
    const id = setTimeout(
      () => setFindBlocking(open),
      open ? motionTokens.split : motionTokens.fade + 60
    );
    return () => clearTimeout(id);
  }, [findTab, reducedMotion]);
  const renderSidebarTab = (tab: NonNullable<typeof state>["tabs"][number]) => (
    <View
      key={tab.id}
      ref={(view) => {
        if (view) sidebarRowRefs.current.set(tab.id, view);
        else sidebarRowRefs.current.delete(tab.id);
      }}
      style={[
        s.tab,
        splitPaneIds.includes(tab.id) && !tab.suspended && s.tabSelected,
      ]}
    >
      <DragSource
        reducedMotion={reducedMotion}
        accessibilityLabel={`${
          tab.private ? "Private tab" : tab.pinned ? "Pinned tab" : "Tab"
        } ${tabLabel(tab)}`}
        style={s.tabDrag}
        onPress={() => switchTab(tab.id)}
        onDragStart={(x, y) => beginDrag(tab.id, tabLabel(tab), x, y)}
        onDragMove={moveDrag}
        onDragRelease={finishDrag}
        onDragCancel={cancelDrag}
        onLongPress={(x, y) => openTabMenu(tab.id, x, y)}
      >
        <View style={s.tabFavicon}>
          {playing.includes(tab.id) ? (
            <ChromeIcon name="play" size={14} />
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
        <Text numberOfLines={1} style={s.tabTitle}>
          {tabLabel(tab)}
        </Text>
        {!!validSplit && splitPaneIds.includes(tab.id) && (
          <ChromeIcon name="split" size={14} color={theme.inkMuted} />
        )}
      </DragSource>
      <SidebarPressable
        accessibilityRole="button"
        accessibilityLabel={`Close ${tabLabel(tab)}`}
        accessibilityState={{ disabled: !!tab.suspended }}
        disabled={!!tab.suspended}
        style={({ pressed }) => [
          s.tabClose,
          tab.suspended && s.disabled,
          pressed && s.rowPressed,
        ]}
        onPress={() => closeTab(tab.id)}
      >
        <ChromeIcon name="close" size={15} color={theme.inkMuted} />
      </SidebarPressable>
    </View>
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
          label: "New tab",
          icon: "plus",
          onPress: () => openQuickOpen("touch"),
        },
        {
          id: "new-folder",
          label: "New folder",
          icon: "folder",
          onPress: () => {
            setFolderName("");
            setNewFolderOpen(true);
          },
        },
        {
          id: "new-space",
          label: "New space",
          icon: "space",
          onPress: createSpace,
        },
        {
          id: "favorite",
          label: "Add current tab to favorites",
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
          label: "History",
          icon: "history",
          onPress: () => setHistoryOpen(true),
        },
        {
          id: "picture-in-picture",
          label: "Picture-in-picture",
          icon: "external",
          disabled: !pip.state.supported || !pip.state.allowed || !pipTab,
          onPress: enterPictureInPicture,
        },
        {
          id: "settings",
          label: "Settings",
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
          label: `Move to ${folder.title}`,
          icon: "folder",
          onPress: () =>
            run(controller.bookmarkSetFolder(bookmark.id, folder.id)),
        }));
      if (bookmark.folderId)
        destinations.push({
          id: "move-root",
          label: "Move out of folder",
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
                label: "Close tab",
                icon: "close" as const,
                disabled: !!tab.suspended,
                onPress: () => closeTab(tab.id),
              },
              {
                id: "reset",
                label: "Back to saved page",
                icon: "reload" as const,
                onPress: () => run(controller.reset(tab.id)),
              },
              {
                id: "split",
                label: "Open in Split View",
                icon: "split" as const,
                disabled: !!tab.suspended,
                onPress: () => setSplitPickerTabId(tab.id),
              },
              {
                id: "duplicate",
                label: "Duplicate tab",
                icon: "copy" as const,
                onPress: () => createTabAndShow(tab.url),
              },
            ]
          : []),
        {
          id: "open",
          label: "Open",
          icon: "external",
          onPress: () => openBookmark(bookmark),
        },
        {
          id: "edit",
          label: "Edit saved page",
          icon: "edit",
          onPress: () => editBookmark(bookmark),
        },
        {
          id: "copy",
          label: "Copy link",
          icon: "copy",
          onPress: () => {
            platform.copyToClipboard(bookmark.url);
            flashNotice("Link copied");
          },
        },
        ...destinations,
        {
          id: "remove",
          label: "Remove pin",
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
        label: expandedFolders.has(folder.id)
          ? "Collapse folder"
          : "Expand folder",
        icon: "folder",
        onPress: () => toggleFolder(folder.id),
      },
      {
        id: "rename",
        label: "Rename folder",
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
        label: "Remove folder and keep bookmarks",
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
      <ThemeContext.Provider value={theme}>
        <SafeAreaView
          style={[
            s.app,
            { justifyContent: "center", alignItems: "center", padding: 24 },
          ]}
        >
          <Text style={s.dialogTitle}>
            {browser.startupError
              ? "Browser settings could not be read"
              : "Opening browser…"}
          </Text>
          {!!browser.startupError && (
            <>
              <Text style={s.dialogHelp}>{browser.startupError}</Text>
              <Button label="Retry" onPress={browser.retryStartup} />
            </>
          )}
        </SafeAreaView>
      </ThemeContext.Provider>
    );
  return (
    <ThemeContext.Provider value={theme}>
      <SafeAreaView style={s.app} edges={contentFullscreen ? [] : undefined}>
        {!!error && !contentFullscreen && (
          <Pressable onPress={() => setError("")}>
            <Text selectable style={s.error}>
              {error}
            </Text>
          </Pressable>
        )}
        {!!target && !!tabErrors[target] && !contentFullscreen && (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Pressable
              style={{ flex: 1 }}
              onPress={() =>
                setTabErrors((old) => {
                  if (!target) return old;
                  const next = { ...old };
                  delete next[target];
                  return next;
                })
              }
            >
              <Text selectable style={s.error}>
                {tabErrors[target]}
              </Text>
            </Pressable>
            <Button
              label="Retry"
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
          style={[s.body, !contentFullscreen && frameStyle]}
          pointerEvents={bodyBlocking ? "none" : "auto"}
        >
          <Animated.View
            style={[
              s.sidebar,
              {
                width: sideP.interpolate({
                  inputRange: [0, 1],
                  outputRange: [size.rail, ui.sidebarWidth],
                }),
              },
              contentFullscreen && s.hidden,
            ]}
          >
            <SidebarLayer
              visible={sidebarMotion.expanded && !contentFullscreen}
              active={!ui.sidebarCollapsed && !contentFullscreen}
              style={[
                s.sidebarLayer,
                s.sidebarLayerExpanded,
                {
                  width: ui.sidebarWidth,
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
              <View style={s.sidebarTop}>
                <View style={s.navigationRow}>
                  <IconButton
                    label="Collapse sidebar"
                    icon="sidebar"
                    onPress={toggleSidebar}
                    disabled={!uiHydrated}
                  />
                  <View style={s.navSpacer} />
                  <IconButton
                    label="Back"
                    icon="back"
                    onPress={goBack}
                    disabled={!canGoBack}
                  />
                  <IconButton
                    label="Forward"
                    icon="forward"
                    onPress={() => invoke(Commands.goForward)}
                    disabled={!canGoForward}
                  />
                  <IconButton
                    label="Reload"
                    icon="reload"
                    onPress={() => invoke(Commands.reload)}
                  />
                </View>
                {activePrivate && (
                  <View
                    style={s.privateBadge}
                    accessibilityLabel="Private browsing is active"
                    accessibilityRole="text"
                  >
                    <ChromeIcon
                      name="private"
                      size={13}
                      color={theme.accentStrong}
                    />
                    <Text style={s.privateBadgeText}>Private</Text>
                  </View>
                )}
                <AddressTrigger
                  url={addressValue}
                  onPress={() => openLocationEditor("touch")}
                />
                <View ref={favoritesRowRef} style={s.favoritesDropTarget}>
                  <ScrollView
                    style={s.favoritesScroll}
                    contentContainerStyle={s.favorites}
                    showsVerticalScrollIndicator={false}
                    onScroll={(event) => {
                      favoriteScrollOffset.current =
                        event.nativeEvent.contentOffset.y;
                    }}
                    scrollEventThrottle={16}
                  >
                    {favoriteTabs.map((tab) => (
                      <View
                        key={tab.id}
                        style={{
                          width:
                            (ui.sidebarWidth - 24 - 6 * (favoriteColumns - 1)) /
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
                          accessibilityLabel={`Favorite ${tabLabel(tab)}`}
                          style={[
                            s.favorite,
                            splitPaneIds.includes(tab.id) &&
                              !tab.suspended &&
                              s.favoriteActive,
                          ]}
                          onPress={() => switchTab(tab.id)}
                          onDragStart={(x, y) =>
                            beginDrag(tab.id, tabLabel(tab), x, y)
                          }
                          onDragMove={moveDrag}
                          onDragRelease={finishDrag}
                          onDragCancel={cancelDrag}
                          onLongPress={(x, y) => openTabMenu(tab.id, x, y)}
                        >
                          {playing.includes(tab.id) ? (
                            <ChromeIcon name="play" size={20} />
                          ) : (
                            <Favicon
                              url={tab.url}
                              fallback={tabLabel(tab).slice(0, 1).toUpperCase()}
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
              <Animated.View
                ref={tabListRef}
                style={[s.tabScrollWrap, spaceStyle]}
              >
                <FlatList
                  key={state?.activeWorkspaceId}
                  data={ordinaryTabs}
                  keyExtractor={(tab) => tab.id}
                  renderItem={({ item }) => renderSidebarTab(item)}
                  initialNumToRender={initialSidebarRows}
                  maxToRenderPerBatch={8}
                  windowSize={3}
                  removeClippedSubviews={false}
                  style={s.tabScroll}
                  contentContainerStyle={s.tabScrollContent}
                  showsVerticalScrollIndicator={false}
                  ListHeaderComponent={
                    <View>
                      <View ref={pinnedSectionRef} style={s.persistentSection}>
                        <SidebarPressable
                          accessibilityRole="button"
                          accessibilityLabel={`Manage space ${
                            activeWorkspace?.name ?? "Space"
                          }`}
                          style={({ pressed }) => [
                            s.spaceHeader,
                            pressed && s.pressed,
                          ]}
                          onPress={() => setSpaceSwitcher(true)}
                        >
                          <ChromeIcon
                            name="space"
                            size={12}
                            color={theme.inkMuted}
                          />
                          <Text numberOfLines={1} style={s.spaceHeaderTitle}>
                            {activeWorkspace?.name ?? "Space"}
                          </Text>
                          <ChromeIcon
                            name="chevronDown"
                            size={10}
                            color={theme.inkMuted}
                          />
                        </SidebarPressable>
                        {spaceFolders.map((folder) => {
                          const open = expandedFolders.has(folder.id);
                          const inside = spaceBookmarks.filter(
                            (bookmark) =>
                              (bookmark.folderId ?? "") === folder.id
                          );
                          return (
                            <View key={folder.id}>
                              <ContextPressable
                                accessibilityRole="button"
                                accessibilityLabel={`${
                                  open ? "Collapse" : "Expand"
                                } folder ${folder.title}`}
                                accessibilityState={{ expanded: open }}
                                style={({ pressed }) => [
                                  s.bookmarkTreeRow,
                                  pressed && s.rowPressed,
                                ]}
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
                              >
                                <ChromeIcon
                                  name={open ? "chevronDown" : "chevronRight"}
                                  size={12}
                                  color={theme.inkMuted}
                                />
                                <ChromeIcon name="folder" size={16} />
                                <Text numberOfLines={1} style={s.tabTitle}>
                                  {folder.title}
                                </Text>
                              </ContextPressable>
                              <FolderDisclosure
                                open={open}
                                reducedMotion={reducedMotion}
                              >
                                {inside.map((bookmark) =>
                                  bookmarkTreeRow(bookmark, true)
                                )}
                              </FolderDisclosure>
                            </View>
                          );
                        })}
                        {spaceBookmarks
                          .filter((bookmark) => !bookmark.folderId)
                          .map((bookmark) => bookmarkTreeRow(bookmark, false))}
                        {(state?.tabs ?? [])
                          .filter(
                            (tab) =>
                              tab.workspaceId === state?.activeWorkspaceId &&
                              tab.pinned &&
                              !tab.bookmarkId &&
                              !tab.favorite
                          )
                          .map((tab) => renderSidebarTab(tab))}
                        {privateTabs.length > 0 && (
                          <View style={s.privateSection}>
                            <View style={s.privateHeader}>
                              <ChromeIcon
                                name="private"
                                size={12}
                                color={theme.accentStrong}
                              />
                              <Text
                                numberOfLines={1}
                                style={s.privateHeaderText}
                              >
                                PRIVATE TABS
                              </Text>
                              <SidebarPressable
                                accessibilityRole="button"
                                accessibilityLabel="New private tab"
                                style={({ pressed }) => [
                                  s.privateNewTab,
                                  pressed && s.rowPressed,
                                ]}
                                onPress={() => createPrivateTabAndShow()}
                              >
                                <ChromeIcon
                                  name="plus"
                                  size={15}
                                  color={theme.inkMuted}
                                />
                              </SidebarPressable>
                            </View>
                            {/* One collection across Spaces: private tabs
                                vanish with the session, wherever they were
                                opened. */}
                            {privateTabs.map((tab) => renderSidebarTab(tab))}
                          </View>
                        )}
                      </View>
                      <View style={s.sectionRule} />
                      <View
                        ref={ordinarySectionRef}
                        style={
                          !ordinaryTabs.length ? s.ordinarySection : undefined
                        }
                      >
                        <SidebarPressable
                          accessibilityRole="button"
                          accessibilityLabel={`New tab in ${
                            activeWorkspace?.name ?? "Space"
                          }`}
                          style={({ pressed }) => [
                            s.newTab,
                            pressed && s.rowPressed,
                          ]}
                          onPress={() => openQuickOpen("touch")}
                        >
                          <ChromeIcon
                            name="plus"
                            size={18}
                            color={theme.inkMuted}
                          />
                          <Text style={s.newTabText}>New tab</Text>
                        </SidebarPressable>
                      </View>
                    </View>
                  }
                />
              </Animated.View>
              <View style={s.sidebarBottom}>
                <IconButton label="Android home" icon="home" onPress={goHome} />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={s.spaceRailScroll}
                  contentContainerStyle={s.spaceRail}
                >
                  {(state?.workspaces ?? []).map((workspace) => (
                    <SidebarPressable
                      key={workspace.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Switch to ${workspace.name}`}
                      accessibilityState={{
                        selected: workspace.id === state?.activeWorkspaceId,
                      }}
                      style={({ pressed }) => [
                        s.spaceChip,
                        workspace.id === state?.activeWorkspaceId &&
                          s.spaceChipActive,
                        pressed && s.pressed,
                      ]}
                      onPress={() => switchSpace(workspace.id)}
                      onLongPress={() => setSpaceSwitcher(true)}
                    >
                      <ChromeIcon
                        name="space"
                        size={17}
                        color={
                          workspace.id === state?.activeWorkspaceId
                            ? theme.ink
                            : theme.inkMuted
                        }
                      />
                      {workspace.id === state?.activeWorkspaceId && (
                        <View style={s.spaceIndicator} />
                      )}
                    </SidebarPressable>
                  ))}
                </ScrollView>
                <SidebarPressable
                  accessibilityRole="button"
                  accessibilityLabel="Add to sidebar"
                  style={s.iconButton}
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
                  <ChromeIcon name="plus" size={20} />
                </SidebarPressable>
              </View>
            </SidebarLayer>
            <SidebarLayer
              visible={sidebarMotion.rail && !contentFullscreen}
              active={ui.sidebarCollapsed && !contentFullscreen}
              style={[
                s.sidebarLayer,
                s.sidebarLayerRail,
                {
                  width: 48,
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
              <View style={[s.identityRow, s.identityRowCollapsed]}>
                <IconButton
                  label="Expand sidebar"
                  icon="sidebar"
                  onPress={toggleSidebar}
                  disabled={!uiHydrated}
                />
              </View>
              <View style={s.tabScrollWrap}>
                <FlatList
                  key={state?.activeWorkspaceId}
                  data={railTabs}
                  keyExtractor={(tab) => tab.id}
                  renderItem={({ item: t }) => (
                    <DragSource
                      reducedMotion={reducedMotion}
                      key={t.id}
                      accessibilityLabel={`Tab ${tabLabel(t)}`}
                      style={[
                        s.railItem,
                        splitPaneIds.includes(t.id) &&
                          !t.suspended &&
                          s.railTabActive,
                      ]}
                      onPress={() => switchTab(t.id)}
                      onDragStart={(x, y) => beginDrag(t.id, tabLabel(t), x, y)}
                      onDragMove={moveDrag}
                      onDragRelease={finishDrag}
                      onDragCancel={cancelDrag}
                      onLongPress={(x, y) => openTabMenu(t.id, x, y)}
                    >
                      <View style={s.railIcon}>
                        {playing.includes(t.id) ? (
                          <ChromeIcon name="play" size={16} />
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
                  style={s.tabScroll}
                  contentContainerStyle={s.railContent}
                  showsVerticalScrollIndicator={false}
                  ListHeaderComponent={
                    <View style={s.railHeader}>
                      {favoriteTabs.map((tab) => (
                        <DragSource
                          reducedMotion={reducedMotion}
                          key={tab.id}
                          accessibilityLabel={`Favorite ${tabLabel(tab)}`}
                          style={[
                            s.railItem,
                            splitPaneIds.includes(tab.id) &&
                              !tab.suspended &&
                              s.railTabActive,
                          ]}
                          onPress={() => switchTab(tab.id)}
                          onDragStart={(x, y) =>
                            beginDrag(tab.id, tabLabel(tab), x, y)
                          }
                          onDragMove={moveDrag}
                          onDragRelease={finishDrag}
                          onDragCancel={cancelDrag}
                          onLongPress={(x, y) => openTabMenu(tab.id, x, y)}
                        >
                          <View style={s.railIcon}>
                            {playing.includes(tab.id) ? (
                              <ChromeIcon name="play" size={16} />
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
                      <View style={s.railSeparator} />
                    </View>
                  }
                />
              </View>
              <View style={s.sidebarBottomCollapsed}>
                <IconButton label="Android home" icon="home" onPress={goHome} />
                <SidebarPressable
                  accessibilityRole="button"
                  accessibilityLabel="New tab"
                  hitSlop={8}
                  style={({ pressed }) => [s.railItem, pressed && s.pressed]}
                  onPress={() => openQuickOpen("touch")}
                >
                  <View style={s.railIcon}>
                    <ChromeIcon name="plus" size={18} />
                  </View>
                </SidebarPressable>
                <IconButton
                  label="Settings"
                  icon="settings"
                  onPress={() => setSettings(true)}
                />
              </View>
            </SidebarLayer>
            {!ui.sidebarCollapsed && (
              <View
                accessibilityRole="adjustable"
                accessibilityLabel="Resize sidebar"
                style={s.sidebarResizeHandle}
                {...sidebarResize.panHandlers}
              />
            )}
          </Animated.View>
          <Animated.View
            style={[
              s.content,
              { opacity: spaceMotion.opacity },
              contentFullscreen && s.contentFullscreen,
            ]}
          >
            <SidebarLayer
              visible={sidebarMotion.rail && !contentFullscreen}
              active={ui.sidebarCollapsed && !contentFullscreen}
              style={{
                display: contentFullscreen ? "none" : "flex",
                overflow: "hidden",
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
              <View style={s.canvasToolbar}>
                <View style={s.compactNavigation}>
                  <IconButton
                    label="Back"
                    icon="back"
                    onPress={goBack}
                    disabled={!canGoBack}
                  />
                  <IconButton
                    label="Forward"
                    icon="forward"
                    onPress={() => invoke(Commands.goForward)}
                    disabled={!canGoForward}
                  />
                  <AddressTrigger
                    compact
                    url={addressValue}
                    onPress={() => openLocationEditor("touch")}
                  />
                </View>
                <IconButton
                  label={validSplit ? "Unsplit" : "Split"}
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
              accessibilityLabel="Split drop canvas"
              style={[
                s.panes,
                renderSplit?.orientation === "vertical" && s.panesVertical,
              ]}
              pointerEvents={findBlocking ? "none" : "auto"}
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
                      <Animated.View
                        style={[
                          contentFullscreen && s.hidden,
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
                          accessibilityLabel="Resize split"
                          accessibilityActions={[
                            { name: "increment", label: "Grow first pane" },
                            { name: "decrement", label: "Shrink first pane" },
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
                          style={[
                            s.divider,
                            !vertical && { height: "100%" },
                            renderSplit.orientation === "vertical" &&
                              s.dividerVertical,
                          ]}
                          {...dividerPanResponder.panHandlers}
                        >
                          <View
                            style={[
                              s.dividerHandle,
                              renderSplit.orientation === "vertical" &&
                                s.dividerHandleVertical,
                            ]}
                          />
                        </View>
                      </Animated.View>
                    )}
                    <Animated.View
                      pointerEvents={
                        leaving || hiddenByFullscreen ? "none" : "auto"
                      }
                      importantForAccessibility={
                        leaving || hiddenByFullscreen
                          ? "no-hide-descendants"
                          : "auto"
                      }
                      style={[
                        s.pane,
                        { flex: ratio },
                        // Arc gives a single pane no focus ring — the ring
                        // only marks which half of a split is focused, so a
                        // lone pane never draws a doubled border inside the
                        // card's own border.
                        renderSplit && target === item.id && s.paneFocused,
                        contentFullscreen && s.paneFullscreen,
                        hiddenByFullscreen && s.hidden,
                      ]}
                    >
                      {renderSplit && (
                        <Animated.View
                          style={{
                            overflow: "hidden",
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
                            style={[
                              s.paneHeader,
                              target === item.id && s.paneHeaderFocused,
                            ]}
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
                            <Text numberOfLines={1} style={s.paneHeaderTitle}>
                              {tabLabel(item)}
                            </Text>
                            <ChromeIcon
                              name="more"
                              size={16}
                              color={theme.inkMuted}
                            />
                          </DragSource>
                        </Animated.View>
                      )}
                      <Animated.View
                        style={
                          contentMotion
                            ? [s.paneContent, contentMotion]
                            : s.paneContent
                        }
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
                          style={s.newTabOverlay}
                          pop
                          reducedMotion={reducedMotion}
                        >
                          {item.url === NEW_TAB_URL &&
                            !controller.isPopupTab(item.id) && (
                              <NewTabPage
                                favorites={favoriteTabs}
                                reducedMotion={reducedMotion}
                                engine={ui.searchEngine}
                                suggestions={suggestionSources}
                                commands={registry.entries()}
                                onCommand={(id) => registry.execute(id)}
                                onOpenUrl={(url) => loadInPane(item.id, url)}
                                onOpenFavorite={(id) => {
                                  const blank = item.id;
                                  switchTab(id);
                                  if (blank !== id)
                                    run(controller.close(blank));
                                }}
                              />
                            )}
                        </Overlay>
                      </Animated.View>
                    </Animated.View>
                  </React.Fragment>
                );
              })}
              {drag?.zone && (
                <View
                  pointerEvents="none"
                  style={[
                    s.dropPreview,
                    drag.zone === "left" && s.dropLeft,
                    drag.zone === "right" && s.dropRight,
                    drag.zone === "top" && s.dropTop,
                    drag.zone === "bottom" && s.dropBottom,
                  ]}
                />
              )}
            </View>
            <Overlay open={!!findTab} reducedMotion={reducedMotion}>
              {findTab && (
                <FindBar
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
          </Animated.View>
        </View>
        <Overlay
          open={notice !== ""}
          style={s.noticeBanner}
          lift={-12}
          touchThrough
          reducedMotion={reducedMotion}
        >
          <View pointerEvents="none">
            <Text style={s.noticeText}>{notice}</Text>
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
                flashNotice("Link copied");
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
                      run(controller.setFavorite(menuTab.id, !menuTab.favorite));
                    }
              }
              onTogglePin={
                menuTab.private
                  ? undefined
                  : () => {
                      if (!menuTab) return;
                      run(controller.setPinned(menuTab.id, !menuTab.pinned));
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
                      .createTab(menuTab.url, workspaceId, { private: true })
                      .then((snapshot) => {
                        setSplitLayout(null);
                        setFocused(snapshot.activeTabId ?? null);
                      })
                  );
                } else createTabAndShow(menuTab.url, workspaceId);
              }}
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
          sidebarMenu && (
            <ActionMenu
              title={
                sidebarMenu.kind === "create"
                  ? "Add to sidebar"
                  : sidebarMenu.kind === "folder"
                  ? "Folder"
                  : sidebarMenu.kind === "bookmarkMove"
                  ? "Move bookmark"
                  : "Bookmark"
              }
              anchor={sidebarMenu.anchor}
              items={sidebarActions()}
              onClose={() => setSidebarMenu(null)}
            />
          )
        )}
        {sheet(
          !!splitPickerTabId,
          () => setSplitPickerTabId(null),
          splitPickerTabId && (
            <ActionMenu
              title="Choose a tab to split with"
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
                      controller.activate(origin, [origin, tab.id]).then(() => {
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
            <View style={[s.dialog, s.settingsDialog]}>
              <Text style={s.dialogTitle}>New folder</Text>
              <TextInput
                accessibilityLabel="Folder name"
                autoFocus
                value={folderName}
                onChangeText={setFolderName}
                style={s.commandInput}
                placeholder="Folder name"
                placeholderTextColor={theme.inkFaint}
              />
              <Button
                label="Create folder"
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
                    .workspace(`Space ${(state.workspaces.length ?? 0) + 1}`)
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
          () => setHistoryOpen(false),
          <HistoryDialog
            entries={history.entries}
            onOpen={(url) => createTabAndShow(url)}
            onClear={() => {
              void history.clear().then((ok) => {
                if (!ok) setError("History could not be cleared on disk");
              });
            }}
            onClose={() => setHistoryOpen(false)}
          />
        )}
        {drag && (
          <Animated.View
            pointerEvents="none"
            style={[
              s.dragGhost,
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
            <Text numberOfLines={1} style={s.dragGhostText}>
              {drag.title}
            </Text>
          </Animated.View>
        )}
        {sheet(
          !!quickOpen,
          closeQuickOpen,
          quickOpen && (
            <View style={[s.dialog, s.quickOpenDialog]}>
              <AddressBox
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
                commands={quickOpenEdit ? [] : registry.entries()}
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
                  contentContainerStyle={s.quickOpenRow}
                >
                  {favoriteTabs.map((tab) => (
                    <Pressable
                      key={tab.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Favorite ${tab.title || tab.url}`}
                      style={({ pressed }) => [
                        s.quickOpenTile,
                        pressed && s.pressed,
                      ]}
                      onPress={() => {
                        closeQuickOpen();
                        switchTab(tab.id);
                      }}
                    >
                      <View style={s.quickOpenTileIcon}>
                        <Favicon
                          url={tab.url}
                          fallback={(tab.title || tab.url)
                            .slice(0, 1)
                            .toUpperCase()}
                          size={22}
                          radius={6}
                        />
                      </View>
                      <Text numberOfLines={1} style={s.quickOpenTileLabel}>
                        {tab.title || tab.url}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : (
                <Text style={s.quickOpenHint}>
                  Type a link — favorites you add appear here.
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
            <View style={s.dialog}>
              <Text style={s.dialogTitle}>Commands</Text>
              <TextInput
                accessibilityLabel="Find command"
                value={query}
                onChangeText={setQuery}
                style={s.commandInput}
                disableFullscreenUI
              />
              <ScrollView>
                {registry
                  .entries()
                  .filter((command) =>
                    command.title.toLowerCase().includes(query.toLowerCase())
                  )
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
                label="Close commands"
                onPress={() => setPalette(false)}
              />
            </View>
          )
        )}
        {sheet(
          !!bookmarkManager,
          () => setBookmarkManager(false),
          bookmarkManager && (
            <View style={[s.dialog, s.bookmarkDialog]}>
              <View style={s.dialogHeader}>
                <Text style={[s.dialogTitle, { flex: 1 }]}>Bookmarks</Text>
                <IconButton
                  label="Close bookmark manager"
                  icon="close"
                  onPress={() => setBookmarkManager(false)}
                />
              </View>
              <Text style={s.dialogHelp}>
                {bookmarkFolder
                  ? `Inside ${
                      spaceFolders.find(
                        (folder) => folder.id === bookmarkFolder
                      )?.title ?? "folder"
                    } — new bookmarks land here.`
                  : `Saved in ${activeWorkspace?.name ?? "this Space"}.`}
              </Text>
              <Text style={s.dialogHelp}>
                Bookmarks remain on this device, including bookmarks saved from private browsing.
              </Text>
              <View style={s.bookmarkForm}>
                <TextInput
                  accessibilityLabel="Bookmark title"
                  value={bookmarkTitle}
                  onChangeText={setBookmarkTitle}
                  placeholder="Name"
                  placeholderTextColor={theme.inkFaint}
                  style={s.commandInput}
                  autoCorrect={false}
                  disableFullscreenUI
                />
                <TextInput
                  accessibilityLabel="Bookmark URL"
                  value={bookmarkUrl}
                  onChangeText={setBookmarkUrl}
                  placeholder="https://"
                  placeholderTextColor={theme.inkFaint}
                  style={s.commandInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  disableFullscreenUI
                  keyboardType="url"
                />
                <View style={s.bookmarkActions}>
                  <Button
                    label={bookmarkEditing ? "Save bookmark" : "Add bookmark"}
                    onPress={() => {
                      if (!bookmarkTitle.trim() || !bookmarkUrl.trim()) return;
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
                    label="Add current page"
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
                <View style={s.bookmarkActions}>
                  <TextInput
                    accessibilityLabel="New folder name"
                    value={folderName}
                    onChangeText={setFolderName}
                    placeholder="New folder name"
                    placeholderTextColor={theme.inkFaint}
                    style={[s.commandInput, { flex: 1 }]}
                    autoCorrect={false}
                    autoCapitalize="none"
                    disableFullscreenUI
                  />
                  <Button
                    label="Add folder"
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
              <ScrollView style={s.bookmarkList}>
                {!bookmarkFolder &&
                  spaceFolders.map((folder) => (
                    <View key={folder.id} style={s.bookmarkRow}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Open folder ${folder.title}`}
                        style={s.folderRow}
                        onPress={() => setBookmarkFolder(folder.id)}
                      >
                        <ChromeIcon name="folder" size={18} />
                        <Text numberOfLines={1} style={s.optionTitle}>
                          {folder.title}
                        </Text>
                        <Text style={s.workspaceCount}>
                          {
                            spaceBookmarks.filter(
                              (bookmark) =>
                                (bookmark.folderId ?? "") === folder.id
                            ).length
                          }
                        </Text>
                      </Pressable>
                      <IconButton
                        label={`Rename folder ${folder.title}`}
                        icon="edit"
                        onPress={() => {
                          setRenamingFolder(folder.id);
                          setFolderName(folder.title);
                        }}
                      />
                      <IconButton
                        label={`Delete folder ${folder.title}`}
                        icon="close"
                        onPress={() =>
                          run(controller.bookmarkFolderRemove(folder.id))
                        }
                      />
                    </View>
                  ))}
                {renamingFolder && (
                  <View style={s.bookmarkActions}>
                    <TextInput
                      accessibilityLabel="Rename folder"
                      value={folderName}
                      onChangeText={setFolderName}
                      placeholder="Folder name"
                      placeholderTextColor={theme.inkFaint}
                      style={[s.commandInput, { flex: 1 }]}
                      autoCorrect={false}
                      autoCapitalize="none"
                      disableFullscreenUI
                    />
                    <Button
                      label="Save name"
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
                    accessibilityLabel="Back to all bookmarks"
                    style={s.bookmarkRow}
                    onPress={() => setBookmarkFolder("")}
                  >
                    <ChromeIcon name="back" size={18} />
                    <Text style={s.optionTitle}>
                      {spaceFolders.find(
                        (folder) => folder.id === bookmarkFolder
                      )?.title ?? "Folder"}
                    </Text>
                  </Pressable>
                )}
                {spaceBookmarks
                  .filter(
                    (bookmark) => (bookmark.folderId ?? "") === bookmarkFolder
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
                      <View key={bookmark.id} style={s.bookmarkRow}>
                        <View style={s.bookmarkCopy}>
                          <Text numberOfLines={1} style={s.optionTitle}>
                            {bookmark.title}
                          </Text>
                          <Text numberOfLines={1} style={s.optionDescription}>
                            {bookmark.url}
                          </Text>
                        </View>
                        {folders.length > 0 && (
                          <IconButton
                            label={`Move bookmark ${bookmark.title}`}
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
                          label={`Move bookmark ${bookmark.title} up`}
                          icon="chevronUp"
                          disabled={index === 0 || upTarget < 0}
                          onPress={() =>
                            run(controller.bookmarkMove(bookmark.id, upTarget))
                          }
                        />
                        <IconButton
                          label={`Move bookmark ${bookmark.title} down`}
                          icon="chevronDown"
                          disabled={index === list.length - 1 || downTarget < 0}
                          onPress={() =>
                            run(
                              controller.bookmarkMove(bookmark.id, downTarget)
                            )
                          }
                        />
                        <IconButton
                          label={`Edit bookmark ${bookmark.title}`}
                          icon="edit"
                          onPress={() => {
                            setBookmarkEditing(bookmark.id);
                            setBookmarkTitle(bookmark.title);
                            setBookmarkUrl(bookmark.url);
                          }}
                        />
                        <IconButton
                          label={`Remove bookmark ${bookmark.title}`}
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
            <View style={[s.dialog, s.settingsDialog]}>
              <View style={s.dialogHeader}>
                <View style={s.dialogHeadingCopy}>
                  <Text style={s.dialogTitle}>Settings</Text>
                  <Text style={s.dialogHelp}>
                    Appearance and sidebar preferences are saved on this device.
                  </Text>
                </View>
                <IconButton
                  label="Close settings"
                  icon="close"
                  onPress={() => setSettings(false)}
                />
              </View>
              <ScrollView
                style={s.dialogScroll}
                showsVerticalScrollIndicator={false}
              >
                <BrowserToolsPanel
                  config={browser.config}
                  onSave={browser.saveConfig}
                  tabId={target ?? undefined}
                  url={targetUrl}
                  privateTab={!!state?.tabs.find((tab) => tab.id === target)?.private}
                  security={target ? browser.security[target] : undefined}
                  onError={setError}
                  onNotice={flashNotice}
                />
                <BrowserDataPanel
                  controller={controller}
                  ui={ui}
                  hydrated={uiHydrated}
                  onPresentation={async ({ schema: _schema, ...appearance }) => {
                    const next = { ...currentUi.current, ...appearance };
                    await platform.saveUiPreferences(JSON.stringify(next));
                    updateUi({ type: "restore", preferences: next });
                  }}
                  onError={setError}
                  onNotice={flashNotice}
                />
                <Text style={s.settingsSection}>APPEARANCE</Text>
                <View style={s.optionRow}>
                  {(["lavender", "warm"] as const).map((appearance) => (
                    <Pressable
                      key={appearance}
                      accessibilityRole="button"
                      accessibilityLabel={
                        appearance === "lavender"
                          ? "Lavender appearance"
                          : "Warm appearance"
                      }
                      style={[
                        s.appearanceOption,
                        ui.appearance === appearance &&
                          s.appearanceOptionSelected,
                        !uiHydrated && s.disabled,
                      ]}
                      accessibilityState={{ disabled: !uiHydrated }}
                      disabled={!uiHydrated}
                      onPress={() =>
                        updateUi({ type: "setAppearance", appearance })
                      }
                    >
                      <View
                        style={[
                          s.appearanceSwatch,
                          { backgroundColor: themes[appearance].chrome },
                        ]}
                      />
                      <Text style={s.optionTitle}>
                        {appearance === "lavender" ? "Lavender" : "Warm rose"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={s.settingsSection}>SIDEBAR</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    ui.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
                  }
                  style={s.settingsAction}
                  accessibilityState={{ disabled: !uiHydrated }}
                  disabled={!uiHydrated}
                  onPress={toggleSidebar}
                >
                  <View>
                    <Text style={s.optionTitle}>
                      {ui.sidebarCollapsed
                        ? "Expand sidebar"
                        : "Collapse sidebar"}
                    </Text>
                    <Text style={s.optionDescription}>
                      {ui.sidebarCollapsed
                        ? "Show favorites, labels, and workspace tools"
                        : "Keep active tabs visible in compact chrome"}
                    </Text>
                  </View>
                  <Text style={s.chevron}>›</Text>
                </Pressable>
                <Text style={s.settingsSection}>LAYOUT</Text>
                {FRAME_SIDES.map((side) => (
                  <View key={side} style={s.settingsAction}>
                    <View>
                      <Text style={s.optionTitle}>
                        {FRAME_SIDE_LABELS[side]} padding
                      </Text>
                      <Text style={s.optionDescription}>
                        Outer margin on this side, in px
                      </Text>
                    </View>
                    <View style={s.stepperRow}>
                      <IconButton
                        label={`Decrease ${side} frame padding`}
                        icon="minus"
                        disabled={ui.framePx[side] <= FRAME_PX_MIN}
                        onPress={() =>
                          updateUi({
                            type: "setFramePx",
                            side,
                            value: ui.framePx[side] - FRAME_PX_STEP,
                          })
                        }
                      />
                      <Text style={s.stepperValue}>{ui.framePx[side]}px</Text>
                      <IconButton
                        label={`Increase ${side} frame padding`}
                        icon="plus"
                        disabled={ui.framePx[side] >= FRAME_PX_MAX}
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
                <Text style={s.settingsSection}>DISPLAY</Text>
                <Pressable
                  accessibilityRole="switch"
                  accessibilityLabel="Full screen"
                  accessibilityState={{
                    checked: ui.fullscreen,
                    disabled: !uiHydrated,
                  }}
                  disabled={!uiHydrated}
                  style={({ pressed }) => [
                    s.settingsToggle,
                    pressed && s.pressed,
                  ]}
                  onPress={() =>
                    updateUi({
                      type: "setFullscreen",
                      fullscreen: !ui.fullscreen,
                    })
                  }
                >
                  <View style={s.settingsToggleCopy}>
                    <Text style={s.optionTitle}>Full screen</Text>
                    <Text style={s.optionDescription}>
                      Hide the system bars for an immersive canvas
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
                <Text style={s.settingsSection}>SITE PERMISSIONS</Text>
                <Text style={s.dialogHelp}>
                  Sites ask before using these; the answer is remembered per
                  site, and one site's grant never applies to another.
                </Text>
                {siteRules.map((rule) => (
                  <View
                    key={`${rule.origin}|${rule.kind}`}
                    style={s.settingsAction}
                  >
                    <View style={s.settingsToggleCopy}>
                      <Text style={s.optionTitle}>
                        {rule.origin.replace(/^https?:\/\//, "")}
                      </Text>
                      <Text style={s.optionDescription}>
                        {PERMISSION_LABELS[rule.kind]} —{" "}
                        {rule.decision === "allow" ? "allowed" : "blocked"}
                      </Text>
                    </View>
                    <IconButton
                      label={`Forget ${PERMISSION_LABELS[rule.kind]} for ${
                        rule.origin
                      }`}
                      icon="close"
                      onPress={() => {
                        run(
                          sitePermissions
                            .revoke(rule.origin, rule.kind)
                            .then(() => setPermissionRulesVersion((v) => v + 1))
                        );
                      }}
                    />
                  </View>
                ))}
                {siteRules.length === 0 && (
                  <Text style={s.optionDescription}>
                    No site permissions granted yet.
                  </Text>
                )}
                {siteRules.length > 0 && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Forget all site permissions"
                    style={s.settingsAction}
                    onPress={() => {
                      run(
                        sitePermissions
                          .clearAll()
                          .then(() => setPermissionRulesVersion((v) => v + 1))
                      );
                    }}
                  >
                    <View>
                      <Text style={s.optionTitle}>Forget all</Text>
                      <Text style={s.optionDescription}>
                        Every site asks again on next use
                      </Text>
                    </View>
                    <Text style={s.chevron}>›</Text>
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Search engine"
                  style={s.settingsAction}
                  onPress={() => {
                    const order: SearchEngineId[] = [
                      "google",
                      "naver",
                      "duckduckgo",
                    ];
                    const next =
                      order[
                        (order.indexOf(ui.searchEngine) + 1) % order.length
                      ];
                    updateUi({ type: "setSearchEngine", searchEngine: next });
                  }}
                >
                  <View>
                    <Text style={s.optionTitle}>Search engine</Text>
                    <Text style={s.optionDescription}>
                      Used for address-bar queries
                    </Text>
                  </View>
                  <Text style={s.chevron}>
                    {SEARCH_ENGINES[ui.searchEngine].label} ›
                  </Text>
                </Pressable>
                <Text style={s.settingsSection}>DATA</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="History"
                  style={s.settingsAction}
                  onPress={() => {
                    setSettings(false);
                    setHistoryOpen(true);
                  }}
                >
                  <View>
                    <Text style={s.optionTitle}>History</Text>
                    <Text style={s.optionDescription}>
                      Recent pages on this device
                    </Text>
                  </View>
                  <Text style={s.chevron}>›</Text>
                </Pressable>
                <Text style={s.settingsSection}>BOOKMARKS</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Bookmarks"
                  style={s.settingsAction}
                  onPress={() => {
                    setSettings(false);
                    setBookmarkManager(true);
                  }}
                >
                  <View>
                    <Text style={s.optionTitle}>Bookmarks</Text>
                    <Text style={s.optionDescription}>
                      Saved links, separate from favorite tabs
                    </Text>
                  </View>
                  <Text style={s.chevron}>›</Text>
                </Pressable>
                <Text style={s.settingsSection}>SITE BOOSTS</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Site boosts"
                  style={s.settingsAction}
                  onPress={() => {
                    setSettings(false);
                    setBoostsOpen(true);
                  }}
                >
                  <View>
                    <Text style={s.optionTitle}>Site boosts</Text>
                    <Text style={s.optionDescription}>
                      Custom CSS per site, applied on every load
                    </Text>
                  </View>
                  <Text style={s.chevron}>
                    {ui.boosts.length > 0 ? `${ui.boosts.length} ›` : "›"}
                  </Text>
                </Pressable>
                <Text style={s.settingsSection}>COMMANDS</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Command palette"
                  style={s.settingsAction}
                  onPress={() => {
                    setSettings(false);
                    setPalette(true);
                  }}
                >
                  <View>
                    <Text style={s.optionTitle}>Command palette</Text>
                    <Text style={s.optionDescription}>
                      Run browser commands by name
                    </Text>
                  </View>
                  <Text style={s.chevron}>›</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Keyboard"
                  style={s.settingsAction}
                  onPress={openKeyboard}
                >
                  <View>
                    <Text style={s.optionTitle}>Keyboard shortcuts</Text>
                    <Text style={s.optionDescription}>
                      Edit bindings or add Android-friendly alternatives
                    </Text>
                  </View>
                  <Text style={s.chevron}>›</Text>
                </Pressable>
              </ScrollView>
            </View>
          )
        )}
        {sheet(
          !!boostsOpen,
          () => setBoostsOpen(false),
          <BoostsDialog
            boosts={ui.boosts}
            onSave={(boosts) => {
              updateUi({ type: "setBoosts", boosts });
              setBoostsOpen(false);
            }}
            onClose={() => setBoostsOpen(false)}
          />
        )}
        {sheet(
          !!keys,
          () => setKeys(false),
          keys && (
            <View style={s.dialog}>
              <Text style={s.dialogTitle}>Keyboard shortcuts</Text>
              <Text style={s.dialogHelp}>
                Customize shortcuts. Each key combination can have one action.
              </Text>
              <Text style={s.dialogHelp}>
                Ctrl alternatives are available when Android reserves a ⌘
                shortcut.
              </Text>
              <TextInput
                accessibilityLabel="Keymap JSON"
                multiline
                style={s.keymapInput}
                value={keyDraft}
                onChangeText={setKeyDraft}
                autoCapitalize="none"
                autoCorrect={false}
                disableFullscreenUI
              />
              <Button
                label="Add Ctrl alternatives"
                onPress={() =>
                  applyKeymapDraft(() =>
                    withCtrlAlternativesFromDraft(keyDraft)
                  )
                }
              />
              <Button
                label="Save keymap"
                onPress={() => applyKeymapDraft(keymapFromDraft)}
              />
              <Button label="Cancel keyboard" onPress={() => setKeys(false)} />
            </View>
          )
        )}
      </SafeAreaView>
      <BrowserContentMenu
        request={browser.context}
        onClose={browser.closeContext}
        onChoose={browser.selectContext}
      />
    </ThemeContext.Provider>
  );
}
