import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  FlatList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
} from "react-native";
import { SidebarPressable } from "../chrome/SidebarInteraction";
import { ContextPressable } from "../chrome/ContextPressable";
import { ChromeIcon, type IconName } from "../chrome/ChromeIcon";
import { menuPosition, type MenuAnchor } from "../menuLayout";
import { sidebarAddressLabel } from "../sidebarModel";
import type { SidebarSplit } from "../sidebarPresentation";
import { useTheme } from "../themeContext";
import type { Theme } from "../theme";
import { useI18n } from "../i18nContext";
import { Favicon } from "./Favicon";

const pageTitle = (page: { title: string; url: string }) =>
  page.title || sidebarAddressLabel(page.url) || "New tab";
const compactCount = (count: number) => (count > 99 ? "99+" : String(count));
const useCollectionStyles = () => {
  const theme = useTheme();
  return useMemo(() => stylesFor(theme), [theme]);
};

export function SplitSidebarItem({
  split,
  collapsed,
  onOpen,
  open = false,
}: {
  split: SidebarSplit;
  collapsed: boolean;
  open?: boolean;
  onOpen: (anchor: MenuAnchor) => void;
}) {
  const s = useCollectionStyles();
  const t = useTheme();
  const { tr } = useI18n();
  const front =
    split.pages.find((page) => page.id === split.focusedId) ?? split.pages[0];
  const back = split.pages.find((page) => page.id !== front.id)!;
  return (
    <SidebarPressable
      accessibilityRole="button"
      accessibilityLabel={tr("collections.splitLabel", {
        kind: tr(front.private ? "chrome.privateSplit" : "chrome.splitView"),
        pages: split.pages.map(pageTitle).join(" + "),
        page: pageTitle(front),
      })}
      accessibilityHint={tr("collections.splitHint")}
      accessibilityState={{ selected: true, expanded: open }}
      onPress={({ nativeEvent }) =>
        onOpen({ x: nativeEvent.pageX, y: nativeEvent.pageY })
      }
      style={({ pressed }) => [
        s.split,
        collapsed ? s.splitRail : s.splitExpanded,
        pressed && s.pressed,
      ]}
    >
      <View
        style={s.stack}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {[back, front].map((page, index) => (
          <View
            key={page.id}
            testID={index ? "split-favicon-front" : "split-favicon-back"}
            accessibilityLabel={pageTitle(page)}
            style={[s.stackedIcon, index ? s.frontIcon : s.backIcon]}
          >
            <Favicon
              url={page.url}
              fallback={pageTitle(page).slice(0, 1).toUpperCase()}
              size={17}
              radius={4}
              persist={!page.private}
            />
          </View>
        ))}
      </View>
      {!collapsed && (
        <>
          <View style={s.splitTitles}>
            {split.pages.map((page) => (
              <View key={page.id} style={s.titleLine}>
                <View
                  style={[
                    s.focusDot,
                    page.id !== split.focusedId && s.inactiveDot,
                  ]}
                />
                <Text
                  numberOfLines={1}
                  style={[
                    s.title,
                    page.id !== split.focusedId && s.secondaryTitle,
                  ]}
                >
                  {pageTitle(page)}
                </Text>
              </View>
            ))}
          </View>
          <ChromeIcon
            name={front.private ? "private" : "chevronDown"}
            size={13}
            color={t.inkMuted}
          />
        </>
      )}
    </SidebarPressable>
  );
}

