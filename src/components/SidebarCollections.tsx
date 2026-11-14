import React, { useCallback } from "react";
import {
  Pressable,
  FlatList,
  Text,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { Badge, Separator } from "@unikit-bridge/ui";
import { SidebarPressable } from "@/chrome/SidebarInteraction";
import { ContextPressable } from "@/chrome/ContextPressable";
import { ChromeIcon, type IconName } from "@/chrome/ChromeIcon";
import { AnchoredMenuSurface } from "@/components/AnchoredMenuSurface";
import type { MenuAnchor } from "@/menuLayout";
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
  "flex-row items-center bg-field-on-chrome border border-transparent rounded-[9px] active:bg-pill",
  {
    variants: {
      collapsed: {
        true: "size-[36px] justify-center",
        false: "min-h-[46px] px-md py-sm gap-md my-xs",
      },
    },
  }
);
const folderItemVariants = cva(
  "flex-row items-center rounded-[8px] gap-sm active:bg-field-on-chrome border border-transparent",
  {
    variants: {
      collapsed: {
        true: "size-[36px] justify-center",
        false: "min-h-tab-row px-md",
      },
      selected: { true: "bg-field-on-chrome border-transparent", false: "" },
    },
  }
);
const stackedIconVariants = cva(
  "absolute size-[22px] rounded-[6px] items-center justify-center border",
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
  stack: "size-[32px] shrink-0",
  splitTitles: "flex-1 min-w-0 gap-[2px]",
  titleLine: "flex-row items-center gap-[5px]",
  focusDot: "size-sm rounded-full bg-accent-strong",
  title: "flex-1 text-ink text-body font-normal",
  secondaryTitle: "text-ink-muted",
  folderGlyph: "size-[20px] items-center justify-center",
  folderDot: "size-[5px] rounded-full bg-accent-strong",
  countBadge:
    "h-[18px] px-[6px] py-0 rounded-full bg-field-on-chrome border-transparent",
  countText: "text-ink-faint text-micro font-semibold tabular-nums",
  railCount:
    "absolute right-[1px] bottom-[1px] bg-surface-elevated border border-tile-border rounded-[4px] px-[3px]",
  menuIcon: "size-[32px] rounded-[8px] items-center justify-center active:bg-sunken",
  menuScroll: "grow-0 shrink",
  choiceRow: "flex-row items-center rounded-[8px]",
  choiceSelected: "bg-sunken",
  choice:
    "flex-1 min-h-[48px] flex-row items-center gap-lg px-lg py-sm rounded-[8px] active:bg-field-on-chrome",
  choiceIcon: "w-[22px] items-center",
  choiceCopy: "flex-1 min-w-0 gap-xs",
  detail: "text-ink-muted text-small",
  empty: "p-xxl text-ink-faint text-body",
  menuActions: "mt-xs pt-xs gap-[2px]",
  action:
    "min-h-[38px] flex-row items-center gap-lg px-xl rounded-[8px] active:bg-sunken",
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
              size={16}
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
            collapsed ? "size-[18px]" : "size-[15px]",
            containsFocused ? "text-accent-strong" : "text-icon"
          )}
        />
      </View>
      {!collapsed && (
        <Text
          numberOfLines={1}
          className={cn(
            collectionClasses.title,
            open || containsFocused
              ? "text-ink font-medium"
              : "text-ink-muted font-normal"
          )}
        >
          {title}
        </Text>
      )}
      {!collapsed && containsFocused && (
        <View className={collectionClasses.folderDot} />
      )}
      {collapsed ? (
        <View className={collectionClasses.railCount}>
          <Text className={collectionClasses.countText}>
            {compactCount(count)}
          </Text>
        </View>
      ) : (
        <Badge variant="secondary" className={collectionClasses.countBadge}>
          <Text className={collectionClasses.countText}>
            {compactCount(count)}
          </Text>
        </Badge>
      )}
      {!collapsed && (
        <ChromeIcon
          name={open ? "chevronDown" : "chevronRight"}
          className="size-[11px] text-ink-faint"
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
  const renderPage = useCallback(
    ({ item }: ListRenderItemInfo<SidebarPageChoice>) => (
      <SidebarPageRow page={item} onClose={onClose} />
    ),
    [onClose]
  );
  return (
    <AnchoredMenuSurface
      title={title}
      anchor={anchor}
      preferredWidth={300}
      estimatedHeight={52 + pages.length * 52 + actions.length * 40}
      onClose={onClose}
      closeClassName={collectionClasses.menuIcon}
      closeIconSize={15}
    >
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
              <Separator className="mb-xs w-auto mx-xs bg-tile-border" />
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
    </AnchoredMenuSurface>
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
