import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { parse } from "@babel/parser";

// Evaluate the docked phone bar's IME lift at the source wiring level. This
// does not simulate Yoga, the IME animation or Gecko; those stay Android
// gates (issue #25 acceptance: the input row and bottom bar must stay clear
// of the soft keyboard on phones).
const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const ast = parse(source, {
  sourceType: "module",
  plugins: ["typescript", "jsx"],
});

let liftStyle = "";
let hostStart = -1;
let hostEnd = -1;
let bars: { name: string; start: number }[] = [];
function visit(node: any) {
  if (!node || typeof node !== "object") return;
  if (
    node.type === "VariableDeclarator" &&
    node.id?.name === "imeLiftStyle" &&
    node.init
  )
    liftStyle = source.slice(node.init.start, node.init.end);
  if (node.type === "JSXOpeningElement" && node.name?.name === "PhoneBottomBar")
    bars.push({ name: "PhoneBottomBar", start: node.start });
  if (node.type === "JSXOpeningElement" && node.name?.name === "PhoneHybridBar")
    bars.push({ name: "PhoneHybridBar", start: node.start });
  if (node.type === "JSXOpeningElement" && node.name?.name === "View") {
    const style = node.attributes.find(
      (attribute: any) => attribute.name?.name === "style"
    )?.value?.expression;
    if (
      hostStart < 0 &&
      style &&
      source.slice(style.start, style.end) === "imeLiftStyle(keyboardInset)"
    )
      hostStart = node.start;
  }
  // The lift host wraps only the two phone bar components, so the first View
  // closing tag after the host opens is the host's own.
  if (node.type === "JSXClosingElement" && node.name?.name === "View") {
    if (hostEnd < 0 && node.end > hostStart && hostStart >= 0) hostEnd = node.end;
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") visit(value);
  }
}
visit(ast);
let enclosingGate = "";
function visitGates(node: any) {
  if (!node || typeof node !== "object") return;
  if (node.type === "JSXExpressionContainer") {
    if (node.start < hostStart && node.end > hostEnd)
      enclosingGate = source.slice(node.start, node.end);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visitGates);
    else if (value && typeof value === "object") visitGates(value);
  }
}
visitGates(ast);

test("the docked phone bar rides the owner-confirmed IME inset", () => {
  expect(liftStyle).not.toBe("");
  // Strip the parameter's TS annotation so the extracted arrow stays
  // evaluable JS; the annotation itself is asserted by bun run typecheck.
  expect(liftStyle).toMatch(/^\(keyboardInset(: number)?\) =>/);
  const lift = new Function(
    "keyboardInset",
    `return (${liftStyle.replace("(keyboardInset: number)", "(keyboardInset)")})(keyboardInset);`
  );
  // Resting chrome stays untouched; a risen keyboard parks the bar on top.
  expect(lift(0)).toBeUndefined();
  expect(lift(320)).toEqual({ transform: [{ translateY: -320 }] });
});

test("both compact chrome bars mount inside the lift host", () => {
  expect(bars.map((bar) => bar.name).sort()).toEqual([
    "PhoneBottomBar",
    "PhoneHybridBar",
  ]);
  expect(hostStart).toBeGreaterThan(0);
  expect(hostEnd).toBeGreaterThan(hostStart);
  for (const bar of bars) {
    expect(bar.start).toBeGreaterThan(hostStart);
    expect(bar.start).toBeLessThan(hostEnd);
  }
});

test("the lift only mounts for the compact bottom chrome tiers", () => {
  // Tablets resolve phoneChromeLayout to "top" and never enter this gate,
  // so the transform cannot reach the tablet layout (issue #25 scope).
  expect(enclosingGate).toContain("bottomChrome || hybridChrome");
  expect(enclosingGate).toContain("!contentFullscreen");
  expect(enclosingGate).toContain("!isLittleArc");
});
