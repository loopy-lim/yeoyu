import { expect, test } from "bun:test";
import { fileURLToPath, URL } from "node:url";

for (const scenario of [
  "query-race",
  "configure",
  "return-once",
  "strict-return",
  "return-failure",
  "validation",
  "resume",
  "cleanup",
  "old-binary",
]) {
  test(`external PiP ${scenario}`, () => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        fileURLToPath(
          new URL(
            "./fixtures/external-picture-in-picture-hook.tsx",
            import.meta.url
          )
        ),
        scenario,
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    if (result.exitCode) throw Error(result.stderr.toString());
    expect(JSON.parse(result.stdout.toString())).toEqual({
      scenario,
      passed: true,
    });
  });
}
