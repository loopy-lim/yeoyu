import { cva } from "class-variance-authority";
import { cn } from "@/ui/cn";
import React from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useTheme } from "@/themeContext";
import { ChromeIcon, type IconName } from "@/chrome/ChromeIcon";
import { DialogCard } from "@/components/DialogCard";
import { DialogHeader } from "@/components/DialogHeader";
import { useI18n } from "@/i18nContext";

const sectionIcons: Record<string, IconName> = {
  browsing: "search",
  appearance: "window",
  website: "space",
  permissions: "lock",
  extensions: "plus",
  privacy: "private",
  data: "folder",
  media: "play",
  advanced: "settings",
};

export interface SettingsSection {
  id: string;
  title: string;
  description: string;
  keywords: string;
  content: React.ReactNode;
}
export type SettingsSaveStatus = "loading" | "saving" | "saved" | "failed";

const c = {
  header:
    "px-[20px] py-lg gap-md border-b-hairline-width border-b-hairline bg-surface-elevated",
  headerTop: "flex-row items-center gap-md",
  headerTitleRow: "flex-row items-center gap-md flex-1 min-w-0",
  title: "text-[20px] font-bold text-ink",
  statusPill:
    "px-md py-xs rounded-chip bg-sunken border border-hairline flex-row items-center gap-sm",
  statusText: "text-small font-semibold text-ink-muted",
  retryButton:
    "min-h-[32px] px-lg rounded-control bg-sunken border border-hairline justify-center active:bg-sunken-strong",
  retryText: "text-small font-semibold text-ink",
  searchRow: "flex-row items-center gap-sm",
  search:
    "flex-1 min-w-0 min-h-[38px] bg-sunken text-ink px-xl rounded-control text-input-plus border border-hairline",
  searchWide:
    "w-[210px] min-h-[36px] bg-sunken text-ink px-xl rounded-control text-input-plus border border-hairline",
  clearButton:
    "min-h-[36px] px-lg rounded-control bg-sunken border border-hairline justify-center active:bg-sunken-strong",
  close:
    "size-[38px] items-center justify-center rounded-control bg-sunken active:bg-sunken-strong",
  navContent: "p-lg gap-xs",
  content: "flex-1 min-w-0 bg-surface-elevated",
  sectionHeader:
    "pb-lg mb-xl border-b-hairline-width border-b-hairline gap-xs",
  sectionTitle: "text-[22px] font-bold text-ink",
  text: "text-input-plus text-ink leading-[21px]",
  textRow: "flex-row items-center gap-md",
  navCopy: "flex-1 min-w-0",
  navIcon: "size-[22px] items-center justify-center",
  detail: "text-body text-ink-muted leading-[20px]",
  action:
    "min-h-[42px] px-lg py-md rounded-control border justify-center active:bg-sunken-strong",
} as const;
const bodyClasses = cva("flex-1 min-h-0", {
  variants: { wide: { true: "flex-row", false: "flex-col" } },
});
const navClasses = cva("shrink bg-sidebar", {
  variants: {
    split: {
      true: "w-[216px] grow-0 border-r-hairline-width border-r-hairline",
      false: "w-full grow",
    },
  },
});
const contentClasses = cva("pb-[36px]", {
  variants: {
    wide: { true: "p-[24px] pb-[36px]", false: "p-[18px] pb-[36px]" },
  },
});
const categoryClasses = cva(c.action, {
  variants: {
    selected: {
      true: "bg-sunken-strong border-transparent",
      false: "border-transparent",
    },
  },
});
const categoryLabelClasses = cva("text-input-plus leading-[21px]", {
  variants: {
    selected: { true: "text-ink font-semibold", false: "text-ink-muted font-medium" },
  },
});

