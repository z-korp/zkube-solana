import { useCallback, useEffect, useState } from "react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { PERIOD_LABELS, type PeriodKind } from "@/chain/settlementEvents";
import { useSettlementResult } from "@/hooks/useSettlementResult";
import { browserLocalStorage, type StorageLike } from "@/platform/browserStorage";

export type { PeriodKind };

/** Per-wallet localStorage key: the last-seen per-period reward totals. */
const SEEN_KEY_PREFIX = "zkube:v4:rewards-seen:";

export interface PrizeDelta {
  /** 0 Daily, 1 Weekly, 2 Season — the period whose record grew. */
  periodKind: PeriodKind;
  periodLabel: "Daily" | "Weekly" | "Season";
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

type SeenTriplet = [bigint, bigint, bigint];

function readSeen(storage: StorageLike, key: string): SeenTriplet | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { d?: unknown }).d !== "string" ||
      typeof (parsed as { w?: unknown }).w !== "string" ||
      typeof (parsed as { s?: unknown }).s !== "string"
    ) {
      return null;
    }
    const record = parsed as { d: string; w: string; s: string };
    return [BigInt(record.d), BigInt(record.w), BigInt(record.s)];
  } catch {
    return null;
  }
}

function writeSeen(storage: StorageLike, key: string, value: SeenTriplet): void {
  storage.setItem(
    key,
    JSON.stringify({
      d: value[0].toString(),
      w: value[1].toString(),
      s: value[2].toString(),
    }),
  );
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
 * PlayerState and surfaces a landed Daily/Weekly/Season prize the instant the
 * keeper's push confirms (not at a render poll). A pushed prize is the only way a
 * period's lifetime `rewardsLamports` grows, so an increase is always a real paid
 * win — never a fabricated "scored vs expired" outcome (that per-run distinction
 * is not on PlayerState; see `useSettlementResult`).
 *
 * Dedup + baseline (bigint-safe, per wallet, persisted so a reload never
 * re-congratulates): the last-seen per-period totals live in localStorage. The
 * first observation for a wallet is baselined silently so a returning player with
 * existing winnings is never falsely congratulated. Thereafter every period is
 * reconciled against its last-seen total — all grown periods are advanced at once
 * so a settlement burst that pays several boards can never be double-counted
 * later — and the largest genuine increase is celebrated once, enriched with the
 * precise event's rank. The trigger never acts on a loading or errored read.
 */
export function usePrizeDeltaTrigger(): PrizeDeltaTrigger {
  const { publicKey } = useConnectedPlayer();
  const address = publicKey?.toBase58() ?? null;
  const { periods, latestEvent, loading, error } = useSettlementResult();
  const daily = periods[0];
  const weekly = periods[1];
  const season = periods[2];
  const dailyRewards = daily?.rewardsLamports ?? 0n;
  const weeklyRewards = weekly?.rewardsLamports ?? 0n;
  const seasonRewards = season?.rewardsLamports ?? 0n;
  const dailyRank = daily?.bestPrizeRank ?? 0;
  const weeklyRank = weekly?.bestPrizeRank ?? 0;
  const seasonRank = season?.bestPrizeRank ?? 0;

  const [prize, setPrize] = useState<PrizeDelta | null>(null);

  useEffect(() => {
    // Never trust an in-flight or failed read; money never gates on it either.
    if (!address || loading || error) return;
    const storage = browserLocalStorage();
    if (!storage) return;

    const key = `${SEEN_KEY_PREFIX}${address}`;
    const current: SeenTriplet = [dailyRewards, weeklyRewards, seasonRewards];
    const ranks: [number, number, number] = [dailyRank, weeklyRank, seasonRank];
    const seen = readSeen(storage, key);

    // First observation for this wallet — baseline silently, celebrate nothing.
    if (seen === null) {
      writeSeen(storage, key, current);
      return;
    }

    // Reconcile every period against the last-seen totals: advance them all at
    // once so a burst that pays several boards is never double-counted later,
    // and pick the largest genuine increase to celebrate.
    const next: SeenTriplet = [seen[0], seen[1], seen[2]];
    let bestKind: PeriodKind | null = null;
    let bestDelta = 0n;
    for (const kind of [0, 1, 2] as const) {
      const delta = current[kind] - seen[kind];
      if (delta > 0n) {
        next[kind] = current[kind];
        if (delta > bestDelta) {
          bestDelta = delta;
          bestKind = kind;
        }
      }
    }

    if (bestKind === null) return;

    // Persist immediately so a refresh or re-render never re-fires this prize.
    writeSeen(storage, key, next);
    // `latestEvent` is the same snapshot's largest increase and carries the
    // period record's rank; fall back to the reconciled period's own rank if the
    // subscription has not surfaced the event yet (e.g. a manual refresh path).
    const rank =
      latestEvent && latestEvent.periodKind === bestKind
        ? latestEvent.bestPrizeRank
        : ranks[bestKind];
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
    weeklyRewards,
    seasonRewards,
    dailyRank,
    weeklyRank,
    seasonRank,
  ]);

  const dismiss = useCallback(() => setPrize(null), []);

  return { prize, dismiss };
}
