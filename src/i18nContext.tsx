import React, { createContext, useContext, useCallback } from "react";
import { translate, type AppLanguage, type TranslationKey } from "./i18n";

export const I18nContext = createContext<AppLanguage>("en");

export function useI18n() {
  const language = useContext(I18nContext);
  const tr = useCallback(
    (key: TranslationKey, values?: Record<string, string | number>) =>
      translate(language, key, values),
    [language]
  );
  return { language, tr };
}
