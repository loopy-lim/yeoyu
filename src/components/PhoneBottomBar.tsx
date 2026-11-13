import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { AddressTrigger } from "@/components/AddressTrigger";
import { ExtensionActionsBar } from "@/components/ExtensionActionsBar";
import { Favicon } from "@/components/Favicon";
import { ChromeIcon, type IconName } from "@/chrome/ChromeIcon";
import { appClasses } from "@/chrome/appStyles";
import { useI18n } from "@/i18nContext";
import { cn } from "@/ui/cn";
import { controlVariants } from "@/ui/variants";
import type { ExtensionToolbarAction } from "@/browserExtensionActions";
import type { BrowserSecurity } from "@/hooks/useBrowserWorkflows";

// Same target math as the compact toolbar's IconButton: a 32dp visual with
// hitSlop 8 reaches 48dp inside the 44dp h-toolbar row (issue #24 pattern).
// The press stays a plain Pressable like the rail items — no scale spring.
function BarButton({
  label,
  icon,
  onPress,
  disabled = false,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      className={cn(
        controlVariants({ size: "icon", disabled }),
        "active:opacity-pressed"
      )}
    >
      <ChromeIcon name={icon} />
    </Pressable>
  );
}

// Phone compact chrome (issue #19), bottom mode: the canvasToolbar row
// docks at the screen bottom instead of the content top. Back, forward,
// reload/stop, extension actions and the address pill mirror that row; the
// trailing Space button opens the bottom sheet.
export function PhoneBottomBar({
  canGoBack,
  canGoForward,
  loading,
  onBack,
  onForward,
  onReloadStop,
  url,
  security,
  extensionActions,
  onOpenExtensionAction,
  onAddressPress,
  onOpenSpaces,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  onBack: () => void;
  onForward: () => void;
  onReloadStop: () => void;
  url: string;
  security: BrowserSecurity | undefined;
  extensionActions: ExtensionToolbarAction[];
  onOpenExtensionAction: (
    action: ExtensionToolbarAction,
    anchor: { x: number; y: number }
  ) => void;
  onAddressPress: () => void;
  onOpenSpaces: () => void;
}) {
  const { tr } = useI18n();
  return (
    <View className={appClasses.phoneBottomBar}>
      <View className={appClasses.compactNavigation}>
        <BarButton
          label={tr("chrome.back")}
          icon="back"
          onPress={onBack}
          disabled={!canGoBack}
        />
        <BarButton
          label={tr("chrome.forward")}
          icon="forward"
          onPress={onForward}
          disabled={!canGoForward}
        />
        <BarButton
          label={tr(loading ? "chrome.stop" : "chrome.reload")}
          icon={loading ? "close" : "reload"}
          onPress={onReloadStop}
        />
        <AddressTrigger
          compact
          url={url}
          security={security}
          onPress={onAddressPress}
        />
        <ExtensionActionsBar
          actions={extensionActions}
          onOpen={onOpenExtensionAction}
        />
      </View>
      <BarButton
        label={tr("chrome.openSpaces")}
        icon="space"
        onPress={onOpenSpaces}
      />
    </View>
  );
}

export interface HybridBarTab {
  id: string;
  title: string;
  url: string;
  active: boolean;
  playing: boolean;
}

// Phone compact chrome (issue #19), hybrid mode: the top canvasToolbar
// keeps navigation and the address pill while this bottom strip puts tab
// switching, new tab, settings and Space selection within thumb reach.
export function PhoneHybridBar({
  tabs,
  onSelectTab,
  onLongPressTab,
  onNewTab,
  onOpenSettings,
  onOpenSpaces,
}: {
  tabs: HybridBarTab[];
  onSelectTab: (id: string) => void;
  onLongPressTab?: (id: string, x: number, y: number) => void;
  onNewTab: () => void;
  onOpenSettings: () => void;
  onOpenSpaces: () => void;
}) {
  const { tr } = useI18n();
  return (
    <View className={appClasses.phoneBottomBar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className={appClasses.phoneHybridTabs}
        contentContainerClassName={appClasses.phoneHybridTabsContent}
      >
        {tabs.map((tab) => (
          <Pressable
            key={tab.id}
            accessibilityRole="button"
            accessibilityLabel={tr("chrome.tabNamed", { name: tab.title })}
            accessibilityState={{ selected: tab.active }}
            hitSlop={{ top: 5, bottom: 5, left: 2, right: 2 }}
            onPress={() => onSelectTab(tab.id)}
            onLongPress={
              onLongPressTab
                ? (event) =>
                    onLongPressTab(
                      tab.id,
                      event.nativeEvent.pageX,
                      event.nativeEvent.pageY
                    )
                : undefined
            }
            className={cn(
              appClasses.phoneHybridTab,
              tab.active && appClasses.phoneHybridTabActive
            )}
          >
            {tab.playing ? (
              <ChromeIcon name="play" className="size-[16px]" />
            ) : (
              <Favicon
                url={tab.url}
                fallback={tab.title.slice(0, 1).toUpperCase()}
                size={16}
                radius={4}
              />
            )}
            {tab.active && (
              <Text numberOfLines={1} className={appClasses.phoneHybridTabLabel}>
                {tab.title}
              </Text>
            )}
          </Pressable>
        ))}
      </ScrollView>
      <BarButton
        label={tr("chrome.newTab")}
        icon="plus"
        onPress={onNewTab}
      />
      <BarButton
        label={tr("chrome.settings")}
        icon="settings"
        onPress={onOpenSettings}
      />
      <BarButton
        label={tr("chrome.openSpaces")}
        icon="space"
        onPress={onOpenSpaces}
      />
    </View>
  );
}