export function SettingsDialog({
  sections,
  query,
  onQueryChange,
  selectedId,
  onSelect,
  onClose,
  saveStatus,
  onRetrySave,
}: {
  sections: SettingsSection[];
  query: string;
  onQueryChange(value: string): void;
  selectedId: string | null;
  onSelect(id: string | null): void;
  onClose(): void;
  saveStatus: SettingsSaveStatus;
  onRetrySave(): void;
}) {
  const t = useTheme();
  const { tr } = useI18n();
  const { width, height, fontScale } = useWindowDimensions();
  const wide = width >= 820 && fontScale < 1.5;
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const filtered = sections.filter((section) =>
    words.every((word) =>
      `${section.title} ${section.description} ${section.keywords}`
        .toLocaleLowerCase()
        .includes(word)
    )
  );
  const selected = sections.find((section) => section.id === selectedId);
  // Search always shows matching categories. Choosing one clears the query
  // and opens it, including when it was selected before the search.
  const page = words.length
    ? undefined
    : selected ?? (wide ? sections[0] : undefined);
  const split = wide && !!page;
  const searchInput = (
    <View className={c.searchRow}>
      <TextInput
        accessibilityLabel={tr("settings.searchHint")}
        placeholder={tr("settings.search")}
        placeholderTextColor={t.inkMuted}
        value={query}
        onChangeText={onQueryChange}
        autoCapitalize="none"
        autoCorrect={false}
        className={wide ? c.searchWide : c.search}
        returnKeyType="search"
      />
      {!!query && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("settings.clearSearch")}
          className={c.clearButton}
          onPress={() => onQueryChange("")}
        >
          <Text className={c.retryText}>{tr("common.clear")}</Text>
        </Pressable>
      )}
    </View>
  );
  const statusControl = (
    <View className={c.searchRow}>
      <View className={c.statusPill}>
        <Text accessibilityLiveRegion="polite" className={c.statusText}>
          {tr(`settings.${saveStatus}`)}
        </Text>
      </View>
      {saveStatus === "failed" && (
        <Pressable
          accessibilityRole="button"
          className={c.retryButton}
          onPress={onRetrySave}
        >
          <Text className={c.retryText}>{tr("settings.retrySave")}</Text>
        </Pressable>
      )}
    </View>
  );
  return (
    <DialogCard
      variant="wide"
      style={{ height: Math.max(160, height - 48) }}
    >
      <View className={c.header}>
        <DialogHeader
          className="gap-md"
          leading={
            !wide && page ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tr("settings.back")}
                className={c.close}
                onPress={() => onSelect(null)}
              >
                <ChromeIcon name="back" size={18} />
              </Pressable>
            ) : undefined
          }
          title={
            <View className={c.headerTitleRow}>
              <Text accessibilityRole="header" className={c.title}>
                {tr("settings.title")}
              </Text>
              {(saveStatus === "saving" || saveStatus === "failed") &&
                statusControl}
            </View>
          }
          closeLabel={tr("settings.close")}
          closeClassName={c.close}
          closeIconSize={18}
          onClose={onClose}
        >
          {wide && searchInput}
        </DialogHeader>
        {!wide && searchInput}
      </View>
      <View className={cn(bodyClasses({ wide }))}>
        {(wide || !page) && (
          <ScrollView
            className={cn(navClasses({ split }))}
            contentContainerClassName={c.navContent}
            keyboardShouldPersistTaps="handled"
          >
            {!!words.length && (
              <Text accessibilityLiveRegion="polite" className={cn(c.detail, "px-md py-xs")}>
                {filtered.length
                  ? tr("settings.matchCount", { count: filtered.length })
                  : tr("settings.noMatch")}
              </Text>
            )}
            {filtered.map((section) => {
              const isSelected = page?.id === section.id;
              return (
                <Pressable
                  key={section.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => {
                    onSelect(section.id);
                    onQueryChange("");
                  }}
                  className={cn(categoryClasses({ selected: isSelected }))}
                >
                  <View className={c.textRow}>
                    <View className={c.navIcon}>
                      <ChromeIcon
                        name={sectionIcons[section.id] ?? "settings"}
                        size={18}
                        color={isSelected ? t.accentStrong : t.inkMuted}
                      />
                    </View>
                    <View className={c.navCopy}>
                      <Text
                        className={cn(
                          categoryLabelClasses({ selected: isSelected })
                        )}
                      >
                        {section.title}
                      </Text>
                      {!split && (
                        <Text className={c.detail}>{section.description}</Text>
                      )}
                    </View>
                    {!split && (
                      <ChromeIcon
                        name="chevronRight"
                        size={16}
                        color={t.inkFaint}
                      />
                    )}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        {page && (
          <ScrollView
            key={page.id}
            className={c.content}
            contentContainerClassName={cn(contentClasses({ wide }))}
            keyboardShouldPersistTaps="handled"
          >
            <View className="w-full max-w-[680px]">
              <View className={c.sectionHeader}>
                <Text accessibilityRole="header" className={c.sectionTitle}>
                  {page.title}
                </Text>
                <Text className={c.detail}>{page.description}</Text>
              </View>
              {page.content}
            </View>
          </ScrollView>
        )}
      </View>
    </DialogCard>
  );
}
