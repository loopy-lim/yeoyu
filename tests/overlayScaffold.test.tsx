import { expect, test } from "bun:test";
import { URL } from "node:url";

test("overlay scaffold primitives preserve animation, modal accessibility, backdrop, and menu anchoring contracts", () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      new URL("./fixtures/overlay-scaffold.tsx", import.meta.url).pathname,
    ],
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
