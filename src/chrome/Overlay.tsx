import React, { useLayoutEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { motion as motionTokens } from "@/theme";
import { easing } from "@/chrome/motion";
import { useReducedMotion } from "@/chrome/useReducedMotion";
import { useResolveClassNames } from "uniwind";
import { cn } from "@/ui/cn";
import { useI18n } from "@/i18nContext";

// Keep committed content frozen during exit. A reversal continues from the
// visible pose; only a presentation after a completed exit starts afresh.
export function Overlay({
  open,
  children,
  style,
  className,
  pop = false,
  lift = 0,
  dim = true,
  touchThrough = false,
  reducedMotion: reducedMotionOverride,
  onExited,
}: {
  open: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  className?: string;
  /** Subtle scale entrance for dialogs and the new-tab page. */
  pop?: boolean;
  /** Slide the content in from `lift` px (banners, mini players). */
  lift?: number;
  /** Keep the scrim color; false floats the sheet over a visible page. */
  dim?: boolean;
  /** Let touches pass the overlay's own surface (notice banners). */
  touchThrough?: boolean;
  /** Defaults to the system's live reduced-motion preference. */
  reducedMotion?: boolean;
  onExited?: () => void;
}) {
  const systemReducedMotion = useReducedMotion();
  const reducedMotion = reducedMotionOverride ?? systemReducedMotion;
  const [mounted, setMounted] = useState(open);
  const present = useRef(open);
  const frozen = useRef<React.ReactNode>(null);
  const generation = useRef(0);
  const [{ opacity, scale, offset }] = useState(() => ({
    opacity: new Animated.Value(open && reducedMotion ? 1 : 0),
    scale: new Animated.Value(pop && !reducedMotion ? 0.97 : 1),
    offset: new Animated.Value(reducedMotion ? 0 : lift),
  }));
  const exitedRef = useRef(onExited);
  const resolved = useResolveClassNames(
    cn(className, !dim && "bg-transparent")
  );
  const guardStyle = useResolveClassNames("absolute inset-0");
  const clearScrim = useResolveClassNames("bg-transparent");

  // Updating open content must not schedule a second React commit. Keep the
  // callback committed too, so a pending render cannot change exit behavior.
  useLayoutEffect(() => {
    if (open) frozen.current = children;
    exitedRef.current = onExited;
  }, [children, open, onExited]);

  useLayoutEffect(() => {
    const currentGeneration = ++generation.current;
    let animation: Animated.CompositeAnimation | undefined;
    const cancel = () => {
      // Invalidate before stop: native drivers may synchronously call back.
      generation.current++;
      animation?.stop();
    };
    const completeExit = () => {
      if (generation.current !== currentGeneration || !present.current) return;
      generation.current++;
      present.current = false;
      frozen.current = null;
      setMounted(false);
      exitedRef.current?.();
    };

    if (open) {
      if (!present.current) {
        present.current = true;
        opacity.setValue(0);
        scale.setValue(pop ? 0.97 : 1);
        offset.setValue(lift);
        setMounted(true);
      }
      if (reducedMotion) {
        opacity.setValue(1);
        scale.setValue(1);
        offset.setValue(0);
        return cancel;
      }
    } else {
      if (!present.current) return cancel;
      if (reducedMotion) {
        opacity.setValue(0);
        completeExit();
        return cancel;
      }
    }

    // Animate every channel so changes to pop/lift cannot strand an old
    // transform. Timing keeps the small scale change free of spring bounce.
    const config = {
      duration: open ? motionTokens.base : motionTokens.fade,
      easing: open ? easing.enter : easing.exit,
      useNativeDriver: true,
    };
    animation = Animated.parallel([
      Animated.timing(opacity, { ...config, toValue: open ? 1 : 0 }),
      Animated.timing(scale, { ...config, toValue: open || !pop ? 1 : 0.98 }),
      Animated.timing(offset, { ...config, toValue: open ? 0 : lift / 2 }),
    ]);
    animation.start(({ finished }) => {
      if (finished && !open) completeExit();
    });
    return cancel;
  }, [open, pop, lift, reducedMotion, opacity, scale, offset]);

  // Mount the host in the opening commit so its native animated props attach
  // before the layout effect starts playback. `mounted` only retains exits.
  if (!open && !mounted) return null;
  return (
    <>
      {!open && !touchThrough && (
        // The moving surface cannot shield edges exposed by its transform.
        // Keep this guard until exit completes, even if the caller has already
        // re-enabled the page. A sibling preserves direct-child sheet sizing.
        <View
          collapsable={false}
          pointerEvents="box-only"
          onStartShouldSetResponder={() => true}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            guardStyle,
            { zIndex: StyleSheet.flatten([resolved, style])?.zIndex ?? 1 },
          ]}
        />
      )}
      <Animated.View
        pointerEvents={
          touchThrough
            ? open
              ? "box-none"
              : "none"
            : open
            ? "auto"
            : "box-only"
        }
        onStartShouldSetResponder={touchThrough ? undefined : () => true}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "auto" : "no-hide-descendants"}
        style={[
          resolved,
          style,
          !dim && clearScrim,
          {
            opacity,
            transform: [{ translateY: offset }, { scale }],
          },
        ]}
      >
        {open ? children : frozen.current}
      </Animated.View>
    </>
  );
}

export type OverlaySheetPosition = "center" | "bottom";

/**
 * Unified modal sheet surface over the GeckoView canvas: replaces separate
 * centered/bottom sheet wrappers and raw scrim blocks while preserving
 * `Overlay`'s native exit-freeze and `bodyBlocking` flash-guard timing.
 */
export function OverlaySheet({
  open,
  onClose,
  children,
  position = "center",
  bottomInset,
  dim = false,
  backdropDismiss = true,
  closeLabel,
  reducedMotion,
  className,
  contentClassName,
  style,
  onExited,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  position?: OverlaySheetPosition;
  bottomInset?: number;
  dim?: boolean;
  backdropDismiss?: boolean;
  closeLabel?: string;
  reducedMotion?: boolean;
  className?: string;
  contentClassName?: string;
  style?: StyleProp<ViewStyle>;
  onExited?: () => void;
}) {
  const { tr } = useI18n();
  const isBottom = position === "bottom";
  const resolvedStyle =
    bottomInset !== undefined ? [{ bottom: bottomInset }, style] : style;
  return (
    <Overlay
      open={open}
      className={cn(
        "absolute inset-0 bg-scrim justify-center items-center",
        className
      )}
      style={resolvedStyle}
      pop={!isBottom}
      lift={isBottom ? 16 : 0}
      dim={dim}
      reducedMotion={reducedMotion}
      onExited={onExited}
    >
      {open && (
        <>
          {backdropDismiss && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={closeLabel ?? tr("common.close")}
              className="absolute inset-0"
              onPress={onClose}
            />
          )}
          <View
            className={cn(
              "absolute inset-0",
              isBottom ? "justify-end" : "justify-center items-center",
              contentClassName
            )}
            pointerEvents="box-none"
          >
            {children}
          </View>
        </>
      )}
    </Overlay>
  );
}

