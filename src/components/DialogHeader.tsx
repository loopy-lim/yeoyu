import React from "react";
import { Pressable, View } from "react-native";
import { ChromeIcon } from "@/chrome/ChromeIcon";
import { cn } from "@/ui/cn";

/**
 * Shared dialog header scaffold: optional leading back button, caller-supplied
 * title node, optional trailing actions, and accessible close control.
 */
export function DialogHeader({
  title,
  closeLabel,
  onClose,
  leading,
  children,
  className,
  closeClassName,
  closeIconSize = 16,
}: {
  title: React.ReactNode;
  closeLabel: string;
  onClose: () => void;
  leading?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  closeClassName?: string;
  closeIconSize?: number;
}) {
  return (
    <View className={cn("flex-row items-center", className)}>
      {leading}
      {title}
      {children}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        hitSlop={8}
        className={cn(
          "size-action-row rounded-control items-center justify-center",
          closeClassName
        )}
        onPress={onClose}
      >
        <ChromeIcon
          name="close"
          size={closeIconSize}
          className="text-icon"
        />
      </Pressable>
    </View>
  );
}
