import { useMemo } from "react";

import { useProgress } from "@/contexts/progress";
import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { bigintToSafeNumber } from "@/utils/solanaDisplay";

export interface PlayerMeta {
  player: string;
  totalRuns: number;
  dailyStars: number;
  lifetimeXp: number;
  lastActive: number;
}

export const usePlayerMeta = (overrideAddress?: string) => {
  const { publicKey } = useConnectedPlayer();
  const { progress, loading: progressLoading } = useProgress();
  const address = publicKey?.toBase58() ?? "";
  const isCurrentPlayer = Boolean(
    publicKey && (!overrideAddress || overrideAddress === address),
  );

  const playerMeta = useMemo<PlayerMeta | null>(() => {
    if (!isCurrentPlayer) return null;
    return {
      player: address,
      totalRuns: bigintToSafeNumber(progress?.lifetime.runsStarted ?? 0n),
      dailyStars: bigintToSafeNumber(progress?.lifetime.dailyChallenges ?? 0n),
      lifetimeXp: bigintToSafeNumber(progress?.lifetimeXp ?? 0n),
      lastActive: 0,
    };
  }, [address, isCurrentPlayer, progress]);

  return {
    playerMeta,
    isLoading: isCurrentPlayer && progressLoading,
  };
};
