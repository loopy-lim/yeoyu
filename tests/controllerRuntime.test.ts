import { mock, test, expect } from "bun:test";

test("archive runtime bindings invoke createAsyncEngine", async () => {
  const archiveInvocations: {
    command: string;
    options?: { signal?: AbortSignal; timeoutMs?: number };
  }[] = [];
  mock.module("@generated/react-native", () => ({
    rustra: { ready: async () => undefined },
  }));
  mock.module("@rustra/react-native", () => ({
    createAsyncEngine: () => ({
      invoke: (
        command: string,
        _args: unknown,
        options?: { signal?: AbortSignal; timeoutMs?: number },
      ) => {
        archiveInvocations.push({ command, options });
        if (command === "workArchiveExport") return Promise.resolve("{}");
        return Promise.resolve({});
      },
    }),
    getRustraNative: () => ({}),
  }));
  const { invokeArchiveCommand } = await import("../src/archiveAsyncInvoke");
  const signal = new AbortController().signal;
  await invokeArchiveCommand("workArchiveExport", { presentation: null }, {
    signal,
    timeoutMs: 30_000,
  });
  expect(archiveInvocations).toEqual([
    {
      command: "workArchiveExport",
      options: { signal, timeoutMs: 30_000 },
    },
  ]);
});