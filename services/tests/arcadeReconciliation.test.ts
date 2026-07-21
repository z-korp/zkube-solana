// @vitest-environment node
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  DAILY_RECOVERY_DEADLINE_OFFSET,
  DAILY_RUN_CLOSE_OFFSET,
  KEEPER_RECENT_DAILY_CADENCES,
  SECONDS_PER_DAY,
  seasonIdForDay,
  seasonStartDay,
  rulesCatalogPda,
  weekIdForDay,
  weekStartDay,
} from "../src/arcadeChain";
import {
  discoverReconciliationPlans,
  validateProtocolSnapshot,
  type DailySnapshot,
  type ProtocolSnapshot,
  type RunSnapshot,
  type SeasonSnapshot,
  type WeeklySnapshot,
} from "../src/arcadeReconciliation";

const DAY = 20_651;
const NOW = DAY * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET;

describe("v4 keeper reconciliation", () => {
  it("prepares successors and activates funding periods", () => {
    const snapshot = baseSnapshot({
      dailies: [daily(DAY, "funding")],
      weeklies: [{
        weekId: 2_949,
        status: "funding",
        closesAt: 20_654 * SECONDS_PER_DAY,
        potLamports: 0n,
        predecessorRolloverRequired: false,
        predecessorRolloverApplied: false,
        qualificationDailiesComplete: false,
      }],
      seasons: [season(737, "funding")],
    });
    const operations = discoverReconciliationPlans({
      snapshot,
      nowUnix: DAY * SECONDS_PER_DAY + 10,
    }).map(({ operation }) => operation);
    expect(operations).toEqual([
      "activate_arena_daily",
      "activate_weekly_jackpot",
      "activate_season",
      "prepare_arena_daily",
      "prepare_weekly_jackpot",
      "prepare_season",
    ]);
  });

  it("recovers more than one missed Daily, Weekly, and Season sequentially", () => {
    const launchDay = DAY - 3;
    const dailySnapshot = baseSnapshot({
      launchDayId: launchDay,
      dailies: [
        daily(launchDay, "open", { predecessorRolloverRequired: false }),
        daily(launchDay + 1, "funding", {
          predecessorRolloverRequired: true,
          predecessorRolloverApplied: true,
        }),
      ],
    });
    const dailyPlans = discoverReconciliationPlans({
      snapshot: dailySnapshot,
      nowUnix: NOW,
    });
    expect(dailyPlans).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: "activate_arena_daily",
        context: expect.objectContaining({
          dayId: launchDay + 1,
          recoveryActivation: true,
        }),
      }),
      expect.objectContaining({
        operation: "prepare_arena_daily",
        context: expect.objectContaining({
          dayId: launchDay + 1,
          followingDayId: launchDay + 2,
        }),
      }),
    ]));

    const currentWeek = weekIdForDay(DAY);
    const launchWeek = currentWeek - 3;
    const weeklySnapshot = baseSnapshot({
      launchDayId: weekStartDay(launchWeek),
      weeklies: [
        weekly(launchWeek, "open", { predecessorRolloverRequired: false }),
        weekly(launchWeek + 1, "funding", {
          predecessorRolloverRequired: true,
          predecessorRolloverApplied: true,
        }),
      ],
    });
    const weeklyPlans = discoverReconciliationPlans({
      snapshot: weeklySnapshot,
      nowUnix: NOW,
    });
    expect(weeklyPlans).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: "activate_weekly_jackpot",
        context: expect.objectContaining({
          weekId: launchWeek + 1,
          recoveryActivation: true,
        }),
      }),
      expect.objectContaining({
        operation: "prepare_weekly_jackpot",
        context: expect.objectContaining({
          weekId: launchWeek + 1,
          followingWeekId: launchWeek + 2,
        }),
      }),
    ]));

    const currentSeason = seasonIdForDay(DAY);
    const launchSeason = currentSeason - 3;
    const seasonSnapshot = baseSnapshot({
      launchDayId: seasonStartDay(launchSeason),
      seasons: [
        season(launchSeason, "open"),
        season(launchSeason + 1, "funding", {
          predecessorRolloverRequired: true,
          predecessorRolloverApplied: true,
        }),
      ],
    });
    const seasonPlans = discoverReconciliationPlans({
      snapshot: seasonSnapshot,
      nowUnix: NOW,
    });
    expect(seasonPlans).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: "activate_season",
        context: expect.objectContaining({
          seasonId: launchSeason + 1,
          recoveryActivation: true,
        }),
      }),
      expect.objectContaining({
        operation: "prepare_season",
        context: expect.objectContaining({
          seasonId: launchSeason + 1,
          followingSeasonId: launchSeason + 2,
        }),
      }),
    ]));
  });

  it("leaves recovery older than the recurring-authority window read-only", () => {
    const launchDay = DAY - KEEPER_RECENT_DAILY_CADENCES - 2;
    const plans = discoverReconciliationPlans({
      snapshot: baseSnapshot({
        launchDayId: launchDay,
        dailies: [daily(launchDay, "open", {
          predecessorRolloverRequired: false,
        })],
      }),
      nowUnix: NOW,
    });
    expect(plans.some(({ operation }) => operation === "prepare_arena_daily"))
      .toBe(false);
  });

  it("keeps current paid play independent from late predecessor settlement", () => {
    const currentWeek = weekIdForDay(DAY);
    const currentSeason = seasonIdForDay(DAY);
    const emptySettlement = { winners: [], rolloverLamports: 0n };
    const snapshot = baseSnapshot({
      launchDayId: seasonStartDay(currentSeason - 1),
      dailies: [daily(DAY, "open", {
        predecessorRolloverRequired: true,
        predecessorRolloverApplied: false,
        settlement: emptySettlement,
      })],
      weeklies: [weekly(currentWeek, "open", {
        predecessorRolloverRequired: true,
        predecessorRolloverApplied: false,
        settlement: emptySettlement,
      })],
      seasons: [season(currentSeason, "open", {
        predecessorRolloverRequired: true,
        predecessorRolloverApplied: false,
        settlement: emptySettlement,
      })],
    });
    expect(() => validateProtocolSnapshot(snapshot)).not.toThrow();
    expect(discoverReconciliationPlans({ snapshot, nowUnix: NOW })
      .some(({ operation }) => operation.startsWith("finalize_"))).toBe(false);
  });

  it("routes terminal Campaign, ranked, and Practice runs by location", () => {
    const owner = Keypair.generate().publicKey;
    const runs: RunSnapshot[] = [
      campaignRun(owner, 1n, "base"),
      arenaRun(owner, 2n, "ranked", "base", "terminal", true),
      arenaRun(owner, 3n, "practice", "base", "terminal", true),
      arenaRun(owner, 4n, "ranked", "ephemeral_rollup", "terminal", true),
    ];
    const plans = discoverReconciliationPlans({
      snapshot: baseSnapshot({
        dailies: [daily(DAY - 1, "open", { predecessorRolloverRequired: true }), daily(DAY)],
        runs,
      }),
      nowUnix: NOW,
    });
    expect(plans.map(({ operation }) => operation)).toEqual([
      "prepare_arena_daily",
      "consume_campaign_run",
      "consume_arena_run",
      "consume_practice_run",
      "commit_run",
    ]);
  });

  it("uses today's deadline window for yesterday's Practice challenge", () => {
    const owner = Keypair.generate().publicKey;
    const practice = arenaRun(
      owner,
      12n,
      "practice",
      "ephemeral_rollup",
      "playing",
      true,
    );
    const force = discoverReconciliationPlans({
      snapshot: baseSnapshot({
        launchDayId: DAY - 1,
        dailies: [daily(DAY - 1, "finalized", {
          predecessorRolloverRequired: false,
          seasonRollupSealed: true,
        })],
        runs: [practice],
      }),
      nowUnix: NOW,
    }).find(({ operation }) => operation === "force_finish_deadline");
    expect(force?.context).toMatchObject({
      challengeDayId: DAY - 1,
      deadlineDayId: DAY,
      deadlineAt: DAY * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
      recoveryDeadlineAt:
        DAY * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
    });

    const expiry = discoverReconciliationPlans({
      snapshot: baseSnapshot({
        launchDayId: DAY - 1,
        dailies: [daily(DAY - 1, "finalized", {
          predecessorRolloverRequired: false,
          seasonRollupSealed: true,
        })],
        runs: [{
          ...practice,
          location: "unavailable",
          lifecycle: "unavailable",
        }],
      }),
      nowUnix: DAY * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
    }).find(({ operation }) => operation === "expire_unresolved_arena_run");
    expect(expiry?.context).toMatchObject({
      challengeDayId: DAY - 1,
      deadlineDayId: DAY,
      includeArenaPlayer: false,
    });
  });

  it("finishes reachable ER state, expires unavailable state, and cleans base orphans", () => {
    const owner = Keypair.generate().publicKey;
    const finish = arenaRun(owner, 1n, "ranked", "ephemeral_rollup", "playing", true);
    const expire = arenaRun(owner, 2n, "ranked", "unavailable", "unavailable", true);
    const orphan = arenaRun(owner, 3n, "ranked", "base", "playing", false);
    const operations = discoverReconciliationPlans({
      snapshot: baseSnapshot({ dailies: [daily(DAY)], runs: [finish, expire, orphan] }),
      nowUnix: DAY * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
    }).map(({ operation }) => operation);
    expect(operations).toContain("force_finish_deadline");
    expect(operations).toContain("expire_unresolved_arena_run");
    expect(operations).toContain("cleanup_orphan_active_run");
  });

  it("plans conserved native-SOL Daily payout and successor rollover", () => {
    const owner = Keypair.generate().publicKey;
    const current = daily(DAY, "open", {
      entriesPaid: 1n,
      entriesScored: 1n,
      potLamports: 100_000_001n,
      settlement: {
        winners: [{
          owner,
          payoutLamports: 100_000_000n,
          rank: 1,
          destinationValid: true,
        }],
        rolloverLamports: 1n,
      },
    });
    const following = daily(DAY + 1, "funding", {
      predecessorRolloverRequired: true,
    });
    const plan = discoverReconciliationPlans({
      snapshot: baseSnapshot({ dailies: [current, following] }),
      nowUnix: NOW,
    }).find(({ operation }) => operation === "finalize_arena_daily");
    expect(plan?.context).toMatchObject({
      dayId: DAY,
      followingDayId: DAY + 1,
      owners: [owner],
      payoutLamports: [100_000_000n],
      payoutTotalLamports: 100_000_000n,
      rolloverLamports: 1n,
    });
  });

  it("initializes, rolls, and seals the Daily-to-Season pipeline", () => {
    const owner = Keypair.generate().publicKey;
    const current = daily(DAY, "finalized", {
      seasonEligiblePlayers: 1,
      seasonRollups: 0,
    });
    const snapshot = baseSnapshot({
      dailies: [current],
      seasons: [season(seasonIdForDay(DAY), "open")],
      dailySeasonPlayers: [{
        dayId: DAY,
        owner,
        dailyResolved: true,
        hasBestScore: true,
        seasonRolled: false,
        seasonPlayerExists: false,
      }],
    });
    expect(discoverReconciliationPlans({ snapshot, nowUnix: NOW })
      .map(({ operation }) => operation)).toContain("initialize_season_player");

    snapshot.dailySeasonPlayers = [{
      ...snapshot.dailySeasonPlayers[0]!,
      seasonPlayerExists: true,
    }];
    expect(discoverReconciliationPlans({ snapshot, nowUnix: NOW })
      .map(({ operation }) => operation)).toContain("rollup_arena_to_season");

    snapshot.dailies = [daily(DAY, "finalized", {
      seasonEligiblePlayers: 1,
      seasonRollups: 1,
    })];
    snapshot.dailySeasonPlayers = [{
      ...snapshot.dailySeasonPlayers[0]!,
      seasonRolled: true,
    }];
    expect(discoverReconciliationPlans({ snapshot, nowUnix: NOW })
      .map(({ operation }) => operation)).toContain("seal_arena_season_rollups");
  });

  it("rejects noncanonical payout schedules before planning", () => {
    const malformed = baseSnapshot({
      dailies: [daily(DAY, "open", {
        potLamports: 10_000_000n,
        settlement: {
          winners: [{
            owner: Keypair.generate().publicKey,
            payoutLamports: 9_000_000n,
            rank: 1,
            destinationValid: true,
          }],
          rolloverLamports: 1_000_000n,
        },
      })],
    });
    expect(() => validateProtocolSnapshot(malformed)).toThrow("prize schedule");
  });
});

