import * as commands from "../generated/react-native";
import { BrowserController } from "./BrowserController";
import { platform } from "./platform";

/** Composition boundary: only the app runtime loads React Native and generated JSI. */
export const controller = new BrowserController(
  { ...commands, ready: () => commands.rustra.ready() },
  platform
);
