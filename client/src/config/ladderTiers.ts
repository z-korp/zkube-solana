/**
 * Named ladder tiers. The protocol owns the point boundaries and the tier a
 * total has reached — both come from the deterministic core — so this file
 * carries only what the chain has no opinion about: the name and the colour of
 * each block.
 *
 * The ramp climbs by luminance and saturation so the order reads at a glance
 * without a legend, and tops out on the brand violet.
 */

export interface LadderTier {
  readonly name: string;
  /** Block body colour; the glossy edges derive from it. */
  readonly color: string;
}

export const LADDER_TIERS: readonly LadderTier[] = [
  { name: "Slate", color: "#6B7280" },
  { name: "Copper", color: "#B4703C" },
  { name: "Jade", color: "#10A37F" },
  { name: "Azure", color: "#3B82F6" },
  { name: "Prism", color: "#A855F7" },
];

/**
 * Cumulative-point floor of each tier, mirrored from the protocol so the
 * profile can draw a progress bar without loading the WASM core mid-render —
 * the same convention the payout display maths follows.
 *
 * `ladderTiers.test.ts` asserts every value against the core, so a boundary
 * that moves on chain fails the client build rather than showing a rank the
 * player does not hold.
 */
export const LADDER_TIER_THRESHOLDS: readonly bigint[] = [
  0n,
  1_500n,
  7_000n,
  25_000n,
  75_000n,
];

/** Name of a tier index, clamped so an unknown index still renders. */
export function ladderTierName(tier: number): string {
  return (LADDER_TIERS[tier] ?? LADDER_TIERS[0]!).name;
}

/** Block colour of a tier index, clamped so an unknown index still renders. */
export function ladderTierColor(tier: number): string {
  return (LADDER_TIERS[tier] ?? LADDER_TIERS[0]!).color;
}

/** True when the tier is the highest the protocol defines. */
export function isTopLadderTier(tier: number): boolean {
  return tier >= LADDER_TIER_THRESHOLDS.length - 1;
}

/**
 * How far a total has climbed inside its tier, and what is left to the next
 * one. `remaining` is zero at the top tier, where `fraction` is a full bar.
 */
export function ladderTierProgress(
  points: bigint,
  tier: number,
): { fraction: number; remaining: bigint } {
  if (isTopLadderTier(tier)) return { fraction: 1, remaining: 0n };
  const floor = LADDER_TIER_THRESHOLDS[tier] ?? 0n;
  const ceiling = LADDER_TIER_THRESHOLDS[tier + 1] ?? floor;
  const span = ceiling - floor;
  if (span <= 0n) return { fraction: 1, remaining: 0n };
  const climbed = points > floor ? points - floor : 0n;
  const fraction = Number(climbed) / Number(span);
  return {
    fraction: Math.min(1, Math.max(0, fraction)),
    remaining: climbed >= span ? 0n : span - climbed,
  };
}
