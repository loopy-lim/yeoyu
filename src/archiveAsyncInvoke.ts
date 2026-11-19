import * as commands from "@generated/react-native";
import { frameRegistry } from "@generated/frame-registry";
import { GENERATED_CONTRACT_HASH, SCHEMA_VERSION } from "@generated/contract";
import {
  createAsyncEngine,
  getRustraNative,
  type ReactNativeEngine,
} from "@rustra/react-native";
import type { InvokeOptions } from "@rustra/types";

export type ArchiveCommand =
  | "workArchiveExport"
  | "workArchivePreview"
  | "workArchivePrepare"
  | "workArchiveImport";

export type AsyncFrameCommand = ArchiveCommand | "browserSnapshot";

let archiveAsyncEngine: ReactNativeEngine | null = null;

async function archiveEngine(): Promise<ReactNativeEngine> {
  await commands.rustra.ready();
  if (!archiveAsyncEngine) {
    archiveAsyncEngine = createAsyncEngine(getRustraNative(), {
      frameCodecs: frameRegistry,
      contractHash: GENERATED_CONTRACT_HASH,
      contractVerification: "strict",
      schemaVersion: SCHEMA_VERSION,
    });
  }
  return archiveAsyncEngine;
}

export async function invokeArchiveCommand<T>(
  command: AsyncFrameCommand,
  args: unknown,
  options?: InvokeOptions,
): Promise<T> {
  const engine = await archiveEngine();
  return engine.invoke<T>(command, args, options);
}

export function bindAsyncFrameCommand<Command extends AsyncFrameCommand>(
  command: Command,
): (typeof commands)[Command] {
  const bound = (
    input: Parameters<(typeof commands)[Command]>[0],
    options?: InvokeOptions,
  ) => invokeArchiveCommand(command, input, options);
  return bound as (typeof commands)[Command];
}