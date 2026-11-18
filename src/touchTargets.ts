import { phoneSize, size, space, TOUCH_TARGET } from "@/theme";
import { defaultFramePadding } from "@/uiPreferences";

// Touch-target policy runtime (issue #24). The baseline lives in
// theme.ts (TOUCH_TARGET + phoneSize) so it stays next to the size tokens
// it scales; this module derives the hitSlop compensation and the numeric
// acceptance gates, mirroring src/themeGates.ts for geometry.

export const COMPACT_TOOLBAR_VIEWPORT_WIDTH = 360;
export const LITTLE_ARC_PORTRAIT_GUTTER = 12;
export const LITTLE_ARC_PROMOTE_HEIGHT = 32;
// px-lg (10dp * 2) + 14dp pin icon + 1dp border each side
export const LITTLE_ARC_PROMOTE_COMPACT_WIDTH = 2 * space.lg + 14 + 2;

/**
 * Horizontal budget remaining for the flex-1 AddressTrigger inside compact
 * `canvasToolbar` at `viewportWidth` (default outer frame horizontal padding +
 * 48dp rail + 4dp content margin + 2dp card border + compact px-md padding +
 * four 44dp icon buttons [back, forward, reload, split] + four 4dp gaps +
 * extension actions). Reader mode stays in the rail `+` menu and expanded
 * sidebar on compact windows. Keeping this at or above TOUCH_TARGET.floor
 * prevents the address trigger from collapsing into an untappable sliver on
 * 360-390dp phones.
 */
export function compactToolbarAddressWidth(
  viewportWidth: number = COMPACT_TOOLBAR_VIEWPORT_WIDTH,
  extensionCount: number = 0,
  frameHorizontalDp: number = defaultFramePadding.left + defaultFramePadding.right,
): number {
  const railColumn = size.rail + space.sm + 2;
  const toolbarChrome = 2 * space.md + 4 * space.sm;
  const iconButtons =
    (4 + extensionCount) * phoneSize.iconButton + extensionCount * space.sm;
  return (
    viewportWidth -
    frameHorizontalDp -
    railColumn -
    toolbarChrome -
    iconButtons
  );
}

/**
 * Maximum ExtensionActionsBar buttons that fit inside compact `canvasToolbar`
 * while keeping AddressTrigger at or above TOUCH_TARGET.floor. Overflowing
 * actions stay accessible in the expanded sidebar and rail `+` menu.
 */
export function compactToolbarMaxExtensions(
  viewportWidth: number = COMPACT_TOOLBAR_VIEWPORT_WIDTH,
  frameHorizontalDp: number = defaultFramePadding.left + defaultFramePadding.right,
): number {
  const baseBudget = compactToolbarAddressWidth(
    viewportWidth,
    0,
    frameHorizontalDp,
  );
  if (baseBudget < TOUCH_TARGET.floor) return 0;
  return Math.floor(
    (baseBudget - TOUCH_TARGET.floor) / (phoneSize.iconButton + space.sm),
  );
}

export function compactToolbarVisibleExtensions<T>(
  actions: readonly T[],
  viewportWidth: number = COMPACT_TOOLBAR_VIEWPORT_WIDTH,
  frameHorizontalDp: number = defaultFramePadding.left + defaultFramePadding.right,
): T[] {
  return actions.slice(
    0,
    compactToolbarMaxExtensions(viewportWidth, frameHorizontalDp),
  );
}

/**
 * Horizontal budget remaining for the flex-1 AddressTrigger inside compact
 * `littleArcToolbar` at `viewportWidth` (portrait card inner width minus
 * compact px-sm padding, six 4dp gaps, five 44dp icon buttons, and the
 * icon-only promote button).
 */
export function compactLittleArcAddressWidth(
  viewportWidth: number = COMPACT_TOOLBAR_VIEWPORT_WIDTH,
): number {
  const cardWidth = Math.max(
    viewportWidth - LITTLE_ARC_PORTRAIT_GUTTER * 2,
    280,
  );
  const cardInnerWidth = cardWidth - 2;
  const toolbarChrome = 2 * space.sm + 6 * space.sm;
  const buttons =
    5 * phoneSize.iconButton + LITTLE_ARC_PROMOTE_COMPACT_WIDTH;
  return cardInnerWidth - toolbarChrome - buttons;
}

/**
 * HitSlop for the Little Arc promote button. On compact phones the label
 * hides and surrounding horizontal gaps tighten to space.sm (4dp), so
 * horizontal slop stays inside the gap while vertical slop lifts the 32dp
 * visual to the 48dp toolbar target.
 */
export function littleArcPromoteHitSlop(compactWindow: boolean): HitSlop {
  const vertical = hitSlopForTarget(LITTLE_ARC_PROMOTE_HEIGHT);
  if (!compactWindow) return vertical;
  return {
    top: vertical,
    bottom: vertical,
    left: space.sm,
    right: space.sm,
  };
}

/**
 * Per-side hitSlop that lifts a `visual`-dp control to the 48dp target:
 * visual + 2 × hitSlopForTarget(visual) >= target.
 * Symmetric slop is only safe when each side is no larger than the gap to
 * the next box. A larger slop covers the neighbor's visual box, and Android
 * hit-tests later siblings first so the neighbor steals the press. Dense
 * stacks use the directional helpers below instead.
 */
