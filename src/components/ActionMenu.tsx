import React from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { ChromeIcon, type IconName } from "@/chrome/ChromeIcon";
import { AnchoredMenuSurface } from "@/components/AnchoredMenuSurface";
import type { MenuAnchor } from "@/menuLayout";
import { cva } from "class-variance-authority";
import { cn } from "@/ui/cn";

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
  return (
    <AnchoredMenuSurface
      title={title}
      anchor={anchor}
      preferredWidth={280}
      estimatedHeight={44 + items.length * 40}
      onClose={onClose}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        className="grow-0 shrink"
        contentContainerClassName="pb-md"
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
    </AnchoredMenuSurface>
  );
}
