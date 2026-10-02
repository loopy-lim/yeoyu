import { afterEach, expect, mock, test } from "bun:test";
import "../uniwindTestHarness";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { parse } from "@babel/parser";
import { sidebarAddressLabel } from "../../src/sidebarModel";
import type { BrowserSecurity } from "../../src/hooks/useBrowserWorkflows";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
mock.module("react-native", () => ({
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  Animated: { View: "View" },
}));
mock.module("react-native-svg", () => ({ default: "Svg", Path: "Path" }));
const { AddressTrigger } = await import("../../src/components/AddressTrigger");

// Execute both production App entries so passing a display-only host cannot
// silently disable the security indicator again.
const source = readFileSync(
  new URL("../../src/App.tsx", import.meta.url),
  "utf8"
);
const ast = parse(source, {
  sourceType: "module",
  plugins: ["typescript", "jsx"],
});
const entries: string[] = [];
let addressExpression = "";
function visit(node: any) {
  if (!node || typeof node !== "object") return;
  if (node.type === "VariableDeclarator" && node.id.name === "addressValue")
    addressExpression = source.slice(node.init.start, node.init.end);
  if (
    node.type === "JSXElement" &&
    node.openingElement.name.name === "AddressTrigger"
  )
    entries.push(source.slice(node.start, node.end));
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") visit(value);
  }
}
visit(ast);
const appEntry = (index: number, url: string, security?: BrowserSecurity) => {
  const compiled = require("@babel/core").transformSync(
    `const addressValue = (${addressExpression}); const value = (${entries[index]});`,
    {
      filename: "App.tsx",
      babelrc: false,
      configFile: false,
      presets: [require.resolve("@react-native/babel-preset")],
    }
  ).code;
  return new Function(
    "React",
    "require",
    "AddressTrigger",
    "targetUrl",
    "NEW_TAB_URL",
    "displayUrl",
    "target",
    "browser",
    "openLocationEditor",
    compiled + "\nreturn value;"
  )(
    React,
    require,
    AddressTrigger,
    url,
    "about:blank",
    sidebarAddressLabel,
    "current",
    { security: { current: security } },
    () => {}
  ) as React.ReactElement;
};
const trees: ReactTestRenderer[] = [];
async function mount(element: React.ReactElement) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  trees.push(tree);
  return tree;
}
afterEach(async () => {
  await act(() => trees.splice(0).forEach((tree) => tree.unmount()));
});
const secure: BrowserSecurity = {
  tabId: "current",
  origin: "https://www.example.com:8443",
  host: "www.example.com",
  known: true,
  secure: true,
  exception: false,
  mixedActive: false,
  mixedPassive: false,
};
const securityGlyphs = (tree: ReactTestRenderer) =>
  tree.root
    .findAll(
      (node) => node.props.name === "lock" || node.props.name === "warning"
    )
    .map((node) => node.props.name);
const labels = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType("Text" as React.ElementType)
    .map((node) => node.children.join(""));

test("expanded and compact App addresses show verified trust while displaying a short host", async () => {
  expect(entries).toHaveLength(2);
  for (let index = 0; index < entries.length; index++) {
    const tree = await mount(
      appEntry(index, "https://www.example.com:8443/docs?q=tab", secure)
    );
    expect(securityGlyphs(tree)).toEqual(["lock"]);
    expect(labels(tree)).toEqual(["example.com:8443"]);
    expect(
      tree.root.findByType("Pressable" as React.ElementType).props
        .accessibilityHint
    ).toContain("https://www.example.com:8443/docs?q=tab");
  }
});

test("each App address exposes certificate, mixed-content and plain-HTTP warnings", async () => {
  const cases = [
    {
      url: "https://www.example.com:8443/docs",
      security: { ...secure, exception: true },
    },
    {
      url: "https://www.example.com:8443/docs",
      security: { ...secure, mixedActive: true },
    },
    {
      url: "http://www.example.com:8443/docs",
      security: {
        ...secure,
        origin: "http://www.example.com:8443",
        secure: false,
      },
    },
  ];
  for (let index = 0; index < entries.length; index++) {
    for (const item of cases) {
      const tree = await mount(appEntry(index, item.url, item.security));
      expect(securityGlyphs(tree)).toEqual(["warning"]);
    }
  }
});

test("loading, unverified and stale origins cannot claim a trusted connection", async () => {
  const url = "https://www.example.com:8443/docs";
  for (const security of [
    undefined,
    { ...secure, known: false },
    { ...secure, origin: "https://www.example.com" },
    { ...secure, origin: "http://www.example.com:8443" },
  ]) {
    const tree = await mount(
      <AddressTrigger url={url} security={security} onPress={() => {}} />
    );
    expect(securityGlyphs(tree)).toEqual([]);
  }
});

test("new tabs and local files keep their existing readable labels without a network trust claim", async () => {
  const empty = await mount(appEntry(0, "about:blank", secure));
  expect(securityGlyphs(empty)).toEqual([]);
  expect(
    empty.root.findAll((node) => node.props.name === "search")
  ).toHaveLength(1);
  const file = await mount(
    appEntry(1, "file:///storage/My%20Document.pdf", secure)
  );
  expect(securityGlyphs(file)).toEqual([]);
  expect(labels(file)).toEqual(["My Document.pdf"]);
  expect(
    file.root.findByType("Pressable" as React.ElementType).props
      .accessibilityHint
  ).toContain("file:///storage/My%20Document.pdf");
});
