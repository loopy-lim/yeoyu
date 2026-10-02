import { expect, test } from "bun:test";

for (const [scenario, title] of [
  [
    "initial",
    "input viewport queries the exact owner for an already-visible keyboard",
  ],
  [
    "routing",
    "main and secondary input viewports receive only their own events",
  ],
  [
    "stale",
    "a new input viewport event supersedes the pending native snapshot",
  ],
  [
    "rotation",
    "rotation, keyboard hiding and activation refresh viewport geometry",
  ],
  ["retarget", "switching scope rejects late previous-owner results"],
  [
    "invalid",
    "malformed and foreign viewport payloads cannot alter owner geometry",
  ],
  ["cleanup", "unmount releases input viewport listeners and late results"],
  [
    "unsupported",
    "input viewport remains compatible with runtimes without the bridge",
  ],
] as const) {
  test(title, () => {
    const result = Bun.spawnSync(
      [process.execPath, "tests/fixtures/input-viewport.tsx", scenario],
      {
        cwd: `${import.meta.dir}/..`,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    expect({ code: result.exitCode, output: result.stderr.toString() }).toEqual(
      { code: 0, output: "" }
    );
  });
}
