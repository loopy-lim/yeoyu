import React, { createContext, useContext, useMemo, type ReactNode } from "react";
import { ScopedVariables } from "uniwind";
import { size, type SizeTokens, type Theme } from "@/theme";

const TierSizesContext = createContext<SizeTokens>(size);

/** Size tokens of the enclosing ThemeScope. A phone scope passes phoneSize;
 *  every other scope keeps the tablet defaults, matching its CSS variables.
 *  Hit slop reads this so it follows the painted control, not the tablet token. */
export function useTierSizes(): SizeTokens {
  return useContext(TierSizesContext);
}

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
  // A nested scope that omits `sizes` resets to the tablet tokens. Leaving
  // the parent phone context in place would pair phone slop with tablet CSS.
  const tier = useMemo<SizeTokens>(
    () => (sizes ? { ...size, ...sizes } : size),
    [sizes]
  );
  return (
    <TierSizesContext.Provider value={tier}>
      <ScopedVariables variables={variables}>{children}</ScopedVariables>
    </TierSizesContext.Provider>
  );
}
