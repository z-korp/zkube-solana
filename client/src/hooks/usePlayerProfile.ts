import { useMemo } from "react";

import { useClientState } from "@/backend/client";
import type { CompetitionRecord } from "@/backend/views";
import { useZoneProgress } from "./useZoneProgress";

export interface PlayerProfile {
  featuredEmblem: number;
  lifetimePaidEntries: bigint;
  scoreRecord: CompetitionRecord;
  themeRecord: CompetitionRecord;
  totalWins: number;
  totalRewardsLamports: bigint;
  ladderPoints: bigint;
  highestLadderTier: number;
  featuredFrameTier: number;
  bestDailyScore: number;
  entryStreakDays: number;
  totalStars: number;
}

export interface PlayerProfileResult extends PlayerProfile {
  loading: boolean;
  error: string | null;
  refresh: () => Promise<null>;
}

/** Presentation over the Economy service's replaying profile state. */
export function usePlayerProfile(): PlayerProfileResult {
  const { economy, identity } = useClientState();
  const { totalStars } = useZoneProgress(identity.address);
  const result = useMemo<PlayerProfileResult>(() => {
    const score = economy.profile.records.score;
    const theme = economy.profile.records.theme;
    return {
      featuredEmblem: economy.profile.wornEmblem,
      lifetimePaidEntries: 0n,
      scoreRecord: score,
      themeRecord: theme,
      totalWins: score.wins + theme.wins,
      totalRewardsLamports:
        score.rewardsLamports + theme.rewardsLamports,
      ladderPoints: economy.profile.ladderPoints,
      highestLadderTier: economy.profile.highestTier,
      featuredFrameTier: economy.profile.wornBorder,
      bestDailyScore: economy.profile.bestScore,
      entryStreakDays: economy.profile.streak,
      totalStars,
      loading: false,
      error: null,
      refresh: async () => null,
    };
  }, [economy, totalStars]);
  return result;
}
