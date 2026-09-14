import { mock } from "bun:test";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
  cancelAnimationFrame: (handle: ReturnType<typeof setTimeout>) =>
    clearTimeout(handle),
});

export class TestValue {
  constructor(public value: number) {}
  setValue(value: number) {
    this.value = value;
  }
  stopAnimation(callback?: (value: number) => void) {
    for (const animation of animations)
      if (animation.value === this && !animation.stopped) animation.stop();
    callback?.(this.value);
  }
  interpolate(config: {
    inputRange: number[];
    outputRange: Array<number | string>;
  }) {
    return { source: this, config };
  }
}

type Completion = { finished: boolean };
export class TestAnimation {
  callback?: (result: Completion) => void;
  stopped = false;
  constructor(
    public value?: TestValue,
    public config: Record<string, unknown> = {},
    public children?: TestAnimation[]
  ) {}
  start(callback?: (result: Completion) => void) {
    this.callback = callback;
    this.children?.forEach((child) => child.start());
    animations.push(this);
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.children?.forEach((child) => child.stop());
    this.callback?.({ finished: false });
  }
  finish(result: Completion = { finished: true }) {
    if (result.finished) {
      if (this.value) this.value.setValue(this.config.toValue as number);
      this.children?.forEach((child) => child.finish(result));
    }
    this.callback?.(result);
  }
}

export const animations: TestAnimation[] = [];
export const resetAnimations = () => {
  animations.length = 0;
};
export const latestAnimation = () => {
  const result = animations.at(-1);
  if (!result) throw new Error("No animation was started");
  return result;
};

let reducedMotion = false;
const preferenceListeners = new Set<(enabled: boolean) => void>();
export function setReduceMotion(enabled: boolean) {
  reducedMotion = enabled;
  preferenceListeners.forEach((listener) => listener(enabled));
}

mock.module("react-native", () => ({
  Pressable: "Pressable",
  View: "View",
  StyleSheet: {
    absoluteFill: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    flatten: (style: unknown): unknown =>
      Array.isArray(style)
        ? Object.assign(
            {},
            ...style
              .flat(Infinity)
              .filter((item) => item && typeof item === "object")
          )
        : style,
    create: (style: unknown) => style,
  },
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(reducedMotion),
    addEventListener: (
      _event: string,
      listener: (enabled: boolean) => void
    ) => {
      preferenceListeners.add(listener);
      return { remove: () => preferenceListeners.delete(listener) };
    },
  },
  Easing: {
    bezier: () => (value: number) => value,
    linear: (value: number) => value,
    out: (curve: unknown) => curve,
    quad: (value: number) => value * value,
  },
  Animated: {
    View: "View",
    Value: TestValue,
    timing: (value: TestValue, config: Record<string, unknown>) =>
      new TestAnimation(value, config),
    spring: (value: TestValue, config: Record<string, unknown>) =>
      new TestAnimation(value, config),
    parallel: (children: TestAnimation[]) =>
      new TestAnimation(undefined, {}, children),
  },
  PanResponder: {
    create: (handlers: Record<string, unknown>) => ({ panHandlers: handlers }),
  },
}));
