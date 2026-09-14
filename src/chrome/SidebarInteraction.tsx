import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Animated, Pressable } from "react-native";

const SidebarActive = createContext(true);
export const useSidebarActive = () => useContext(SidebarActive);

/** Visit lazily, keep heavy chrome mounted, and retain the outgoing fade. */
export function SidebarLayer({
  visible,
  active,
  children,
  style,
}: {
  visible: boolean;
  active: boolean;
  children: React.ReactNode;
  style?: React.ComponentProps<typeof Animated.View>["style"];
}) {
  const visited = useRef(false);
  useLayoutEffect(() => {
    if (visible) visited.current = true;
  }, [visible]);
  if (!visible && !visited.current) return null;
  return (
    <SidebarActive.Provider value={active && visible}>
      <Animated.View
        collapsable={false}
        pointerEvents={active && visible ? "auto" : "none"}
        accessibilityElementsHidden={!active || !visible}
        importantForAccessibility={
          active && visible ? "auto" : "no-hide-descendants"
        }
        style={[style, !visible && { display: "none" }]}
      >
        {children}
      </Animated.View>
    </SidebarActive.Provider>
  );
}

/** Reset public RN Pressability on hide; showing reuses the idle replacement. */
export function SidebarPressable({
  style,
  children,
  ...props
}: React.ComponentProps<typeof Pressable>) {
  const active = useSidebarActive();
  const [boundary, setBoundary] = useState({ active, generation: 0 });
  // Adjust only this component before its children commit. A layout-effect
  // update would first commit the still-armed Pressable under inactive chrome.
  if (boundary.active !== active) {
    setBoundary({ active, generation: boundary.generation + (active ? 0 : 1) });
  }
  const generation = boundary.generation;
  const committed = useRef({ active, generation });
  useLayoutEffect(() => {
    committed.current = { active, generation };
  }, [active, generation]);
  const live = () =>
    active &&
    committed.current.active &&
    committed.current.generation === generation;
  const guard = <Event,>(
    callback: ((event: Event) => void) | null | undefined
  ) =>
    callback
      ? (event: Event) => {
          if (live()) callback(event);
        }
      : undefined;
  return (
    <Pressable
      {...props}
      key={generation}
      disabled={props.disabled || !active}
      focusable={active && props.focusable !== false}
      onPress={guard(props.onPress)}
      onLongPress={guard(props.onLongPress)}
      onPressIn={guard(props.onPressIn)}
      onPressOut={guard(props.onPressOut)}
      onPressMove={guard(props.onPressMove)}
      onPointerDown={guard(props.onPointerDown)}
      onPointerUp={guard(props.onPointerUp)}
      onPointerMove={guard(props.onPointerMove)}
      onPointerCancel={guard(props.onPointerCancel)}
      onAccessibilityAction={guard(props.onAccessibilityAction)}
      style={
        typeof style === "function"
          ? (state) => style({ pressed: live() && state.pressed })
          : style
      }
    >
      {typeof children === "function"
        ? (state) => children({ pressed: live() && state.pressed })
        : children}
    </Pressable>
  );
}
