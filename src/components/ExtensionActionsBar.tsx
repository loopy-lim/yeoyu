import React from "react";
import { Image, Pressable, Text, View } from "react-native";
import { cva } from "class-variance-authority";
import { cn } from "@/ui/cn";
import { useI18n } from "@/i18nContext";
import type { ExtensionToolbarAction } from "@/browserExtensionActions";

const extensionButtonVariants = cva("size-icon-button rounded-[8px] items-center justify-center", {
  variants: { enabled: { true: "active:opacity-pressed", false: "opacity-disabled" } },
});

/** Chrome-style extension action buttons: the engine-provided icon (falling
 * back to a letter tile until the bitmap arrives), the engine badge with its
 * own colors, disabled (not removed) when the action is unavailable here. */
export function ExtensionActionsBar({
  actions,
  onOpen,
}: {
  actions: ExtensionToolbarAction[];
  onOpen: (action: ExtensionToolbarAction, anchor: { x: number; y: number }) => void;
}) {
  const { tr } = useI18n();
  if (actions.length === 0) return null;
  return (
    <View
      className="flex-row items-center gap-md"
      accessibilityRole="toolbar"
    >
      {actions.map((action) => (
        <Pressable
          key={action.id}
          accessibilityRole="button"
          accessibilityLabel={tr("extension.actionOpen", { name: action.name })}
          accessibilityState={{ disabled: !action.actionEnabled }}
          disabled={!action.actionEnabled}
          hitSlop={8}
          onPress={(event) =>
            onOpen(action, {
              x: event.nativeEvent.pageX,
              y: event.nativeEvent.pageY,
            })
          }
          className={cn(extensionButtonVariants({ enabled: action.actionEnabled }))}
        >
          {action.icon !== "" ? (
            <Image
              source={{ uri: action.icon }}
              className="size-[24px] rounded-[6px]"
            />
          ) : (
            <View
              className="size-[26px] rounded-[7px] items-center justify-center bg-sunken border border-hairline"
            >
              <Text
                className="text-input font-semibold text-ink"
              >
                {(action.name.trim().slice(0, 1) || "?").toUpperCase()}
              </Text>
            </View>
          )}
          {action.badge !== "" && (
            <View
              className={cn("absolute right-[-1px] bottom-[-1px] max-w-[30px] rounded-[7px] px-[3px] border border-surface", !action.badgeBackgroundColor && "bg-accent")}
              // Engine-defined badge colors are extension data, not theme roles.
              style={action.badgeBackgroundColor ? { backgroundColor: action.badgeBackgroundColor } : undefined}
            >
              <Text
                numberOfLines={1}
                className={cn("text-micro font-bold", !action.badgeTextColor && "text-surface-elevated")}
                style={action.badgeTextColor ? { color: action.badgeTextColor } : undefined}
              >
                {action.badge.slice(0, 4)}
              </Text>
            </View>
          )}
        </Pressable>
      ))}
    </View>
  );
}
