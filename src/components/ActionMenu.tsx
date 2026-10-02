import React, { useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { ChromeIcon, type IconName } from "@/chrome/ChromeIcon";
import { menuPosition, type MenuAnchor } from "@/menuLayout";
import { cva } from "class-variance-authority";
import { cn } from "@/ui/cn";
import { useI18n } from "@/i18nContext";

export type { MenuAnchor } from "@/menuLayout";
export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
  shortcut?: string;
}

const menuRowVariants = cva("min-h-favorite px-xl rounded-[7px] flex-row items-center gap-xl bg-transparent active:bg-sunken", {
  variants: { disabled: { true: "opacity-disabled", false: "" } },
  defaultVariants: { disabled: false },
});

export function ActionMenu({
  title,
  anchor,
  items,
  onClose,
}: {
  title: string;
  anchor?: MenuAnchor;
  items: MenuItem[];
  onClose: () => void;
}) {
  const { tr } = useI18n();
  const window = useWindowDimensions();
  const [height, setHeight] = useState(44 + items.length * 40);
  const position = menuPosition(anchor, window, 280, height);
  return (
    <View
      accessibilityViewIsModal
      accessibilityLabel={title}
      onLayout={({ nativeEvent }) => setHeight(nativeEvent.layout.height)}
      className="absolute p-md rounded-tile bg-surface-elevated border border-hairline shadow-action-menu"
      // Placement depends on the measured menu and current native window.
      style={position}
    >
      <View
        className="flex-row items-center min-h-rail-item pl-lg"
      >
        <Text
          numberOfLines={1}
          className="flex-1 text-ink-muted text-body-plus font-semibold"
        >
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("dialog.closeMenu", { title })}
          onPress={onClose}
          hitSlop={8}
          className="size-icon-button items-center justify-center"
        >
          <ChromeIcon name="close" className="size-[14px] text-icon" />
        </Pressable>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        className="grow-0 shrink"
      >
        {items.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ disabled: !!item.disabled }}
            disabled={item.disabled}
            onPress={() => {
              onClose();
              item.onPress();
            }}
            className={cn(menuRowVariants({ disabled: !!item.disabled }))}
          >
            <ChromeIcon
              name={item.icon ?? "chevronRight"}
              className={cn("size-[16px]", item.destructive ? "text-error-ink" : "text-icon")}
            />
            <Text
              className={cn("text-input flex-1", item.destructive ? "text-error-ink" : "text-ink")}
            >
              {item.label}
            </Text>
            {item.shortcut && (
              <Text className="text-ink-muted text-body">
                {item.shortcut}
              </Text>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
