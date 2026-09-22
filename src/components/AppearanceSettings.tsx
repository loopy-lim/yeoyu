import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, useColorScheme, View } from "react-native";
import { resolveTheme, WORKSPACE_PALETTE, type Theme } from "../theme";
import { useTheme } from "../themeContext";
import { ChromeIcon } from "../chrome/ChromeIcon";
import { useI18n } from "../i18nContext";
import {
  normalizeCustomColor,
  resolveColorMode,
  type ResolvedColorMode,
  type ColorSource,
  type UiPreferenceAction,
  type UiPreferences,
} from "../uiPreferences";

const PRESETS = [...WORKSPACE_PALETTE, "#808080", "#202020"];

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    group: { gap: 10, marginBottom: 24 },
    title: { fontSize: 16, fontWeight: "600", color: t.ink },
    text: { fontSize: 14, color: t.ink, lineHeight: 21 },
    textRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    detail: { fontSize: 14, color: t.inkMuted, lineHeight: 21 },
    choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    choice: {
      maxWidth: "100%",
      minHeight: 48,
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.hairline,
      justifyContent: "center",
      backgroundColor: t.surfaceElevated,
    },
    selected: { borderColor: t.ink, backgroundColor: t.sunkenStrong },
    disabled: { opacity: 0.5 },
    input: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: t.inkMuted,
      borderRadius: 10,
      paddingHorizontal: 12,
      color: t.ink,
      backgroundColor: t.surfaceElevated,
      fontSize: 16,
    },
    swatch: {
      width: 48,
      height: 48,
      padding: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.hairline,
      alignItems: "center",
      justifyContent: "center",
    },
    swatchFill: {
      width: 30,
      height: 30,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: t.inkMuted,
    },
    preview: { padding: 16, borderRadius: 12, gap: 12 },
    previewCard: { padding: 16, borderRadius: 10, gap: 8, borderWidth: 1 },
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
  const s = useMemo(() => makeStyles(t), [t]);
  // A new saved seed remounts the editor below, while ordinary app renders
  // preserve the draft. Typing never changes the persisted appearance.
  const source = ui.colorSource ?? "space";
  const sourceDescriptions: Record<ColorSource, string> = {
    space: tr("color.spaceHelp", { space: spaceName, color: spaceColor ? ` (${spaceColor})` : tr("color.basePalette") }),
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
      style={[
        s.choice,
        checked && s.selected,
        (!hydrated || disabled) && s.disabled,
      ]}
    >
      <View style={s.textRow}>
        {checked && (
          <ChromeIcon name="check" size={14} color={t.accentStrong} />
        )}
        <Text style={s.text}>{label}</Text>
      </View>
    </Pressable>
  );
  return (
    <>
      <View style={s.group}>
        <Text accessibilityRole="header" style={s.title}>
          {tr("color.mode")}
        </Text>
        <View style={s.choices}>
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
        <Text style={s.detail}>
          {tr((ui.colorMode ?? "system") === "system" ? "color.modeSystemHelp" : "color.modeManualHelp", { mode: tr(`color.${resolvedMode}`) })}
        </Text>
      </View>
      <View style={s.group}>
        <Text accessibilityRole="header" style={s.title}>
          {tr("color.base")}
        </Text>
        <View style={s.choices}>
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
        <Text style={s.detail}>
          {tr("color.baseHelp")}
        </Text>
      </View>
      <View style={s.group}>
        <Text accessibilityRole="header" style={s.title}>
          {tr("color.source")}
        </Text>
        <View style={s.choices}>
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
        <Text style={s.detail}>{sourceDescriptions[source]}</Text>
      </View>
      <CustomColorEditor
        key={`${ui.customColor ?? "unset"}:${editorVersion}`}
        ui={ui}
        hydrated={hydrated}
        onChange={onChange}
        styles={s}
        resolvedMode={resolvedMode}
      />
      <View style={s.group}>
        <Pressable
          accessibilityRole="button"
          disabled={!hydrated}
          accessibilityState={{ disabled: !hydrated }}
          onPress={() => {
            onChange({ type: "resetColors" });
            setEditorVersion((version) => version + 1);
          }}
          style={[s.choice, !hydrated && s.disabled]}
        >
          <Text style={s.text}>{tr("color.reset")}</Text>
        </Pressable>
        <Text style={s.detail}>
          {tr("color.resetHelp")}
        </Text>
      </View>
    </>
  );
}

function CustomColorEditor({
  ui,
  hydrated,
  onChange,
  styles: s,
  resolvedMode,
}: {
  ui: UiPreferences;
  hydrated: boolean;
  onChange(action: UiPreferenceAction): void;
  styles: ReturnType<typeof makeStyles>;
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
    <View style={s.group}>
      <Text accessibilityRole="header" style={s.title}>
        {tr("color.choose")}
      </Text>
      <Text style={s.detail}>
        {tr("color.chooseHelp")}
      </Text>
      <View style={s.choices}>
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
            style={[
              s.swatch,
              color === preset && s.selected,
              !hydrated && s.disabled,
            ]}
          >
            <View style={[s.swatchFill, { backgroundColor: preset }]} />
          </Pressable>
        ))}
      </View>
      <Text style={s.text}>{tr("color.hex")}</Text>
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
        style={s.input}
        onSubmitEditing={() => {
          if (hydrated && color) onChange({ type: "setCustomColor", color });
        }}
      />
      {!color && (
        <Text accessibilityRole="alert" style={s.detail}>
          {tr("color.invalid")}
        </Text>
      )}
      <View style={[s.preview, { backgroundColor: preview.sidebar }]}>
        <Text style={[s.title, { color: preview.ink }]}>
          {tr("color.preview", { color: color ?? initial })}
        </Text>
        <Text style={[s.detail, { color: preview.inkMuted }]}>
          {tr("color.sidebar")}
        </Text>
        <View
          style={[
            s.previewCard,
            {
              backgroundColor: preview.surface,
              borderColor: preview.paneFocus,
            },
          ]}
        >
          <Text style={[s.text, { color: preview.ink }]}>
            {tr("color.tabs")}
          </Text>
          <Text style={[s.detail, { color: preview.inkMuted }]}>
            {tr("color.tones")}
          </Text>
          <View
            style={{
              height: 4,
              borderRadius: 2,
              backgroundColor: preview.accent,
            }}
          />
        </View>
      </View>
      <Text style={s.detail}>
        {tr("color.seedHelp")}
      </Text>
      <View style={s.choices}>
        <Pressable
          accessibilityRole="button"
          disabled={!hydrated || !color || applied}
          accessibilityState={{ disabled: !hydrated || !color || applied }}
          onPress={() => color && onChange({ type: "setCustomColor", color })}
          style={[
            s.choice,
            s.selected,
            (!hydrated || !color || applied) && s.disabled,
          ]}
        >
          <Text style={s.text}>
            {tr(applied ? "color.applied" : "color.apply")}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!hydrated || draft === initial}
          accessibilityState={{ disabled: !hydrated || draft === initial }}
          onPress={() => setDraft(initial)}
          style={[s.choice, (!hydrated || draft === initial) && s.disabled]}
        >
          <Text style={s.text}>{tr("color.discard")}</Text>
        </Pressable>
      </View>
    </View>
  );
}
