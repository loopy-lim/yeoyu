import { expect, test } from "bun:test";

test("address triggers keep full navigation origins for trust and accessible hints", () => {
  const result = Bun.spawnSync(
    [process.execPath, "test", "./tests/fixtures/address-trigger.tsx"],
    {
      cwd: `${import.meta.dir}/..`,
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  if (result.exitCode)
    throw new Error(result.stdout.toString() + result.stderr.toString());
  expect(result.exitCode).toBe(0);
});
