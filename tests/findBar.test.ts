import { expect, test } from "bun:test";

const cases = [
  ["position", "find remains visible inside the content card and lets the page receive touches"],
  ["narrow", "find keeps its input and close controls inside a narrow content card"],
  ["counts", "find displays Gecko's one-based match ordinal and unknown total"],
  ["no-matches", "find does not step a query with no matches"],
  ["retarget", "finding in a different tab resets the query and cancels the old debounce"],
] as const;

for (const [scenario, title] of cases) {
  test(title, () => {
    const result = Bun.spawnSync(
      [process.execPath, "tests/fixtures/find-bar.tsx", scenario],
      { cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe" },
    );
    expect({ code: result.exitCode, output: result.stderr.toString() }).toEqual({
      code: 0,
      output: "",
    });
  });
}