export function hitSlopForTarget(
  visual: number,
  target: number = TOUCH_TARGET.target,
): number {
  return Math.max(0, Math.ceil((target - visual) / 2));
}

/** Edge insets. React Native accepts this shape as `hitSlop`. */
export interface HitSlopInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type HitSlop = number | HitSlopInsets;

/**
 * Height of the overflow-hidden top-toolbar SidebarLayer. The inner row is
 * `h-toolbar`, which the phone scope resolves to phoneSize.toolbar (48).
 * A wrapper stuck on the tablet token (46) clips that row. Tablet rendering
 * stays on size.toolbar.
 */
export function toolbarLayerHeight(compactWindow: boolean): number {
  return compactWindow ? phoneSize.toolbar : size.toolbar;
}

/**
 * Icon-button slop for the tier that actually paints `size-icon-button`.
 * Tablet visual is 34dp (slop 7); the phone visual is 44dp (slop 2). Using
 * the tablet figure on a phone covers the next control across a 2px gap.
 */
export function iconButtonHitSlop(compactWindow: boolean): number {
  return hitSlopForTarget(
    compactWindow ? phoneSize.iconButton : size.iconButton,
  );
}

const denseGap = 2; // expanded sidebar rows and the space-chip strip
const railGap = 3; // railContent gap between stacked rail tiles

/** Half the gap, rounded down: opposing slop meets inside the gap and
 * neither box covers its neighbor. gap 3 → 1, gap 2 → 1. */
export function gapFitSlop(gap: number): number {
  return Math.floor(gap / 2);
}

/**
 * Vertical stacks: rail tiles (3px gap) and expanded sidebar rows (2px).
 * Horizontal slop still lifts the 36dp rail visual to the target; vertical
 * slop stays inside the tighter gap (`{ left: 6, right: 6, top: 1, bottom: 1 }`).
 */
export function denseVerticalHitSlop(): HitSlopInsets {
  const along = Math.min(gapFitSlop(railGap), gapFitSlop(denseGap));
  const cross = hitSlopForTarget(36);
  return { top: along, bottom: along, left: cross, right: cross };
}

/**
 * Space chips are 24dp in a horizontal 2px strip. Vertical slop lifts the
 * target; horizontal slop stays inside the gap
 * (`{ left: 1, right: 1, top: 12, bottom: 12 }`).
 */
export function spaceChipHitSlop(): HitSlopInsets {
  const along = gapFitSlop(denseGap);
  const cross = hitSlopForTarget(24);
  return { top: cross, bottom: cross, left: along, right: along };
}

interface TouchTargetGate {
  name: string;
  /** Visual dp of the control's height (also the width when `width` is omitted). */
  visual: number;
  /** Visual width when it differs from the height. */
  width?: number;
  hitSlop: HitSlop;
  /** Containing row height that caps the effective area, if any. */
  cap?: number;
  /** Gap to the adjacent target along `stackAxis`. */
  neighborGap?: number;
  stackAxis?: "vertical" | "horizontal";
  /** May sit under the floor, but still must not cover a neighbor. */
  exemptFloor?: boolean;
}

function slopInsets(hitSlop: HitSlop): HitSlopInsets {
  return typeof hitSlop === "number"
    ? { top: hitSlop, right: hitSlop, bottom: hitSlop, left: hitSlop }
    : hitSlop;
}

const effectiveTarget = (gate: TouchTargetGate) => {
  const slop = slopInsets(gate.hitSlop);
  const width = (gate.width ?? gate.visual) + slop.left + slop.right;
  let height = gate.visual + slop.top + slop.bottom;
  if (gate.cap != null) height = Math.min(height, gate.cap);
  return Math.min(width, height);
};

/** True when stack-axis slop is larger than the gap, so it covers the
 * neighbor's box instead of stopping at its edge. */
const coversNeighbor = (gate: TouchTargetGate) => {
  if (gate.neighborGap == null || gate.stackAxis == null) return false;
  const slop = slopInsets(gate.hitSlop);
  const along =
    gate.stackAxis === "vertical"
      ? [slop.top, slop.bottom]
      : [slop.left, slop.right];
  return along.some((side) => side > gate.neighborGap!);
};

