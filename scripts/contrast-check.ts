import { contrastGates, failedGates } from "../src/themeGates";
import { contrastRatio } from "../src/theme";

// Numeric palette gate: run via check.sh (`bun scripts/contrast-check.ts`).
// Ratios and thresholds live in src/themeGates.ts; docs/architecture.md
// explains how the UI quality gates fit into project verification.
const failures = failedGates();
for (const gate of contrastGates()) {
  const ratio = contrastRatio(gate.fg, gate.bg);
  const mark = ratio + 1e-9 >= gate.min ? "ok " : "FAIL";
  console.log(
    `${mark}  ${ratio.toFixed(2).padStart(5)} : 1  (min ${gate.min.toFixed(1)})  ${gate.name}`
  );
}
if (failures.length > 0) {
  throw new Error(`${failures.length} contrast gate(s) failed`);
}
console.log("\nAll contrast gates passed.");
