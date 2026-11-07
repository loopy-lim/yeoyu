import { expect, test } from "bun:test";
import { URL } from "node:url";

test("content-menu privateOpen opens a private tab and download hands off to the bridge", () => {
  const result = Bun.spawnSync(
    [process.execPath, new URL("./fixtures/browser-workflows-context.tsx", import.meta.url).pathname],
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
