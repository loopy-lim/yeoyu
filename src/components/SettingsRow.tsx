import React, { useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { cva } from "class-variance-authority";
import { cn } from "@/ui/cn";
import { useI18n } from "@/i18nContext";

const rowClasses = cva("gap-xl min-h-[56px] py-xxl border-b border-hairline", {
  variants: { horizontal: { true: "flex-row", false: "flex-col" } },
});
const controlClasses = cva("gap-lg justify-center max-w-full shrink", {
  variants: { horizontal: { true: "items-end", false: "items-start" } },
});

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
  const { fontScale } = useWindowDimensions();
  const { tr } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [panelWidth, setPanelWidth] = useState(0);
  const horizontal = panelWidth >= 600 && fontScale < 1.4;
  return (
    <View
      onLayout={({ nativeEvent }) => setPanelWidth(nativeEvent.layout.width)}
      className={cn(rowClasses({ horizontal }))}
    >
      <View className="flex-1 min-w-0 gap-sm">
        <Text className="text-ink text-icon-size font-semibold">{title}</Text>
        {!!summary && (
          <Text className="text-ink-muted text-input-plus leading-[20px]">
            {summary}
          </Text>
        )}
        {!!help && (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => setExpanded(!expanded)}
              className="min-h-action-row justify-center active:opacity-pressed"
            >
              <Text className="text-accent text-input-plus">
                {tr(expanded ? "common.hideDetails" : "common.moreDetails")}
              </Text>
            </Pressable>
            {expanded && (
              <Text className="text-ink-muted text-input-plus leading-[21px]">
                {help}
              </Text>
            )}
          </>
        )}
      </View>
      {(value || children) && (
        <View className={cn(controlClasses({ horizontal }))}>
          {!!value && (
            <Text className="text-ink-muted text-input-plus">{value}</Text>
          )}
          {children}
        </View>
      )}
    </View>
  );
}
