import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@tailwindcss/node";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Font-size utilities backed by --text-* tokens in global.css. If a --color-*
// token shares the same suffix (e.g. --color-input vs --text-input), Tailwind
// resolves text-* as color and drops font-size silently.
const FONT_TOKEN_UTILITIES = [
  ["text-micro", "var(--text-micro)"],
  ["text-small", "var(--text-small)"],
  ["text-body", "var(--text-body)"],
  ["text-body-plus", "var(--text-body-plus)"],
  ["text-input", "var(--text-input)"],
  ["text-input-plus", "var(--text-input-plus)"],
  ["text-icon-size", "var(--text-icon-size)"],
  ["text-title", "var(--text-title)"],
];

// UniKit semantic utilities bridged in @theme inline to yeoyu palette rolls.
// Checking the compiled CSS ensures inline var() references reach ThemeScope.
const BRIDGE_UTILITIES = [
  ["bg-background", "background-color", "var(--color-surface)"],
  ["text-foreground", "color", "var(--color-ink)"],
  ["bg-card", "background-color", "var(--color-surface-elevated)"],
  ["text-card-foreground", "color", "var(--color-ink)"],
  ["bg-popover", "background-color", "var(--color-surface-elevated)"],
  ["text-popover-foreground", "color", "var(--color-ink)"],
  ["bg-primary", "background-color", "var(--color-ink)"],
  ["text-primary-foreground", "color", "var(--color-ghost)"],
  ["bg-secondary", "background-color", "var(--color-sunken)"],
  ["text-secondary-foreground", "color", "var(--color-ink)"],
  ["bg-muted", "background-color", "var(--color-sunken)"],
  ["text-muted-foreground", "color", "var(--color-ink-muted)"],
  ["bg-accent", "background-color", "var(--color-accent)"],
  ["text-accent-foreground", "color", "var(--color-ghost)"],
  ["bg-destructive", "background-color", "var(--color-error-ink)"],
  ["text-destructive-foreground", "color", "var(--color-notice-ink)"],
  ["border-border", "border-color", "var(--color-card-border)"],
];

function extractRuleBody(builtCss, className) {
  const escaped = className.replace(/([.:[\]%()])/g, "\\$1");
  const pattern = new RegExp(`\\.${escaped}\\s*\\{([^}]*)\\}`, "m");
  const match = builtCss.match(pattern);
  return match ? match[1] : null;
}

export async function verifyCssCompilation(cssSource, baseDir = ROOT) {
  const compiled = await compile(cssSource, {
    base: baseDir,
    onDependency: () => {},
  });
  const candidates = [
    ...FONT_TOKEN_UTILITIES.map(([name]) => name),
    ...BRIDGE_UTILITIES.map(([name]) => name),
  ];
  const built = compiled.build(candidates);
  const errors = [];

  for (const [utility, expectedSize] of FONT_TOKEN_UTILITIES) {
    const body = extractRuleBody(built, utility);
    if (!body) {
      errors.push(`${utility}: missing compiled rule`);
      continue;
    }
    if (!body.includes(`font-size: ${expectedSize}`)) {
      errors.push(
        `${utility}: expected font-size: ${expectedSize}, got {${body.trim()}}`
      );
    }
    if (/(?:^|;|\s)color\s*:/.test(body)) {
      errors.push(
        `${utility}: unexpected color declaration (namespace collision?) in {${body.trim()}}`
      );
    }
  }

  for (const [utility, property, expectedVar] of BRIDGE_UTILITIES) {
    const body = extractRuleBody(built, utility);
    if (!body) {
      errors.push(`${utility}: missing compiled rule`);
      continue;
    }
    if (!body.includes(`${property}: ${expectedVar}`)) {
      errors.push(
        `${utility}: expected ${property}: ${expectedVar}, got {${body.trim()}}`
      );
    }
  }

  return { errors, checkedCount: candidates.length };
}

const isCli =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isCli) {
  const useStdin = process.argv.includes("--stdin");
  const cssPath = path.join(ROOT, "global.css");
  const cssSource = useStdin
    ? fs.readFileSync(0, "utf8")
    : fs.readFileSync(cssPath, "utf8");
  const { errors, checkedCount } = await verifyCssCompilation(cssSource, ROOT);
  if (errors.length > 0) {
    for (const err of errors) console.error(`FAIL  ${err}`);
    process.exit(1);
  }
  console.log(`CSS compile gate passed (${checkedCount} utilities verified).`);
}
