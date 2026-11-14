import { cva } from "class-variance-authority";
import { cn } from "@/ui/cn";
import { ThemeScope } from "@/ui/ThemeScope";
import React, { useMemo, useState } from "react";
import { Pressable, Text, TextInput, useColorScheme, View } from "react-native";
import { resolveTheme, WORKSPACE_PALETTE } from "@/theme";
import { useTheme } from "@/themeContext";
import { ChromeIcon } from "@/chrome/ChromeIcon";
import { useI18n } from "@/i18nContext";
import { SettingsGroup, settingsClasses } from "@/components/settings/kit";
import {
  normalizeCustomColor,
  resolveColorMode,
  type PhoneChromeLayout,
  type ResolvedColorMode,
  type ColorSource,
  type UiPreferenceAction,
  type UiPreferences,
} from "@/uiPreferences";

const PRESETS = [...WORKSPACE_PALETTE, "#808080", "#202020"];

const c = {
  group: "",
  groupUnheaded: "mt-xxl",
  groupBody: "px-xxl py-lg gap-lg",
  title: "text-body-plus font-bold text-ink",
  text: "text-input-plus text-ink leading-[21px] font-medium",
  textRow: "flex-row items-center gap-md",
  detail: "text-body text-ink-muted leading-[19px]",
  choices: "flex-row flex-wrap gap-md",
  choice: `${settingsClasses.chip} max-w-full`,
  input:
    "min-h-[44px] border border-hairline rounded-control px-xxl text-ink bg-surface-elevated text-input-plus",
  swatch:
    "size-[34px] rounded-full border-2 border-transparent items-center justify-center active:opacity-pressed",
  swatchSelected: "border-accent-strong",
  swatchFill: "size-[24px] rounded-full bg-accent",
  preview:
    "p-lg rounded-tile bg-sidebar border border-hairline gap-sm",
  previewSidebar: "w-[96px] p-sm rounded-control gap-xs justify-between",
  previewCard:
    "flex-1 p-lg rounded-control bg-surface gap-xs shadow-mini",
} as const;
const choiceClasses = cva("", {
  variants: {
    selected: { true: settingsClasses.chipSelected, false: "" },
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
      <SettingsGroup first className={c.group} heading={tr("color.mode")}>
        <View className={c.groupBody}>
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
      </SettingsGroup>
      <SettingsGroup className={c.group} heading={tr("color.base")}>
        <View className={c.groupBody}>
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
      </SettingsGroup>
      <SettingsGroup className={c.group} heading={tr("color.source")}>
        <View className={c.groupBody}>
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
      </SettingsGroup>
      <CustomColorEditor
        key={`${ui.customColor ?? "unset"}:${editorVersion}`}
        ui={ui}
        hydrated={hydrated}
        onChange={onChange}
        resolvedMode={resolvedMode}
      />
      <SettingsGroup className={cn(c.group, c.groupUnheaded)}>
        <View className={cn(c.groupBody, "flex-row flex-wrap items-center justify-between gap-lg")}>
          <Text className={cn(c.detail, "flex-1 min-w-[180px]")}>
            {tr("color.resetHelp")}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={!hydrated}
            accessibilityState={{ disabled: !hydrated }}
            onPress={() => {
              onChange({ type: "resetColors" });
              setEditorVersion((version) => version + 1);
            }}
            className={cn(
              settingsClasses.action,
              choiceClasses({ disabled: !hydrated })
            )}
          >
            <Text className={c.text}>{tr("color.reset")}</Text>
          </Pressable>
        </View>
      </SettingsGroup>
      <SettingsGroup className={c.group} heading={tr("appearance.chromeLayout")}>
        <View className={c.groupBody}>
          <View className={c.choices}>
            {(["bottom", "hybrid", "top"] as const).map(
              (layout: PhoneChromeLayout) => (
                <React.Fragment key={layout}>
                  {choice(
                    tr(
                      layout === "bottom"
                        ? "appearance.chromeLayoutBottom"
                        : layout === "hybrid"
                        ? "appearance.chromeLayoutHybrid"
                        : "appearance.chromeLayoutTop"
                    ),
                    (ui.phoneChromeLayout ?? "bottom") === layout,
                    () => onChange({ type: "setPhoneChromeLayout", layout })
                  )}
                </React.Fragment>
              )
            )}
          </View>
          <Text className={c.detail}>{tr("appearance.chromeLayoutDetail")}</Text>
        </View>
      </SettingsGroup>
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
    <SettingsGroup className={c.group} heading={tr("color.choose")}>
      <View className={c.groupBody}>
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
                color === preset && c.swatchSelected,
                !hydrated && "opacity-50"
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
          <Text accessibilityRole="alert" className="text-body text-error-ink">
            {tr("color.invalid")}
          </Text>
        )}
        <ThemeScope theme={preview}>
          <View className={c.preview}>
            <Text className={c.title}>
              {tr("color.preview", { color: color ?? initial })}
            </Text>
            <View className="flex-row gap-sm">
              <View className={c.previewSidebar}>
                <View className="gap-xs">
                  <View className="flex-row gap-[4px] mb-xs">
                    <View className="size-[8px] rounded-full bg-accent" />
                    <View className="size-[8px] rounded-full bg-hairline-on-chrome" />
                  </View>
                  <View className="h-[22px] px-sm rounded-control bg-pill justify-center">
                    <Text
                      numberOfLines={1}
                      className="text-ink text-micro font-semibold"
                    >
                      {tr("color.sidebar")}
                    </Text>
                  </View>
                  <View className="h-[16px] rounded-control bg-field-on-chrome" />
                </View>
                <View className="h-[6px] w-[28px] rounded-full bg-accent" />
              </View>
              <View className={c.previewCard}>
                <Text className={c.text}>{tr("color.tabs")}</Text>
                <Text className={c.detail}>{tr("color.tones")}</Text>
                <View className="h-[4px] rounded-full bg-accent mt-xs" />
              </View>
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
            <Text className={cn(c.text, "font-semibold")}>
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
    </SettingsGroup>
  );
}
