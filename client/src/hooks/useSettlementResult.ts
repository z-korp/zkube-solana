import { useMemo } from "react";

import type { CompetitionRecord } from "@/chain/campaignClient";
import { usePlayerProfile } from "./usePlayerProfile";

export type PeriodKind = 0 | 1 | 2;

export interface PeriodSettlement {
  /** 0 Daily, 1 Weekly, 2 Season — matches competitionProfileSynced.periodKind. */
  periodKind: PeriodKind;
  label: "Daily" | "Weekly" | "Season";
  /** Best payout-bearing rank ever reached (0 = none). */
  bestPrizeRank: number;
  podiums: number;
  wins: number;
  rewardsLamports: bigint;
  /** True once any payout-bearing rank or reward has landed for this period. */
  hasPrize: boolean;
}

export interface SettlementResult {
  periods: PeriodSettlement[];
  totalRewardsLamports: bigint;
  totalWins: number;
  /**
   * TODO(chain): the guardian-delivers screen also wants the single MOST RECENT
   * pushed prize and a scored-vs-expired signal for the just-settled run. That
   * cannot be derived from PlayerState alone — the account only carries the
   * aggregate lifetime `competitionRecord`s reflected above, not a per-event
   * history. It requires the `competitionProfileSynced` event
   * ({ owner, periodKind, rank, rewardLamports }) via a program-log
   * subscription or an indexer, which is a separate read surface. Until that
   * lands, `latestEvent` stays null rather than fabricating a "latest" result.
   */
  latestEvent: null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<unknown>;
}

const PERIODS: readonly { kind: PeriodKind; label: PeriodSettlement["label"] }[] =
  [
    { kind: 0, label: "Daily" },
    { kind: 1, label: "Weekly" },
    { kind: 2, label: "Season" },
  ];

function toPeriod(
  kind: PeriodKind,
  label: PeriodSettlement["label"],
  record: CompetitionRecord,
): PeriodSettlement {
  return {
    periodKind: kind,
    label,
    bestPrizeRank: record.bestPrizeRank,
    podiums: record.podiums,
    wins: record.wins,
    rewardsLamports: record.rewardsLamports,
    hasPrize: record.bestPrizeRank > 0 || record.rewardsLamports > 0n,
  };
}

/**
 * Read-only settlement summary for the connected player, derived from the
 * on-chain Daily/Weekly/Season competition records. Settlement is push-only and
 * may be late; these records update whenever the keeper pushes a profile sync,
 * so this reflects the latest confirmed prize state without gating on money.
 */
export function useSettlementResult(): SettlementResult {
  const profile = usePlayerProfile();
  const periods = useMemo<PeriodSettlement[]>(() => {
    const records: Record<PeriodKind, CompetitionRecord> = {
      0: profile.dailyRecord,
      1: profile.weeklyRecord,
      2: profile.seasonRecord,
    };
    return PERIODS.map(({ kind, label }) => toPeriod(kind, label, records[kind]));
  }, [profile.dailyRecord, profile.weeklyRecord, profile.seasonRecord]);

  return {
    periods,
    totalRewardsLamports: profile.totalRewardsLamports,
    totalWins: profile.totalWins,
    latestEvent: null,
    loading: profile.loading,
    error: profile.error,
    refresh: profile.refresh,
  };
}
