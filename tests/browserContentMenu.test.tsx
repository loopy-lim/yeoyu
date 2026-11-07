import { expect, test } from "bun:test";
import { URL } from "node:url";

test("content menu keeps the mainstream link/image action set per source privacy", () => {
  const result = Bun.spawnSync(
    [process.execPath, new URL("./fixtures/browser-content-menu.tsx", import.meta.url).pathname],
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
