// Runs in its own Bun process so native module mocks cannot affect other tests.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import {
  animations,
  latestAnimation,
  resetAnimations,
  setReduceMotion,
} from "../chromeTestHarness";

let keyboardDismisses = 0;
let windowSize = { width: 800, height: 600 };

// Extend chromeTestHarness react-native mock with the host surfaces this fixture
// mounts (Modal/menus) plus Image for Favicon via SidebarCollections.
mock.module("react-native", () => ({
  Pressable: "Pressable",
  View: "View",
  Text: "Text",
  Modal: "Modal",
  ScrollView: "ScrollView",
  // Render footer/empty so SidebarPageMenu action rows stay findable under the mock.
  FlatList: ({
    ListFooterComponent,
    ListEmptyComponent,
  }: {
    ListFooterComponent?: React.ReactNode;
    ListEmptyComponent?: React.ReactNode;
  }) =>
    React.createElement(
      React.Fragment,
      null,
      ListEmptyComponent ?? null,
      ListFooterComponent ?? null
    ),
  Switch: "Switch",
  TextInput: "TextInput",
  Image: "Image",
  Keyboard: {
    dismiss: () => {
      keyboardDismisses += 1;
    },
  },
  useWindowDimensions: () => windowSize,
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
    isReduceMotionEnabled: () => Promise.resolve(false),
    addEventListener: () => ({ remove: () => {} }),
  },
  Easing: {
    bezier: () => (value: number) => value,
    linear: (value: number) => value,
    out: (curve: unknown) => curve,
    quad: (value: number) => value * value,
  },
  Animated: {
    View: "View",
    Value: class {
      constructor(public value: number) {}
      setValue(value: number) {
        this.value = value;
      }
      interpolate(config: { inputRange: number[]; outputRange: Array<number | string> }) {
        return { source: this, config };
      }
    },
    timing: (value: unknown, config: Record<string, unknown>) => {
      const anim = {
        value,
        config,
        stopped: false,
        callback: undefined as ((r: { finished: boolean }) => void) | undefined,
        start(cb?: (r: { finished: boolean }) => void) {
          this.callback = cb;
          animations.push(this as never);
        },
        stop() {
          if (this.stopped) return;
          this.stopped = true;
          this.callback?.({ finished: false });
        },
        finish(result = { finished: true }) {
          this.callback?.(result);
        },
      };
      return anim;
    },
    parallel: (children: Array<{ start: () => void; stop: () => void; finish: (r?: { finished: boolean }) => void }>) => {
      const anim = {
        children,
        stopped: false,
        callback: undefined as ((r: { finished: boolean }) => void) | undefined,
        start(cb?: (r: { finished: boolean }) => void) {
          this.callback = cb;
          children.forEach((child) => child.start());
          animations.push(this as never);
        },
        stop() {
          if (this.stopped) return;
          this.stopped = true;
          children.forEach((child) => child.stop());
          this.callback?.({ finished: false });
        },
        finish(result = { finished: true }) {
          if (result.finished) children.forEach((child) => child.finish(result));
          this.callback?.(result);
        },
      };
      return anim;
    },
  },
}));
mock.module("react-native-svg", () => ({ default: "Svg", Path: "Path" }));
const Text = "Text" as React.ElementType;

const { I18nContext } = await import("../../src/i18nContext");
const {
  DialogCard,
  DialogHeader,
  PortalModal,
  AnchoredMenuSurface,
  OverlaySheet,
} = await import("../../src/components/OverlayScaffold");
const { ActionMenu } = await import("../../src/components/ActionMenu");
const { SidebarPageMenu } = await import("../../src/components/SidebarCollections");

const originalError = console.error;
console.error = (...args: unknown[]) => {
  if (!String(args[0]).includes("react-test-renderer is deprecated"))
    originalError(...args);
};

function mount(element: React.ReactElement, language: "en" | "ko" = "en") {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      React.createElement(I18nContext.Provider, { value: language }, element)
    );
  });
  return renderer;
}

