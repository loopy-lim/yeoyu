import { expect, test } from "bun:test";
import { fileURLToPath, URL } from "node:url";

// Each RN harness stays in its own process; mocked native boundaries cannot
// leak into unrelated suites or the actual installed Pressability checks.
for (const fixture of [
  "sidebar-interaction-checks.tsx",
  "sidebar-drag-boundary-checks.tsx",
]) {
  test(`sidebar retention: ${fixture}`, () => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "test",
        fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url)),
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    if (result.exitCode)
      throw new Error(result.stdout.toString() + result.stderr.toString());
    expect(result.exitCode).toBe(0);
  }, 15000);
}
