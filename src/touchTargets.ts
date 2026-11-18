import { phoneSize, size, TOUCH_TARGET } from "@/theme";

// Touch-target policy runtime (issue #24). The baseline lives in
// theme.ts (TOUCH_TARGET + phoneSize) so it stays next to the size tokens
// it scales; this module derives the hitSlop compensation and the numeric
// acceptance gates, mirroring src/themeGates.ts for geometry.

/**
 * Per-side hitSlop that lifts a `visual`-dp control to the 48dp target:
 * visual + 2 × hitSlopForTarget(visual) >= target. Rows containing the
 * control cap the effective area (see gates below), so over-slopping a
 * control that sits in a shorter row is harmless.
 */
export function hitSlopForTarget(
  visual: number,
  target: number = TOUCH_TARGET.target,
): number {
  return Math.max(0, Math.ceil((target - visual) / 2));
}

interface TouchTargetGate {
  name: string;
  /** Visual dp of the control's smaller axis in the phone tier. */
  visual: number;
  /** Per-side hitSlop in dp (0 when the visual already carries the target). */
  hitSlop: number;
  /** Containing row height that caps the effective area, if any. */
  cap?: number;
  /** Gap to the adjacent target in a contiguous stack, if any. */
  neighborGap?: number;
}

const effectiveTarget = (gate: TouchTargetGate) => {
  const slopReach = gate.neighborGap
    ? Math.min(2 * gate.hitSlop, gate.neighborGap)
    : 2 * gate.hitSlop;
  const effective = gate.visual + slopReach;
  return gate.cap ? Math.min(effective, gate.cap) : effective;
};

const denseGap = 2; // tabScrollContent / space sheet list row gap
const railGap = 3; // railContent gap between stacked rail tiles

// Phone-tier (compact window) primary controls. Token-backed visuals come
// from phoneSize so the gates fail when a token drops below the floor.
// The sidebar space-chip strip is a documented exception: chips only appear
// in a manually expanded sidebar (the phone tier keeps the rail collapsed),
// and a 2px-gap chip strip cannot reach the floor without 44dp chips —
// Space switching keeps the gated paths (bottom sheet rows, rail tiles).
export const phoneTouchTargetGates = (): TouchTargetGate[] => [
  {
    name: "bottom bar / toolbar icon button",
    visual: phoneSize.iconButton,
    hitSlop: hitSlopForTarget(size.iconButton),
    cap: phoneSize.toolbar,
  },
  {
    name: "compact address trigger",
    visual: phoneSize.addressCompact,
    hitSlop: hitSlopForTarget(size.addressCompact),
    cap: phoneSize.toolbar,
  },
  {
    name: "rail tile (tab, favorite, pinned)",
    visual: phoneSize.railItem,
    hitSlop: hitSlopForTarget(36), // 36dp visual width inside the 48dp rail
    neighborGap: railGap,
  },
  {
    name: "sidebar tab row",
    visual: phoneSize.tabRow,
    hitSlop: 0,
    neighborGap: denseGap,
  },
  {
    name: "hybrid bar tab chip",
    visual: phoneSize.tabRow,
    hitSlop: 4,
    neighborGap: 4, // phoneHybridTabsContent gap-sm
  },
  {
    name: "space sheet row",
    visual: TOUCH_TARGET.floor,
    hitSlop: 0,
    neighborGap: denseGap,
  },
  {
    name: "new space row",
    visual: TOUCH_TARGET.floor,
    hitSlop: 0,
  },
  {
    name: "space manage button",
    visual: phoneSize.actionRow,
    hitSlop: hitSlopForTarget(phoneSize.actionRow),
  },
  {
    name: "tab close affordance",
    visual: 26, // appClasses.tabClose literal
    hitSlop: hitSlopForTarget(26),
    cap: phoneSize.tabRow,
  },
];

export const failedTouchTargetGates = () =>
  phoneTouchTargetGates()
    .map((gate) => ({ gate, effective: effectiveTarget(gate) }))
    .filter(({ effective }) => effective < TOUCH_TARGET.floor)
    .map(({ gate, effective }) => `${gate.name}: ${effective}dp effective`);
