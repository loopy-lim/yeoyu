import { expect, test } from "bun:test";

test("retrying a native window binding keeps the tab already created for that owner", () => {
  const result = Bun.spawnSync(
    [process.execPath, "tests/fixtures/window-address.tsx", "owner-retry"],
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

test("new window lookup, binding and closing stay with their launch owner after focus changes", () => {
  const result = Bun.spawnSync(
    [process.execPath, "tests/fixtures/window-address.tsx", "owner"],
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

test("OS window addresses use the saved search engine and preserve URI schemes", () => {
  const result = Bun.spawnSync(
    [process.execPath, "tests/fixtures/window-address.tsx"],
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

test("each OS window shows and resolves only its own site's permission requests", () => {
  const result = Bun.spawnSync(
    [process.execPath, "tests/fixtures/window-address.tsx", "permissions"],
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

test("an OS window can retry a failed preference read without resetting saved preferences", () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "tests/fixtures/window-address.tsx",
      "preferences-failed",
    ],
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

test("a cold OS window applies saved site rules before restoring its browser tab", () => {
  const result = Bun.spawnSync(
    [process.execPath, "tests/fixtures/window-address.tsx", "cold-start"],
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
