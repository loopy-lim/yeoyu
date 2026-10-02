import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { parse } from "@babel/parser";

// Execute the actual main canvas props and modal predicate. Native TalkBack is
// a device boundary; this guards the RN contract that excludes background nodes.
const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const ast = parse(source, {
  sourceType: "module",
  plugins: ["typescript", "jsx"],
});
const declarations = new Map<string, string>();
let bodyAttributes: any[] = [];
function visit(node: any) {
  if (!node || typeof node !== "object") return;
  if (
    node.type === "VariableDeclarator" &&
    node.id?.type === "Identifier" &&
    node.init
  )
    declarations.set(
      node.id.name,
      source.slice(node.init.start, node.init.end)
    );
  if (
    node.type === "JSXOpeningElement" &&
    node.name?.name === "View" &&
    node.attributes.some(
      (attribute: any) =>
        attribute.name?.name === "className" &&
        attribute.value?.expression?.object?.name === "c" &&
        attribute.value?.expression?.property?.name === "body"
    )
  )
    bodyAttributes = node.attributes;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") visit(value);
  }
}
visit(ast);
const modalStates = [
  "quickOpen",
  "palette",
  "bookmarkManager",
  "settings",
  "keys",
  "spaceSwitcher",
  "historyOpen",
  "boostsOpen",
  "ctxMenuTabId",
  "sidebarMenu",
  "splitPickerTabId",
  "newFolderOpen",
];
function bodyProps(active?: string) {
  const values = Object.fromEntries(
    modalStates.map((key) => [key, key === active])
  );
  const overlayOpen = new Function(
    ...modalStates,
    `return (${declarations.get("overlayOpen")});`
  )(...modalStates.map((key) => values[key]));
  const accessibilityBlocking = new Function(
    "overlayOpen",
    "permissionRequest",
    `return (${declarations.get("accessibilityBlocking")});`
  )(overlayOpen, active === "permissionRequest" ? { id: "request" } : null);
  const valueFor = (name: string) => {
    const expression = bodyAttributes.find(
      (attribute) => attribute.name?.name === name
    )?.value?.expression;
    if (!expression) throw new Error(`Main canvas must provide ${name}`);
    return new Function(
      "accessibilityBlocking",
      `return (${source.slice(expression.start, expression.end)});`
    )(accessibilityBlocking);
  };
  return {
    hidden: valueFor("accessibilityElementsHidden"),
    importance: valueFor("importantForAccessibility"),
  };
}

test.each([...modalStates, "permissionRequest"])(
  "main %s excludes sidebar and page accessibility nodes while its sibling sheet remains visible",
  (active) => {
    expect(bodyProps(active)).toEqual({
      hidden: true,
      importance: "no-hide-descendants",
    });
  }
);

test("find stays nonmodal and closing a sheet restores background accessibility", () => {
  expect(bodyProps("findTab")).toEqual({ hidden: false, importance: "auto" });
  expect(bodyProps()).toEqual({ hidden: false, importance: "auto" });
});
