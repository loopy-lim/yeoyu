import React, { useCallback, useState } from "react";
import {
  Pressable,
  FlatList,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
} from "react-native";
import { SidebarPressable } from "@/chrome/SidebarInteraction";
import { ContextPressable } from "@/chrome/ContextPressable";
import { ChromeIcon, type IconName } from "@/chrome/ChromeIcon";
import { menuPosition, type MenuAnchor } from "@/menuLayout";
import { sidebarAddressLabel } from "@/sidebarModel";
import type { SidebarSplit } from "@/sidebarPresentation";
import { cva } from "class-variance-authority";
import { cn } from "@/ui/cn";
import { useI18n } from "@/i18nContext";
import { Favicon } from "@/components/Favicon";

const pageTitle = (page: { title: string; url: string }) =>
  page.title || sidebarAddressLabel(page.url) || "New tab";
const compactCount = (count: number) => (count > 99 ? "99+" : String(count));
const splitItemVariants = cva(
  "flex-row items-center bg-pill rounded-control active:bg-field-on-chrome",
  {
    variants: {
      collapsed: {
        true: "size-input justify-center",
        false: "min-h-[52px] px-lg py-md gap-lg my-[3px]",
      },
    },
  }
);
const folderItemVariants = cva(
  "flex-row items-center rounded-[8px] gap-md active:bg-field-on-chrome",
  {
    variants: {
      collapsed: {
        true: "size-input justify-center",
        false: "min-h-tile px-lg",
      },
      selected: { true: "bg-field-on-chrome", false: "" },
    },
  }
);
const stackedIconVariants = cva(
  "absolute size-[24px] rounded-[6px] items-center justify-center border",
  {
    variants: {
      front: {
        true: "bottom-0 right-0 bg-surface-elevated border-accent-strong",
        false: "top-0 left-0 bg-sidebar border-hairline-on-chrome",
      },
    },
  }
);
const collectionClasses = {
  stack: "size-address shrink-0",
  splitTitles: "flex-1 min-w-0 gap-xs",
  titleLine: "flex-row items-center gap-[5px]",
  focusDot: "size-sm rounded-[2px] bg-accent-strong",
  title: "flex-1 text-ink text-input font-normal",
  secondaryTitle: "text-ink-muted",
  folderGlyph: "size-[26px] items-center justify-center",
  folderDot:
    "absolute left-0 bottom-0 size-[5px] rounded-[3px] bg-accent-strong",
  count: "text-ink-muted text-body tabular-nums",
  railCount:
    "absolute right-[1px] bottom-[1px] bg-sidebar rounded-[4px] px-[3px]",
  menu: "absolute p-md rounded-tile bg-surface-elevated border border-hairline",
  menuHeading: "flex-row items-center pl-lg",
  menuTitle: "flex-1 text-ink-muted text-body-plus font-medium",
  menuIcon: "size-input items-center justify-center",
  menuScroll: "grow-0 shrink",
  choiceRow: "flex-row items-center rounded-[8px]",
  choiceSelected: "bg-sunken",
  choice:
    "flex-1 min-h-[56px] flex-row items-center gap-[9px] px-lg py-[7px] rounded-[8px] active:bg-field-on-chrome",
  choiceIcon: "w-[24px] items-center",
  choiceCopy: "flex-1 min-w-0 gap-[3px]",
  detail: "text-ink-muted text-body",
  empty: "p-xxl text-ink-muted text-input",
  menuActions: "border-t-hairline-width border-hairline mt-sm pt-sm",
  action:
    "min-h-input flex-row items-center gap-[9px] px-[9px] rounded-[8px] active:bg-field-on-chrome",
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
      className={cn(splitItemVariants({ collapsed }))}
    >
      <View
        className={collectionClasses.stack}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {[back, front].map((page, index) => (
          <View
            key={page.id}
            testID={index ? "split-favicon-front" : "split-favicon-back"}
            accessibilityLabel={pageTitle(page)}
            className={cn(stackedIconVariants({ front: !!index }))}
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
          <View className={collectionClasses.splitTitles}>
            {split.pages.map((page) => (
              <View key={page.id} className={collectionClasses.titleLine}>
                <View
                  className={cn(
                    collectionClasses.focusDot,
                    page.id !== split.focusedId && "bg-transparent"
                  )}
                />
                <Text
                  numberOfLines={1}
                  className={cn(
                    collectionClasses.title,
                    page.id !== split.focusedId &&
                      collectionClasses.secondaryTitle
                  )}
                >
                  {pageTitle(page)}
                </Text>
              </View>
            ))}
          </View>
          <ChromeIcon
            name={front.private ? "private" : "chevronDown"}
            className="size-[13px] text-ink-muted"
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
  return (
    <ContextPressable
      accessibilityRole="button"
      accessibilityLabel={`${
        collapsed ? "Open" : open ? "Collapse" : "Expand"
      } folder ${title}, ${count} pages${
        containsFocused ? ", contains selected page" : ""
      }`}
      accessibilityState={{ expanded: open, selected: containsFocused }}
      className={cn(
        folderItemVariants({ collapsed, selected: containsFocused })
      )}
      onPress={onPress}
      onContextMenu={onContextMenu}
      contextOpen={contextOpen}
    >
      <View className={collectionClasses.folderGlyph}>
        <ChromeIcon
          name={open ? "folderOpen" : "folder"}
          className={cn(
            collapsed ? "size-[25px]" : "size-[22px]",
            containsFocused ? "text-accent-strong" : "text-icon"
          )}
        />
        {containsFocused && <View className={collectionClasses.folderDot} />}
      </View>
      {!collapsed && (
        <Text numberOfLines={1} className={collectionClasses.title}>
          {title}
        </Text>
      )}
      <Text
        className={cn(
          collectionClasses.count,
          collapsed && collectionClasses.railCount
        )}
      >
        {compactCount(count)}
      </Text>
      {!collapsed && (
        <ChromeIcon
          name={open ? "chevronDown" : "chevronRight"}
          className="size-[11px] text-ink-muted"
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
      className={collectionClasses.menu}
      // Anchored placement tracks the measured menu and native window bounds.
      style={menuPosition(anchor, window, 300, height)}
    >
      <View className={collectionClasses.menuHeading}>
        <Text numberOfLines={1} className={collectionClasses.menuTitle}>
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
          onPress={onClose}
          className={collectionClasses.menuIcon}
        >
          <ChromeIcon name="close" className="size-[16px]" />
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
        className={collectionClasses.menuScroll}
        ListEmptyComponent={
          <Text className={collectionClasses.empty}>
            {tr("collections.noSavedPages")}
          </Text>
        }
        ListFooterComponent={
          actions.length > 0 ? (
            <View className={collectionClasses.menuActions}>
              {actions.map((action) => (
                <Pressable
                  key={action.id}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  onPress={() => {
                    onClose();
                    action.onPress();
                  }}
                  className={collectionClasses.action}
                >
                  <ChromeIcon name={action.icon} className="size-[16px]" />
                  <Text className={collectionClasses.title}>
                    {action.label}
                  </Text>
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
  return (
    <View
      className={cn(
        collectionClasses.choiceRow,
        page.selected && collectionClasses.choiceSelected
      )}
    >
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
        className={collectionClasses.choice}
      >
        <View className={collectionClasses.choiceIcon}>
          <Favicon
            url={page.url}
            fallback={pageTitle(page).slice(0, 1).toUpperCase()}
            size={20}
            radius={4}
            persist={!page.private}
          />
        </View>
        <View className={collectionClasses.choiceCopy}>
          <Text numberOfLines={1} className={collectionClasses.title}>
            {pageTitle(page)}
          </Text>
          <Text numberOfLines={1} className={collectionClasses.detail}>
            {[page.detail, sidebarAddressLabel(page.url)]
              .filter(Boolean)
              .join(" · ") || "New tab"}
          </Text>
        </View>
        {page.selected && (
          <ChromeIcon name="check" className="size-[14px] text-accent-strong" />
        )}
      </Pressable>
      {page.onMenu && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Actions for ${pageTitle(page)}`}
          className={collectionClasses.menuIcon}
          onPress={({ nativeEvent }) => {
            onClose();
            page.onMenu?.({ x: nativeEvent.pageX, y: nativeEvent.pageY });
          }}
        >
          <ChromeIcon name="more" className="size-[17px]" />
        </Pressable>
      )}
    </View>
  );
}
