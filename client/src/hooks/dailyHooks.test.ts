import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  parseDailyStatus,
  type DailyStatus,
  type DailyView,
} from "@/chain/dailyClient";
import { dailyToCurrentChallenge } from "./useCurrentChallenge";

const key = () => Keypair.generate().publicKey;
const daily = (status: DailyStatus): DailyView => ({
  address: key(),
  economyVersion: 2,
  dayId: 10,
  weekId: 2,
  status,
  mapId: 4,
  opensAt: 100,
  entriesCloseAt: 200,
  runsCloseAt: 300,
  settlementGraceCloseAt: 400,
  finalizedAt: 0,
  starEntryCost: 1n,
  uniquePlayers: 2,
  weeklyEligiblePlayers: 2,
  weeklyRollups: 1,
  attemptsStarted: 3n,
  runsFinalized: 1n,
  playerEligible: true,
  playerStars: 5n,
  nextRunId: 2n,
  player: null,
  leaderboard: [],
  rules: {
    pointsRequired: 0,
    maxMoves: 40,
    difficulty: 2,
    primary: { kind: 0, value: 0, requiredCount: 0 },
    secondary: { kind: 0, value: 0, requiredCount: 0 },
    activeMutatorId: 8,
    passiveMutatorId: 9,
    bossId: 0,
    starThresholdModifier: 128,
    bonusType: 0,
    bonusTriggerType: 0,
    bonusThreshold: 0,
    startingCharges: 0,
  },
  endlessThresholds: [1, 2, 3, 4, 5, 6, 7],
  endlessScoreMultipliersX100: [100, 110, 120, 130, 140, 150, 160, 170],
  endlessRampMultiplierX100: 200,
});

describe("Daily projection", () => {
  it("rejects unknown decoded Daily status variants", () => {
    expect(parseDailyStatus({ open: {} })).toBe("open");
    expect(parseDailyStatus({ settled: {} })).toBe("unknown");
    expect(parseDailyStatus("open")).toBe("unknown");
  });

  it.each([
    ["open", false, false],
    ["claimable", true, false],
    ["closed", true, false],
    ["cancelled", false, true],
  ])(
    "maps %s without inventing a settled status",
    (status, settled, cancelled) => {
      expect(dailyToCurrentChallenge(daily(status))).toMatchObject({
        challenge_id: 10,
        zone_id: 4,
        settled,
        cancelled,
        active_mutator_id: 8,
        passive_mutator_id: 9,
        total_attempts: 3n,
      });
    },
  );
});