// Phone-tier (compact window) primary controls. Token-backed visuals come
// from phoneSize, and the toolbar wrapper height comes from
// toolbarLayerHeight, so a shadow constant cannot pass while the row clips.
// The sidebar space-chip strip is a documented exception: chips are 24dp
// with a 2px horizontal gap, and a symmetric 12dp slop would cover the
// neighbor. spaceChipHitSlop extends vertically instead; the horizontal
// axis stays under the floor on purpose. Space switching keeps the gated
// paths (bottom sheet rows, rail tiles).
export const phoneTouchTargetGates = (): TouchTargetGate[] => [
  {
    name: "bottom bar / toolbar icon button",
    visual: phoneSize.iconButton,
    hitSlop: iconButtonHitSlop(true),
    cap: toolbarLayerHeight(true),
    // Tightest icon-button stack is the rail cluster (gap-xs = 2).
    neighborGap: denseGap,
    stackAxis: "vertical",
  },
  {
    name: "compact address trigger",
    visual: phoneSize.addressCompact,
    width: compactToolbarAddressWidth(),
    hitSlop: hitSlopForTarget(phoneSize.addressCompact),
    cap: toolbarLayerHeight(true),
    neighborGap: space.sm,
    stackAxis: "horizontal",
  },
  {
    name: "compact littleArc address trigger",
    visual: phoneSize.addressCompact,
    width: compactLittleArcAddressWidth(),
    hitSlop: hitSlopForTarget(phoneSize.addressCompact),
    cap: toolbarLayerHeight(true),
    neighborGap: space.sm,
    stackAxis: "horizontal",
  },
  {
    name: "compact littleArc promote button",
    visual: LITTLE_ARC_PROMOTE_HEIGHT,
    width: LITTLE_ARC_PROMOTE_COMPACT_WIDTH,
    hitSlop: littleArcPromoteHitSlop(true),
    cap: toolbarLayerHeight(true),
    neighborGap: space.sm,
    stackAxis: "horizontal",
  },
  {
    name: "rail tile (tab, favorite, pinned)",
    visual: phoneSize.railItem,
    width: 36, // appClasses.railItem visual width inside the 48dp rail
    hitSlop: denseVerticalHitSlop(),
    neighborGap: railGap,
    stackAxis: "vertical",
  },
  {
    name: "expanded sidebar row",
    visual: phoneSize.tabRow,
    hitSlop: denseVerticalHitSlop(),
    neighborGap: denseGap,
    stackAxis: "vertical",
  },
  {
    name: "sidebar tab row",
    visual: phoneSize.tabRow,
    hitSlop: 0,
    neighborGap: denseGap,
    stackAxis: "vertical",
  },
  {
    name: "hybrid bar tab chip",
    visual: phoneSize.tabRow,
    hitSlop: 4,
    neighborGap: 4, // phoneHybridTabsContent gap-sm
    stackAxis: "horizontal",
  },
  {
    name: "space sheet row",
    visual: TOUCH_TARGET.floor,
    hitSlop: 0,
    neighborGap: denseGap,
    stackAxis: "vertical",
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
  {
    name: "space header",
    visual: phoneSize.spaceHeader,
    hitSlop: 0,
  },
  {
    name: "space chip",
    visual: 24,
    hitSlop: spaceChipHitSlop(),
    neighborGap: denseGap,
    stackAxis: "horizontal",
    exemptFloor: true,
  },
];

export const failedTouchTargetGates = () => {
  const failures: string[] = [];
  const phoneToolbar = toolbarLayerHeight(true);
  const tabletToolbar = toolbarLayerHeight(false);
  if (phoneToolbar !== phoneSize.toolbar)
    failures.push(
      `top toolbar layer: phone wrapper ${phoneToolbar}dp clips the ${phoneSize.toolbar}dp row`,
    );
  if (tabletToolbar !== size.toolbar)
    failures.push(
      `top toolbar layer: tablet wrapper ${tabletToolbar}dp moved off ${size.toolbar}dp`,
    );
  const addressBudget = compactToolbarAddressWidth();
  if (addressBudget < TOUCH_TARGET.floor)
    failures.push(
      `compact canvasToolbar: AddressTrigger gets ${addressBudget}dp at ${COMPACT_TOOLBAR_VIEWPORT_WIDTH}dp (below ${TOUCH_TARGET.floor}dp floor)`,
    );
  for (const installedExtensions of [1, 2, 4]) {
    const visibleExtensions = Math.min(
      installedExtensions,
      compactToolbarMaxExtensions(),
    );
    const overflowBudget = compactToolbarAddressWidth(
      COMPACT_TOOLBAR_VIEWPORT_WIDTH,
      visibleExtensions,
    );
    if (overflowBudget < TOUCH_TARGET.floor)
      failures.push(
        `compact canvasToolbar (${installedExtensions} extensions): AddressTrigger gets ${overflowBudget}dp at ${COMPACT_TOOLBAR_VIEWPORT_WIDTH}dp (below ${TOUCH_TARGET.floor}dp floor)`,
      );
  }
  const littleArcAddressBudget = compactLittleArcAddressWidth();
  if (littleArcAddressBudget < TOUCH_TARGET.floor)
    failures.push(
      `compact littleArcToolbar: AddressTrigger gets ${littleArcAddressBudget}dp at ${COMPACT_TOOLBAR_VIEWPORT_WIDTH}dp (below ${TOUCH_TARGET.floor}dp floor)`,
    );
  for (const gate of phoneTouchTargetGates()) {
    if (coversNeighbor(gate))
      failures.push(`${gate.name}: hitSlop covers the neighboring box`);
    if (gate.exemptFloor) continue;
    const effective = effectiveTarget(gate);
    if (effective < TOUCH_TARGET.floor)
      failures.push(`${gate.name}: ${effective}dp effective`);
  }
  return failures;
};
