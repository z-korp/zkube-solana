import { useMemo } from "react";

import { useCampaign } from "@/contexts/campaign";
import { useProgress } from "@/contexts/progress";
import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { bigintToSafeNumber, highestClearedLevel } from "@/utils/solanaDisplay";
import type { CampaignMapView } from "@/chain/campaignClient";

export interface PlayerMeta {
  player: string;
  bestLevel: number;
  totalRuns: number;
  dailyStars: number;
  lifetimeXp: number;
  lastActive: number;
}

export function campaignBestLevel(maps: readonly CampaignMapView[]): number {
  return maps.reduce((best, map) => {
    const highest = map.cleared ? 10 : highestClearedLevel(map.levelStars);
    return highest > 0 ? Math.max(best, (map.mapId - 1) * 10 + highest) : best;
  }, 0);
}

export const usePlayerMeta = (overrideAddress?: string) => {
  const { publicKey } = useConnectedPlayer();
  const { campaign, loading: campaignLoading } = useCampaign();
  const { progress, loading: progressLoading } = useProgress();
  const address = publicKey?.toBase58() ?? "";
  const isCurrentPlayer = Boolean(
    publicKey && (!overrideAddress || overrideAddress === address),
  );

  const playerMeta = useMemo<PlayerMeta | null>(() => {
    if (!isCurrentPlayer) return null;
    const bestLevel = campaignBestLevel(campaign?.maps ?? []);
    return {
      player: address,
      bestLevel,
      totalRuns: bigintToSafeNumber(progress?.lifetime.runsStarted ?? 0n),
      dailyStars: bigintToSafeNumber(progress?.lifetime.dailyChallenges ?? 0n),
      lifetimeXp: bigintToSafeNumber(progress?.lifetimeXp ?? 0n),
      lastActive: 0,
    };
  }, [address, campaign?.maps, isCurrentPlayer, progress]);

  return {
    playerMeta,
    isLoading: isCurrentPlayer && (campaignLoading || progressLoading),
  };
};
