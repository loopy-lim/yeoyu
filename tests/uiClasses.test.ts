import { expect, test } from "bun:test";
import { cn } from "../src/ui/cn";
import { controlVariants, rowVariants, textVariants } from "../src/ui/variants";

test("class overrides retain the independent font size and foreground role", () => {
  expect(cn("text-body text-ink", "text-ink-muted")).toBe(
    "text-body text-ink-muted"
  );
  expect(cn("text-body text-ink", "text-input")).toBe("text-ink text-input");
  expect(cn("text-icon-size text-icon", "text-ink")).toBe(
    "text-icon-size text-ink"
  );
});

test("conditional classes and layout overrides produce one effective control style", () => {
  expect(cn("px-sm", false, ["px-lg", { "opacity-disabled": true }])).toBe(
    "px-lg opacity-disabled"
  );
  expect(
    cn(controlVariants({ tone: "accent", disabled: true }), "h-action-row")
  ).toContain("bg-accent-strong");
  expect(
    cn(controlVariants({ tone: "accent", disabled: true }), "h-action-row")
  ).toContain("opacity-disabled");
  expect(
    cn(controlVariants({ tone: "accent", disabled: true }), "h-action-row")
  ).not.toContain("h-icon-button");
});

test("selected rows and text roles preserve their separate layout and foreground classes", () => {
  const row = rowVariants({ selected: true, density: "tab" });
  expect(row).toContain("bg-pill");
  expect(row).toContain("h-tab-row");
  expect(
    cn(textVariants({ size: "input", tone: "muted", weight: "medium" }))
  ).toBe("text-input text-ink-muted font-medium");
});
