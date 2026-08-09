import { useCallback, useEffect, useState } from "react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { PERIOD_LABELS, type PeriodKind } from "@/chain/settlementEvents";
import { useSettlementResult } from "@/hooks/useSettlementResult";
import { browserLocalStorage, type StorageLike } from "@/platform/browserStorage";

export type { PeriodKind };

/** Per-wallet localStorage key: the last-seen Daily reward total. */
const SEEN_KEY_PREFIX = "zkube:v5:rewards-seen:";

export interface PrizeDelta {
  /** Daily — the period whose record grew. */
  periodKind: PeriodKind;
  periodLabel: "Daily";
  /** How much the attributed period's lifetime rewards grew, in lamports. */
  amountLamports: bigint;
  /**
   * Best payout-bearing rank on the period record (0 = none). This is the
   * lifetime-best rank carried on PlayerState, which equals this placement only
   * on a first prize; a repeat winner keeps a better prior rank. The exact
   * per-event rank would need the `competitionProfileSynced` program event,
   * which is deliberately not scraped — so this is the honest best-known rank,
   * not a claim about this specific win.
   */
  bestPrizeRank: number;
}

function readSeen(storage: StorageLike, key: string): bigint | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

function writeSeen(storage: StorageLike, key: string, value: bigint): void {
  storage.setItem(key, value.toString());
}

export interface PrizeDeltaTrigger {
  /** The prize to celebrate, or null when there is nothing new to show. */
  prize: PrizeDelta | null;
  dismiss: () => void;
}

/**
 * Precise, real-time celebration trigger for the guardian-delivers moment.
 *
 * Driven by `useSettlementResult`, which subscribes to the connected player's
 * PlayerState and surfaces a landed Daily prize the instant the
 * keeper's push confirms (not at a render poll). A pushed prize is the only way a
 * period's lifetime `rewardsLamports` grows, so an increase is always a real paid
 * win — never a fabricated "scored vs expired" outcome (that per-run distinction
 * is not on PlayerState; see `useSettlementResult`).
 *
 * Dedup + baseline (bigint-safe, per wallet, persisted so a reload never
 * re-congratulates): the last-seen Daily total lives in localStorage. The
 * first observation for a wallet is baselined silently so a returning player with
 * existing winnings is never falsely congratulated. Thereafter the Daily record
 * is reconciled against its last-seen total and a genuine increase is celebrated
 * once, enriched with the precise event's rank. The trigger never acts on a
 * loading or errored read.
 */
export function usePrizeDeltaTrigger(): PrizeDeltaTrigger {
  const { publicKey } = useConnectedPlayer();
  const address = publicKey?.toBase58() ?? null;
  const { periods, latestEvent, loading, error } = useSettlementResult();
  const daily = periods[0];
  const dailyRewards = daily?.rewardsLamports ?? 0n;
  const dailyRank = daily?.bestPrizeRank ?? 0;

  const [prize, setPrize] = useState<PrizeDelta | null>(null);

  useEffect(() => {
    // Never trust an in-flight or failed read; money never gates on it either.
    if (!address || loading || error) return;
    const storage = browserLocalStorage();
    if (!storage) return;

    const key = `${SEEN_KEY_PREFIX}${address}`;
    const current = dailyRewards;
    const seen = readSeen(storage, key);

    // First observation for this wallet — baseline silently, celebrate nothing.
    if (seen === null) {
      writeSeen(storage, key, current);
      return;
    }

    const bestKind: PeriodKind = 0;
    const bestDelta = current - seen;
    if (bestDelta <= 0n) return;

    // Persist immediately so a refresh or re-render never re-fires this prize.
    writeSeen(storage, key, current);
    // `latestEvent` is the same snapshot's largest increase and carries the
    // period record's rank; fall back to the reconciled period's own rank if the
    // subscription has not surfaced the event yet (e.g. a manual refresh path).
    const rank =
      latestEvent && latestEvent.periodKind === bestKind
        ? latestEvent.bestPrizeRank
        : dailyRank;
    setPrize({
      periodKind: bestKind,
      periodLabel: PERIOD_LABELS[bestKind],
      amountLamports: bestDelta,
      bestPrizeRank: rank,
    });
  }, [
    address,
    loading,
    error,
    latestEvent,
    dailyRewards,
    dailyRank,
  ]);

  const dismiss = useCallback(() => setPrize(null), []);

  return { prize, dismiss };
}
