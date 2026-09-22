import React from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useTheme } from "../themeContext";
import { useI18n } from "../i18nContext";
import { alpha } from "../theme";
import type { ExtensionToolbarAction } from "../browserExtensionActions";

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
  const t = useTheme();
  const { tr } = useI18n();
  if (actions.length === 0) return null;
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
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
          style={({ pressed }) => ({
            width: 32,
            height: 32,
            borderRadius: 8,
            alignItems: "center",
            justifyContent: "center",
            opacity: action.actionEnabled
              ? pressed
                ? alpha.pressed
                : 1
              : alpha.disabled,
          })}
        >
          {action.icon !== "" ? (
            <Image
              source={{ uri: action.icon }}
              style={{ width: 24, height: 24, borderRadius: 6 }}
            />
          ) : (
            <View
              style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: t.sunken,
                borderWidth: 1,
                borderColor: t.hairline,
              }}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "600",
                  color: t.ink,
                }}
              >
                {(action.name.trim().slice(0, 1) || "?").toUpperCase()}
              </Text>
            </View>
          )}
          {action.badge !== "" && (
            <View
              style={{
                position: "absolute",
                right: -1,
                bottom: -1,
                maxWidth: 30,
                borderRadius: 7,
                paddingHorizontal: 3,
                backgroundColor: action.badgeBackgroundColor || t.accent,
                borderWidth: 1,
                borderColor: t.surface,
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 9,
                  fontWeight: "700",
                  color: action.badgeTextColor || t.surfaceElevated,
                }}
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
