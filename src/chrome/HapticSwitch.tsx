import React from "react";
import { Switch, type SwitchProps } from "react-native";
import { platform } from "../platform";

// Settings toggles confirm with the same tick haptic as navigation; the
// value change itself stays the caller's concern.
export function HapticSwitch(props: SwitchProps) {
  return (
    <Switch
      {...props}
      onValueChange={(value) => {
        platform.haptic?.("tick");
        props.onValueChange?.(value);
      }}
    />
  );
}