function baseSnapshot(overrides: Partial<ProtocolSnapshot> = {}): ProtocolSnapshot {
  return {
    paused: false,
    launchDayId: DAY,
    rulesCatalog: rulesCatalogPda(1),
    dailies: [],
    weeklies: [],
    seasons: [],
    runs: [],
    dailySeasonPlayers: [],
    ...overrides,
  };
}

function daily(
  dayId: number,
  status: DailySnapshot["status"] = "open",
  overrides: Partial<DailySnapshot> = {},
): DailySnapshot {
  return {
    dayId,
    status,
    runsCloseAt: dayId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
    recoveryDeadlineAt: dayId * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
    entriesPaid: 0n,
    entriesScored: 0n,
    entriesExpired: 0n,
    potLamports: 0n,
    predecessorRolloverRequired: dayId !== DAY,
    predecessorRolloverApplied: false,
    seasonEligiblePlayers: 0,
    seasonRollups: 0,
    seasonRollupSealed: false,
    ...overrides,
  };
}

function season(
  seasonId: number,
  status: SeasonSnapshot["status"],
  overrides: Partial<SeasonSnapshot> = {},
): SeasonSnapshot {
  return {
    seasonId,
    status,
    closesAt: (seasonId * 28 + 32) * SECONDS_PER_DAY,
    potLamports: 0n,
    predecessorRolloverRequired: false,
    predecessorRolloverApplied: false,
    sealedDailies: 0,
    ...overrides,
  };
}

