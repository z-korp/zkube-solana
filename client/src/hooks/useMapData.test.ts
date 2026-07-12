import { describe, expect, it } from "vitest";

import type { CampaignMapView } from "@/solana/reboot/campaignClient";
import type { ActiveRunRulesView } from "@/solana/reboot/runPlan";
import { generateMapData } from "./useMapData";

const rule: ActiveRunRulesView = {
  pointsRequired: 10,
  maxMoves: 20,
  difficulty: 0,
  primary: { kind: 0, value: 0, requiredCount: 0 },
  secondary: { kind: 0, value: 0, requiredCount: 0 },
  activeMutatorId: 0,
  passiveMutatorId: 0,
  bossId: 0,
  starThresholdModifier: 128,
  bonusType: 0,
  bonusTriggerType: 0,
  bonusThreshold: 0,
  startingCharges: 0,
};

const map = (overrides: Partial<CampaignMapView> = {}): CampaignMapView => ({
  mapId: 2,
  themeId: 7,
  enabled: true,
  unlocked: true,
  purchased: false,
  cleared: false,
  perfected: false,
  starCost: 40n,
  usdcCost: 2_000_000n,
  levelStars: [3, 2, 0, 0, 0, 0, 0, 0, 0, 0],
  levels: Array.from({ length: 10 }, () => rule),
  ...overrides,
});

describe("generateMapData", () => {
  it("uses authoritative theme, rules, guardian, and progression", () => {
    const result = generateMapData({ map: map() });
    expect(result.zoneTheme).toBe("theme-7");
    expect(result.currentNodeIndex).toBe(2);
    expect(result.nodes.map((node) => node.state)).toEqual([
      "cleared",
      "cleared",
      "current",
      "locked",
      "locked",
      "locked",
      "locked",
      "locked",
      "locked",
      "locked",
    ]);
    expect(result.nodes[9]).toMatchObject({
      type: "boss",
      contractLevel: 10,
      displayLabel: "2-BOSS",
    });
    expect(result.nodes[0].levelConfig?.pointsRequired).toBe(10);
  });

  it("keeps locked catalogs locked and marks the active run", () => {
    const locked = generateMapData({
      map: map({ unlocked: false }),
      activeStoryNode: { zoneId: 2, level: 4 },
    });
    expect(locked.nodes[2].state).toBe("locked");
    expect(locked.nodes[3].state).toBe("playing");
  });
});
