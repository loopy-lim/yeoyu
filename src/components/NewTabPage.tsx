import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Button as UnikitButton } from "@unikit-bridge/ui";
import { appClasses as c } from "@/chrome/appStyles";
import { ChromeIcon } from "@/chrome/ChromeIcon";
import { AddressBox } from "@/components/AddressBox";
import { Favicon } from "@/components/Favicon";
import { useI18n } from "@/i18nContext";
import { cn } from "@/ui/cn";
import { useTheme } from "@/themeContext";
import type { SearchEngineId, SuggestionSources } from "@/suggestions";
import type { SiteSearchEntry } from "@/uiPreferences";
import {
  NEW_TAB_SHORTCUT_MAX,
  normalizeShortcutUrl,
  shortcutHost,
  shortcutId,
  type NewTabShortcut,
} from "@/uiPreferences";
import type { ProductCommand } from "@/commandRegistry";

// Zen-parity new-tab dashboard (issue #10): a clock, a theme-linked wash and
// an editable grid of pinned-site shortcuts over the blank tab. Quick Open
// stays a separate overlay above this page; favorite tabs keep living in the
// sidebar and Quick Open so the dashboard never duplicates their role.

/** Locale-aware dashboard clock. Falls back to a stable numeric readout
 *  when the runtime has no ICU formatting. */
