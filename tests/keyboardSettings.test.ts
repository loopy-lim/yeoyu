import { expect, test } from "bun:test";

test.each(["draft-isolation", "save-failure-conflicts", "pending-actions", "closed-save", "advanced-draft", "rapid-add"])("keyboard editor: %s", (scenario) => {
  const result = Bun.spawnSync([process.execPath, "tests/fixtures/keyboard-settings.tsx", scenario], {
    cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe",
  });
  expect({ code: result.exitCode, output: result.stderr.toString() }).toEqual({ code: 0, output: "" });
});