function weekly(
  weekId: number,
  status: WeeklySnapshot["status"],
  overrides: Partial<WeeklySnapshot> = {},
): WeeklySnapshot {
  return {
    weekId,
    status,
    closesAt: (weekStartDay(weekId) + 7) * SECONDS_PER_DAY,
    potLamports: 0n,
    predecessorRolloverRequired: true,
    predecessorRolloverApplied: false,
    qualificationDailiesComplete: false,
    ...overrides,
  };
}

function campaignRun(
  owner: RunSnapshot["owner"],
  runId: bigint,
  location: RunSnapshot["location"],
): RunSnapshot {
  return {
    owner,
    runId,
    mode: "campaign",
    arenaPlayerExists: false,
    lifecycle: "terminal",
    location,
    acceptedActions: 1,
    reservationActive: true,
  };
}

function arenaRun(
  owner: RunSnapshot["owner"],
  runId: bigint,
  mode: "ranked" | "practice",
  location: RunSnapshot["location"],
  lifecycle: RunSnapshot["lifecycle"],
  reservationActive: boolean,
): RunSnapshot {
  const deadlineDayId = DAY;
  const challengeDayId = mode === "ranked" ? DAY : DAY - 1;
  return {
    owner,
    runId,
    mode,
    challengeDayId,
    deadlineDayId,
    arenaPlayerExists: mode === "ranked",
    lifecycle,
    location,
    acceptedActions: 1,
    runsCloseAt: deadlineDayId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
    recoveryDeadlineAt:
      deadlineDayId * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
    reservationActive,
  };
}
