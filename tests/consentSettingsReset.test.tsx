import { expect, test } from "bun:test";

test("permission settings prepare device access, preserve reset, and scope autoplay choices", () => {
  const result = Bun.spawnSync(
    [process.execPath, "tests/fixtures/consent-permissions.tsx"],
    {
      cwd: `${import.meta.dir}/..`,
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  expect({ code: result.exitCode, output: result.stderr.toString() }).toEqual({
    code: 0,
    output: "",
  });
});
