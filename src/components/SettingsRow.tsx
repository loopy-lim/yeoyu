import React, { useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { cva } from "class-variance-authority";
import { cn } from "@/ui/cn";
import { useI18n } from "@/i18nContext";

const rowClasses = cva("gap-lg min-h-[54px] px-xxl py-lg", {
  variants: {
    horizontal: { true: "flex-row items-center", false: "flex-col" },
    last: { true: "", false: "border-b-hairline-width border-b-hairline" },
  },
});
const labelClasses = cva("min-w-0 gap-xs", {
  variants: { horizontal: { true: "flex-1", false: "w-full" } },
});
const controlClasses = cva("gap-md justify-center max-w-full shrink", {
  variants: { horizontal: { true: "items-end", false: "items-start" } },
});

/** A settings row owns presentation only; callers still own state and persistence. */
export function SettingsRow({
  title,
  summary,
  value,
  help,
  last = false,
  children,
}: {
  title: string;
  summary?: string;
  value?: string;
  help?: string;
  last?: boolean;
  children?: React.ReactNode;
}) {
  const { fontScale } = useWindowDimensions();
  const { tr } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [panelWidth, setPanelWidth] = useState(0);
  const horizontal = panelWidth >= 460 && fontScale < 1.4;
  return (
    <View
      onLayout={({ nativeEvent }) => setPanelWidth(nativeEvent.layout.width)}
      className={cn(rowClasses({ horizontal, last }))}
    >
      <View className={cn(labelClasses({ horizontal }))}>
        <Text className="text-ink text-input-plus font-semibold leading-[21px]">
          {title}
        </Text>
        {!!summary && (
          <Text className="text-ink-muted text-body leading-[19px]">
            {summary}
          </Text>
        )}
        {!!help && (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => setExpanded(!expanded)}
              className="min-h-[36px] justify-center active:opacity-pressed"
            >
              <Text className="text-accent-strong text-body font-medium">
                {tr(expanded ? "common.hideDetails" : "common.moreDetails")}
              </Text>
            </Pressable>
            {expanded && (
              <Text className="text-ink-muted text-body leading-[19px]">
                {help}
              </Text>
            )}
          </>
        )}
      </View>
      {(value || children) && (
        <View className={cn(controlClasses({ horizontal }))}>
          {!!value && (
            <Text className="text-ink-muted text-body">{value}</Text>
          )}
          {children}
        </View>
      )}
    </View>
  );
}
