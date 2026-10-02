import { expect, test } from "bun:test";

const cases = [
  ["pending", "main-window permissions wait until window ownership is known"],
  ["event", "a window ownership event supersedes the pending initial snapshot"],
  ["event-failure", "failure of an obsolete ownership read does not block a newer event"],
  ["read", "a successful initial snapshot opens only main-owned permissions"],
  ["retry", "failed ownership reads keep permissions blocked and retry on activation"],
  ["malformed", "malformed ownership stays blocked until a valid native event arrives"],
  ["unsupported", "a runtime without window support opens main-owned permissions"],
  ["cleanup", "late ownership reads cannot mutate an unmounted imperative ref"],
] as const;

for (const [scenario, title] of cases) {
  test(title, () => {
    const result = Bun.spawnSync(
      [process.execPath, "tests/fixtures/window-tabs.tsx", scenario],
      { cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe" },
    );
    expect({ code: result.exitCode, output: result.stderr.toString() }).toEqual({
      code: 0,
      output: "",
    });
  });
}
