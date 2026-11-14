import React from "react";
import { Text, View } from "react-native";
import { Card } from "@unikit-bridge/ui";
import { cn } from "@/ui/cn";

// One visual system for settings surfaces: inset group cards under quiet
// headers, every radius and fill from the theme tokens. Panels compose these
// primitives instead of keeping private copies, so a section reads the same
// whether it lives in App.tsx or a panel component.

export const settingsClasses = {
  // Inset card that groups related rows. Rows inside carry their own
  // dividers, so the card only owns radius, fill, and clipping.
  group: "rounded-tile bg-sunken border border-hairline overflow-hidden",
  // Quiet header above a group. Uppercase is a latin-only concern and a
  // no-op for Korean copy; letter spacing carries the hierarchy instead.
  groupHeader:
    "text-small font-bold text-ink-faint tracking-[0.6px] uppercase mt-xxl mb-sm px-xs",
  // Header attached to the first group (no top margin).
  groupHeaderFirst:
    "text-small font-bold text-ink-faint tracking-[0.6px] uppercase mb-sm px-xs",
  row: "min-h-[54px] flex-row flex-wrap items-center gap-lg py-xl px-xxl border-b-hairline-width border-b-hairline",
  rowLast:
    "min-h-[54px] flex-row flex-wrap items-center gap-lg py-xl px-xxl",
  rowTitle: "text-ink text-input-plus font-semibold leading-[21px]",
  rowDetail: "text-input-plus text-ink-muted leading-[21px]",
  action:
    "self-start min-h-[36px] justify-center px-xl py-xs rounded-control bg-surface-elevated border border-hairline active:opacity-pressed",
  actionSecondary:
    "self-start min-h-[36px] justify-center px-xl py-xs rounded-control bg-surface-elevated border border-hairline active:opacity-pressed",
  field:
    "min-h-action-row rounded-control border border-hairline bg-surface-elevated px-xxl text-ink text-input-plus",
  chip: "min-h-[36px] px-xl py-xs rounded-control border border-hairline justify-center bg-surface-elevated active:opacity-pressed",
  chipSelected: "border-accent-strong bg-sunken-strong",
  stepperRow: "flex-row items-center gap-sm",
  stepperButton:
    "w-[36px] h-[36px] rounded-control bg-surface-elevated border border-hairline items-center justify-center active:opacity-pressed",
  stepperValue: "text-ink text-body-plus font-bold min-w-[46px] text-center",
} as const;

/** A titled group card. The heading is an already-translated string. */
export function SettingsGroup({
  heading,
  first = false,
  children,
  className,
}: {
  heading?: string;
  first?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <View className={className}>
      {heading !== undefined && (
        <Text
          accessibilityRole="header"
          className={
            first ? settingsClasses.groupHeaderFirst : settingsClasses.groupHeader
          }
        >
          {heading}
        </Text>
      )}
      <Card className={settingsClasses.group}>{children}</Card>
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
    <View
      className={cn(
        last ? settingsClasses.rowLast : settingsClasses.row,
        className
      )}
    >
      {children}
    </View>
  );
}
