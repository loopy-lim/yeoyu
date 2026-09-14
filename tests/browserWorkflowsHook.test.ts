import { expect, test } from "bun:test";
import { fileURLToPath, URL } from "node:url";

test("startup session warnings arrive before the ready gate and listeners end with the hook", () => {
  const result = Bun.spawnSync([process.execPath, fileURLToPath(new URL("./fixtures/browser-workflows-hook.tsx", import.meta.url))], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw Error(result.stderr.toString());
  expect(JSON.parse(result.stdout.toString())).toEqual({ startupWarningDelivered: true, readyGate: true, listenerReleased: true });
});
