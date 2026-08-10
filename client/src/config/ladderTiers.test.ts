// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  coreLadderStreakBonusPct,
  coreLadderTier,
  coreLadderTierCount,
  coreLadderTierFloor,
  initializeZkubeCoreSync,
} from "@/core/zkubeCore";
import {
  LADDER_STREAK_BONUS_CAP_DAYS,
  LADDER_TIERS,
  LADDER_TIER_THRESHOLDS,
  isTopLadderTier,
  ladderTierColor,
  ladderTierName,
  ladderTierProgress,
  ladderStreakBonusPct,
} from "./ladderTiers";

initializeZkubeCoreSync(
  readFileSync(
    new URL("../core/generated/zkube_core_bg.wasm", import.meta.url),
  ),
);

describe("ladder tiers", () => {
  it("mirrors every protocol boundary, so the displayed tier is the stored one", () => {
    expect(LADDER_TIER_THRESHOLDS).toHaveLength(coreLadderTierCount());
    expect(LADDER_TIERS).toHaveLength(coreLadderTierCount());
    LADDER_TIER_THRESHOLDS.forEach((threshold, tier) => {
      expect(threshold).toBe(coreLadderTierFloor(tier));
    });
  });

  it("agrees with the core on which tier a total has reached", () => {
    const totals = [
      0n,
      1n,
      1_499n,
      1_500n,
      6_999n,
      7_000n,
      24_999n,
      75_000n,
      10n ** 9n,
    ];
    for (const points of totals) {
      const tier = LADDER_TIER_THRESHOLDS.filter(
        (threshold) => points >= threshold,
      ).length - 1;
      expect(tier).toBe(coreLadderTier(points));
    }
  });

  it("names and colours every tier the protocol defines", () => {
    for (let tier = 0; tier < coreLadderTierCount(); tier += 1) {
      expect(ladderTierName(tier)).toMatch(/^[A-Z][a-z]+$/);
      expect(ladderTierColor(tier)).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("falls back rather than rendering nothing for an unknown tier", () => {
    expect(ladderTierName(99)).toBe(LADDER_TIERS[0]!.name);
    expect(ladderTierColor(-1)).toBe(LADDER_TIERS[0]!.color);
  });

  it("measures progress inside a tier and what is left to the next", () => {
    expect(ladderTierProgress(0n, 0)).toEqual({ fraction: 0, remaining: 1_500n });
    expect(ladderTierProgress(750n, 0)).toEqual({
      fraction: 0.5,
      remaining: 750n,
    });
    expect(ladderTierProgress(4_250n, 1)).toEqual({
      fraction: 0.5,
      remaining: 2_750n,
    });
  });

  it("mirrors the protocol's streak bonus, cap included", () => {
    const streaks = [0, 1, 6, 40, 99, 100, 101, 5_000];
    for (const days of streaks) {
      expect(ladderStreakBonusPct(days)).toBe(coreLadderStreakBonusPct(days));
    }
    expect(ladderStreakBonusPct(LADDER_STREAK_BONUS_CAP_DAYS)).toBe(
      LADDER_STREAK_BONUS_CAP_DAYS,
    );
  });

  it("never promises a bonus for a streak that has not started", () => {
    expect(ladderStreakBonusPct(0)).toBe(0);
    expect(ladderStreakBonusPct(-3)).toBe(0);
    expect(ladderStreakBonusPct(Number.NaN)).toBe(0);
  });

  it("fills the bar at the top tier, where nothing remains", () => {
    const top = coreLadderTierCount() - 1;
    expect(isTopLadderTier(top)).toBe(true);
    expect(ladderTierProgress(10n ** 9n, top)).toEqual({
      fraction: 1,
      remaining: 0n,
    });
  });
});
