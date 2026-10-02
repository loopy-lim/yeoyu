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
  dialog:
    "w-[94%] max-w-[1040px] max-h-[94%] rounded-[24px] bg-surface-elevated overflow-hidden",
  headerScroll: "max-h-[34%] grow-0 shrink",
  header: "px-[20px] py-xxl gap-lg border-hairline border-b-hairline-width",
  row: "flex-row items-center gap-xxl",
  title: "text-[22px] font-semibold text-ink flex-1",
  navContent: "p-xxl gap-sm",
  content: "flex-1 min-w-0",
  sectionTitle: "text-[24px] font-semibold text-ink mb-lg",
  text: "text-input-plus text-ink leading-[21px]",
  textRow: "flex-row items-center gap-xxl",
  navCopy: "flex-1 min-w-0",
  navIcon: "size-[24px] items-center justify-center rounded-control",
  close:
    "size-[48px] items-center justify-center rounded-[24px] bg-sunken active:bg-sunken-strong",
  footer:
    "min-h-input flex-row items-center gap-lg px-[20px] py-lg border-hairline border-t-hairline-width",
  detail: "text-input-plus text-ink-muted leading-[21px]",
  action:
    "min-h-action-row p-xxl rounded-[10px] justify-center active:bg-sunken-strong",
  search:
    "flex-1 min-w-0 min-h-action-row bg-sunken text-ink px-xxl rounded-[10px] text-icon-size border border-hairline",
  status: "flex-1 min-w-0 text-input-plus leading-[21px] text-ink-muted",
} as const;
const bodyClasses = cva("flex-1 min-h-0", {
  variants: { wide: { true: "flex-row", false: "flex-col" } },
});
const navClasses = cva("shrink bg-sunken", {
  variants: { split: { true: "w-[232px] grow-0", false: "w-full grow" } },
});
const contentClasses = cva("pb-[36px]", {
  variants: {
    wide: { true: "p-[28px] pb-[36px]", false: "p-[20px] pb-[36px]" },
  },
});
const categoryClasses = cva(c.action, {
  variants: { selected: { true: "bg-surface-elevated", false: "" } },
});
const categoryLabelClasses = cva("text-[15px] leading-[22px]", {
  variants: {
    selected: { true: "text-ink font-semibold", false: "text-ink-muted" },
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
  return (
    <View
      className={c.dialog}
      style={{ height: Math.max(160, height - 48) }}
      accessibilityViewIsModal
    >
      <ScrollView
        className={c.headerScroll}
        contentContainerClassName={c.header}
        keyboardShouldPersistTaps="handled"
      >
        <View className={c.row}>
          {!wide && page && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr("settings.back")}
              className={c.action}
              onPress={() => onSelect(null)}
            >
              <ChromeIcon name="back" size={20} />
            </Pressable>
          )}
          <Text accessibilityRole="header" className={c.title}>
            {tr("settings.title")}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr("settings.close")}
            className={c.close}
            onPress={onClose}
          >
            <ChromeIcon name="close" size={20} />
          </Pressable>
        </View>
        <View className={c.row}>
          <TextInput
            accessibilityLabel={tr("settings.searchHint")}
            placeholder={tr("settings.search")}
            placeholderTextColor={t.inkMuted}
            value={query}
            onChangeText={onQueryChange}
            autoCapitalize="none"
            autoCorrect={false}
            className={c.search}
            returnKeyType="search"
          />
          {!!query && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr("settings.clearSearch")}
              className={c.action}
              onPress={() => onQueryChange("")}
            >
              <Text className={c.text}>{tr("common.clear")}</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
      <View className={cn(bodyClasses({ wide }))}>
        {(wide || !page) && (
          <ScrollView
            className={cn(navClasses({ split }))}
            contentContainerClassName={c.navContent}
            keyboardShouldPersistTaps="handled"
          >
            {!!words.length && (
              <Text accessibilityLiveRegion="polite" className={c.detail}>
                {filtered.length
                  ? tr("settings.matchCount", { count: filtered.length })
                  : tr("settings.noMatch")}
              </Text>
            )}
            {filtered.map((section) => (
              <Pressable
                key={section.id}
                accessibilityRole="button"
                accessibilityState={{ selected: page?.id === section.id }}
                onPress={() => {
                  onSelect(section.id);
                  onQueryChange("");
                }}
                className={cn(
                  categoryClasses({ selected: page?.id === section.id })
                )}
              >
                <View className={c.textRow}>
                  <View className={c.navIcon}>
                    <ChromeIcon
                      name={sectionIcons[section.id] ?? "settings"}
                      size={20}
                    />
                  </View>
                  <View className={c.navCopy}>
                    <Text
                      className={cn(
                        categoryLabelClasses({
                          selected: page?.id === section.id,
                        })
                      )}
                    >
                      {section.title}
                    </Text>
                    {!split && (
                      <Text className={c.detail}>{section.description}</Text>
                    )}
                  </View>
                  {!split && <ChromeIcon name="chevronRight" size={16} />}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
        {page && (
          <ScrollView
            key={page.id}
            className={c.content}
            contentContainerClassName={cn(contentClasses({ wide }))}
            keyboardShouldPersistTaps="handled"
          >
            <Text accessibilityRole="header" className={c.sectionTitle}>
              {page.title}
            </Text>
            <Text className={cn(c.detail, "mb-[20px]")}>
              {page.description}
            </Text>
            {page.content}
          </ScrollView>
        )}
      </View>
      <View className={c.footer}>
        <Text accessibilityLiveRegion="polite" className={c.status}>
          {tr(`settings.${saveStatus}`)}
        </Text>
        {saveStatus === "failed" && (
          <Pressable
            accessibilityRole="button"
            className={c.action}
            onPress={onRetrySave}
          >
            <Text className={c.text}>{tr("settings.retrySave")}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
