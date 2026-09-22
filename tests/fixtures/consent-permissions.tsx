import { mock } from "bun:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let requests: string[] = [],
  reads = 0,
  resets = 0;
let status = {
  camera: "not-allowed",
  microphone: "not-allowed",
  geolocation: "approximate",
  notifications: "allowed",
};
const runtime = {
  getAndroidPermissionStatus: async () => {
    reads++;
    return JSON.stringify(status);
  },
  requestAndroidPermission: async (kind: string) => {
    requests.push(kind);
    return false;
  },
  openAndroidPermissionSettings: async () => {},
};
mock.module("../../src/platform", () => ({ platform: runtime }));
mock.module("react-native", () => ({
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  AppState: { addEventListener: () => ({ remove() {} }) },
  useWindowDimensions: () => ({ width: 400, height: 640, fontScale: 1.6 }),
}));
mock.module("react-native-svg", () => ({ default: "Svg", Path: "Path" }));
const { ConsentSettings } = await import(
  "../../src/components/ConsentSettings"
);
const { I18nContext } = await import("../../src/i18nContext");
const previousError = console.error;
console.error = (...args: unknown[]) => {
  if (!String(args[0]).includes("react-test-renderer is deprecated"))
    previousError(...args);
};
try {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <I18nContext.Provider value="en">
        <ConsentSettings
          rules={[]}
          onRevoke={async () => {}}
          onClearAll={async () => {
            resets++;
          }}
        />
      </I18nContext.Provider>
    );
  });
  assert.equal(requests.length, 0, "opening settings must not request access");
  const button = (label: string) =>
    renderer.root
      .findAllByType("Pressable" as React.ElementType)
      .find((node) => node.props.accessibilityLabel === label);
  assert(
    button("Allow Camera in Android"),
    "missing direct Android grant action"
  );
  assert.equal(
    button("Allow Location in Android"),
    undefined,
    "approximate location already satisfies access"
  );
  await act(async () => button("Allow Camera in Android")!.props.onPress());
  assert.deepEqual(requests, ["camera"]);
  assert(reads >= 2, "status is refreshed after the OS dialog");
  const allText = renderer.root
    .findAllByType("Text" as React.ElementType)
    .map((node) => node.props.children)
    .join(" ");
  assert(
    allText.includes("Android settings"),
    "a denial explains the manual recovery path"
  );
  const denial = renderer.root
    .findAllByType("Text" as React.ElementType)
    .find((node) => String(node.props.children).includes("Access was not granted"));
  assert(denial, "denial feedback is visible");
  let feedbackArea = denial.parent;
  while (
    feedbackArea &&
    !feedbackArea.findAllByProps({ accessibilityLabel: "Allow Camera in Android" }).length
  ) feedbackArea = feedbackArea.parent;
  assert(feedbackArea, "denial feedback accompanies the requested permission");
  assert.equal(
    feedbackArea.findAllByProps({ accessibilityLabel: "Allow Microphone in Android" }).length,
    0,
    "denial feedback belongs to the camera row instead of the bottom of the device list"
  );
  assert.equal(resets, 0);
  await act(async () =>
    button("Forget all saved site choices")!.props.onPress()
  );
  assert.equal(resets, 1, "reset stays reachable with no app rules");
  const autoplayChanges: unknown[][] = [];
  const scene = (
    privateSite: boolean,
    siteUrl = "https://www.example.com:8443/path"
  ) => (
    <I18nContext.Provider value="en">
      <ConsentSettings
        rules={[]}
        onRevoke={async () => {}}
        onClearAll={async () => {}}
        siteUrl={siteUrl}
        privateSite={privateSite}
        onAutoplayChange={async (...args) => {
          autoplayChanges.push(args);
        }}
      />
    </I18nContext.Provider>
  );
  await act(() => renderer.update(scene(false)));
  const radio = (label: string) =>
    renderer.root
      .findAllByType("Pressable" as React.ElementType)
      .find((node) => node.props.accessibilityLabel === label);
  assert.equal(radio("Use default")!.props.accessibilityState.checked, true);
  await act(async () => radio("Allow sound")!.props.onPress());
  assert.deepEqual(autoplayChanges, [
    ["https://www.example.com:8443", "allow"],
  ]);
  await act(() => renderer.update(scene(true)));
  assert.equal(
    radio("Allow sound"),
    undefined,
    "private pages cannot save an autoplay rule"
  );
  await act(() => renderer.update(scene(false, "about:blank")));
  assert.equal(
    radio("Allow sound"),
    undefined,
    "internal pages cannot save an autoplay rule"
  );
  await act(() => renderer.unmount());
} finally {
  console.error = previousError;
}
