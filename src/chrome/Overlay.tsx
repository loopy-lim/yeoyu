import React, { useLayoutEffect, useRef, useState } from "react";
import {
  Animated,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { motion as motionTokens } from "../theme";
import { easing } from "./motion";
import { useReducedMotion } from "./useReducedMotion";

// Keep committed content frozen during exit. A reversal continues from the
// visible pose; only a presentation after a completed exit starts afresh.
export function Overlay({
  open,
  children,
  style,
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
            StyleSheet.absoluteFill,
            { zIndex: StyleSheet.flatten(style)?.zIndex ?? 1 },
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
          dim ? style : [style, { backgroundColor: "transparent" }],
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
