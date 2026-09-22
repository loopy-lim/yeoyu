import { expect, test } from "bun:test";
import { fileURLToPath, URL } from "node:url";

test("compact sidebar components keep selection, privacy and input boundaries", () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "test",
      fileURLToPath(
        new URL("./fixtures/sidebar-collections.tsx", import.meta.url)
      ),
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  if (result.exitCode)
    throw new Error(result.stdout.toString() + result.stderr.toString());
  expect(result.exitCode).toBe(0);
}, 15000);
