import * as commands from "@generated/react-native";
import { bindAsyncFrameCommand } from "@/archiveAsyncInvoke";
import { BrowserController } from "@/BrowserController";
import { platform } from "@/platform";

/** Composition boundary: only the app runtime loads React Native and generated JSI. */
export const controller = new BrowserController(
  {
    ...commands,
    browserSnapshot: bindAsyncFrameCommand("browserSnapshot"),
    workArchiveExport: bindAsyncFrameCommand("workArchiveExport"),
    workArchivePreview: bindAsyncFrameCommand("workArchivePreview"),
    workArchivePrepare: bindAsyncFrameCommand("workArchivePrepare"),
    workArchiveImport: bindAsyncFrameCommand("workArchiveImport"),
    ready: () => commands.rustra.ready(),
  },
  platform,
);