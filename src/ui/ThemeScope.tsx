import React, { useMemo, type ReactNode } from "react";
import { ScopedVariables } from "uniwind";
import type { Theme } from "@/theme";

/** Keep every resolved Theme role local to its RN root or nested Space. */
export function themeToVariables(
  theme: Theme
): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(theme).map(([role, value]) => [
      `--color-${role.replace(
        /[A-Z]/g,
        (letter) => `-${letter.toLowerCase()}`
      )}`,
      value,
    ])
  );
}

export function ThemeScope({
  theme,
  children,
}: {
  theme: Theme;
  children: ReactNode;
}) {
  const variables = useMemo(() => themeToVariables(theme), [theme]);
  return <ScopedVariables variables={variables}>{children}</ScopedVariables>;
}
