import React from "react";
import {
  Modal,
  Pressable,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useReducedMotion } from "@/chrome/useReducedMotion";
import { cn } from "@/ui/cn";

export type PortalModalPosition = "center" | "bottom";

/**
 * Shared native `<Modal>` portal wrapper with reduced-motion animation
 * parity, scrim layout, hardware Back dismiss (`onRequestClose`), and an
 * untagged backdrop press target (`accessible={false}`) so touch dismiss
 * does not alter TalkBack / row button enumeration.
 */
export function PortalModal({
  visible,
  onClose,
  children,
  position = "center",
  backdropDismiss = true,
  reducedMotion: reducedMotionOverride,
  backdropClassName,
  contentClassName,
  style,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  position?: PortalModalPosition;
  backdropDismiss?: boolean;
  reducedMotion?: boolean;
  backdropClassName?: string;
  contentClassName?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const systemReducedMotion = useReducedMotion();
  const reducedMotion = reducedMotionOverride ?? systemReducedMotion;
  return (
    <Modal
      transparent
      visible={visible}
      animationType={reducedMotion ? "none" : "fade"}
      onRequestClose={onClose}
    >
      <View
        className={cn(
          "flex-1 bg-scrim p-[20px]",
          position === "bottom" ? "justify-end" : "justify-center items-center",
          backdropClassName,
          contentClassName
        )}
        style={style}
      >
        {backdropDismiss && (
          <Pressable
            accessible={false}
            className="absolute inset-0"
            onPress={onClose}
          />
        )}
        {children}
      </View>
    </Modal>
  );
}
