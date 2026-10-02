import { cva } from "class-variance-authority";
import { cn } from "@/ui/cn";
import { ThemeScope } from "@/ui/ThemeScope";
import React, { useMemo, useState } from "react";
import { Pressable, Text, TextInput, useColorScheme, View } from "react-native";
import { resolveTheme, WORKSPACE_PALETTE } from "@/theme";
import { useTheme } from "@/themeContext";
import { ChromeIcon } from "@/chrome/ChromeIcon";
import { useI18n } from "@/i18nContext";
import {
  normalizeCustomColor,
  resolveColorMode,
  type ResolvedColorMode,
  type ColorSource,
  type UiPreferenceAction,
  type UiPreferences,
} from "@/uiPreferences";

const PRESETS = [...WORKSPACE_PALETTE, "#808080", "#202020"];

const c = {
  group: "gap-xl mb-[24px]",
  title: "text-icon-size font-semibold text-ink",
  text: "text-input-plus text-ink leading-[21px]",
  textRow: "flex-row items-center gap-md",
  detail: "text-input-plus text-ink-muted leading-[21px]",
  choices: "flex-row flex-wrap gap-lg",
  choice:
    "max-w-full min-h-action-row p-xxl rounded-[10px] border border-hairline justify-center bg-surface-elevated active:opacity-pressed",
  input:
    "min-h-action-row border border-ink-muted rounded-[10px] px-xxl text-ink bg-surface-elevated text-icon-size",
  swatch:
    "size-[48px] p-lg rounded-[10px] border border-hairline items-center justify-center active:opacity-pressed",
  swatchFill: "size-[30px] rounded-[7px] border border-ink-muted bg-accent",
  preview: "p-xxxl rounded-tile gap-xxl bg-sidebar",
  previewCard:
    "p-xxxl rounded-[10px] gap-lg border border-pane-focus bg-surface",
} as const;
const choiceClasses = cva("", {
  variants: {
    selected: { true: "border-ink bg-sunken-strong", false: "" },
    disabled: { true: "opacity-50", false: "" },
  },
});

export function AppearanceSettings({
  ui,
  hydrated,
  spaceColor,
  spaceName,
  onChange,
}: {
  ui: UiPreferences;
  hydrated: boolean;
  spaceColor: string;
  spaceName: string;
  onChange(action: UiPreferenceAction): void;
}) {
  const t = useTheme();
  const { tr } = useI18n();
  const systemScheme = useColorScheme();
  const resolvedMode = resolveColorMode(ui.colorMode, systemScheme);
  const [editorVersion, setEditorVersion] = useState(0);
  // A new saved seed remounts the editor below, while ordinary app renders
  // preserve the draft. Typing never changes the persisted appearance.
  const source = ui.colorSource ?? "space";
  const sourceDescriptions: Record<ColorSource, string> = {
    space: tr("color.spaceHelp", {
      space: spaceName,
      color: spaceColor ? ` (${spaceColor})` : tr("color.basePalette"),
    }),
    custom: tr("color.customHelp", { color: ui.customColor ?? "" }),
    appearance: tr("color.baseSourceHelp"),
  };
  const choice = (
    label: string,
    checked: boolean,
    onPress: () => void,
    disabled = false
  ) => (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled: !hydrated || disabled }}
      disabled={!hydrated || disabled}
      onPress={onPress}
      className={cn(
        c.choice,
        choiceClasses({ selected: checked, disabled: !hydrated || disabled })
      )}
    >
      <View className={c.textRow}>
        {checked && (
          <ChromeIcon name="check" size={14} color={t.accentStrong} />
        )}
        <Text className={c.text}>{label}</Text>
      </View>
    </Pressable>
  );
  return (
    <>
      <View className={c.group}>
        <Text accessibilityRole="header" className={c.title}>
          {tr("color.mode")}
        </Text>
        <View className={c.choices}>
          {(["system", "light", "dark"] as const).map((colorMode) => (
            <React.Fragment key={colorMode}>
              {choice(
                tr(`color.${colorMode}`),
                (ui.colorMode ?? "system") === colorMode,
                () => onChange({ type: "setColorMode", colorMode })
              )}
            </React.Fragment>
          ))}
        </View>
        <Text className={c.detail}>
          {tr(
            (ui.colorMode ?? "system") === "system"
              ? "color.modeSystemHelp"
              : "color.modeManualHelp",
            { mode: tr(`color.${resolvedMode}`) }
          )}
        </Text>
      </View>
      <View className={c.group}>
        <Text accessibilityRole="header" className={c.title}>
          {tr("color.base")}
        </Text>
        <View className={c.choices}>
          {(["lavender", "warm"] as const).map((appearance) => (
            <React.Fragment key={appearance}>
              {choice(
                tr(appearance === "lavender" ? "color.lavender" : "color.warm"),
                ui.appearance === appearance,
                () => onChange({ type: "setAppearance", appearance })
              )}
            </React.Fragment>
          ))}
        </View>
        <Text className={c.detail}>{tr("color.baseHelp")}</Text>
      </View>
      <View className={c.group}>
        <Text accessibilityRole="header" className={c.title}>
          {tr("color.source")}
        </Text>
        <View className={c.choices}>
          {(
            [
              ["appearance", tr("color.sourceBase")],
              ["space", tr("color.sourceSpace")],
              ["custom", tr("color.sourceCustom")],
            ] as [ColorSource, string][]
          ).map(([value, label]) => (
            <React.Fragment key={value}>
              {choice(
                label,
                source === value,
                () => onChange({ type: "setColorSource", source: value }),
                value === "custom" && !ui.customColor
              )}
            </React.Fragment>
          ))}
        </View>
        <Text className={c.detail}>{sourceDescriptions[source]}</Text>
      </View>
      <CustomColorEditor
        key={`${ui.customColor ?? "unset"}:${editorVersion}`}
        ui={ui}
        hydrated={hydrated}
        onChange={onChange}
        resolvedMode={resolvedMode}
      />
      <View className={c.group}>
        <Pressable
          accessibilityRole="button"
          disabled={!hydrated}
          accessibilityState={{ disabled: !hydrated }}
          onPress={() => {
            onChange({ type: "resetColors" });
            setEditorVersion((version) => version + 1);
          }}
          className={cn(c.choice, choiceClasses({ disabled: !hydrated }))}
        >
          <Text className={c.text}>{tr("color.reset")}</Text>
        </Pressable>
        <Text className={c.detail}>{tr("color.resetHelp")}</Text>
      </View>
    </>
  );
}

