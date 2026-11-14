import React, { useEffect, useState } from "react";
import * as ReactNative from "react-native";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { ChromeIcon } from "@/chrome/ChromeIcon";
import {
  computeAnchoredPosition,
  type MenuAnchor,
  type OverlayAlign,
  type OverlayPlacement,
} from "@/menuLayout";
import { useSafeInsets } from "@/safeInsetsContext";
import { cn } from "@/ui/cn";
import { useI18n } from "@/i18nContext";

/**
 * Shared anchored popover menu surface: unifies IME dismissal, window-clamped
 * `computeAnchoredPosition` measurement, safe-area avoidance, modal focus-trap
 * flagging, and header close affordance across ActionMenu and SidebarPageMenu.
 */
export function AnchoredMenuSurface({
  title,
  anchor,
  preferredWidth = 280,
  estimatedHeight,
  placement = "bottom",
  align = "start",
  offset = 0,
  inset = 12,
  onClose,
  className,
  headerClassName,
  titleClassName,
  closeClassName,
  closeIconSize = 14,
  children,
}: {
  title: string;
  anchor?: MenuAnchor;
  preferredWidth?: number;
  estimatedHeight: number;
  placement?: OverlayPlacement;
  align?: OverlayAlign;
  offset?: number;
  inset?: number;
  onClose: () => void;
  className?: string;
  headerClassName?: string;
  titleClassName?: string;
  closeClassName?: string;
  closeIconSize?: number;
  children: React.ReactNode;
}) {
  const { tr } = useI18n();
  const window = useWindowDimensions();
  const safeInsets = useSafeInsets();
  const [height, setHeight] = useState(estimatedHeight);

  const boundedWindow = {
    width: Math.max(0, window.width - safeInsets.left - safeInsets.right),
    height: Math.max(0, window.height - safeInsets.top - safeInsets.bottom),
  };
  const adjustedAnchor = anchor
    ? { ...anchor, x: anchor.x - safeInsets.left, y: anchor.y - safeInsets.top }
    : undefined;
  const rawPosition = computeAnchoredPosition(
    adjustedAnchor,
    boundedWindow,
    preferredWidth,
    height,
    { placement, align, offset, inset }
  );
  const position = {
    left: rawPosition.left + safeInsets.left,
    top: rawPosition.top + safeInsets.top,
    width: rawPosition.width,
    maxHeight: rawPosition.maxHeight,
  };

  // Menus are tap-choose surfaces; an open IME otherwise covers lower rows.
  useEffect(() => {
    (
      ReactNative as { Keyboard?: { dismiss?: () => void } }
    ).Keyboard?.dismiss?.();
  }, []);

  return (
    <View
      accessibilityViewIsModal
      accessibilityLabel={title}
      onLayout={({ nativeEvent }) => setHeight(nativeEvent.layout.height)}
      className={cn(
        "absolute p-sm rounded-tile bg-surface-elevated border border-card-border shadow-action-menu",
        className
      )}
      // Anchored placement tracks the measured menu and native window bounds.
      style={position}
    >
      <View
        className={cn(
          "flex-row items-center min-h-[38px] pl-xl pr-xs pb-xs mb-xs border-b-hairline-width border-b-hairline",
          headerClassName
        )}
      >
        <Text
          numberOfLines={1}
          className={cn(
            "flex-1 text-ink-muted text-small font-bold tracking-[0.3px]",
            titleClassName
          )}
        >
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("dialog.closeMenu", { title })}
          onPress={onClose}
          hitSlop={8}
          className={cn(
            "size-[34px] rounded-control items-center justify-center active:bg-sunken",
            closeClassName
          )}
        >
          <ChromeIcon name="close" size={closeIconSize} className="text-icon" />
        </Pressable>
      </View>
      {children}
    </View>
  );
}