try {
  // 1. OverlaySheet: center vs bottom, backdropDismiss, bottomInset, reducedMotion exit freeze.
  {
    resetAnimations();
    setReduceMotion(false);
    let closed = 0;
    let exited = 0;
    const renderer = mount(
      <OverlaySheet
        open
        onClose={() => {
          closed += 1;
        }}
        position="bottom"
        bottomInset={240}
        closeLabel="Dismiss space sheet"
        reducedMotion={false}
        onExited={() => {
          exited += 1;
        }}
      >
        <DialogCard variant="sheet">
          <Text>Sheet Body</Text>
        </DialogCard>
      </OverlaySheet>
    );

    const overlayNode = renderer.root.find(
      (node) => node.props.pop !== undefined && node.props.lift !== undefined
    );
    assert.equal(overlayNode.props.pop, false, "bottom sheet omits scale pop");
    assert.equal(overlayNode.props.lift, 16, "bottom sheet lifts by 16dp");
    const flattened = (
      Array.isArray(overlayNode.props.style)
        ? overlayNode.props.style
        : [overlayNode.props.style]
    ) as Array<{ bottom?: number } | undefined>;
    assert.equal(
      flattened.find((s) => s && "bottom" in s)?.bottom,
      240,
      "bottomInset forwards { bottom: 240 } to Overlay"
    );

    const backdrop = renderer.root.findByProps({
      accessibilityRole: "button",
      accessibilityLabel: "Dismiss space sheet",
    });
    act(() => backdrop.props.onPress());
    assert.equal(closed, 1);

    // Center + backdropDismiss=false
    act(() => {
      renderer.update(
        <I18nContext.Provider value="en">
          <OverlaySheet
            open
            onClose={() => {
              closed += 1;
            }}
            position="center"
            backdropDismiss={false}
            reducedMotion={false}
            onExited={() => {
              exited += 1;
            }}
          >
            <DialogCard variant="dialog">
              <Text>Centered Body</Text>
            </DialogCard>
          </OverlaySheet>
        </I18nContext.Provider>
      );
    });
    assert.equal(overlayNode.props.pop, true, "center sheet uses pop entrance");
    assert.equal(overlayNode.props.lift, 0, "center sheet has no bottom lift");
    assert.equal(
      renderer.root.findAllByProps({ accessibilityRole: "button" }).length,
      0,
      "backdropDismiss=false omits backdrop button"
    );

    // Exit freezes committed content until exit animation finishes.
    act(() => {
      renderer.update(
        <I18nContext.Provider value="en">
          <OverlaySheet
            open={false}
            onClose={() => {}}
            reducedMotion={false}
            onExited={() => {
              exited += 1;
            }}
          >
            <Text>Replaced While Closed</Text>
          </OverlaySheet>
        </I18nContext.Provider>
      );
    });
    assert.equal(exited, 0, "exit callback waits for Overlay exit animation");
    assert.equal(
      renderer.root.findByType("Text" as React.ElementType).props.children,
      "Centered Body",
      "exit freezes the last open content"
    );
    act(() => latestAnimation().finish({ finished: true }));
    assert.equal(exited, 1, "onExited fires once after exit completes");
    act(() => renderer.unmount());
  }

  // 2. PortalModal: transparent, reducedMotion animationType, onRequestClose, untagged backdrop.
  {
    let closes = 0;
    const renderer = mount(
      <PortalModal
        visible
        onClose={() => {
          closes += 1;
        }}
        position="bottom"
        reducedMotion={false}
      >
        <DialogCard variant="modal">
          <Text>Modal Content</Text>
        </DialogCard>
      </PortalModal>
    );
    const modal = renderer.root.findByType("Modal" as React.ElementType);
    assert.equal(modal.props.transparent, true);
    assert.equal(modal.props.visible, true);
    assert.equal(modal.props.animationType, "fade");

    act(() => modal.props.onRequestClose());
    assert.equal(closes, 1);

    const backdrop = renderer.root.findByProps({ accessible: false });
    act(() => backdrop.props.onPress());
    assert.equal(closes, 2);

    act(() => {
      renderer.update(
        <I18nContext.Provider value="en">
          <PortalModal
            visible
            onClose={() => {}}
            backdropDismiss={false}
            reducedMotion
          >
            <Text>Reduced Modal</Text>
          </PortalModal>
        </I18nContext.Provider>
      );
    });
    assert.equal(modal.props.animationType, "none");
    assert.equal(
      renderer.root.findAllByProps({ accessible: false }).length,
      0
    );
    act(() => renderer.unmount());
  }

  // 3. DialogCard variants & modal prop + DialogHeader layout & close control.
  {
    let closes = 0;
    const renderer = mount(
      <DialogCard variant="wide" modal={false}>
        <DialogHeader
          leading={<Text>Back</Text>}
          title={<Text>Settings</Text>}
          closeLabel="Close settings"
          onClose={() => {
            closes += 1;
          }}
        >
          <Text>Extra</Text>
        </DialogHeader>
      </DialogCard>
    );
    const card = renderer.root.findByProps({ accessibilityViewIsModal: false });
    assert(card.props.className.includes("max-w-[1040px]"));

    const closeBtn = renderer.root.findByProps({
      accessibilityRole: "button",
      accessibilityLabel: "Close settings",
    });
    act(() => closeBtn.props.onPress());
    assert.equal(closes, 1);

    for (const variant of [
      "dialog",
      "compact",
      "wide",
      "editor",
      "sheet",
      "modal",
      "appDialog",
    ] as const) {
      act(() => {
        renderer.update(
          <I18nContext.Provider value="en">
            <DialogCard variant={variant}>
              <Text>{variant}</Text>
            </DialogCard>
          </I18nContext.Provider>
        );
      });
      assert.equal(
        renderer.root.findByProps({ accessibilityViewIsModal: true }).props
          .accessibilityViewIsModal,
        true
      );
    }
    act(() => renderer.unmount());
  }

  // 4. AnchoredMenuSurface, ActionMenu & SidebarPageMenu: Keyboard.dismiss, onLayout clamp, Korean i18n close label.
  {
    keyboardDismisses = 0;
    windowSize = { width: 400, height: 300 };
    let closes = 0;
    let picked = 0;
    const renderer = mount(
      <AnchoredMenuSurface
        title="Tab Menu"
        anchor={{ x: 350, y: 240, width: 20, height: 20 }}
        preferredWidth={280}
        estimatedHeight={100}
        placement="bottom"
        align="end"
        onClose={() => {
          closes += 1;
        }}
      >
        <Text>Row</Text>
      </AnchoredMenuSurface>,
      "ko"
    );
    assert.equal(keyboardDismisses, 1, "Keyboard.dismiss runs on mount");
    const menuView = renderer.root.findByProps({
      accessibilityViewIsModal: true,
      accessibilityLabel: "Tab Menu",
    });
    // end-align: rawLeft = 350+20-280 = 90; top clamps to window-height inset.
    assert.deepEqual(menuView.props.style, {
      left: 90,
      top: 188,
      width: 280,
      maxHeight: 276,
    });

    // Recomputes clamping after onLayout reports taller measured height.
    act(() => menuView.props.onLayout({ nativeEvent: { layout: { height: 220 } } }));
    assert.deepEqual(menuView.props.style, {
      left: 90,
      top: 68,
      width: 280,
      maxHeight: 276,
    });

    const closeBtn = renderer.root.findByProps({
      accessibilityRole: "button",
      accessibilityLabel: "Tab Menu 메뉴 닫기",
    });
    act(() => closeBtn.props.onPress());
    assert.equal(closes, 1);

    // ActionMenu & SidebarPageMenu share AnchoredMenuSurface and trigger close + action cleanly.
    act(() => {
      renderer.update(
        <I18nContext.Provider value="en">
          <ActionMenu
            title="Actions"
            items={[
              {
                id: "open",
                label: "Open",
                onPress: () => {
                  picked += 1;
                },
              },
            ]}
            onClose={() => {
              closes += 1;
            }}
          />
        </I18nContext.Provider>
      );
    });
    const openBtn = renderer.root.findByProps({
      accessibilityRole: "button",
      accessibilityLabel: "Open",
    });
    act(() => openBtn.props.onPress());
    assert.equal(closes, 2);
    assert.equal(picked, 1);

    act(() => {
      renderer.update(
        <I18nContext.Provider value="en">
          <SidebarPageMenu
            title="Page Options"
            pages={[]}
            actions={[
              {
                id: "pin",
                label: "Pin Page",
                icon: "pin",
                onPress: () => {
                  picked += 1;
                },
              },
            ]}
            onClose={() => {
              closes += 1;
            }}
          />
        </I18nContext.Provider>
      );
    });
    const pinBtn = renderer.root.findByProps({
      accessibilityRole: "button",
      accessibilityLabel: "Pin Page",
    });
    act(() => pinBtn.props.onPress());
    assert.equal(closes, 3);
    assert.equal(picked, 2);
    assert(
      renderer.root.findByProps({
        accessibilityRole: "button",
        accessibilityLabel: "Close Page Options menu",
      })
    );
    act(() => renderer.unmount());
  }
} finally {
  console.error = originalError;
}
