import { expect, test } from "bun:test";
import { fileURLToPath, URL } from "node:url";

test("sync settings cover every connection state and the sidebar region folds correctly", () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "test",
      fileURLToPath(new URL("./fixtures/sync-settings.tsx", import.meta.url)),
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  if (result.exitCode)
    throw new Error(result.stdout.toString() + result.stderr.toString());
  expect(result.exitCode).toBe(0);
}, 15000);
