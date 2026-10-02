import { cva } from "class-variance-authority";
import { cn } from "@/ui/cn";
import React from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { appClasses as c } from "@/chrome/appStyles";
import { ChromeIcon } from "@/chrome/ChromeIcon";
import type { PictureInPictureState } from "@/hooks/usePictureInPicture";
import { useTheme } from "@/themeContext";
import { useI18n } from "@/i18nContext";

const actionState = cva("active:opacity-pressed", {
  variants: { disabled: { true: "opacity-disabled", false: "" } },
});

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
        className={cn(
          c.settingsToggle,
          actionState({ disabled: toggleDisabled })
        )}
        onPress={onToggle}
      >
        <View className={c.settingsToggleCopy}>
          <Text className={c.optionTitle}>{tr("pip.automatic")}</Text>
          <Text className={c.optionDescription}>{tr("pip.automaticHelp")}</Text>
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
        <Text className={c.optionDescription}>{tr("pip.unsupported")}</Text>
      )}
      {state.supported && !state.allowed && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("pip.androidSettings")}
          className={cn(c.settingsAction, actionState())}
          onPress={onOpenSettings}
        >
          <View className={c.settingsToggleCopy}>
            <Text className={c.optionTitle}>{tr("pip.androidSettings")}</Text>
            <Text className={c.optionDescription}>{tr("pip.androidHelp")}</Text>
          </View>
          <ChromeIcon name="external" />
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr("pip.open")}
        accessibilityState={{ disabled: enterDisabled }}
        disabled={enterDisabled}
        className={cn(
          c.settingsAction,
          actionState({ disabled: enterDisabled })
        )}
        onPress={onEnter}
      >
        <View className={c.settingsToggleCopy}>
          <Text className={c.optionTitle}>{tr("pip.open")}</Text>
          <Text className={c.optionDescription}>
            {hasTab ? tr("pip.openNow") : tr("pip.openTab")}
          </Text>
        </View>
        <ChromeIcon name="external" />
      </Pressable>
    </>
  );
}
