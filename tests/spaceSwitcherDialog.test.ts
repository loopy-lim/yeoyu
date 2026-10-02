import { expect, test } from "bun:test";

test("a long Space list can scroll while close and new-Space actions stay outside it", () => {
  const result = Bun.spawnSync(
    [process.execPath, "tests/fixtures/space-switcher-dialog.tsx"],
    { cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe" },
  );
  expect({ code: result.exitCode, output: result.stderr.toString() }).toEqual({
    code: 0,
    output: "",
  });
});
