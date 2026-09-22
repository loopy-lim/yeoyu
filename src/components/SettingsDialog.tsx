import React, { useMemo } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useTheme } from "../themeContext";
import { ChromeIcon, type IconName } from "../chrome/ChromeIcon";
import { useI18n } from "../i18nContext";

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
  const s = useMemo(
    () =>
      StyleSheet.create({
        dialog: {
          width: "94%",
          maxWidth: 1040,
          height: Math.max(160, height - 48),
          maxHeight: "94%",
          borderRadius: 24,
          backgroundColor: t.surfaceElevated,
          overflow: "hidden",
        },
        headerScroll: { maxHeight: "34%", flexGrow: 0, flexShrink: 1 },
        header: {
          paddingHorizontal: 20,
          paddingVertical: 12,
          gap: 8,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderColor: t.hairline,
        },
        row: { flexDirection: "row", alignItems: "center", gap: 12 },
        title: { fontSize: 22, fontWeight: "600", color: t.ink, flex: 1 },
        body: { flex: 1, flexDirection: wide ? "row" : "column", minHeight: 0 },
        nav: {
          width: split ? 232 : "100%",
          flexGrow: split ? 0 : 1,
          flexShrink: 1,
          backgroundColor: t.sunken,
        },
        navContent: { padding: 12, gap: 4 },
        content: { flex: 1, minWidth: 0 },
        contentInner: { padding: wide ? 28 : 20, paddingBottom: 36 },
        sectionTitle: {
          fontSize: 24,
          fontWeight: "600",
          color: t.ink,
          marginBottom: 8,
        },
        text: { fontSize: 14, color: t.ink, lineHeight: 21 },
        textRow: { flexDirection: "row", alignItems: "center", gap: 12 },
        navLabel: { fontSize: 15, lineHeight: 22, color: t.inkMuted },
        navSelectedLabel: { color: t.ink, fontWeight: "600" },
        navCopy: { flex: 1, minWidth: 0 },
        navIcon: {
          width: 24,
          height: 24,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 9,
        },
        close: {
          width: 48,
          height: 48,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 24,
          backgroundColor: t.sunken,
        },
        footer: {
          minHeight: 44,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 20,
          paddingVertical: 8,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderColor: t.hairline,
        },
        pressed: { backgroundColor: t.sunkenStrong },
        detail: { fontSize: 14, color: t.inkMuted, lineHeight: 21 },
        action: {
          minHeight: 48,
          padding: 12,
          borderRadius: 10,
          justifyContent: "center",
        },
        selected: { backgroundColor: t.surfaceElevated },
        search: {
          flex: 1,
          minWidth: 0,
          minHeight: 48,
          backgroundColor: t.sunken,
          color: t.ink,
          paddingHorizontal: 12,
          borderRadius: 10,
          fontSize: 16,
          borderWidth: 1,
          borderColor: t.hairline,
        },
        status: {
          flex: 1,
          minWidth: 0,
          fontSize: 14,
          lineHeight: 21,
          color: t.inkMuted,
        },
      }),
    [t, height, wide, split]
  );
  return (
    <View style={s.dialog} accessibilityViewIsModal>
      <ScrollView
        style={s.headerScroll}
        contentContainerStyle={s.header}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.row}>
          {!wide && page && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr("settings.back")}
              style={s.action}
              onPress={() => onSelect(null)}
            >
              <ChromeIcon name="back" size={20} />
            </Pressable>
          )}
          <Text accessibilityRole="header" style={s.title}>
            {tr("settings.title")}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr("settings.close")}
            style={({ pressed }) => [s.close, pressed && s.pressed]}
            onPress={onClose}
          >
            <ChromeIcon name="close" size={20} />
          </Pressable>
        </View>
        <View style={s.row}>
          <TextInput
            accessibilityLabel={tr("settings.searchHint")}
            placeholder={tr("settings.search")}
            placeholderTextColor={t.inkMuted}
            value={query}
            onChangeText={onQueryChange}
            autoCapitalize="none"
            autoCorrect={false}
            style={s.search}
            returnKeyType="search"
          />
          {!!query && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr("settings.clearSearch")}
              style={s.action}
              onPress={() => onQueryChange("")}
            >
              <Text style={s.text}>{tr("common.clear")}</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
      <View style={s.body}>
        {(wide || !page) && (
          <ScrollView
            style={s.nav}
            contentContainerStyle={s.navContent}
            keyboardShouldPersistTaps="handled"
          >
            {!!words.length && (
              <Text accessibilityLiveRegion="polite" style={s.detail}>
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
                style={({ pressed }) => [
                  s.action,
                  page?.id === section.id && s.selected,
                  pressed && s.pressed,
                ]}
              >
                <View style={s.textRow}>
                  <View style={s.navIcon}>
                    <ChromeIcon
                      name={sectionIcons[section.id] ?? "settings"}
                      size={20}
                    />
                  </View>
                  <View style={s.navCopy}>
                    <Text
                      style={[
                        s.navLabel,
                        page?.id === section.id && s.navSelectedLabel,
                      ]}
                    >
                      {section.title}
                    </Text>
                    {!split && (
                      <Text style={s.detail}>{section.description}</Text>
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
            style={s.content}
            contentContainerStyle={s.contentInner}
            keyboardShouldPersistTaps="handled"
          >
            <Text accessibilityRole="header" style={s.sectionTitle}>
              {page.title}
            </Text>
            <Text style={[s.detail, { marginBottom: 20 }]}>
              {page.description}
            </Text>
            {page.content}
          </ScrollView>
        )}
      </View>
      <View style={s.footer}>
        <Text accessibilityLiveRegion="polite" style={s.status}>
          {tr(`settings.${saveStatus}`)}
        </Text>
        {saveStatus === "failed" && (
          <Pressable
            accessibilityRole="button"
            style={s.action}
            onPress={onRetrySave}
          >
            <Text style={s.text}>{tr("settings.retrySave")}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