export function SidebarFolderItem({
  title,
  count,
  open,
  collapsed = false,
  containsFocused,
  contextOpen,
  onPress,
  onContextMenu,
}: {
  title: string;
  count: number;
  open: boolean;
  collapsed?: boolean;
  containsFocused: boolean;
  contextOpen: boolean;
  onPress: () => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const s = useCollectionStyles();
  const t = useTheme();
  return (
    <ContextPressable
      accessibilityRole="button"
      accessibilityLabel={`${
        collapsed ? "Open" : open ? "Collapse" : "Expand"
      } folder ${title}, ${count} pages${
        containsFocused ? ", contains selected page" : ""
      }`}
      accessibilityState={{ expanded: open, selected: containsFocused }}
      style={({ pressed }) => [
        s.folder,
        collapsed ? s.folderRail : s.folderExpanded,
        containsFocused && s.folderSelected,
        pressed && s.pressed,
      ]}
      onPress={onPress}
      onContextMenu={onContextMenu}
      contextOpen={contextOpen}
    >
      <View style={s.folderGlyph}>
        <ChromeIcon
          name={open ? "folderOpen" : "folder"}
          size={collapsed ? 25 : 22}
          color={containsFocused ? t.accentStrong : t.icon}
        />
        {containsFocused && <View style={s.folderDot} />}
      </View>
      {!collapsed && (
        <Text numberOfLines={1} style={s.title}>
          {title}
        </Text>
      )}
      <Text style={[s.count, collapsed && s.railCount]}>
        {compactCount(count)}
      </Text>
      {!collapsed && (
        <ChromeIcon
          name={open ? "chevronDown" : "chevronRight"}
          size={11}
          color={t.inkMuted}
        />
      )}
    </ContextPressable>
  );
}

export interface SidebarPageChoice {
  id: string;
  title: string;
  url: string;
  private?: boolean;
  detail?: string;
  selected?: boolean;
  onPress: () => void;
  onMenu?: (anchor: MenuAnchor) => void;
}

export function SidebarPageMenu({
  title,
  anchor,
  pages,
  actions = [],
  onClose,
}: {
  title: string;
  anchor?: MenuAnchor;
  pages: SidebarPageChoice[];
  actions?: {
    id: string;
    label: string;
    icon: IconName;
    onPress: () => void;
  }[];
  onClose: () => void;
}) {
  const { tr } = useI18n();
  const s = useCollectionStyles();
  const window = useWindowDimensions();
  const [height, setHeight] = useState(
    50 + pages.length * 56 + actions.length * 44
  );
  const renderPage = useCallback(
    ({ item }: ListRenderItemInfo<SidebarPageChoice>) => (
      <SidebarPageRow page={item} onClose={onClose} />
    ),
    [onClose]
  );
  return (
    <View
      accessibilityViewIsModal
      accessibilityLabel={title}
      onLayout={({ nativeEvent }) => setHeight(nativeEvent.layout.height)}
      style={[s.menu, menuPosition(anchor, window, 300, height)]}
    >
      <View style={s.menuHeading}>
        <Text numberOfLines={1} style={s.menuTitle}>
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
          onPress={onClose}
          style={s.menuIcon}
        >
          <ChromeIcon name="close" size={16} />
        </Pressable>
      </View>
      <FlatList
        data={pages}
        keyExtractor={(page) => page.id}
        renderItem={renderPage}
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        windowSize={3}
        keyboardShouldPersistTaps="handled"
        style={s.menuScroll}
        ListEmptyComponent={<Text style={s.empty}>{tr("collections.noSavedPages")}</Text>}
        ListFooterComponent={
          actions.length > 0 ? (
            <View style={s.menuActions}>
              {actions.map((action) => (
                <Pressable
                  key={action.id}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  onPress={() => {
                    onClose();
                    action.onPress();
                  }}
                  style={({ pressed }) => [s.action, pressed && s.pressed]}
                >
                  <ChromeIcon name={action.icon} size={16} />
                  <Text style={s.title}>{action.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : undefined
        }
      />
    </View>
  );
}

function SidebarPageRow({
  page,
  onClose,
}: {
  page: SidebarPageChoice;
  onClose: () => void;
}) {
  const s = useCollectionStyles();
  const t = useTheme();
  return (
    <View style={[s.choiceRow, page.selected && s.choiceSelected]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${
          page.detail ? page.detail + ": " : ""
        }${pageTitle(page)}`}
        accessibilityState={{ selected: !!page.selected }}
        onPress={() => {
          onClose();
          page.onPress();
        }}
        style={({ pressed }) => [s.choice, pressed && s.pressed]}
      >
        <View style={s.choiceIcon}>
          <Favicon
            url={page.url}
            fallback={pageTitle(page).slice(0, 1).toUpperCase()}
            size={20}
            radius={4}
            persist={!page.private}
          />
        </View>
        <View style={s.choiceCopy}>
          <Text numberOfLines={1} style={s.title}>
            {pageTitle(page)}
          </Text>
          <Text numberOfLines={1} style={s.detail}>
            {[page.detail, sidebarAddressLabel(page.url)]
              .filter(Boolean)
              .join(" · ") || "New tab"}
          </Text>
        </View>
        {page.selected && (
          <ChromeIcon name="check" size={14} color={t.accentStrong} />
        )}
      </Pressable>
      {page.onMenu && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Actions for ${pageTitle(page)}`}
          style={s.menuIcon}
          onPress={({ nativeEvent }) => {
            onClose();
            page.onMenu?.({ x: nativeEvent.pageX, y: nativeEvent.pageY });
          }}
        >
          <ChromeIcon name="more" size={17} />
        </Pressable>
      )}
    </View>
  );
}

const stylesFor = (t: Theme) =>
  StyleSheet.create({
    split: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: t.pill,
      borderRadius: 9,
    },
    splitRail: { width: 44, height: 44, justifyContent: "center" },
    splitExpanded: {
      minHeight: 52,
      paddingHorizontal: 8,
      paddingVertical: 6,
      gap: 8,
      marginVertical: 3,
    },
    stack: { width: 34, height: 34, flexShrink: 0 },
    stackedIcon: {
      position: "absolute",
      width: 24,
      height: 24,
      borderRadius: 6,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
    },
    backIcon: {
      top: 0,
      left: 0,
      backgroundColor: t.sidebar,
      borderColor: t.hairlineOnChrome,
    },
    frontIcon: {
      bottom: 0,
      right: 0,
      backgroundColor: t.surfaceElevated,
      borderColor: t.accentStrong,
    },
    splitTitles: { flex: 1, minWidth: 0, gap: 2 },
    titleLine: { flexDirection: "row", alignItems: "center", gap: 5 },
    focusDot: {
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.accentStrong,
    },
    inactiveDot: { backgroundColor: "transparent" },
    title: { flex: 1, color: t.ink, fontSize: 13, fontWeight: "400" },
    secondaryTitle: { color: t.inkMuted },
    pressed: { backgroundColor: t.fieldOnChrome },
    folder: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 8,
      gap: 6,
    },
    folderExpanded: { minHeight: 38, paddingHorizontal: 8 },
    folderRail: { width: 44, height: 44, justifyContent: "center" },
    folderSelected: { backgroundColor: t.fieldOnChrome },
    folderGlyph: {
      width: 26,
      height: 26,
      alignItems: "center",
      justifyContent: "center",
    },
    folderDot: {
      position: "absolute",
      left: 0,
      bottom: 0,
      width: 5,
      height: 5,
      borderRadius: 3,
      backgroundColor: t.accentStrong,
    },
    count: { color: t.inkMuted, fontSize: 11, fontVariant: ["tabular-nums"] },
    railCount: {
      position: "absolute",
      right: 1,
      bottom: 1,
      backgroundColor: t.sidebar,
      borderRadius: 4,
      paddingHorizontal: 3,
    },
    menu: {
      position: "absolute",
      padding: 6,
      borderRadius: 12,
      backgroundColor: t.surfaceElevated,
      borderWidth: 1,
      borderColor: t.hairline,
    },
    menuHeading: { flexDirection: "row", alignItems: "center", paddingLeft: 8 },
    menuTitle: { flex: 1, color: t.inkMuted, fontSize: 12, fontWeight: "500" },
    menuIcon: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    menuScroll: { flexGrow: 0, flexShrink: 1 },
    choiceRow: { flexDirection: "row", alignItems: "center", borderRadius: 8 },
    choiceSelected: { backgroundColor: t.sunken },
    choice: {
      flex: 1,
      minHeight: 56,
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      paddingHorizontal: 8,
      paddingVertical: 7,
      borderRadius: 8,
    },
    choiceIcon: { width: 24, alignItems: "center" },
    choiceCopy: { flex: 1, minWidth: 0, gap: 3 },
    detail: { color: t.inkMuted, fontSize: 11 },
    empty: { padding: 12, color: t.inkMuted, fontSize: 13 },
    menuActions: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.hairline,
      marginTop: 4,
      paddingTop: 4,
    },
    action: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      paddingHorizontal: 9,
      borderRadius: 8,
    },
  });
