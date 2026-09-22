import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { Children, isValidElement, type ReactNode } from "react";
import { parse } from "@babel/parser";
import { permissionSupportsOnce, type PermissionChoice } from "../src/permissionRequests";
import { translate } from "../src/i18n";
import { PERMISSION_KINDS } from "../src/uiPreferences";

// Execute the real dialog with plain host elements; no global React Native
// mock or native rendering claim is needed to verify labels and choices.
const source = readFileSync(resolve(import.meta.dir, "../src/components/Dialogs.tsx"), "utf8");
const tree = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
const declaration = tree.program.body.flatMap((entry) => entry.type === "ExportNamedDeclaration" && entry.declaration?.type === "FunctionDeclaration" && entry.declaration.id?.name === "PermissionDialog" ? [entry.declaration] : [])[0];
if (!declaration) throw new Error("PermissionDialog was not found");
const { transformSync } = require("@babel/core");
const javascript = transformSync(source.slice(declaration.start!, declaration.end!), {
  babelrc: false, configFile: false,
  plugins: [["@babel/plugin-transform-typescript", { isTSX: true }], ["@babel/plugin-transform-react-jsx", { runtime: "classic" }]],
}).code;
const PermissionDialog = new Function("React", "useStyles", "useI18n", "permissionSupportsOnce", "PERMISSION_KINDS", "View", "Text", "Pressable", "DialogHeader", "ScrollView", `${javascript}; return PermissionDialog;`)(
  React, () => ({ styles: {} }), () => ({ tr: (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) => translate("en", key, values) }), permissionSupportsOnce, PERMISSION_KINDS, "View", "Text", "Pressable", "DialogHeader", "ScrollView",
) as (props: { request: { kinds: string[]; origin: string; ephemeral?: boolean }; onDecide(choice: PermissionChoice): void; onDismiss(): void }) => ReactNode;

type Props = { children?: ReactNode; accessibilityLabel?: string; onPress?: () => void };
function dialog(kinds: string[], ephemeral = false) {
  const choices: PermissionChoice[] = [], buttons: Props[] = [], text: string[] = [];
  const root = PermissionDialog({ request: { origin: "https://example.com", kinds, ephemeral }, onDecide: (choice) => choices.push(choice), onDismiss: () => {} });
  function visit(node: ReactNode) {
    Children.forEach(node, (child) => {
      if (typeof child === "string") text.push(child);
      if (!isValidElement<Props>(child)) return;
      if (child.type === "Pressable") buttons.push(child.props);
      visit(child.props.children);
    });
  }
  visit(root);
  return { buttons, choices, text: text.join(" ") };
}

test("notifications, location and autoplay offer one explicit remembered Allow", () => {
  for (const kind of ["notifications", "geolocation", "autoplay"]) {
    const value = dialog([kind]);
    expect(value.buttons.map((button) => button.accessibilityLabel)).toEqual(["Allow for this site", "Block this site"]);
    expect(value.text).toContain("This choice is remembered");
    value.buttons[0]!.onPress!();
    expect(value.choices).toEqual(["always"]);
  }
});

test("media retains once and always choices while persistent storage explains its irreversible grant", () => {
  const media = dialog(["camera", "microphone"]);
  expect(media.buttons.map((button) => button.accessibilityLabel)).toEqual(["Allow for this site", "Allow once", "Block this site"]);
  media.buttons[1]!.onPress!();
  expect(media.choices).toEqual(["once"]);
  const storage = dialog(["persistent-storage"]);
  expect(storage.text).toContain("cannot undo it");
  expect(storage.buttons.map((button) => button.accessibilityLabel)).toEqual(["Allow persistent storage", "Block this site"]);
  storage.buttons[0]!.onPress!();
  expect(storage.choices).toEqual(["always"]);
});

test("private content choices describe private browsing rather than claiming one request", () => {
  const value = dialog(["notifications"], true);
  expect(value.buttons.map((button) => button.accessibilityLabel)).toEqual(["Allow in private browsing", "Block in private browsing"]);
  expect(value.text).toContain("not added to your saved site rules");
  value.buttons[0]!.onPress!();
  expect(value.choices).toEqual(["always"]);
  expect(dialog(["camera"], true).buttons.map((button) => button.accessibilityLabel)).toEqual(["Allow once", "Deny once"]);
});
