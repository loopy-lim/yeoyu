import React, { useLayoutEffect, useRef, useState } from "react";
import { Animated } from "react-native";
import { easing } from "./motion";
import { useReducedMotion } from "./useReducedMotion";

/** Keep the folder's layout until its rows finish fading out. */
export function FolderDisclosure({
  open,
  children,
  reducedMotion: reducedMotionOverride,
}: {
  open: boolean;
  children: React.ReactNode;
  reducedMotion?: boolean;
}) {
  const systemReducedMotion = useReducedMotion();
  const reducedMotion = reducedMotionOverride ?? systemReducedMotion;
  const [mounted, setMounted] = useState(open);
  const present = useRef(open);
  const frozen = useRef<React.ReactNode>(null);
  const generation = useRef(0);
  const [progress] = useState(
    () => new Animated.Value(open && reducedMotion ? 1 : 0)
  );

  useLayoutEffect(() => {
    if (open) frozen.current = children;
  }, [open, children]);

  useLayoutEffect(() => {
    const currentGeneration = ++generation.current;
    let animation: Animated.CompositeAnimation | undefined;
    const cancel = () => {
      // Stop may synchronously deliver completion from the native driver.
      generation.current++;
      animation?.stop();
    };
    const completeExit = () => {
      if (generation.current !== currentGeneration || !present.current) return;
      generation.current++;
      present.current = false;
      frozen.current = null;
      setMounted(false);
    };

    if (open && !present.current) {
      present.current = true;
      progress.setValue(0);
      setMounted(true);
    } else if (!open && !present.current) {
      return cancel;
    }

    if (reducedMotion) {
      progress.setValue(open ? 1 : 0);
      if (!open) completeExit();
      return cancel;
    }

    animation = Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: open ? 170 : 120,
      easing: open ? easing.enter : easing.exit,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished && !open) completeExit();
    });
    return cancel;
  }, [open, reducedMotion, progress]);

  // The opening commit must attach the animated host before playback starts.
  if (!open && !mounted) return null;
  return (
    <Animated.View
      pointerEvents={open ? "auto" : "none"}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      style={{
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [-4, 0],
            }),
          },
        ],
      }}
    >
      {open ? children : frozen.current}
    </Animated.View>
  );
}
