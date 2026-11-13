import React from "react";
import { Pressable, View } from "react-native";
import { AddressTrigger } from "@/components/AddressTrigger";
import { ChromeIcon, type IconName } from "@/chrome/ChromeIcon";
import { appClasses } from "@/chrome/appStyles";
import { useI18n } from "@/i18nContext";
import { cn } from "@/ui/cn";
import { controlVariants } from "@/ui/variants";
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
// reload/stop and the address pill mirror that row; the trailing Space
// button opens the bottom sheet. Split stays out — phone split is a
// separate slice — and extension actions are not surfaced here yet.
export function PhoneBottomBar({
  canGoBack,
  canGoForward,
  loading,
  onBack,
  onForward,
  onReloadStop,
  url,
  security,
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
      </View>
      <BarButton
        label={tr("chrome.openSpaces")}
        icon="space"
        onPress={onOpenSpaces}
      />
    </View>
  );
}
