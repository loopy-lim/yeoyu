import { beforeAll, expect, test } from "bun:test";
import {
  browserSnapshotCodec,
  workArchiveExportCodec,
} from "@generated/frame-codecs";
import { frameRegistry } from "@generated/frame-registry";
import {
  createAsyncEngine,
  type RustraJSIAsyncNative,
} from "../.deps/rustra-main/packages/react-native/src/react-native-async";

function makeAsyncByIdNative() {
  const byIdCalls: { cmdId: number; args: unknown }[] = [];
  const cancelIds: number[] = [];
  let resolveNow: (() => void) | null = null;

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
      resolveNow = () => onSuccess(resultPayload(commandId));
      return commandId + 100;
    },
    invokeCancel(invocationId: number) {
      cancelIds.push(invocationId);
      return true;
    },
  };

  return {
    native,
    byIdCalls,
    cancelIds,
    get resolveNow() {
      return resolveNow;
    },
    clear() {
      byIdCalls.length = 0;
      cancelIds.length = 0;
      resolveNow = null;
    },
  };
}

function resultPayload(commandId: number): unknown {
  if (commandId === workArchiveExportCodec.commandId) return { json: "{}" };
  if (commandId === browserSnapshotCodec.commandId)
    return { revision: 0, tabs: [], workspaces: [] };
  return {};
}

const harness = makeAsyncByIdNative();
let engine: ReturnType<typeof createAsyncEngine>;

beforeAll(() => {
  engine = createAsyncEngine(harness.native, {
    frameCodecs: frameRegistry,
    contractVerification: "off",
  });
});

test("frame-registry archive commands route through invokeTypedAsyncById", async () => {
  harness.clear();
  const pending = engine.invoke("workArchiveExport", { presentation: null });
  harness.resolveNow?.();
  await expect(pending).resolves.toEqual({ json: "{}" });
  expect(harness.byIdCalls).toEqual([
    { cmdId: workArchiveExportCodec.commandId, args: { presentation: null } },
  ]);
});

test("import recovery browserSnapshot uses async byId cmd 1", async () => {
  harness.clear();
  const pending = engine.invoke("browserSnapshot", {}, { timeoutMs: 30_000 });
  harness.resolveNow?.();
  await expect(pending).resolves.toMatchObject({ revision: 0 });
  expect(harness.byIdCalls).toEqual([{ cmdId: browserSnapshotCodec.commandId, args: {} }]);
});

test("async archive invoke propagates abort through invokeCancel", async () => {
  harness.clear();
  const abort = new AbortController();
  const pending = engine.invoke(
    "workArchiveExport",
    { presentation: null },
    { signal: abort.signal },
  );
  abort.abort();
  await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  expect(harness.cancelIds).toEqual([workArchiveExportCodec.commandId + 100]);
});