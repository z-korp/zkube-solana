// @vitest-environment node
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { ACHIEVEMENT_DEFS } from "../config/achievementDefs";
import { QUEST_DEFS } from "../config/questDefs";
import {
  CANONICAL_ACHIEVEMENT_RULES,
  CANONICAL_QUEST_RULES,
  dailyQuestIndices,
  questRewardsForCadence,
  weeklyQuestIndices,
} from "./progressCatalog";

const owner = new PublicKey(
  Uint8Array.from(Array.from({ length: 32 }, (_, index) => index + 1)),
);

describe("canonical zkube progression catalog", () => {
  it("preserves 16 Arcade achievements and eight ungrantable ABI slots", () => {
    const activeIndices = [
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 20, 21, 22, 23,
    ];
    const reservedIndices = [12, 13, 14, 15, 16, 17, 18, 19];
    expect(CANONICAL_ACHIEVEMENT_RULES).toHaveLength(24);
    expect(
      activeIndices.map((index) => CANONICAL_ACHIEVEMENT_RULES[index]),
    ).toEqual(
      activeIndices.map((index) => ({
        metric: index < 4 ? 0 : index < 8 ? 1 : index < 12 ? 2 : 6,
        threshold: BigInt(ACHIEVEMENT_DEFS[index]!.target),
        xpReward: ACHIEVEMENT_DEFS[index]!.xp,
      })),
    );
    expect(
      reservedIndices.map((index) => CANONICAL_ACHIEVEMENT_RULES[index]),
    ).toEqual(
      Array.from({ length: 8 }, () => ({
        metric: 0xff,
        threshold: (1n << 64n) - 1n,
        xpReward: 0,
      })),
    );
    expect(
      CANONICAL_ACHIEVEMENT_RULES.reduce((sum, rule) => sum + rule.xpReward, 0),
    ).toBe(24_000);
  });

  it("mirrors the owner-mixed eight-slot Daily selection and eligibility", () => {
    expect(CANONICAL_QUEST_RULES).toHaveLength(20);
    expect(CANONICAL_QUEST_RULES.map((rule) => rule.threshold)).toEqual(
      QUEST_DEFS.map((definition) => definition.target),
    );
    expect(
      [0, 1, 2, 3, 10, 100, 20_000].map((day) =>
        dailyQuestIndices(day, owner, true),
      ),
    ).toEqual([
      [3, 6, 2],
      [1, 2, 7],
      [6, 7, 0],
      [4, 7, 3],
      [2, 4, 0],
      [7, 1, 2],
      [0, 2, 7],
    ]);
    for (let day = 0; day < 1_000; day += 1) {
      const selected = dailyQuestIndices(day, owner, false);
      expect(new Set(selected).size).toBe(3);
      expect(selected).not.toContain(5);
      expect(selected).not.toContain(7);
    }
  });

  it("always includes attendance plus two owner-mixed Weekly objectives", () => {
    expect(
      [0, 1, 2, 3, 10, 100, 20_000].map((week) =>
        weeklyQuestIndices(week, owner),
      ),
    ).toEqual([
      [9, 12, 10],
      [9, 12, 18],
      [9, 16, 13],
      [9, 14, 10],
      [9, 10, 19],
      [9, 14, 15],
      [9, 18, 12],
    ]);
    for (let week = 0; week < 1_000; week += 1) {
      const selected = weeklyQuestIndices(week, owner);
      expect(selected[0]).toBe(9);
      expect(new Set(selected).size).toBe(3);
      expect(selected).not.toContain(11);
      expect(selected).not.toContain(17);
    }
    expect(questRewardsForCadence()).toEqual({
      dailyXp: 650,
      weeklyXp: 1_500,
    });
  });
});
