import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@babel/parser";
import { parseDownloadHistoryStatus } from "../src/downloadHistory";
import { translate } from "../src/i18n";

// Exercise the actual panel event handler without substituting React Native's
// global module mock used by the animation tests. Native Alert rendering is not simulated.
const source = readFileSync(resolve(import.meta.dir, "../src/components/BrowserToolsPanel.tsx"), "utf8");
const tree = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
let handlerSource = "";
function visit(node: unknown) {
  if (!node || typeof node !== "object") return;
  const entry = node as Record<string, unknown>;
  const id = entry.id as { name?: string } | undefined;
  if (entry.type === "VariableDeclarator" && id?.name === "recoverDownloadHistory") {
    const init = entry.init as { start: number; end: number };
    handlerSource = source.slice(init.start, init.end);
  }
  for (const value of Object.values(entry)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") visit(value);
  }
}
visit(tree);
if (!handlerSource) throw new Error("The download recovery handler was not found");
const createHandler = new Function("downloadHistory", "Alert", "perform", "platform", "parseDownloadHistoryStatus", "setDownloadHistory", "onNotice", "onError", "setDownloadRefresh", "tr", `return (${handlerSource});`);

type Button = { text: string; style?: string; onPress?: () => void };
function fixture(state: "damaged" | "unsupported", resultState = "ready") {
  let calls = 0;
  let buttons: Button[] = [];
  let copy = "";
  let operation: Promise<unknown> | undefined;
  const errors: string[] = [], notices: string[] = [];
  const handler = createHandler(
    parseDownloadHistoryStatus(JSON.stringify({ state, message: "Read failure", canReset: true })),
    { alert: (title: string, message: string, actions: Button[]) => { copy = `${title} ${message}`; buttons = actions; } },
    (task: () => Promise<unknown>) => { operation = task(); },
    { recoverDownloadHistory: async () => { calls++; return JSON.stringify({ state: resultState, message: "Recovery result", canReset: false }); } },
    parseDownloadHistoryStatus,
    () => {}, (message: string) => notices.push(message), (message: string) => errors.push(message), () => {},
    (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate("en", key, values),
  );
  return { handler, calls: () => calls, buttons: () => buttons, copy: () => copy, wait: () => operation, errors, notices };
}

test("recovery waits for explicit history confirmation and Cancel preserves the original", async () => {
  const value = fixture("damaged");
  value.handler();
  expect(value.calls()).toBe(0);
  expect(value.copy()).toContain("Downloaded files will stay");
  expect(value.copy()).toContain("original history will be kept");
  value.buttons().find((button) => button.style === "cancel")?.onPress?.();
  expect(value.calls()).toBe(0);
  value.buttons().find((button) => button.style === "destructive")!.onPress!();
  await value.wait();
  expect(value.calls()).toBe(1);
  expect(value.notices).toEqual(["Recovery result"]);
});

test("unsupported history never opens destructive confirmation", () => {
  const value = fixture("unsupported");
  value.handler();
  expect(value.buttons()).toEqual([]);
  expect(value.calls()).toBe(0);
});

test("failed backup reports an error rather than announcing recovery", async () => {
  const value = fixture("damaged", "unavailable");
  value.handler();
  value.buttons().find((button) => button.style === "destructive")!.onPress!();
  await value.wait();
  expect(value.notices).toEqual([]);
  expect(value.errors).toEqual(["Recovery result"]);
});
