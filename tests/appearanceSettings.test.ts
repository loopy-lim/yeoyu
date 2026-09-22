import { expect, test } from "bun:test";

test("appearance editor follows live system mode and preserves the unsaved custom draft", () => {
  // React Native mocks stay in a separate process so other renderer suites retain theirs.
  const result = Bun.spawnSync([process.execPath, "tests/fixtures/appearance-settings.tsx"], {
    cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe",
  });
  expect({ code: result.exitCode, output: result.stderr.toString() }).toEqual({ code: 0, output: "" });
});
