import { useCallback, useEffect, useMemo, useState } from "react";

import type { CompetitionRecord } from "@/chain/campaignClient";
import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { useSolanaConnection } from "@/chain/connectionContext";
import {
  fetchPlayerStateView,
  type PlayerStateView,
} from "@/chain/playerStateClient";
import { errorMessage } from "@/utils/errors";
import { DEV_BYPASS_ACTIVE } from "@/dev/devBypass";
import { applyDevPlayerProfile } from "@/dev/fixtures";
import { useZoneProgress } from "./useZoneProgress";

const EMPTY_RECORD: CompetitionRecord = {
  bestPrizeRank: 0,
  podiums: 0,
  wins: 0,
  rewardsLamports: 0n,
};

export interface PlayerProfile {
  /** Stored emblem id (0 = auto). Resolve to a descriptor with config/emblems. */
  featuredEmblem: number;
  lifetimePaidEntries: bigint;
  dailyRecord: CompetitionRecord;
  weeklyRecord: CompetitionRecord;
  seasonRecord: CompetitionRecord;
  /** Display-time sum of wins across the three competition records. */
  totalWins: number;
  /** Display-time sum of rewards (lamports) across the three records. */
  totalRewardsLamports: bigint;
  /** Campaign stars, reused from useZoneProgress rather than re-read. */
  totalStars: number;
}

export interface PlayerProfileResult extends PlayerProfile {
  loading: boolean;
  error: string | null;
  refresh: () => Promise<PlayerStateView | null>;
}

/**
 * Competitive profile for the connected player. Reads PlayerState directly for
 * the emblem, lifetime paid entries, and the Daily/Weekly/Season prize records;
 * Campaign stars/totalStars are reused from useZoneProgress (which projects the
 * shared campaign controller) rather than re-reading the account. Fields fall
 * back to zeros when disconnected or before the first paid entry, so the UI
 * always has a stable shape to render.
 */
export function usePlayerProfile(): PlayerProfileResult {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const owner = player.publicKey;
  const address = owner?.toBase58();
  const { totalStars } = useZoneProgress(address);
  const [state, setState] = useState<PlayerStateView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!owner) {
      setState(null);
      return null;
    }
    setLoading(true);
    try {
      const next = await fetchPlayerStateView({
        connection,
        wallet: player.readOnlyWallet,
        owner,
      });
      setState(next);
      setError(null);
      return next;
    } catch (cause) {
      setState(null);
      setError(errorMessage(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }, [connection, owner, player.readOnlyWallet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const profile = useMemo<PlayerProfile>(() => {
    const daily = state?.dailyRecord ?? EMPTY_RECORD;
    const weekly = state?.weeklyRecord ?? EMPTY_RECORD;
    const season = state?.seasonRecord ?? EMPTY_RECORD;
    return {
      featuredEmblem: state?.featuredEmblem ?? 0,
      lifetimePaidEntries: state?.lifetimePaidEntries ?? 0n,
      dailyRecord: daily,
      weeklyRecord: weekly,
      seasonRecord: season,
      totalWins: daily.wins + weekly.wins + season.wins,
      totalRewardsLamports:
        daily.rewardsLamports + weekly.rewardsLamports + season.rewardsLamports,
      totalStars,
    };
  }, [state, totalStars]);

  const result: PlayerProfileResult = { ...profile, loading, error, refresh };
  // DEV-ONLY fixture override; folds away in production builds.
  return import.meta.env.DEV && DEV_BYPASS_ACTIVE
    ? applyDevPlayerProfile(result)
    : result;
}
