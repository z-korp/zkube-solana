import { useCallback, useEffect, useState } from "react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { usePlayerProfile } from "@/hooks/usePlayerProfile";
import { browserLocalStorage, type StorageLike } from "@/platform/browserStorage";

/** Period kinds match competitionProfileSynced.periodKind (0 Daily …). */
type PeriodKind = 0 | 1 | 2;

const PERIOD_LABELS: Record<PeriodKind, "Daily" | "Weekly" | "Season"> = {
  0: "Daily",
  1: "Weekly",
  2: "Season",
};

/** Per-wallet localStorage key: the last-seen per-period reward totals. */
const SEEN_KEY_PREFIX = "zkube:v4:rewards-seen:";

export interface PrizeDelta {
  /** 0 Daily, 1 Weekly, 2 Season — the period whose record grew. */
  periodKind: PeriodKind;
  periodLabel: "Daily" | "Weekly" | "Season";
  /** How much the attributed period's lifetime rewards grew, in lamports. */
  amountLamports: bigint;
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
 * Data-available celebration trigger for the guardian-delivers moment.
 *
 * The precise per-run "scored vs expired" outcome and the exact just-settled
 * event need the `competitionProfileSynced` program-log subscription that
 * `useSettlementResult` documents as a follow-up TODO. Until that lands we key
 * off data we already have: the lifetime per-period reward totals on
 * PlayerState. We persist the last-seen totals per wallet in localStorage and,
 * whenever a period's total grows beyond what we last saw, fire the overlay
 * once for that delta (attributed to the largest-growing period). The very
 * first observation for a wallet is baselined silently so a returning player
 * with existing winnings is never falsely congratulated.
 */
export function usePrizeDeltaTrigger(): PrizeDeltaTrigger {
  const { publicKey } = useConnectedPlayer();
  const address = publicKey?.toBase58() ?? null;
  const profile = usePlayerProfile();
  const { loading, error } = profile;
  const dailyRewards = profile.dailyRecord.rewardsLamports;
  const weeklyRewards = profile.weeklyRecord.rewardsLamports;
  const seasonRewards = profile.seasonRecord.rewardsLamports;

  const [prize, setPrize] = useState<PrizeDelta | null>(null);

  useEffect(() => {
    // Never trust an in-flight or failed read; money never gates on it either.
    if (!address || loading || error) return;
    const storage = browserLocalStorage();
    if (!storage) return;

    const key = `${SEEN_KEY_PREFIX}${address}`;
    const current: SeenTriplet = [dailyRewards, weeklyRewards, seasonRewards];
    const seen = readSeen(storage, key);

    // First observation for this wallet — baseline silently, celebrate nothing.
    if (seen === null) {
      writeSeen(storage, key, current);
      return;
    }

    // Attribute to the period with the largest positive growth since last seen.
    let bestKind: PeriodKind | null = null;
    let bestDelta = 0n;
    for (const kind of [0, 1, 2] as const) {
      const delta = current[kind] - seen[kind];
      if (delta > bestDelta) {
        bestDelta = delta;
        bestKind = kind;
      }
    }

    if (bestKind !== null) {
      // Persist immediately so a refresh or re-render never re-fires this prize.
      writeSeen(storage, key, current);
      setPrize({
        periodKind: bestKind,
        periodLabel: PERIOD_LABELS[bestKind],
        amountLamports: bestDelta,
      });
    }
  }, [address, loading, error, dailyRewards, weeklyRewards, seasonRewards]);

  const dismiss = useCallback(() => setPrize(null), []);

  return { prize, dismiss };
}
