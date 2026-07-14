import { useDaily } from "@/contexts/daily";
import { useEmbeddedIdentity } from "@/chain/embeddedIdentityContext";

export interface PlayerEntryView {
  bestDailyScore: number;
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
  const { publicKey } = useEmbeddedIdentity();
  const matches =
    challengeId !== undefined &&
    daily?.dayId === challengeId &&
    (!playerAddress || playerAddress === publicKey.toBase58());
  const player = matches ? daily.player : null;
  const rank =
    daily?.leaderboard.findIndex((candidate) =>
      candidate.player.equals(publicKey),
    ) ?? -1;
  const entry: PlayerEntryView | null = player
    ? {
        bestDailyScore: player.bestDailyScore ?? player.bestScore,
        bestEngineScore: player.bestEngineScore ?? player.bestScore,
        bestMoves: player.bestMoves ?? 0,
        bestScore: player.bestDailyScore ?? player.bestScore,
        rank: rank + 1,
        finalizedAttempts: player.finalizedAttempts,
        starRefunded: player.starRefunded,
      }
    : null;
  return { entry, isRegistered: entry !== null };
}

export default usePlayerEntry;
