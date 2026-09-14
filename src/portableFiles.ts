import { NativeModules } from "react-native";

export interface PortableFiles {
  /** Null means the user cancelled the picker. */
  chooseImport(): Promise<string | null>;
  chooseExport(contents: string, html: boolean): Promise<"saved" | null>;
}
export const portableFiles = NativeModules.BrowserData as PortableFiles | undefined;
