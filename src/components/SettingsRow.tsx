import React, { useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useTheme } from "../themeContext";
import { useI18n } from "../i18nContext";

/** A settings row owns presentation only; callers still own state and persistence. */
export function SettingsRow({
  title,
  summary,
  value,
  help,
  children,
}: {
  title: string;
  summary?: string;
  value?: string;
  help?: string;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const { tr } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [panelWidth, setPanelWidth] = useState(0);
  const horizontal = panelWidth >= 600 && fontScale < 1.4;
  return (
    <View
      onLayout={({ nativeEvent }) => setPanelWidth(nativeEvent.layout.width)}
      style={{
        flexDirection: horizontal ? "row" : "column",
        gap: 10,
        minHeight: 56,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.hairline,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={{ color: theme.ink, fontSize: 16, fontWeight: "600" }}>
          {title}
        </Text>
        {!!summary && (
          <Text style={{ color: theme.inkMuted, fontSize: 14, lineHeight: 20 }}>
            {summary}
          </Text>
        )}
        {!!help && (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => setExpanded(!expanded)}
              style={{ minHeight: 48, justifyContent: "center" }}
            >
              <Text style={{ color: theme.accent, fontSize: 14 }}>
                {tr(expanded ? "common.hideDetails" : "common.moreDetails")}
              </Text>
            </Pressable>
            {expanded && (
              <Text
                style={{ color: theme.inkMuted, fontSize: 14, lineHeight: 21 }}
              >
                {help}
              </Text>
            )}
          </>
        )}
      </View>
      {(value || children) && (
        <View
          style={{
            gap: 8,
            alignItems: horizontal ? "flex-end" : "flex-start",
            justifyContent: "center",
            maxWidth: "100%",
            flexShrink: 1,
          }}
        >
          {!!value && (
            <Text style={{ color: theme.inkMuted, fontSize: 14 }}>{value}</Text>
          )}
          {children}
        </View>
      )}
    </View>
  );
}
