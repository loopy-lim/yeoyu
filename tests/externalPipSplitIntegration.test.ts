import { expect, test } from "bun:test";
import { fileURLToPath, URL } from "node:url";

for (const scenario of [
  "replace-pane",
  "leave-focused-second-pane",
  "return-to-second-pane",
  "bookmark-layout",
  "queued-layouts",
  "move-background-pane-space",
  "move-active-pane-space",
]) {
  test(`external PiP split integration ${scenario}`, () => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        fileURLToPath(
          new URL(
            "./fixtures/external-pip-split-integration.tsx",
            import.meta.url
          )
        ),
        scenario,
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    if (result.exitCode) throw Error(result.stderr.toString());
    expect(JSON.parse(result.stdout.toString())).toEqual({
      scenario,
      passed: true,
    });
  });
}
