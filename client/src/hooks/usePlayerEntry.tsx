import { useDaily } from "@/contexts/daily";
import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { dailyLeaderboardRank } from "@/chain/dailyClient";

export interface PlayerEntryView {
  bestDailyScore: number;
  bestDailyBonusTriggers: number;
  bestEngineScore: number;
  bestMoves: number;
  /** Daily score compatibility alias. */
  bestScore: number;
  rank: number;
  finalizedAttempts: number;
  starRefunded: boolean;
}

export function usePlayerEntry(
  challengeId: number | undefined,
  playerAddress: string | undefined,
) {
  const { daily } = useDaily();
  const { publicKey } = useConnectedPlayer();
  const matches =
    challengeId !== undefined &&
    daily?.dayId === challengeId &&
    Boolean(publicKey && (!playerAddress || playerAddress === publicKey.toBase58()));
  const player = matches ? daily.player : null;
  const leaderboardIndex =
    publicKey
      ? (daily?.leaderboard.findIndex((candidate) =>
          candidate.player.equals(publicKey),
        ) ?? -1)
      : -1;
  const rank = daily && leaderboardIndex >= 0
    ? dailyLeaderboardRank(daily.leaderboard, leaderboardIndex)
    : 0;
  const entry: PlayerEntryView | null = player
    ? {
        bestDailyScore: player.bestDailyScore ?? player.bestScore,
        bestDailyBonusTriggers: player.bestDailyBonusTriggers ?? 0,
        bestEngineScore: player.bestEngineScore ?? player.bestScore,
        bestMoves: player.bestMoves ?? 0,
        bestScore: player.bestDailyScore ?? player.bestScore,
        rank,
        finalizedAttempts: player.finalizedAttempts,
        starRefunded: player.starRefunded,
      }
    : null;
  return { entry, isRegistered: entry !== null };
}

export default usePlayerEntry;
