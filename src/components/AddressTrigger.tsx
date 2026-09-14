import React from "react";
import { Text, View } from "react-native";
import { SidebarPressable as Pressable } from "../chrome/SidebarInteraction";
import { alpha, font, radius, size, space } from "../theme";
import { ChromeIcon } from "../chrome/ChromeIcon";
import { useTheme } from "../themeContext";

// Display-only address pill for the sidebar nav row and the compact
// toolbar. It never takes text input: tapping it (like ⌘L) opens the
// centered editor dialog, the single input surface for addresses.
export function AddressTrigger({
  url,
  compact = false,
  onPress,
}: {
  url: string;
  compact?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const empty = url === "";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Edit address"
      accessibilityHint={
        empty
          ? "Opens search and address entry"
          : `Current site: ${url}. Opens the full address for editing.`
      }
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        compact
          ? {
              flex: 1,
              height: size.addressCompact,
              marginLeft: space.sm,
              paddingHorizontal: space.xl,
              borderRadius: radius.control,
              backgroundColor: t.sunken,
              justifyContent: "center",
            }
          : {
              // alignSelf stretch, not flex:1 — the trigger lives in the
              // sidebar's auto-height column now, where a flex basis of 0
              // would collapse it to nothing.
              alignSelf: "stretch",
              height: size.address,
              paddingHorizontal: space.xl,
              borderRadius: radius.control,
              backgroundColor: t.fieldOnChrome,
              justifyContent: "center",
            },
        pressed && { opacity: alpha.pressed },
      ]}
    >
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}
      >
        {empty && <ChromeIcon name="search" size={15} color={t.inkMuted} />}
        <Text
          numberOfLines={1}
          style={[
            {
              flex: 1,
              color: t.ink,
              fontSize: font.input,
            },
            empty && { color: t.inkFaint },
          ]}
        >
          {empty ? "Search or enter address" : url}
        </Text>
      </View>
    </Pressable>
  );
}
