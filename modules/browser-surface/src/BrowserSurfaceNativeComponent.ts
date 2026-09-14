import type { HostComponent, ViewProps, CodegenTypes } from "react-native";
import { codegenNativeComponent, codegenNativeCommands } from "react-native";
import type React from "react";
export type Navigation = Readonly<{
  tabId: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  fullscreen?: boolean;
  navigationSequence?: CodegenTypes.Double;
}>;
export interface NativeProps extends ViewProps {
  tabId: string;
  initialUrl: string;
  active?: boolean;
  onNavigation?: CodegenTypes.DirectEventHandler<Navigation>;
  onFocused?: CodegenTypes.DirectEventHandler<Readonly<{ tabId: string }>>;
}
type Surface = HostComponent<NativeProps>;
interface NativeCommands {
  loadUrl: (viewRef: React.ElementRef<Surface>, url: string) => void;
  goBack: (viewRef: React.ElementRef<Surface>) => void;
  goForward: (viewRef: React.ElementRef<Surface>) => void;
  reload: (viewRef: React.ElementRef<Surface>) => void;
  focusContent: (viewRef: React.ElementRef<Surface>) => void;
}
export const Commands = codegenNativeCommands<NativeCommands>({
  supportedCommands: [
    "loadUrl",
    "goBack",
    "goForward",
    "reload",
    "focusContent",
  ],
});
export default codegenNativeComponent<NativeProps>("BrowserSurface") as Surface;
