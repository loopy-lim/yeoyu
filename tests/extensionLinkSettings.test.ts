import { expect, test } from "bun:test";

test("extension link installation validates input, preserves consent and recovers from failure", () => {
  const result = Bun.spawnSync(
    [process.execPath, "test", "./tests/fixtures/extension-link-settings.tsx"],
    {
      cwd: `${import.meta.dir}/..`,
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  expect({ code: result.exitCode, output: result.stderr.toString() }).toEqual({
    code: 0,
    output: expect.any(String),
  });
});
