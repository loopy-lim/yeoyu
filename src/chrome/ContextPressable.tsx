import React, { useLayoutEffect, useRef } from "react";
import { type PressableProps } from "react-native";
import {
  SidebarPressable as Pressable,
  useSidebarActive,
} from "./SidebarInteraction";
import { ContextPressGuard } from "../pressIntent";

interface Props
  extends Omit<PressableProps, "onPress" | "onLongPress" | "onPointerDown"> {
  onPress: () => void;
  onContextMenu: (x: number, y: number) => void;
  contextOpen: boolean;
}

/** Context menus share touch/secondary-click behavior without a second activation. */
export function ContextPressable({
  onPress,
  onContextMenu,
  contextOpen,
  ...props
}: Props) {
  const active = useSidebarActive();
  const guard = useRef(new ContextPressGuard());
  useLayoutEffect(() => {
    if (!active || !contextOpen) guard.current.reset();
  }, [active, contextOpen]);
  return (
    <Pressable
      {...props}
      onPress={() => {
        if (guard.current.allowPress()) onPress();
      }}
      onLongPress={(event) =>
        onContextMenu(event.nativeEvent.pageX, event.nativeEvent.pageY)
      }
      onPointerDown={(event) => {
        if (
          guard.current.pointerDown(
            event.nativeEvent.pointerType,
            event.nativeEvent.button
          )
        )
          onContextMenu(event.nativeEvent.pageX, event.nativeEvent.pageY);
      }}
    />
  );
}
