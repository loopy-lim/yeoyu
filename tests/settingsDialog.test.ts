import { expect, test } from "bun:test";

test("settings keeps drafts across language changes and remains navigable with large text", () => {
  const result = Bun.spawnSync([process.execPath, "tests/fixtures/settings-dialog.tsx"], {
    cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe",
  });
  expect({ code: result.exitCode, output: result.stderr.toString() }).toEqual({ code: 0, output: "" });
});
