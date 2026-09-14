import React from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { useStyles } from "../chrome/appStyles";
import { ChromeIcon } from "../chrome/ChromeIcon";
import type { PictureInPictureState } from "../hooks/usePictureInPicture";
import { useTheme } from "../themeContext";

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
  const s = useStyles(theme);
  const toggleDisabled = !hydrated || !state.supported;
  const enterDisabled =
    !state.supported || !state.allowed || !hasTab || externalBusy;

  return (
    <>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel="Automatic picture-in-picture"
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
          <Text style={s.optionTitle}>Automatic picture-in-picture</Text>
          <Text style={s.optionDescription}>
            Keep playing video in a floating window when switching tabs. If
            unavailable, picture-in-picture opens when you go Home.
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
          Picture-in-picture is not available on this device.
        </Text>
      )}
      {state.supported && !state.allowed && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Android PiP settings"
          style={({ pressed }) => [s.settingsAction, pressed && s.pressed]}
          onPress={onOpenSettings}
        >
          <View style={s.settingsToggleCopy}>
            <Text style={s.optionTitle}>Android PiP settings</Text>
            <Text style={s.optionDescription}>
              Allow picture-in-picture for Yeoyu in Android settings
            </Text>
          </View>
          <ChromeIcon name="external" />
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open picture-in-picture"
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
          <Text style={s.optionTitle}>Open picture-in-picture</Text>
          <Text style={s.optionDescription}>
            {hasTab
              ? "Show the current tab in a small window now"
              : "Open a tab to use picture-in-picture"}
          </Text>
        </View>
        <ChromeIcon name="external" />
      </Pressable>
    </>
  );
}
