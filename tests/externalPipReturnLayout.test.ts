import { test, expect } from "bun:test";
import { fileURLToPath, URL } from "node:url";
for (const scenario of [
  "right-pane-roundtrip",
  "restore-geometry-immediately",
  "unhydrated-no-restoration",
  "idle-before-commit",
  "restoration-consumed",
  "queued-new-split-wins",
  "same-active-departure",
  "query-during-preparation",
  "vertical-order-ratio",
  "partner-closed",
  "partner-close-reopen",
  "space-away-and-back",
  "source-reused-before-return",
  "queued-source-suspended",
  "queued-partner-moved",
  "source-navigation-invalidates",
]) {
  test(`external PiP return layout ${scenario}`, () => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        fileURLToPath(
          new URL("./fixtures/external-pip-return-layout.tsx", import.meta.url)
        ),
        scenario,
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({
      scenario,
      passed: true,
    });
  });
}
