import React from "react";
import { Text, View } from "react-native";
import { cn } from "@/ui/cn";

// One visual system for settings surfaces: inset group cards under quiet
// headers, every radius and fill from the theme tokens. Panels compose these
// primitives instead of keeping private copies, so a section reads the same
// whether it lives in App.tsx or a panel component.

export const settingsClasses = {
  // Inset card that groups related rows. Rows inside carry their own
  // dividers, so the card only owns radius, fill, and clipping.
  group: "rounded-control bg-sunken border border-hairline overflow-hidden",
  // Quiet header above a group. Uppercase is a latin-only concern and a
  // no-op for Korean copy; letter spacing carries the hierarchy instead.
  groupHeader:
    "text-small font-bold text-ink-faint tracking-[0.6px] uppercase mt-xxl mb-sm px-lg",
  // Header attached to the first group (no top margin).
  groupHeaderFirst: "text-small font-bold text-ink-faint tracking-[0.6px] uppercase mb-sm px-lg",
  row: "min-h-[56px] flex-row flex-wrap items-center gap-xxl py-[14px] px-xxl border-b-hairline-width border-b-hairline",
  rowLast:
    "min-h-[56px] flex-row flex-wrap items-center gap-xxl py-[14px] px-xxl",
  rowTitle: "text-ink text-input-plus font-semibold leading-[21px]",
  rowDetail: "text-input-plus text-ink-muted leading-[21px]",
  action:
    "min-h-action-row justify-center px-xxl rounded-control bg-sunken active:opacity-pressed",
  actionSecondary:
    "min-h-action-row justify-center px-xxl rounded-control bg-surface-elevated active:opacity-pressed",
  field:
    "min-h-action-row rounded-control border border-hairline bg-sunken px-xxl text-ink text-input-plus",
  chip: "min-h-action-row px-xxl rounded-control border border-hairline justify-center bg-surface-elevated active:opacity-pressed",
} as const;

/** A titled group card. The heading is an already-translated string. */
export function SettingsGroup({
  heading,
  children,
  className,
}: {
  heading?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <View className={className}>
      {heading !== undefined && (
        <Text
          accessibilityRole="header"
          className={settingsClasses.groupHeader}
        >
          {heading}
        </Text>
      )}
      <View className={settingsClasses.group}>{children}</View>
    </View>
  );
}

/** Row inside a SettingsGroup; the last row drops its divider. */
export function SettingsGroupRow({
  last = false,
  children,
  className,
}: {
  last?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <View className={cn(last ? settingsClasses.rowLast : settingsClasses.row, className)}>
      {children}
    </View>
  );
}
