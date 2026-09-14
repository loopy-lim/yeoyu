import { useLayoutEffect, useRef, useState } from "react";
import { Animated } from "react-native";
import type { SplitLayout } from "../splitLayout";
import { motion } from "../theme";
import { easing } from "./motion";

type SplitInSpace = { layout: SplitLayout; space: string };

/** One JS progress drives sidebar width, toolbar height, and both chrome layers. */
export function useSidebarMotion(collapsed: boolean, reduced: boolean) {
  const [progress] = useState(() => new Animated.Value(collapsed ? 0 : 1));
  const previous = useRef(collapsed);
  const [moving, setMoving] = useState(false);
  useLayoutEffect(() => {
    const changed = previous.current !== collapsed;
    previous.current = collapsed;
    if (reduced) {
      progress.setValue(collapsed ? 0 : 1);
      setMoving(false);
      return;
    }
    if (!changed) return;
    setMoving(true);
    let current = true;
    const animation = Animated.timing(progress, {
      toValue: collapsed ? 0 : 1,
      duration: motion.slide,
      easing: easing.geometry,
      useNativeDriver: false,
    });
    animation.start(({ finished }) => {
      if (current && finished) setMoving(false);
    });
    return () => {
      current = false;
      animation.stop();
    };
  }, [collapsed, reduced, progress]);
  // Retain outgoing children in the first commit, before the effect runs.
  const retain = !reduced && (moving || previous.current !== collapsed);
  return {
    progress,
    expanded: !collapsed || retain,
    rail: collapsed || retain,
  };
}

/** Animate the committed Space, including changes initiated outside its rail. */
export function useSpaceMotion(id: string, index: number, reduced: boolean) {
  const previous = useRef({ id, index });
  const [opacity] = useState(() => new Animated.Value(1));
  const [offset] = useState(() => new Animated.Value(0));
  const moving = useRef(false);
  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = { id, index };
    if (reduced || !old.id) {
      moving.current = false;
      opacity.setValue(1);
      offset.setValue(0);
      return;
    }
    const changed = old.id !== id;
    const interrupted = moving.current;
    if (!changed && !interrupted) return;
    const direction = index < old.index ? -1 : 1;
    if (!interrupted) {
      opacity.setValue(0.45);
      offset.setValue(direction * 12);
    }
    // Reversing mid-flight gives the new direction a small animated response;
    // never teleport the current offset or dim an already visible Space again.
    const nudge = interrupted && changed;
    const duration = nudge ? motion.micro / 2 : motion.slide;
    let current = true;
    let nudged = false;
    moving.current = true;
    let animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        easing: easing.enter,
        useNativeDriver: true,
      }),
      Animated.timing(offset, {
        toValue: nudge ? direction * 4 : 0,
        duration,
        easing: easing.enter,
        useNativeDriver: true,
      }),
    ]);
    animation.start(({ finished }) => {
      if (!current || !finished) return;
      if (!nudge) {
        moving.current = false;
        return;
      }
      if (nudged) return;
      nudged = true;
      animation = Animated.timing(offset, {
        toValue: 0,
        duration: motion.slide - duration,
        easing: easing.enter,
        useNativeDriver: true,
      });
      animation.start(({ finished: settled }) => {
        if (current && settled) moving.current = false;
      });
    });
    return () => {
      current = false;
      animation.stop();
    };
  }, [id, index, reduced, opacity, offset]);
  return { opacity, offset };
}

/** Only a surviving member in the same Space may keep the outgoing pair alive. */
export function useSplitMotion(
  live: SplitLayout | null,
  space: string,
  selected: string | null | undefined,
  reduced: boolean,
  restoreToken?: number
) {
  const retained = useRef<SplitInSpace | null>(
    live ? { layout: live, space } : null
  );
  const [exitFinished, setExitFinished] = useState(!live);
  const [settledLayout, setSettledLayout] = useState<SplitInSpace | null>(
    () => (live ? { layout: live, space } : null)
  );
  const [progress] = useState(() => new Animated.Value(live ? 1 : 0));
  const [firstFraction] = useState(() => new Animated.Value(live?.ratio ?? 1));
  const moving = useRef(false);
  const open = !!live;
  const previous = useRef({ open, space, selected });
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { open, space, selected };
    const stored = retained.current;
    const newPair =
      !!live &&
      (!stored ||
        stored.space !== space ||
        stored.layout.first !== live.first ||
        stored.layout.second !== live.second);
    if (live) retained.current = { layout: live, space };
    const pair = retained.current;
    const mayClose =
      pair?.space === space &&
      (selected === pair.layout.first || selected === pair.layout.second);
    const fraction = live?.ratio ?? (selected === pair?.layout.second ? 0 : 1);
    const settled =
      !moving.current &&
      before.open === open &&
      before.space === space &&
      !newPair;
    let current = true;
    if (
      reduced ||
      (open && restoreToken !== undefined) ||
      (!open && !mayClose) ||
      settled
    ) {
      moving.current = false;
      progress.setValue(open ? 1 : 0);
      firstFraction.setValue(fraction);
      setExitFinished(!open);
      setSettledLayout((current) => {
        if (current?.layout === live && current?.space === space) return current;
        return live ? { layout: live, space } : null;
      });
      return;
    }
    setSettledLayout(null);
    if (live && newPair) {
      firstFraction.setValue(before.selected === live.second ? 0 : 1);
      progress.setValue(0);
    }
    if (open) setExitFinished(false);
    moving.current = true;
    const config = {
      duration: open ? motion.split : motion.base,
      easing: easing.geometry,
      useNativeDriver: false,
    };
    // A separate fraction preserves geometry when the surviving pane changes
    // during a reversal. Reinterpreting progress around a new anchor would jump.
    const animation = Animated.parallel([
      Animated.timing(progress, { ...config, toValue: open ? 1 : 0 }),
      Animated.timing(firstFraction, { ...config, toValue: fraction }),
    ]);
    animation.start(({ finished }) => {
      if (!current || !finished) return;
      current = false;
      moving.current = false;
      // Equal setValue still flushes JS-driven bindings. Publish both final
      // values before the numeric commit detaches their Animated nodes.
      progress.setValue(open ? 1 : 0);
      firstFraction.setValue(fraction);
      setExitFinished(!open);
      // Opening already has exitFinished=false. A distinct completion state
      // commits the final numeric geometry instead of relying on Fabric's
      // last per-frame update to remain the final native flex value.
      setSettledLayout(live ? { layout: live, space } : null);
    });
    return () => {
      current = false;
      animation.stop();
    };
  }, [
    live, open, space, selected, reduced, restoreToken, progress, firstFraction,
  ]);
  const old = retained.current;
  const mayRetain =
    !reduced &&
    !exitFinished &&
    old?.space === space &&
    (selected === old.layout.first || selected === old.layout.second);
  return {
    progress,
    firstFraction,
    settled:
      !!live &&
      settledLayout?.layout === live &&
      settledLayout.space === space,
    layout: live ?? (mayRetain ? old!.layout : null),
  };
}