function CustomColorEditor({
  ui,
  hydrated,
  onChange,
  resolvedMode,
}: {
  ui: UiPreferences;
  hydrated: boolean;
  onChange(action: UiPreferenceAction): void;
  resolvedMode: ResolvedColorMode;
}) {
  const initial = ui.customColor ?? WORKSPACE_PALETTE[0];
  const { tr } = useI18n();
  const [draft, setDraft] = useState(initial);
  const color = normalizeCustomColor(draft);
  const preview = useMemo(
    () =>
      resolveTheme({
        appearance: ui.appearance,
        colorMode: resolvedMode,
        colorSource: "custom",
        customColor: color ?? initial,
      }),
    [ui.appearance, resolvedMode, color, initial]
  );
  const applied = ui.colorSource === "custom" && color === ui.customColor;
  return (
    <View className={c.group}>
      <Text accessibilityRole="header" className={c.title}>
        {tr("color.choose")}
      </Text>
      <Text className={c.detail}>{tr("color.chooseHelp")}</Text>
      <View className={c.choices}>
        {PRESETS.map((preset) => (
          <Pressable
            key={preset}
            accessibilityRole="radio"
            accessibilityLabel={tr("color.previewColor", { color: preset })}
            accessibilityState={{
              checked: color === preset,
              disabled: !hydrated,
            }}
            disabled={!hydrated}
            onPress={() => setDraft(preset)}
            className={cn(
              c.swatch,
              choiceClasses({ selected: color === preset, disabled: !hydrated })
            )}
          >
            <ThemeScope theme={{ ...preview, accent: preset }}>
              <View className={c.swatchFill} />
            </ThemeScope>
          </Pressable>
        ))}
      </View>
      <Text className={c.text}>{tr("color.hex")}</Text>
      <TextInput
        accessibilityLabel={tr("color.customHex")}
        accessibilityHint={tr("color.hexHint")}
        editable={hydrated}
        value={draft}
        onChangeText={setDraft}
        placeholder="#7d94d4"
        placeholderTextColor={preview.inkMuted}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        importantForAutofill="no"
        spellCheck={false}
        maxLength={32}
        className={c.input}
        onSubmitEditing={() => {
          if (hydrated && color) onChange({ type: "setCustomColor", color });
        }}
      />
      {!color && (
        <Text accessibilityRole="alert" className={c.detail}>
          {tr("color.invalid")}
        </Text>
      )}
      <ThemeScope theme={preview}>
        <View className={c.preview}>
          <Text className={c.title}>
            {tr("color.preview", { color: color ?? initial })}
          </Text>
          <Text className={c.detail}>{tr("color.sidebar")}</Text>
          <View className={c.previewCard}>
            <Text className={c.text}>{tr("color.tabs")}</Text>
            <Text className={c.detail}>{tr("color.tones")}</Text>
            <View className="h-sm rounded-[2px] bg-accent" />
          </View>
        </View>
      </ThemeScope>
      <Text className={c.detail}>{tr("color.seedHelp")}</Text>
      <View className={c.choices}>
        <Pressable
          accessibilityRole="button"
          disabled={!hydrated || !color || applied}
          accessibilityState={{ disabled: !hydrated || !color || applied }}
          onPress={() => color && onChange({ type: "setCustomColor", color })}
          className={cn(
            c.choice,
            choiceClasses({
              selected: true,
              disabled: !hydrated || !color || applied,
            })
          )}
        >
          <Text className={c.text}>
            {tr(applied ? "color.applied" : "color.apply")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!hydrated || draft === initial}
          accessibilityState={{ disabled: !hydrated || draft === initial }}
          onPress={() => setDraft(initial)}
          className={cn(
            c.choice,
            choiceClasses({ disabled: !hydrated || draft === initial })
          )}
        >
          <Text className={c.text}>{tr("color.discard")}</Text>
        </Pressable>
      </View>
    </View>
  );
}
