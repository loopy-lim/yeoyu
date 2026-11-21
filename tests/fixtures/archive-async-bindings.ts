import assert from "node:assert/strict";
import { mock } from "bun:test";

mock.module("react-native", () => ({
  NativeModules: {},
  Platform: { OS: "android", Version: 35 },
}));

const generatedSync = async () => {
  throw new Error("sync JSI must not run archive commands");
};
mock.module("@generated/react-native", () => ({
  rustra: { ready: async () => {} },
  workArchiveExport: generatedSync,
  browserSnapshot: generatedSync,
}));

const { GENERATED_CONTRACT_HASH } = await import("@generated/contract");
const { browserSnapshotCodec, workArchiveExportCodec } = await import(
  "@generated/frame-codecs"
);
type RustraJSIAsyncNative = import("@rustra/react-native").RustraJSIAsyncNative;

function makeAsyncByIdNative() {
  const byIdCalls: { cmdId: number; args: unknown }[] = [];
  const cancelIds: number[] = [];

  const native: RustraJSIAsyncNative = {
    invoke() {
      return new ArrayBuffer(0);
    },
    invokeFrame() {
      throw new Error("sync invokeFrame must not be used in async archive tests");
    },
    invokeTypedAsync() {
      return 1;
    },
    invokeTypedAsyncById(
      commandId: number,
      args: unknown,
      onSuccess: (result: unknown) => void,
    ) {
      byIdCalls.push({ cmdId: commandId, args });
      const complete = () =>
        onSuccess(
          commandId === workArchiveExportCodec.commandId
            ? { json: "{}" }
            : commandId === browserSnapshotCodec.commandId
              ? { revision: 0, tabs: [], workspaces: [] }
              : {},
        );
      setTimeout(complete, 100);
      return commandId + 100;
    },
    invokeCancel(invocationId: number) {
      cancelIds.push(invocationId);
      return true;
    },
    getContractHash() {
      return new TextEncoder().encode(GENERATED_CONTRACT_HASH).buffer;
    },
  };

  return { native, byIdCalls, cancelIds };
}

const harness = makeAsyncByIdNative();
(globalThis as { __rustraNative?: RustraJSIAsyncNative }).__rustraNative =
  harness.native;

const archive = await import("../../src/archiveAsyncInvoke");

const exportArchive = archive.bindAsyncFrameCommand("workArchiveExport");
assert.notEqual(exportArchive, generatedSync);

const snapshot = archive.bindAsyncFrameCommand("browserSnapshot");
assert.notEqual(snapshot, generatedSync);

harness.byIdCalls.length = 0;
assert.deepEqual(await exportArchive({ presentation: null }), { json: "{}" });
assert.deepEqual(harness.byIdCalls, [
  { cmdId: workArchiveExportCodec.commandId, args: { presentation: null } },
]);

harness.byIdCalls.length = 0;
assert.equal((await snapshot({}, { timeoutMs: 30_000 })).revision, 0);
assert.deepEqual(harness.byIdCalls, [
  { cmdId: browserSnapshotCodec.commandId, args: {} },
]);

harness.cancelIds.length = 0;
const abort = new AbortController();
const pending = exportArchive({ presentation: null }, { signal: abort.signal });
while (harness.byIdCalls.length === 0) {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
abort.abort();
await assert.rejects(pending, (error: unknown) => {
  assert.equal((error as { code?: string }).code, "cancelled");
  return true;
});
console.log("Archive async bindings use the production engine with strict contract verification.");