import { createContext, useContext } from "react";
import { themes, type Theme } from "./theme";

// Components read the active appearance from here; App provides the value.
export const ThemeContext = createContext<Theme>(themes.lavender);
export const useTheme = () => useContext(ThemeContext);
