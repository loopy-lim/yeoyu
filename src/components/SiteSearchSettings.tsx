import { Pressable, Text, TextInput, View } from "react-native";
import { useState } from "react";
import { SettingsGroup } from "@/components/settings/kit";
import { ChromeIcon } from "@/chrome/ChromeIcon";
import { cn } from "@/ui/cn";
import { useI18n } from "@/i18nContext";
import {
  SITE_SEARCH_KEYWORD_PATTERN,
  SITE_SEARCH_MAX_ENTRIES,
  type SiteSearchEntry,
} from "@/uiPreferences";

const c = {
  body: "px-xxl pb-xxl pt-sm gap-lg",
  help: "text-input text-ink-muted leading-[20px]",
  input: "min-h-action-row text-ink text-icon-size border border-ink-muted rounded-[8px] p-xxl",
  fieldLabel: "text-input text-ink-muted",
  row: "flex-row items-center gap-lg py-md border-b border-hairline last:border-b-0",
  keyword: "text-input-plus text-accent-strong leading-[21px]",
  label: "text-input text-ink leading-[20px] flex-1",
  remove: "size-action-row items-center justify-center rounded-[8px] active:bg-sunken",
  error: "text-input text-error-ink leading-[20px]",
  add: "min-h-action-row self-start px-xxl flex-row items-center gap-sm rounded-[8px] border border-ink-muted active:opacity-pressed",
};

type ErrorKind = "keyword" | "duplicate" | "template" | "limit";

/** Add / remove user site searches ("keyword terms" routing in the address field). */
export const SiteSearchSettings = ({
  entries,
  disabled,
  onChange,
}: {
  entries: SiteSearchEntry[];
  disabled: boolean;
  onChange: (entries: SiteSearchEntry[]) => void;
}) => {
  const { tr } = useI18n();
  const [keyword, setKeyword] = useState("");
  const [label, setLabel] = useState("");
  const [urlTemplate, setUrlTemplate] = useState("");
  const [error, setError] = useState<ErrorKind | null>(null);

  const add = () => {
    const normalized = keyword.trim().toLowerCase();
    if (!SITE_SEARCH_KEYWORD_PATTERN.test(normalized)) {
      setError("keyword");
      return;
    }
    if (entries.some((entry) => entry.keyword === normalized)) {
      setError("duplicate");
      return;
    }
    if (!urlTemplate.includes("%s")) {
      setError("template");
      return;
    }
    try {
      const probe = new URL(urlTemplate.replace("%s", "probe"));
      if (!["http:", "https:"].includes(probe.protocol)) throw new Error("scheme");
    } catch {
      setError("template");
      return;
    }
    if (entries.length >= SITE_SEARCH_MAX_ENTRIES) {
      setError("limit");
      return;
    }
    onChange([
      ...entries,
      {
        id: `site-${Date.now().toString(36)}-${normalized}`,
        keyword: normalized,
        label: label.trim() || normalized,
        urlTemplate: urlTemplate.trim(),
      },
    ]);
    setKeyword("");
    setLabel("");
    setUrlTemplate("");
    setError(null);
  };

  return (
    <SettingsGroup heading={tr("browsing.siteSearch")}>
      <View className={c.body}>
        <Text className={c.help}>{tr("browsing.siteSearchHelp")}</Text>
        {entries.map((entry, index) => (
          <View
            key={entry.id}
            className={c.row}
            style={index === entries.length - 1 ? { borderBottomWidth: 0 } : undefined}
          >
            <Text className={c.keyword}>{entry.keyword}</Text>
            <Text className={c.label} numberOfLines={1}>
              {entry.label}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr("browsing.siteSearchRemove", {
                keyword: entry.keyword,
              })}
              disabled={disabled}
              className={c.remove}
              onPress={() =>
                onChange(entries.filter((candidate) => candidate.id !== entry.id))
              }
            >
              <ChromeIcon name="close" size={16} className="text-ink-muted" />
            </Pressable>
          </View>
        ))}
        <View className="gap-sm">
          <View className="flex-row gap-lg">
            <View className="flex-1 gap-xs">
              <Text className={c.fieldLabel}>{tr("browsing.siteSearchKeyword")}</Text>
              <TextInput
                accessibilityLabel={tr("browsing.siteSearchKeyword")}
                className={c.input}
                value={keyword}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(value) => {
                  setKeyword(value);
                  setError(null);
                }}
              />
            </View>
            <View className="flex-1 gap-xs">
              <Text className={c.fieldLabel}>{tr("browsing.siteSearchLabel")}</Text>
              <TextInput
                accessibilityLabel={tr("browsing.siteSearchLabel")}
                className={c.input}
                value={label}
                onChangeText={(value) => {
                  setLabel(value);
                  setError(null);
                }}
              />
            </View>
          </View>
          <View className="gap-xs">
            <Text className={c.fieldLabel}>{tr("browsing.siteSearchTemplate")}</Text>
            <TextInput
              accessibilityLabel={tr("browsing.siteSearchTemplate")}
              className={c.input}
              value={urlTemplate}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://example.com/search?q=%s"
              onChangeText={(value) => {
                setUrlTemplate(value);
                setError(null);
              }}
            />
            <Text className={c.help}>{tr("browsing.siteSearchTemplateHelp")}</Text>
          </View>
        </View>
        {error && (
          <Text accessibilityRole="alert" className={c.error}>
            {tr(`browsing.siteSearchError_${error}`)}
          </Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("browsing.siteSearchAdd")}
          disabled={disabled}
          className={cn(c.add, disabled && "opacity-50")}
          onPress={add}
        >
          <ChromeIcon name="plus" size={14} className="text-ink" />
          <Text className="text-input-plus text-ink">{tr("browsing.siteSearchAdd")}</Text>
        </Pressable>
      </View>
    </SettingsGroup>
  );
};
