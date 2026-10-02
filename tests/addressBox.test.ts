import { expect, test } from "bun:test";

test("keyboard selection stays inside a short address result viewport", () => {
  const result = Bun.spawnSync(
    [process.execPath, "tests/fixtures/address-box.tsx"],
    {
      cwd: `${import.meta.dir}/..`,
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  expect({ code: result.exitCode, output: result.stderr.toString() }).toEqual({
    code: 0,
    output: "",
  });
});

test("rapid native direction keys accumulate before same-batch Enter", () => {
  const result = Bun.spawnSync(
    [process.execPath, "tests/fixtures/address-box.tsx", "rapid"],
    {
      cwd: `${import.meta.dir}/..`,
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  expect({ code: result.exitCode, output: result.stderr.toString() }).toEqual({
    code: 0,
    output: "",
  });
});

test("a fresh address presentation restores native focus after retained-input blur", () => {
  const result = Bun.spawnSync(
    [process.execPath, "tests/fixtures/address-box.tsx", "presentation"],
    {
      cwd: `${import.meta.dir}/..`,
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  expect({ code: result.exitCode, output: result.stderr.toString() }).toEqual({
    code: 0,
    output: "",
  });
});
