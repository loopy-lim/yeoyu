import * as commands from "@generated/react-native";
import { bindArchiveCommand } from "@/archiveAsyncInvoke";
import { BrowserController } from "@/BrowserController";
import { platform } from "@/platform";

/** Composition boundary: only the app runtime loads React Native and generated JSI. */
export const controller = new BrowserController(
  {
    ...commands,
    workArchiveExport: bindArchiveCommand(
      "workArchiveExport",
    ) as typeof commands.workArchiveExport,
    workArchivePreview: bindArchiveCommand(
      "workArchivePreview",
    ) as typeof commands.workArchivePreview,
    workArchivePrepare: bindArchiveCommand(
      "workArchivePrepare",
    ) as typeof commands.workArchivePrepare,
    workArchiveImport: bindArchiveCommand(
      "workArchiveImport",
    ) as typeof commands.workArchiveImport,
    ready: () => commands.rustra.ready(),
  },
  platform,
);