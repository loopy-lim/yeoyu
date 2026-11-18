import React, { useMemo, type ReactNode } from "react";
import { ScopedVariables } from "uniwind";
import { type SizeTokens, type Theme } from "@/theme";

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

/**
 * Scoped --spacing-* overrides for size tokens (issue #24). Keys mirror
 * `size` in src/theme.ts (global.css owns the static defaults); values are
 * dp numbers exactly like the compiled theme variables.
 */
export function sizeToVariables(
  sizes: Partial<SizeTokens>
): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(sizes).map(([token, value]) => [
      `--spacing-${token.replace(
        /[A-Z]/g,
        (letter) => `-${letter.toLowerCase()}`
      )}`,
      value,
    ])
  );
}

export function ThemeScope({
  theme,
  sizes,
  children,
}: {
  theme: Theme;
  /** Phone-tier token overrides (phoneSize); omit for the default tablet scale. */
  sizes?: Partial<SizeTokens>;
  children: ReactNode;
}) {
  const variables = useMemo(
    () => ({
      ...themeToVariables(theme),
      ...(sizes ? sizeToVariables(sizes) : {}),
    }),
    [theme, sizes]
  );
  return <ScopedVariables variables={variables}>{children}</ScopedVariables>;
}
