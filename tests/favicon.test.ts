import { expect, test } from "bun:test";
import { fileURLToPath, URL } from "node:url";
import { FaviconCache } from "../src/favicons";

// Keep the installed RN Pressable/native boundary mocks isolated.
test("favicon presentation across sidebar and URL boundaries", () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "test",
      fileURLToPath(new URL("./fixtures/favicon-checks.tsx", import.meta.url)),
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  if (result.exitCode)
    throw new Error(result.stdout.toString() + result.stderr.toString());
  expect(result.exitCode).toBe(0);
}, 15000);
test("private icons never use the ordinary network stack or persistent cache", async () => {
  let reads = 0, writes = 0, fetches = 0;
  const cache = new FaviconCache({ read: async () => { reads++; return null; }, save: async () => { writes++; } }, async () => { fetches++; throw Error("must not fetch private icon"); });
  expect(await cache.forUrl("https://private-canary.example", { persist: false })).toBeNull();
  expect({ reads, writes, fetches }).toEqual({ reads: 0, writes: 0, fetches: 0 });
});
