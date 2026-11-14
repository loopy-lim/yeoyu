import React from "react";
import { Pressable, ScrollView, Text } from "react-native";
import { Kbd, Separator } from "@unikit-bridge/ui";
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
  "min-h-[38px] px-xl rounded-[8px] flex-row items-center gap-lg bg-transparent active:bg-sunken",
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
      estimatedHeight={52 + items.length * 38}
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
              <Separator className="my-xs w-auto mx-sm bg-tile-border" />
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
                  "size-[15px]",
                  item.destructive ? "text-error-ink" : "text-icon"
                )}
              />
              <Text
                numberOfLines={1}
                className={cn(
                  "text-body font-medium flex-1",
                  item.destructive ? "text-error-ink" : "text-ink"
                )}
              >
                {item.label}
              </Text>
              {item.shortcut && (
                <Kbd className="h-[22px] px-[6px] rounded-[5px] bg-sunken border border-hairline">
                  <Text className="text-[11px] leading-[14px] font-medium text-ink-faint">
                    {item.shortcut}
                  </Text>
                </Kbd>
              )}
            </Pressable>
          </React.Fragment>
        ))}
      </ScrollView>
    </AnchoredMenuSurface>
  );
}
