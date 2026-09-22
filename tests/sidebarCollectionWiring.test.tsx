import React from "react";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { parse } from "@babel/parser";
import { sidebarPresentation } from "../src/sidebarPresentation";
import { translate, type TranslationKey } from "../src/i18n";

// Execute the real App picker elements, with only native rendering at the seam.
const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const ast = parse(source, {
  sourceType: "module",
  plugins: ["typescript", "jsx"],
});
const menus: string[] = [];
function visit(value: any) {
  if (!value || typeof value !== "object") return;
  if (
    value.type === "JSXElement" &&
    value.openingElement.name.name === "SidebarPageMenu"
  )
    menus.push(source.slice(value.start, value.end));
  for (const item of Object.values(value))
    if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object") visit(item);
}
visit(ast);
function menu(index: number, bindings: Record<string, unknown>) {
  expect(menus.length).toBe(2);
  const compiled = require("@babel/core").transformSync(
    `const value = (${menus[index]});`,
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
    "tr",
    ...Object.keys(bindings),
    compiled + "\nreturn value;"
  )(React, require, (key: TranslationKey, values?: Record<string, string | number>) => translate("en", key, values), ...Object.values(bindings)) as React.ReactElement<any>;
}
const tabs = [
  { id: "a", title: "A", url: "about:blank", workspaceId: "work" },
  { id: "b", title: "B", url: "about:blank", workspaceId: "work" },
];

test("App split picker focuses its chosen pane without unsplitting and reverses orientation only for its own pair", () => {
  const selected: string[] = [],
    updates: any[] = [];
  const split = {
    first: "a",
    second: "b",
    orientation: "vertical" as const,
    ratio: 0.4,
  };
  const sidebar = sidebarPresentation({
    tabs,
    bookmarks: [],
    folders: [],
    workspaceId: "work",
    focusedId: "b",
    split,
  });
  const view = menu(0, {
    SidebarPageMenu: "SidebarPageMenu",
    sidebar,
    sidebarMenu: { kind: "split" },
    switchTab: (id: string) => selected.push(id),
    openTabMenu: () => {},
    setSidebarMenu: () => {},
    toggleSplit: () => selected.push("unsplit"),
    setSplitLayout: (update: (value: typeof split) => unknown) =>
      updates.push(update(split)),
  });
  expect(view.props.pages.map((page: any) => page.detail)).toEqual([
    "Top",
    "Bottom",
  ]);
  view.props.pages[1].onPress();
  expect(selected).toEqual(["b"]);
  view.props.actions
    .find((action: any) => action.id === "orientation")
    .onPress();
  expect(updates).toEqual([{ ...split, orientation: "horizontal" }]);
});

test("App folder picker activates a live bookmark owner but opens a saved page without an owner", () => {
  const events: string[] = [];
  const bookmarks = [
    {
      id: "saved",
      title: "Saved",
      url: "about:blank",
      folderId: "docs",
      workspaceId: "work",
    },
    {
      id: "cold",
      title: "Cold",
      url: "about:blank",
      folderId: "docs",
      workspaceId: "work",
    },
  ];
  const sidebar = sidebarPresentation({
    tabs,
    bookmarks,
    folders: [{ id: "docs", title: "Docs", workspaceId: "work" }],
    workspaceId: "work",
    split: null,
  });
  const view = menu(1, {
    SidebarPageMenu: "SidebarPageMenu",
    sidebar,
    sidebarMenu: { kind: "folderPages", id: "docs" },
    bookmarkTabs: new Map([["saved", tabs[0]]]),
    target: "a",
    switchTab: (id: string) => events.push(`tab:${id}`),
    openBookmark: (bookmark: { id: string }) =>
      events.push(`bookmark:${bookmark.id}`),
    setSidebarMenu: () => {},
  });
  expect(view.props.title).toBe("Docs");
  view.props.pages.forEach((page: any) => page.onPress());
  expect(events).toEqual(["tab:a", "bookmark:cold"]);
});
