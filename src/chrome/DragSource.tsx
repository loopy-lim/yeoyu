import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  PanResponder,
  type GestureResponderEvent,
  type PointerEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { motion } from "../theme";
import { easing } from "./motion";
import { useReducedMotion } from "./useReducedMotion";
import { useSidebarActive } from "./SidebarInteraction";
type ContactEvent = {
  nativeEvent: {
    identifier?: number;
    pointerId?: number;
    timestamp?: number;
    pageX?: number;
    pageY?: number;
  };
};
type Phase = "idle" | "pending" | "armed" | "dragging" | "cancelled";
interface Props {
  accessibilityLabel: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress: () => void;
  onDragStart: (x: number, y: number) => void;
  onDragMove: (x: number, y: number) => void;
  onDragRelease: (x: number, y: number) => void;
  onDragCancel: () => void;
  onLongPress?: (x: number, y: number) => void;
  reducedMotion?: boolean;
}
export function DragSource(props: Props) {
  const active = useSidebarActive();
  // A visibility interval owns its handlers independently of each touch timer.
  // Old native callbacks must not affect a fresh drag after hide/show.
  const interaction = useMemo(() => ({ active }), [active]);
  const committedInteraction = useRef<typeof interaction | null>(interaction);
  useLayoutEffect(() => {
    committedInteraction.current = interaction;
    return () => {
      committedInteraction.current = null;
    };
  }, [interaction]);
  const isCurrentInteraction = useCallback(
    () => interaction.active && committedInteraction.current === interaction,
    [interaction]
  );
  const systemReducedMotion = useReducedMotion();
  const reducedMotion = props.reducedMotion ?? systemReducedMotion;
  const cb = useRef({ ...props, reducedMotion, active });
  useLayoutEffect(() => {
    cb.current = { ...props, reducedMotion, active };
  }, [props, reducedMotion, active]);
  const phase = useRef<Phase>("idle");
  const gestureGeneration = useRef(0);
  const contact = useRef<ContactEvent["nativeEvent"] | null>(null);
  const isCurrentContact = useCallback((event?: ContactEvent) => {
    const started = contact.current;
    if (!started) return false;
    const incoming = event?.nativeEvent;
    if (!incoming) return true;
    for (const key of ["identifier", "pointerId"] as const) {
      if (
        typeof started[key] === "number" &&
        typeof incoming[key] === "number" &&
        started[key] !== incoming[key]
      )
        return false;
    }
    return !(
      typeof started.timestamp === "number" &&
      typeof incoming.timestamp === "number" &&
      incoming.timestamp < started.timestamp
    );
  }, []);
  const owns = useRef(false);
  const moved = useRef(false);
  const handled = useRef(false);
  const mouse = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    origin = useRef({ x: 0, y: 0 }),
    point = useRef({ x: 0, y: 0 });
  // A quiet press treatment shares the chrome's scale and timing tokens.
  const [press] = useState(() => new Animated.Value(1));
  const [scale] = useState(() => new Animated.Value(1));
  const pressAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const hasAnimatedPress = useRef(false);
  const handledFrame = useRef<ReturnType<typeof requestAnimationFrame> | null>(
    null
  );
  const resetPress = useCallback(() => {
    // Untouched values already equal 1; avoid scheduling animated prop updates.
    if (!hasAnimatedPress.current) return;
    pressAnimation.current?.stop();
    pressAnimation.current = null;
    press.setValue(1);
    scale.setValue(1);
    hasAnimatedPress.current = false;
  }, [press, scale]);
  const animatePress = useCallback(
    (opacity: number, targetScale: number, duration: number) => {
      hasAnimatedPress.current = true;
      pressAnimation.current?.stop();
      pressAnimation.current = Animated.parallel([
        Animated.timing(press, {
          toValue: opacity,
          duration,
          easing: easing.standard,
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: targetScale,
          duration,
          easing: easing.standard,
          useNativeDriver: true,
        }),
      ]);
      pressAnimation.current.start();
    },
    [press, scale]
  );
  const pressDim = useCallback(() => {
    if (cb.current.reducedMotion) {
      resetPress();
      return;
    }
    animatePress(0.86, motion.press.scale, motion.micro);
  }, [animatePress, resetPress]);
  const pressLift = useCallback(() => {
    if (cb.current.reducedMotion) {
      resetPress();
      return;
    }
    animatePress(1, 1, motion.fade);
  }, [animatePress, resetPress]);
  useLayoutEffect(() => {
    if (reducedMotion) resetPress();
  }, [reducedMotion, resetPress]);
  const resetHandledNextFrame = useCallback(() => {
    if (handledFrame.current !== null)
      cancelAnimationFrame(handledFrame.current);
    const generation = gestureGeneration.current;
    handledFrame.current = requestAnimationFrame(() => {
      if (!isCurrentInteraction() || generation !== gestureGeneration.current)
        return;
      handled.current = false;
      handledFrame.current = null;
    });
  }, [isCurrentInteraction]);
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const cancel = useCallback(() => {
    clear();
    resetPress();
    if (phase.current === "dragging") cb.current.onDragCancel();
    phase.current = "cancelled";
    contact.current = null;
  }, [clear, resetPress]);
  const track = useCallback(
    (e: {
      nativeEvent: {
        pageX: number;
        pageY: number;
        touches: readonly unknown[];
      };
    }) => {
      if (!isCurrentInteraction() || !isCurrentContact(e)) return;
      point.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
      if (e.nativeEvent.touches.length !== 1) {
        cancel();
        return;
      }
      const d = Math.hypot(
        point.current.x - origin.current.x,
        point.current.y - origin.current.y
      );
      // Quick movement before the hold is a scroll, not a drag. Movement
      // after the hold promotes the press into a drag.
      if (phase.current === "pending" && mouse.current && d > 3) {
        clear();
        moved.current = true;
        phase.current = "dragging";
        cb.current.onDragStart(point.current.x, point.current.y);
      } else if (phase.current === "pending" && d > 10) {
        cancel();
      }
      if (phase.current === "armed" && d > 10) {
        clear();
        moved.current = true;
        phase.current = "dragging";
        cb.current.onDragStart(point.current.x, point.current.y);
      }
      if (phase.current === "dragging" && d > 6) moved.current = true;
    },
    [cancel, clear, isCurrentInteraction, isCurrentContact]
  );
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: () =>
          isCurrentInteraction() && phase.current === "dragging",
        onMoveShouldSetPanResponderCapture: () =>
          isCurrentInteraction() && phase.current === "dragging",
        onPanResponderGrant: (event) => {
          if (
            !isCurrentInteraction() ||
            !isCurrentContact(event) ||
            phase.current === "cancelled" ||
            phase.current === "idle"
          )
            return;
          owns.current = true;
        },
        onPanResponderMove: (e) => {
          if (!isCurrentInteraction() || !isCurrentContact(e)) return;
          track(e);
          if (phase.current === "dragging")
            cb.current.onDragMove(point.current.x, point.current.y);
        },
        onPanResponderRelease: (event) => {
          if (
            !isCurrentInteraction() ||
            !isCurrentContact(event) ||
            phase.current === "cancelled" ||
            phase.current === "idle"
          )
            return;
          owns.current = false;
          handled.current = true;
          clear();
          pressLift();
          if (phase.current === "dragging" && moved.current)
            cb.current.onDragRelease(
              event.nativeEvent.pageX,
              event.nativeEvent.pageY
            );
          else if (phase.current === "dragging") {
            if (cb.current.onLongPress)
              cb.current.onLongPress(
                event.nativeEvent.pageX,
                event.nativeEvent.pageY
              );
            else cb.current.onDragCancel();
          }
          phase.current = "idle";
          resetHandledNextFrame();
        },
        onPanResponderTerminate: (event) => {
          if (
            !isCurrentInteraction() ||
            !isCurrentContact(event) ||
            phase.current === "cancelled" ||
            phase.current === "idle"
          )
            return;
          owns.current = false;
          handled.current = true;
          cancel();
          phase.current = "idle";
          resetHandledNextFrame();
        },
        onPanResponderTerminationRequest: () =>
          !isCurrentInteraction() || phase.current !== "dragging",
      }),
    [
      cancel,
      clear,
      pressLift,
      resetHandledNextFrame,
      track,
      isCurrentInteraction,
      isCurrentContact,
    ]
  );
  const cancelInteraction = useCallback(() => {
    const dragging = phase.current === "dragging";
    ++gestureGeneration.current;
    contact.current = null;
    clear();
    resetPress();
    if (handledFrame.current !== null)
      cancelAnimationFrame(handledFrame.current);
    handledFrame.current = null;
    phase.current = "cancelled";
    owns.current = false;
    moved.current = false;
    mouse.current = false;
    handled.current = true;
    if (dragging) cb.current.onDragCancel();
  }, [clear, resetPress]);
  useLayoutEffect(() => {
    if (!active) cancelInteraction();
  }, [active, cancelInteraction]);
  useEffect(() => cancelInteraction, [cancelInteraction]);
  const start = (e: GestureResponderEvent) => {
    if (!isCurrentInteraction() || mouse.current) return;
    if (e.nativeEvent.touches.length !== 1) {
      cancel();
      return;
    }
    contact.current = {
      identifier: e.nativeEvent.identifier,
      timestamp: e.nativeEvent.timestamp,
    };
    handled.current = false;
    owns.current = false;
    moved.current = false;
    phase.current = "pending";
    origin.current = point.current = {
      x: e.nativeEvent.pageX,
      y: e.nativeEvent.pageY,
    };
    clear();
    pressDim();
    const generation = ++gestureGeneration.current;
    timer.current = setTimeout(() => {
      if (
        !isCurrentInteraction() ||
        generation !== gestureGeneration.current ||
        phase.current !== "pending"
      )
        return;
      // Long hold arms the press: releasing without movement opens the
      // long-press action (tab menu), movement from here on drags.
      phase.current = "armed";
    }, 240);
  };
  const end = (event: GestureResponderEvent) => {
    if (!isCurrentInteraction() || !isCurrentContact(event) || mouse.current)
      return;
    pressLift();
    if (owns.current) return;
    if (handled.current) {
      handled.current = false;
      return;
    }
    clear();
    if (phase.current === "pending") cb.current.onPress();
    else if (phase.current === "armed")
      cb.current.onLongPress?.(point.current.x, point.current.y);
    else if (phase.current === "dragging") cb.current.onDragCancel();
    phase.current = "idle";
  };
  const pointerDown = (event: PointerEvent) => {
    if (!isCurrentInteraction()) return;
    if (event.nativeEvent.pointerType !== "mouse") {
      mouse.current = false;
      return;
    }
    ++gestureGeneration.current;
    // Android exposes a native timestamp even though NativePointerEvent omits it.
    const timestamp =
      "timestamp" in event.nativeEvent ? event.nativeEvent.timestamp : undefined;
    contact.current = {
      pointerId: event.nativeEvent.pointerId,
      timestamp:
        typeof timestamp === "number" && Number.isFinite(timestamp)
          ? timestamp
          : undefined,
    };
    mouse.current = true;
    clear();
    handled.current = false;
    moved.current = false;
    owns.current = false;
    origin.current = point.current = {
      x: event.nativeEvent.pageX,
      y: event.nativeEvent.pageY,
    };
    if (event.nativeEvent.button === 2) {
      phase.current = "cancelled";
      cb.current.onLongPress?.(point.current.x, point.current.y);
    } else if (event.nativeEvent.button === 0) {
      phase.current = "pending";
      pressDim();
    } else phase.current = "cancelled";
  };
  const pointerMove = (event: PointerEvent) => {
    if (
      !isCurrentInteraction() ||
      !isCurrentContact(event) ||
      !mouse.current ||
      !(event.nativeEvent.buttons & 1)
    )
      return;
    // Feed the same state machine, with a single primary mouse contact.
    track({
      nativeEvent: {
        pageX: event.nativeEvent.pageX,
        pageY: event.nativeEvent.pageY,
        touches: [{}],
      },
    });
    if (phase.current === "dragging")
      cb.current.onDragMove(point.current.x, point.current.y);
  };
  const pointerUp = (event: PointerEvent) => {
    if (!isCurrentInteraction() || !isCurrentContact(event) || !mouse.current)
      return;
    clear();
    pressLift();
    if (!handled.current) {
      if (phase.current === "dragging")
        cb.current.onDragRelease(
          event.nativeEvent.pageX,
          event.nativeEvent.pageY
        );
      else if (phase.current === "pending") cb.current.onPress();
    }
    phase.current = "idle";
    handled.current = true;
    owns.current = false;
    mouse.current = false;
  };
  return (
    <Animated.View
      {...responder.panHandlers}
      accessible
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={(event) => {
        if (!isCurrentInteraction() || !isCurrentContact(event)) return;
        cancel();
        mouse.current = false;
      }}
      accessibilityActions={[{ name: "activate" }, { name: "longpress" }]}
      onAccessibilityAction={(e) => {
        if (!isCurrentInteraction()) return;
        if (e.nativeEvent.actionName === "activate") props.onPress();
        if (e.nativeEvent.actionName === "longpress") props.onLongPress?.(0, 0);
      }}
      onTouchStart={start}
      onTouchMove={(event) => {
        if (!isCurrentInteraction()) return;
        if (!mouse.current) track(event);
      }}
      onTouchEnd={end}
      onTouchCancel={(event) => {
        if (!isCurrentInteraction() || !isCurrentContact(event)) return;
        cancel();
        phase.current = "idle";
      }}
      style={[props.style, { opacity: press, transform: [{ scale }] }]}
    >
      {props.children}
    </Animated.View>
  );
}
