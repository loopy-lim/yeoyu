import { expect, test } from "bun:test";
import { fileURLToPath, URL } from "node:url";

test("portable data UI previews choices and prevents duplicate import after appearance failure", () => {
  const result = Bun.spawnSync([process.execPath, fileURLToPath(new URL("./fixtures/browser-data-panel.tsx", import.meta.url))], {stdout: "pipe", stderr: "pipe"});
  if (result.exitCode) throw Error(result.stdout.toString() + result.stderr.toString());
  expect(result.exitCode).toBe(0);
});
