import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
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
  dividerBefore?: boolean;
}

const menuRowVariants = cva(
  "min-h-[40px] px-xl rounded-control flex-row items-center gap-lg bg-transparent active:bg-sunken",
  {
    variants: { disabled: { true: "opacity-disabled", false: "" } },
    defaultVariants: { disabled: false },
  }
);

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
      estimatedHeight={52 + items.length * 40}
      onClose={onClose}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        className="grow-0 shrink"
        contentContainerClassName="pb-xs gap-[2px]"
      >
        {items.map((item, index) => (
          <React.Fragment key={item.id}>
            {item.dividerBefore && index > 0 && (
              <View className="h-hairline-width bg-hairline my-xs mx-sm" />
            )}
            <Pressable
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
                className={cn(
                  "size-[16px]",
                  item.destructive ? "text-error-ink" : "text-icon"
                )}
              />
              <Text
                numberOfLines={1}
                className={cn(
                  "text-body-plus font-medium flex-1",
                  item.destructive ? "text-error-ink" : "text-ink"
                )}
              >
                {item.label}
              </Text>
              {item.shortcut && (
                <View className="px-sm py-[2px] rounded-chip bg-sunken border border-hairline">
                  <Text className="text-ink-faint text-small font-medium">
                    {item.shortcut}
                  </Text>
                </View>
              )}
            </Pressable>
          </React.Fragment>
        ))}
      </ScrollView>
    </AnchoredMenuSurface>
  );
}
