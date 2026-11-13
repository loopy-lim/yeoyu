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
import { cn } from "@/ui/cn";
import { useI18n } from "@/i18nContext";

/**
 * Shared anchored popover menu surface: unifies IME dismissal, window-clamped
 * `computeAnchoredPosition` measurement, modal focus-trap flagging, and header
 * close affordance across ActionMenu and SidebarPageMenu.
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
  const [height, setHeight] = useState(estimatedHeight);
  const position = computeAnchoredPosition(
    anchor,
    window,
    preferredWidth,
    height,
    { placement, align, offset, inset }
  );
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
        "absolute p-md rounded-control bg-surface-elevated border border-hairline shadow-action-menu",
        className
      )}
      // Anchored placement tracks the measured menu and native window bounds.
      style={position}
    >
      <View
        className={cn(
          "flex-row items-center min-h-rail-item pl-lg",
          headerClassName
        )}
      >
        <Text
          numberOfLines={1}
          className={cn(
            "flex-1 text-ink-muted text-body-plus font-semibold",
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
            "size-icon-button items-center justify-center",
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