export function clockLabel(
  date: Date,
  language: string
): { time: string; date: string } {
  const locale = language === "ko" ? "ko-KR" : "en-US";
  try {
    return {
      time: new Intl.DateTimeFormat(locale, {
        hour: "numeric",
        minute: "2-digit",
      }).format(date),
      date: new Intl.DateTimeFormat(locale, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(date),
    };
  } catch {
    const pad = (value: number) => String(value).padStart(2, "0");
    return {
      time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
      date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
        date.getDate()
      )}`,
    };
  }
}

function DashboardClock({ language }: { language: string }) {
  const [label, setLabel] = useState(() => clockLabel(new Date(), language));
  useEffect(() => {
    // Re-render only when the minute readout actually changes.
    const tick = () => {
      const next = clockLabel(new Date(), language);
      setLabel((current) =>
        current.time === next.time && current.date === next.date
          ? current
          : next
      );
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [language]);
  return (
    <View className="items-center gap-xs">
      <Text className={c.newTabClockTime} maxFontSizeMultiplier={1.2}>
        {label.time}
      </Text>
      <Text className={c.newTabClockDate} maxFontSizeMultiplier={1.35}>
        {label.date}
      </Text>
    </View>
  );
}

// The wash follows the active theme: appearance roll, Space tint and dark
// mode all retint the accent, so the backdrop tracks them for free.
function ThemeWash() {
  const theme = useTheme();
  return (
    <View className="absolute inset-0" pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="new-tab-wash" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.accent} stopOpacity={0.1} />
            <Stop offset="1" stopColor={theme.accent} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#new-tab-wash)" />
      </Svg>
    </View>
  );
}

export function NewTabPage({
  shortcuts,
  onSetShortcuts,
  keyboardInset,
  visibleHeight,
  reducedMotion,
  engine,
  siteSearches,
  suggestions,
  commands,
  onCommand,
  onOpenUrl,
  onOpenTab,
}: {
  shortcuts: NewTabShortcut[];
  onSetShortcuts: (shortcuts: NewTabShortcut[]) => void;
  keyboardInset: number;
  visibleHeight: number;
  reducedMotion: boolean;
  engine: SearchEngineId;
  siteSearches?: SiteSearchEntry[];
  suggestions: SuggestionSources;
  commands: ProductCommand[];
  onCommand: (id: string) => void;
  onOpenUrl: (url: string) => void;
  onOpenTab: (id: string) => void;
}) {
  const { tr, language } = useI18n();
  const theme = useTheme();
  const host = useRef<React.ComponentRef<typeof View>>(null);
  const [frame, setFrame] = useState({ y: 0, height: 0 });
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draftUrl, setDraftUrl] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftError, setDraftError] = useState("");
  const measure = useCallback(() => {
    const measuredHost = host.current;
    measuredHost?.measureInWindow((_x, y, _width, height) => {
      if (host.current !== measuredHost) return;
      setFrame((current) =>
        current.y === y && current.height === height ? current : { y, height }
      );
    });
  }, []);
  useLayoutEffect(measure, [measure, keyboardInset, visibleHeight]);
  // A vertical split may already sit entirely above the IME. Only the overlap
  // of this pane and its Activity's confirmed keyboard changes input bounds.
  const newTabKeyboardInset =
    keyboardInset > 0 && frame.height > 0
      ? Math.max(
          0,
          Math.min(frame.height, frame.y + frame.height - visibleHeight)
        )
      : 0;

  const startAdding = () => {
    setAdding(true);
    setDraftUrl("");
    setDraftTitle("");
    setDraftError("");
  };
  const cancelAdding = () => {
    setAdding(false);
    setDraftUrl("");
    setDraftTitle("");
    setDraftError("");
  };
  const submitShortcut = () => {
    const url = normalizeShortcutUrl(draftUrl);
    if (!url) {
      setDraftError(tr("chrome.shortcutUrlInvalid"));
      return;
    }
    if (shortcuts.some((shortcut) => shortcut.url === url)) {
      setDraftError(tr("chrome.shortcutDuplicate"));
      return;
    }
    onSetShortcuts([
      ...shortcuts,
      {
        id: shortcutId(url),
        title: draftTitle.trim() || shortcutHost(url),
        url,
      },
    ]);
    cancelAdding();
  };
  const removeShortcut = (id: string) =>
    onSetShortcuts(shortcuts.filter((shortcut) => shortcut.id !== id));

  return (
    <View
      ref={host}
      className="absolute inset-0"
      pointerEvents="box-none"
      onLayout={measure}
    >
      <View
        className={c.newTabOverlay}
        style={{ bottom: newTabKeyboardInset }}
        pointerEvents="box-none"
      >
        <ThemeWash />
        <View className={cn(c.newTabPanel, "max-h-full min-h-0")}>
          <DashboardClock language={language} />
          <AddressBox
            engine={engine}
            siteSearches={siteSearches}
            autoFocus={false}
            reducedMotion={reducedMotion}
            suggestions={suggestions}
            commands={commands}
            onCommand={onCommand}
            onOpenTab={onOpenTab}
            onSubmit={onOpenUrl}
          />
          <View className="self-stretch gap-md">
            <View className="flex-row items-center justify-between">
              <Text className={c.newTabHeading}>{tr("chrome.shortcuts")}</Text>
              {(editing || shortcuts.length > 0) && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={tr(
                    editing ? "chrome.shortcutDone" : "chrome.shortcutEdit"
                  )}
                  hitSlop={8}
                  onPress={() => {
                    setEditing((value) => !value);
                    cancelAdding();
                  }}
                  className={cn(c.newTabEditToggle, "active:opacity-pressed")}
                >
                  <Text className={c.newTabEditToggleLabel}>
                    {tr(editing ? "chrome.shortcutDone" : "chrome.shortcutEdit")}
                  </Text>
                </Pressable>
              )}
            </View>
            {shortcuts.length === 0 && !adding && (
              <Text className={c.newTabHint}>
                {tr("chrome.newTabShortcutHint")}
              </Text>
            )}
            <View className={c.newTabGrid}>
              {shortcuts.map((shortcut) => (
                <Pressable
                  key={shortcut.id}
                  accessibilityRole="button"
                  accessibilityLabel={tr(
                    editing ? "chrome.removeShortcut" : "chrome.openShortcut",
                    { name: shortcut.title }
                  )}
                  className={cn(c.newTabTile, "active:opacity-pressed")}
                  onPress={() =>
                    editing
                      ? removeShortcut(shortcut.id)
                      : onOpenUrl(shortcut.url)
                  }
                >
                  <View className={c.newTabTileIcon}>
                    <Favicon
                      url={shortcut.url}
                      fallback={shortcut.title.slice(0, 1).toUpperCase()}
                      size={32}
                      radius={8}
                    />
                    {editing && (
                      <View className={c.newTabTileBadge}>
                        <ChromeIcon name="minus" size={12} color={theme.ink} />
                      </View>
                    )}
                  </View>
                  <Text numberOfLines={1} className={c.newTabTileLabel}>
                    {shortcut.title}
                  </Text>
                </Pressable>
              ))}
              {!editing &&
                shortcuts.length < NEW_TAB_SHORTCUT_MAX &&
                !adding && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={tr("chrome.addShortcut")}
                    className={cn(c.newTabTile, "active:opacity-pressed")}
                    onPress={startAdding}
                  >
                    <View className={c.newTabTileIcon}>
                      <ChromeIcon name="plus" size={20} color={theme.inkMuted} />
                    </View>
                    <Text numberOfLines={1} className={c.newTabTileLabel}>
                      {tr("chrome.addShortcut")}
                    </Text>
                  </Pressable>
                )}
            </View>
            {adding && (
              <View className={c.newTabForm}>
                <TextInput
                  accessibilityLabel={tr("chrome.shortcutUrl")}
                  autoFocus
                  value={draftUrl}
                  onChangeText={(value) => {
                    setDraftUrl(value);
                    if (draftError) setDraftError("");
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  disableFullscreenUI
                  inputMode="url"
                  keyboardType="url"
                  maxFontSizeMultiplier={1.35}
                  placeholder={tr("chrome.shortcutUrl")}
                  placeholderTextColor={theme.inkFaint}
                  numberOfLines={1}
                  className={c.commandInput}
                />
                <TextInput
                  accessibilityLabel={tr("chrome.shortcutTitle")}
                  value={draftTitle}
                  onChangeText={setDraftTitle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  disableFullscreenUI
                  maxFontSizeMultiplier={1.35}
                  placeholder={tr("chrome.shortcutTitle")}
                  placeholderTextColor={theme.inkFaint}
                  numberOfLines={1}
                  className={c.commandInput}
                />
                {draftError ? (
                  <Text accessibilityRole="alert" className={c.newTabFormError}>
                    {draftError}
                  </Text>
                ) : null}
                <View className="flex-row gap-md">
                  <UnikitButton
                    variant="secondary"
                    className="flex-1"
                    accessibilityLabel={tr("common.cancel")}
                    onPress={cancelAdding}
                  >
                    {tr("common.cancel")}
                  </UnikitButton>
                  <UnikitButton
                    variant="default"
                    className="flex-1"
                    disabled={!draftUrl.trim()}
                    accessibilityLabel={tr("chrome.addShortcut")}
                    onPress={submitShortcut}
                  >
                    {tr("chrome.addShortcut")}
                  </UnikitButton>
                </View>
              </View>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}
