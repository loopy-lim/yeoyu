import React from "react";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { URL } from "node:url";
const require = createRequire(import.meta.url);
const { transformSync } = require("@babel/core");
const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

// Execute the actual App list expressions. Eager .map() used to create every
// tab row before the incoming GeckoView could mount in the same native batch.
function renderList(rail: boolean) {
  const start = rail
    ? source.indexOf(
        "<View style={s.tabScrollWrap}>",
        source.indexOf("s.sidebarLayerRail")
      )
    : source.indexOf("<Animated.View\n                ref={tabListRef}");
  const end = source.indexOf(
    rail
      ? "<View style={s.sidebarBottomCollapsed}>"
      : "<View style={s.sidebarBottom}>",
    start
  );
  if (start < 0 || end < 0)
    throw new Error("App sidebar list boundary changed");
  const tabs = Array.from({ length: 1000 }, (_, i) => ({
    id: `tab-${i}`,
    workspaceId: "a",
    title: `Tab ${i}`,
    url: "https://example.com",
    favorite: false,
    pinned: false,
  }));
  let rendered = 0;
  const bindings = {
    React,
    Animated: { View: "View" },
    View: "View",
    Text: "Text",
    FlatList: "FlatList",
    ScrollView: "ScrollView",
    SidebarPressable: "SidebarPressable",
    ChromeIcon: "Icon",
    DragSource: "DragSource",
    Favicon: "Favicon",
    tabListRef: null,
    pinnedSectionRef: null,
    ordinarySectionRef: null,
    s: {},
    spaceStyle: {},
    theme: {},
    space: { lg: 8 },
    activeWorkspace: { name: "A" },
    state: { tabs, activeWorkspaceId: "a" },
    ordinaryTabs: tabs,
    railTabs: tabs,
    privateTabs: [],
    createPrivateTabAndShow: () => {},
    initialSidebarRows: 24,
    spaceFolders: [],
    spaceBookmarks: [],
    favoriteTabs: [],
    splitPaneIds: [],
    playing: [],
    renderSidebarTab: (tab: (typeof tabs)[number]) => {
      rendered++;
      return React.createElement("Tab", { key: tab.id, id: tab.id });
    },
    moveDrag: () => {},
    finishDrag: () => {},
    cancelDrag: () => {},
    reducedMotion: false,
    tabLabel: (tab: (typeof tabs)[number]) => tab.title,
  };
  const code = transformSync(
    "return (" + source.slice(start, end).trim() + ");",
    {
      filename: "App.tsx",
      babelrc: false,
      configFile: false,
      parserOpts: { allowReturnOutsideFunction: true },
      presets: [require.resolve("@react-native/babel-preset")],
    }
  ).code;
  const tree = new Function("require", ...Object.keys(bindings), code)(
    require,
    ...Object.values(bindings)
  );
  const nodes: React.ReactElement<Record<string, any>>[] = [];
  function walk(node: React.ReactNode) {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement<Record<string, any>>(child)) return;
      nodes.push(child);
      walk(child.props.children);
    });
  }
  walk(tree);
  return { nodes, tabs, rendered: () => rendered };
}

for (const rail of [false, true]) {
  test(`${
    rail ? "rail" : "expanded"
  } sidebar defers a thousand offscreen rows`, () => {
    const { nodes, tabs, rendered } = renderList(rail);
    expect(rendered()).toBe(0);
    expect(nodes.filter((node) => node.type === "DragSource")).toHaveLength(0);
    const lists = nodes.filter((node) => node.type === "FlatList");
    expect(lists).toHaveLength(1);
    const props = lists[0]!.props;
    expect(props.data).toBe(tabs);
    expect(props.initialNumToRender).toBeLessThan(1000);
    expect(props.keyExtractor(tabs[997])).toBe("tab-997");
    expect(typeof props.renderItem).toBe("function");
  });
}
