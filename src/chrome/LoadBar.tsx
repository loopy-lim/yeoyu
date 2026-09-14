import React, { useEffect, useRef, useState } from "react";
import { Animated } from "react-native";
import { motion } from "../theme";
import { easing } from "./motion";
import type { Theme } from "../theme";
import type { TabLoadState } from "../tabProgress";
import { useReducedMotion } from "./useReducedMotion";

export type LoadState = TabLoadState;

// Keep a fixed layout width and scale the hairline on the native driver.
// Completion reaches the right edge before fading away.
export function LoadBar({
  state,
  theme,
  reducedMotion: overrideReducedMotion,
}: {
  state?: LoadState;
  theme: Theme;
  reducedMotion?: boolean;
}) {
  const systemReducedMotion = useReducedMotion();
  const reducedMotion = overrideReducedMotion ?? systemReducedMotion;
  const [opacity] = useState(() => new Animated.Value(0));
  const [fill] = useState(() => new Animated.Value(0));
  const wasLoading = useRef(false);
  const previousTarget = useRef(0);
  const hasState = state !== undefined;
  const loading = !!state?.loading;
  const progress = state?.progress;
  const target = loading
    ? Math.min(
        1,
        Math.max(Number.isFinite(progress) ? progress! / 100 : 0, 0.04)
      )
    : 1;
  useEffect(() => {
    let active = true;
    let animation: Animated.CompositeAnimation | undefined;
    let fade: Animated.CompositeAnimation | undefined;
    const completing = wasLoading.current && !loading;
    const restarting = !wasLoading.current || target < previousTarget.current;
    wasLoading.current = loading;
    previousTarget.current = target;
    if (!hasState) {
      opacity.setValue(0);
      fill.setValue(0);
      return;
    }
    if (reducedMotion) {
      opacity.setValue(loading ? 1 : 0);
      fill.setValue(target);
      return;
    }
    if (loading || completing) {
      opacity.setValue(1);
      if (loading && restarting) fill.setValue(0.04);
      animation = Animated.timing(fill, {
        toValue: target,
        duration: completing ? motion.micro : motion.base,
        easing: easing.standard,
        useNativeDriver: true,
      });
      animation.start(({ finished }) => {
        if (!active || !finished || loading) return;
        fade = Animated.timing(opacity, {
          toValue: 0,
          duration: motion.base,
          easing: easing.exit,
          useNativeDriver: true,
        });
        fade.start();
      });
    } else {
      opacity.setValue(0);
      fill.setValue(1);
    }
    return () => {
      active = false;
      animation?.stop();
      fade?.stop();
    };
  }, [hasState, loading, target, reducedMotion, fill, opacity]);
  if (!state) return null;
  return (
    <Animated.View
      accessible={false}
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 5,
        opacity,
      }}
    >
      <Animated.View
        style={{
          height: 2,
          width: "100%",
          transformOrigin: [0, 0, 0],
          transform: [{ scaleX: fill }],
          backgroundColor: theme.accent,
        }}
      />
    </Animated.View>
  );
}
