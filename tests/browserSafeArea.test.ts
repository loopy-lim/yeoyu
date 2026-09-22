import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@babel/parser";

// Execute the actual App boundary expression, as in splitFinalGeometry.test.tsx.
// This checks our SafeAreaView contract, not native device pixels or Yoga layout.
const source = readFileSync(resolve(import.meta.dir, "../src/App.tsx"), "utf8");
const ast = parse(source, {
  sourceType: "module",
  plugins: ["typescript", "jsx"],
});
const expressions: string[] = [];
function visit(node: unknown) {
  if (!node || typeof node !== "object") return;
  const item = node as Record<string, any>;
  if (item.type === "JSXOpeningElement" && item.name?.name === "SafeAreaView") {
    const style = item.attributes.find(
      (attr: any) => attr.name?.name === "style"
    );
    const expression = style?.value?.expression;
    if (
      expression?.object?.name === "s" &&
      expression.property?.name === "app"
    ) {
      const edges = item.attributes.find(
        (attr: any) => attr.name?.name === "edges"
      )?.value?.expression;
      expressions.push(
        edges ? source.slice(edges.start, edges.end) : "undefined"
      );
    }
  }
  for (const value of Object.values(item)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") visit(value);
  }
}
visit(ast);
if (expressions.length !== 1)
  throw new Error("Expected one browser canvas SafeAreaView");
const appEdges = new Function(
  "contentFullscreen",
  `return (${expressions[0]});`
) as (fullscreen: boolean) => string[] | undefined;

test.each([false, true])(
  "visible Home bar remains outside browser content (video fullscreen=%s)",
  (fullscreen) => {
    // SafeAreaView's documented default enables all four edges.
    const edges = appEdges(fullscreen) ?? ["top", "right", "bottom", "left"];
    expect(edges).toContain("bottom");
    expect(edges).toContain("left");
    expect(edges).toContain("right");
  }
);
