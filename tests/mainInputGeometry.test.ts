import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { parse } from "@babel/parser";

// Evaluate current App geometry at the native measurement boundary. This does
// not simulate Yoga, IME animation or Gecko; those remain Android/device gates.
const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const ast = parse(source, {
  sourceType: "module",
  plugins: ["typescript", "jsx"],
});
const overlaySource = readFileSync(
  new URL("../src/chrome/Overlay.tsx", import.meta.url),
  "utf8"
);
const overlayAst = parse(overlaySource, {
  sourceType: "module",
  plugins: ["typescript", "jsx"],
});
let sheetInsets: string[] = [],
  newTabInset = "",
  closeAddressSheet = "",
  addressInputRef = "",
  addressInputKey = "",
  overlaySheetStyle = "";
const addressOpenBodies: Record<string, string> = {};
function visit(node: any) {
  if (!node || typeof node !== "object") return;
  if (
    node.type === "VariableDeclarator" &&
    node.id?.name === "newTabKeyboardInset"
  )
    newTabInset = source.slice(node.init.start, node.init.end);
  if (node.type === "VariableDeclarator" && node.id?.name === "closeQuickOpen")
    closeAddressSheet = source.slice(node.init.start, node.init.end);
  if (
    node.type === "VariableDeclarator" &&
    ["openQuickOpen", "openLocationEditor"].includes(node.id?.name)
  )
    addressOpenBodies[node.id.name] = source.slice(
      node.init.body.start,
      node.init.body.end
    );
  if (
    node.type === "JSXOpeningElement" &&
    node.name?.name === "AddressBox" &&
    node.attributes.some(
      (attribute: any) => attribute.name?.name === "autoFocus"
    )
  ) {
    const expression = node.attributes.find(
      (attribute: any) => attribute.name?.name === "ref"
    )?.value?.expression;
    if (expression)
      addressInputRef = source.slice(expression.start, expression.end);
    const key = node.attributes.find(
      (attribute: any) => attribute.name?.name === "key"
    )?.value?.expression;
    if (key) addressInputKey = source.slice(key.start, key.end);
  }
  if (
    node.type === "JSXOpeningElement" &&
    node.name?.name === "OverlaySheet"
  ) {
    const expression = node.attributes.find(
      (attribute: any) => attribute.name?.name === "bottomInset"
    )?.value?.expression;
    sheetInsets.push(
      expression ? source.slice(expression.start, expression.end) : ""
    );
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") visit(value);
  }
}
visit(ast);
function visitOverlay(node: any) {
  if (!node || typeof node !== "object") return;
  if (
    node.type === "VariableDeclarator" &&
    node.id?.name === "resolvedStyle" &&
    node.init
  ) {
    overlaySheetStyle = overlaySource.slice(node.init.start, node.init.end);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visitOverlay);
    else if (value && typeof value === "object") visitOverlay(value);
  }
}
visitOverlay(overlayAst);
const insetFor = (
  keyboardInset: number,
  visibleHeight: number,
  frame: { y: number; height: number }
) => {
  if (!newTabInset)
    throw new Error(
      "New-tab input must use its measured pane's keyboard intersection"
    );
  return new Function(
    "keyboardInset",
    "visibleHeight",
    "frame",
    `return (${newTabInset});`
  )(keyboardInset, visibleHeight, frame);
};

test("main sheets center inside the owner-confirmed visible input viewport", () => {
  expect(sheetInsets.length).toBeGreaterThan(0);
  expect(sheetInsets.every((expr) => expr === "keyboardInset")).toBe(true);
  expect(overlaySheetStyle).not.toBe("");
  const geometry = new Function(
    "bottomInset",
    "style",
    `return (${overlaySheetStyle});`
  );
  expect(geometry(0, undefined)).toEqual([{ bottom: 0 }, undefined]);
  expect(geometry(320, undefined)).toEqual([{ bottom: 320 }, undefined]);
});

test("new-tab address bounds shrink only by the IME intersection with their own split pane", () => {
  expect(insetFor(320, 480, { y: 20, height: 300 })).toBe(0);
  expect(insetFor(320, 480, { y: 340, height: 420 })).toBe(280);
  expect(insetFor(0, 800, { y: 340, height: 420 })).toBe(0);
  expect(insetFor(320, 480, { y: 340, height: 0 })).toBe(0);
  expect(insetFor(320, 200, { y: 340, height: 420 })).toBe(420);
});

test("closing the address sheet blurs its retained input before leaving the background interactive", () => {
  expect(addressInputRef).not.toBe("");
  const events: string[] = [];
  const ownerInput: { current: { blur: () => void } | null } = {
    current: { blur: () => events.push("owner blurred") },
  };
  const dismiss = new Function(
    addressInputRef,
    "setQuickOpen",
    "setQuickOpenEdit",
    `return (${closeAddressSheet});`
  )(
    ownerInput,
    (open: boolean) => events.push(`sheet ${open}`),
    (edit: boolean) => events.push(`edit ${edit}`)
  );
  dismiss();
  expect(events).toEqual(["owner blurred", "sheet false", "edit false"]);
  // An already unmounted input must still permit closing the sheet.
  ownerInput.current = null;
  expect(() => dismiss()).not.toThrow();
});

test("each quick-open request presents a fresh input even when close and reopen commit together", () => {
  expect(addressInputKey).toBe("quickOpenPresentation");
  let presentation = 0;
  let open = true;
  const request = () => presentation++;
  for (const name of ["openLocationEditor", "openQuickOpen"]) {
    open = false;
    const reopen = new Function(
      "mode",
      "target",
      "platform",
      "nextQuickOpenPresentation",
      "setQuickOpenSoft",
      "setQuickOpenEdit",
      "setQuickOpen",
      addressOpenBodies[name]
    );
    reopen(
      "touch",
      null,
      {},
      request,
      () => {},
      () => {},
      (value: boolean) => {
        open = value;
      }
    );
    expect(open).toBe(true);
  }
  expect(presentation).toBe(2);
});
