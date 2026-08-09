import { useMemo } from "react";

import type { CompetitionRecord } from "@/chain/campaignClient";
import type { PeriodKind, SettlementEvent } from "@/chain/settlementEvents";
import { useSettlementWatcher } from "./useSettlementWatcher";

export type { PeriodKind } from "@/chain/settlementEvents";

export interface PeriodSettlement {
  /** Daily — matches competitionProfileSynced.periodKind. */
  periodKind: PeriodKind;
  label: "Daily";
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
   * The single most recent pushed prize — the largest reward increase observed
   * since this session began watching PlayerState. Real-time and exact for the
   * period + amount; `bestPrizeRank` is the record's lifetime-best rank (see
   * `SettlementEvent`), not a claim about this specific placement.
   *
   * This only ever signals a PAID placement: PlayerState carries the aggregate
   * lifetime records, and a reward increase can only come from a real settlement
   * push. A "scored but did not place" vs "expired" outcome for an arbitrary run
   * is NOT derivable here — PlayerState has no per-run history, only the daily
   * per-run receipt (ArenaPlayer) does — so that distinction is left as a
   * documented follow-up rather than fabricated.
   */
  latestEvent: SettlementEvent | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<unknown>;
}

const EMPTY_RECORD: CompetitionRecord = {
  bestPrizeRank: 0,
  podiums: 0,
  wins: 0,
  rewardsLamports: 0n,
};

const PERIODS: readonly { kind: PeriodKind; label: PeriodSettlement["label"] }[] =
  [{ kind: 0, label: "Daily" }];

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
 * Real-time settlement summary for the connected player, derived from the
 * live-subscribed Daily competition record on PlayerState (via
 * `useSettlementWatcher`). Profile synchronization may be late; the account
 * updates whenever the keeper pushes a profile sync, so this reflects the latest
 * confirmed prize state — including the most recent pushed prize as
 * `latestEvent` — the instant it lands, without gating on money.
 */
export function useSettlementResult(): SettlementResult {
  const { view, latestEvent, loading, error, refresh } = useSettlementWatcher();

  const daily = view?.dailyRecord ?? EMPTY_RECORD;

  const periods = useMemo<PeriodSettlement[]>(() => {
    const records: Record<PeriodKind, CompetitionRecord> = {
      0: daily,
    };
    return PERIODS.map(({ kind, label }) => toPeriod(kind, label, records[kind]));
  }, [daily]);

  return {
    periods,
    totalRewardsLamports: daily.rewardsLamports,
    totalWins: daily.wins,
    latestEvent,
    loading,
    error,
    refresh,
  };
}
