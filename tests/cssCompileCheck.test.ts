import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dir, "..");
const SCRIPT = path.join(ROOT, "scripts", "css-compile-check.mjs");
const GLOBAL_CSS = path.join(ROOT, "global.css");

test("css compile gate passes for repository global.css", () => {
  const result = spawnSync("node", [SCRIPT], {
    cwd: ROOT,
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("CSS compile gate passed");
});

test("css compile gate fails when --color-input collides with --text-input", () => {
  const baseCss = fs.readFileSync(GLOBAL_CSS, "utf8");
  const brokenCss = baseCss.replace(
    "@theme inline {",
    "@theme inline {\n  --color-input: var(--color-card-border);"
  );
  const result = spawnSync("node", [SCRIPT, "--stdin"], {
    cwd: ROOT,
    input: brokenCss,
    encoding: "utf8",
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("text-input");
});
