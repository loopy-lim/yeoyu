import { expect, test } from "bun:test";
import { fileURLToPath, URL } from "node:url";

test("archive async bindings cover the production archiveAsyncInvoke path", () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      fileURLToPath(new URL("./fixtures/archive-async-bindings.ts", import.meta.url)),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode) {
    throw new Error(result.stdout.toString() + result.stderr.toString());
  }
  expect(result.exitCode).toBe(0);
});