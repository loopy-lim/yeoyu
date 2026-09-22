import { afterEach, expect, mock, test } from "bun:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let reply = JSON.stringify({ busy: false, catalog: [], extensions: [] });
let installRequests: string[] = [];
let permissionChanges = 0;
let installBehavior: () => Promise<string> = async () => reply;
const bridge = {
  list: async () => reply,
  install: async (source: string) => {
    installRequests.push(source);
    return installBehavior();
  },
  search: async () => reply,
  revokeOptional: async () => reply,
  modify: async () => {
    permissionChanges++;
    throw new Error("Link installation must not grant private access");
  },
  openAction: async () => {},
  openOptions: async () => {},
  setActiveTab: () => {},
  claimTabRequest: async () => false,
  resolveTabRequest: () => {},
};
mock.module("react-native", () => ({
  View: "View",
  Text: "Text",
  TextInput: "TextInput",
  Pressable: "Pressable",
  Switch: "Switch",
  Image: "Image",
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
  Alert: { alert: () => {} },
  AppState: { addEventListener: () => ({ remove: () => {} }) },
  NativeModules: { BrowserExtensions: bridge },
}));
const { ExtensionsSettings } = await import(
  "../../src/components/ExtensionsSettings"
);
let tree: ReactTestRenderer | undefined;
const input = () =>
  tree!.root.findByProps({ accessibilityLabel: "Mozilla Add-ons link" });
const button = () =>
  tree!.root.findByProps({
    accessibilityLabel: "Review extension installation",
  });
async function mount() {
  await act(async () => {
    tree = create(<ExtensionsSettings tabId="page" privateTab={false} />);
  });
}
async function edit(source: string) {
  await act(() => input().props.onChangeText(source));
}
async function press() {
  await act(async () => button().props.onPress());
}
afterEach(async () => {
  if (tree) await act(() => tree!.unmount());
  tree = undefined;
  installRequests = [];
  permissionChanges = 0;
  reply = JSON.stringify({ busy: false, catalog: [], extensions: [] });
  installBehavior = async () => reply;
});

test("link form is available and rejects non-detail and disguised addresses before native installation", async () => {
  await mount();
  expect(
    tree!.root.findAllByProps({ accessibilityLabel: "Mozilla Add-ons link" })
  ).toHaveLength(1);
  expect(button().props.disabled).toBe(true);
  for (const source of [
    "https://evil.example/firefox/addon/example-addon/",
    "example-addon",
    "http://addons.mozilla.org/firefox/addon/example-addon/",
    "https://addons.mozilla.org.evil.example/firefox/addon/example-addon/",
    "https://user@addons.mozilla.org/firefox/addon/example-addon/",
    "https://addons.mozilla.org:8443/firefox/addon/example-addon/",
    "https://addons.mozilla.org/firefox/addon/../addon/example-addon/",
    "https://addons.mozilla.org/firefox/addon/%2fexample-addon/",
    "https://addons.mozilla.org/firefox/addon/%252fexample-addon/",
    "https://addons.mozilla.org/firefox/addon/12345/",
    "https://addons.mozilla.org/firefox/downloads/file/1/addon.xpi",
  ]) {
    await edit(source);
    await press();
    expect(
      tree!.root.findAllByProps({ accessibilityRole: "alert" }).length
    ).toBeGreaterThan(0);
    expect(installRequests).toEqual([]);
  }
});

test("a shared link is normalized, submitted once and locked until the permission/install result arrives", async () => {
  await mount();
  await edit(
    " https://addons.mozilla.org/ko/android/addon/example-addon/?utm_source=share#reviews "
  );
  let resolve!: (value: string) => void;
  installBehavior = () =>
    new Promise((done) => {
      resolve = done;
    });
  const submit = button().props.onPress;
  await act(() => {
    submit();
    submit();
  });
  expect(installRequests).toEqual([
    "https://addons.mozilla.org/firefox/addon/example-addon/",
  ]);
  expect(input().props.editable).toBe(false);
  expect(button().props.disabled).toBe(true);
  await act(async () => resolve(reply));
  expect(input().props.editable).toBe(true);
  expect(permissionChanges).toBe(0);
});

test("an installed linked extension appears in management with private access still off", async () => {
  await mount();
  await edit("https://addons.mozilla.org/firefox/addon/example-addon/");
  installBehavior = async () =>
    JSON.stringify({
      busy: false,
      catalog: [],
      extensions: [
        {
          id: "example@addons.test",
          name: "Example extension",
          version: "1.0",
          description: "",
          enabled: true,
          privateAllowed: false,
          disabledFlags: 0,
          hasOptions: true,
          hasAction: true,
          actionEnabled: true,
          badge: "",
          permissions: ["storage"],
          origins: [],
          dataPermissions: [],
          optionalPermissions: [],
          optionalOrigins: [],
          optionalDataPermissions: [],
        },
      ],
    });
  await press();
  expect(
    tree!.root.findByProps({ accessibilityLabel: "Enable Example extension" })
      .props.value
  ).toBe(true);
  expect(
    tree!.root.findByProps({
      accessibilityLabel: "Allow Example extension in private tabs",
    }).props.value
  ).toBe(false);
  expect(
    tree!.root.findByProps({ accessibilityLabel: "Remove Example extension" })
      .props.disabled
  ).toBe(false);
  expect(permissionChanges).toBe(0);
});

test("stale native state and an unmounted form cannot start installation", async () => {
  reply = "unreadable";
  await mount();
  expect(
    tree!.root.findAllByProps({
      accessibilityLabel: "Review extension installation",
    })
  ).toHaveLength(0);
  reply = JSON.stringify({ busy: false, catalog: [], extensions: [] });
  await act(async () =>
    tree!.root
      .findByProps({ accessibilityLabel: "Retry loading extensions" })
      .props.onPress()
  );
  await edit("https://addons.mozilla.org/firefox/addon/example-addon/");
  const submit = button().props.onPress;
  await act(() => tree!.unmount());
  tree = undefined;
  submit();
  expect(installRequests).toEqual([]);
});

test("an invalid retry clears the previous successful installation notice", async () => {
  await mount();
  await edit("https://addons.mozilla.org/firefox/addon/example-addon/");
  await press();
  const successNotices = () =>
    tree!.root.findAll(
      (node) =>
        node.props.accessibilityLiveRegion === "polite" &&
        String(node.props.children).includes("Installation finished")
    );
  expect(successNotices()).toHaveLength(1);
  await edit("https://other.example/addon");
  await press();
  expect(successNotices()).toHaveLength(0);
  expect(
    tree!.root.findAllByProps({ accessibilityRole: "alert" })
  ).toHaveLength(1);
});

test("compatibility or permission rejection preserves the link, reports failure and allows a retry", async () => {
  await mount();
  const source = "https://addons.mozilla.org/firefox/addon/example-addon/";
  await edit(source);
  installBehavior = async () => {
    throw new Error("Extension is not Android compatible");
  };
  await press();
  expect(input().props.value).toBe(source);
  expect(
    tree!.root.findByProps({ accessibilityRole: "alert" }).props.children
  ).toContain("not Android compatible");
  expect(button().props.disabled).toBe(false);
  installBehavior = async () => reply;
  await press();
  expect(installRequests).toEqual([source, source]);
});
