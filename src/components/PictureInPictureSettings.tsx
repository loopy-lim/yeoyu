import React from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { useStyles } from "../chrome/appStyles";
import { ChromeIcon } from "../chrome/ChromeIcon";
import type { PictureInPictureState } from "../hooks/usePictureInPicture";
import { useTheme } from "../themeContext";
import { useI18n } from "../i18nContext";

interface Props {
  state: PictureInPictureState;
  enabled: boolean;
  hydrated: boolean;
  hasTab: boolean;
  externalBusy?: boolean;
  onToggle: () => void;
  onEnter: () => void;
  onOpenSettings: () => void;
}

export function PictureInPictureSettings({
  state,
  enabled,
  hydrated,
  hasTab,
  externalBusy = false,
  onToggle,
  onEnter,
  onOpenSettings,
}: Props) {
  const theme = useTheme();
  const { tr } = useI18n();
  const s = useStyles(theme);
  const toggleDisabled = !hydrated || !state.supported;
  const enterDisabled =
    !state.supported || !state.allowed || !hasTab || externalBusy;

  return (
    <>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={tr("pip.automatic")}
        accessibilityState={{ checked: enabled, disabled: toggleDisabled }}
        disabled={toggleDisabled}
        style={({ pressed }) => [
          s.settingsToggle,
          pressed && s.pressed,
          toggleDisabled && s.disabled,
        ]}
        onPress={onToggle}
      >
        <View style={s.settingsToggleCopy}>
          <Text style={s.optionTitle}>{tr("pip.automatic")}</Text>
          <Text style={s.optionDescription}>
            {tr("pip.automaticHelp")}
          </Text>
        </View>
        <View
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
        >
          <Switch
            accessible={false}
            disabled={toggleDisabled}
            value={enabled}
            trackColor={{ false: theme.switchOff, true: theme.accent }}
            thumbColor={theme.surfaceElevated}
          />
        </View>
      </Pressable>
      {!state.supported && (
        <Text style={s.optionDescription}>
          {tr("pip.unsupported")}
        </Text>
      )}
      {state.supported && !state.allowed && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("pip.androidSettings")}
          style={({ pressed }) => [s.settingsAction, pressed && s.pressed]}
          onPress={onOpenSettings}
        >
          <View style={s.settingsToggleCopy}>
            <Text style={s.optionTitle}>{tr("pip.androidSettings")}</Text>
            <Text style={s.optionDescription}>
              {tr("pip.androidHelp")}
            </Text>
          </View>
          <ChromeIcon name="external" />
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr("pip.open")}
        accessibilityState={{ disabled: enterDisabled }}
        disabled={enterDisabled}
        style={({ pressed }) => [
          s.settingsAction,
          pressed && s.pressed,
          enterDisabled && s.disabled,
        ]}
        onPress={onEnter}
      >
        <View style={s.settingsToggleCopy}>
          <Text style={s.optionTitle}>{tr("pip.open")}</Text>
          <Text style={s.optionDescription}>
            {hasTab
              ? tr("pip.openNow")
              : tr("pip.openTab")}
          </Text>
        </View>
        <ChromeIcon name="external" />
      </Pressable>
    </>
  );
}
