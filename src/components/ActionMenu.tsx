import React, { useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { ChromeIcon, type IconName } from "../chrome/ChromeIcon";
import { menuPosition, type MenuAnchor } from "../menuLayout";
import { useTheme } from "../themeContext";

export type { MenuAnchor } from "../menuLayout";
export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
  shortcut?: string;
}

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
  const t = useTheme();
  const window = useWindowDimensions();
  const [height, setHeight] = useState(44 + items.length * 40);
  const position = menuPosition(anchor, window, 280, height);
  return (
    <View
      accessibilityViewIsModal
      accessibilityLabel={title}
      onLayout={({ nativeEvent }) => setHeight(nativeEvent.layout.height)}
      style={{
        position: "absolute",
        ...position,
        padding: 6,
        borderRadius: 12,
        backgroundColor: t.surfaceElevated,
        borderWidth: 1,
        borderColor: t.hairline,
        shadowColor: t.ringShadow,
        shadowRadius: 18,
        shadowOpacity: 0.2,
        shadowOffset: { width: 0, height: 6 },
        elevation: 12,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: 36,
          paddingLeft: 8,
        }}
      >
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            color: t.inkMuted,
            fontSize: 12,
            fontWeight: "600",
          }}
        >
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Close ${title} menu`}
          onPress={onClose}
          hitSlop={4}
          style={{
            width: 32,
            height: 32,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ChromeIcon name="close" size={14} color={t.icon} />
        </Pressable>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ flexGrow: 0, flexShrink: 1 }}
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
            style={({ pressed }) => ({
              minHeight: 40,
              paddingHorizontal: 10,
              borderRadius: 7,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              backgroundColor: pressed ? t.sunken : "transparent",
              opacity: item.disabled ? 0.38 : 1,
            })}
          >
            <ChromeIcon
              name={item.icon ?? "chevronRight"}
              size={16}
              color={item.destructive ? t.errorInk : t.icon}
            />
            <Text
              style={{
                color: item.destructive ? t.errorInk : t.ink,
                fontSize: 13,
                flex: 1,
              }}
            >
              {item.label}
            </Text>
            {item.shortcut && (
              <Text style={{ color: t.inkMuted, fontSize: 11 }}>
                {item.shortcut}
              </Text>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
