// @vitest-environment node
import { Connection, Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  DAILY_RECOVERY_DEADLINE_OFFSET,
  KEEPER_RECENT_DAILY_CADENCES,
  KEEPER_RECENT_SEASON_CADENCES,
  KEEPER_RECENT_WEEKLY_CADENCES,
  SECONDS_PER_DAY,
  ZKUBE_PROGRAM_ID,
  seasonIdForDay,
  validationOnlyPlan,
  weekIdForDay,
  rulesCatalogPda,
} from "../src/arcadeChain";
import { assertKeeperPlanPolicy } from "../src/keeperPolicy";

const DAY = 20_651;
const NOW = DAY * SECONDS_PER_DAY + 10;

describe("v4 keeper semantic policy", () => {
  it("uses the Monday cadence without an off-by-one epoch", () => {
    expect(weekIdForDay(4)).toBe(0);
    expect(weekIdForDay(10)).toBe(0);
    expect(weekIdForDay(11)).toBe(1);
  });

  it("accepts only an exact missing successor inside launch-to-current recovery", () => {
    const plan = validationOnlyPlan("prepare_arena_daily", {
      dayId: DAY,
      followingDayId: DAY + 1,
      launchCadenceId: DAY - 10,
      rulesCatalog: rulesCatalogPda(1),
    });
    expect(() => policy(plan)).not.toThrow();
    plan.context!.followingDayId = DAY + 2;
    expect(() => policy(plan)).toThrow("following Daily");
    plan.context!.dayId = DAY - 11;
    plan.context!.followingDayId = DAY - 10;
    expect(() => policy(plan)).toThrow("following Daily");
  });

  it("pins recurring catch-up to the trailing three-Season window", () => {
    const currentWeek = weekIdForDay(DAY);
    const currentSeason = seasonIdForDay(DAY);
    const cases = [
      {
        operation: "prepare_arena_daily" as const,
        current: DAY,
        window: KEEPER_RECENT_DAILY_CADENCES,
        context: (source: number, target: number) => ({
          dayId: source,
          followingDayId: target,
          launchCadenceId: source - 10,
          rulesCatalog: rulesCatalogPda(1),
        }),
      },
      {
        operation: "prepare_weekly_jackpot" as const,
        current: currentWeek,
        window: KEEPER_RECENT_WEEKLY_CADENCES,
        context: (source: number, target: number) => ({
          weekId: source,
          followingWeekId: target,
          launchCadenceId: source - 10,
          rulesCatalog: rulesCatalogPda(1),
        }),
      },
      {
        operation: "prepare_season" as const,
        current: currentSeason,
        window: KEEPER_RECENT_SEASON_CADENCES,
        context: (source: number, target: number) => ({
          seasonId: source,
          followingSeasonId: target,
          launchCadenceId: Math.max(0, source - 10),
        }),
      },
    ];
    for (const fixture of cases) {
      const oldest = fixture.current - fixture.window;
      expect(() => policy(validationOnlyPlan(
        fixture.operation,
        fixture.context(oldest - 1, oldest),
      ))).not.toThrow();
      expect(() => policy(validationOnlyPlan(
        fixture.operation,
        fixture.context(oldest - 2, oldest - 1),
      ))).toThrow("following");
    }

    const oldestDay = DAY - KEEPER_RECENT_DAILY_CADENCES;
    const recovery = validationOnlyPlan("activate_arena_daily", {
      dayId: oldestDay,
      predecessorRolloverApplied: true,
      recoveryActivation: true,
      recoveryDeadlineAt:
        oldestDay * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
    });
    expect(() => policy(recovery)).not.toThrow();
    recovery.context!.dayId = oldestDay - 1;
    recovery.context!.recoveryDeadlineAt =
      (oldestDay - 1) * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET;
    expect(() => policy(recovery)).toThrow("recovery activation");
  });

  it("rejects non-floored or non-conserving payout plans", () => {
    const owner = Keypair.generate().publicKey;
    const plan = validationOnlyPlan("finalize_arena_daily", {
      competition: "daily",
      dayId: DAY,
      followingDayId: DAY + 1,
      owners: [owner],
      payoutLamports: [10_000_000n],
      payoutTotalLamports: 10_000_000n,
      potLamports: 10_000_001n,
      rolloverLamports: 1n,
    });
    expect(() => policy(plan)).not.toThrow();
    plan.context!.payoutLamports = [9_999_999n];
    expect(() => policy(plan)).toThrow("noncanonical SOL payout");
  });

  it("pins deadline run routing to the Router-resolved ER", () => {
    const plan = validationOnlyPlan("force_finish_deadline", {
      challengeDayId: DAY,
      deadlineDayId: DAY,
      owner: Keypair.generate().publicKey,
      runId: 7n,
      runMode: "ranked",
      runLocation: "ephemeral_rollup",
      includeArenaPlayer: true,
      deadlineAt: DAY * SECONDS_PER_DAY,
      recoveryDeadlineAt: DAY * SECONDS_PER_DAY + 1,
    });
    expect(() => policy(plan)).not.toThrow();
    plan.context!.runLocation = "base";
    expect(() => policy(plan)).toThrow("routing");
  });

  it("limits permissionless profile sync to recent canonical winner positions", () => {
    const owner = Keypair.generate().publicKey;
    const daily = validationOnlyPlan("sync_daily_profile", {
      competition: "daily",
      dayId: DAY,
      owner,
      winnerPositionMask: 0b00101,
    });
    expect(() => policy(daily)).not.toThrow();
    daily.context!.winnerPositionMask = 0b100000;
    expect(() => policy(daily)).toThrow("profile sync");

    const weekly = validationOnlyPlan("sync_weekly_profile", {
      competition: "weekly",
      weekId: weekIdForDay(DAY),
      owner,
      winnerPositionMask: 0x0101,
    });
    expect(() => policy(weekly)).not.toThrow();
    weekly.context!.competition = "season";
    expect(() => policy(weekly)).toThrow("profile sync");
  });

  it("rejects executable bytes before generated-IDL materialization", () => {
    const plan = validationOnlyPlan("activate_arena_daily", { dayId: DAY });
    plan.instruction = {} as never;
    expect(() => policy(plan)).toThrow("instruction bytes");
  });
});

function policy(plan: ReturnType<typeof validationOnlyPlan>): void {
  assertKeeperPlanPolicy({
    plan,
    keeper: Keypair.generate().publicKey,
    programId: ZKUBE_PROGRAM_ID,
    connection: new Connection("https://api.devnet.solana.com"),
    nowUnix: NOW,
  });
}
