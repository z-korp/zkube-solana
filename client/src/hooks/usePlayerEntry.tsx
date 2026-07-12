import { useDailyController } from "@/contexts/daily";
import { useEmbeddedIdentity } from "@/solana/reboot/embeddedIdentityContext";

export interface PlayerEntryView {
  bestScore: number;
  rank: number;
  prizeAmount: bigint;
  claimed: boolean;
  freeAttemptUsed: boolean;
  paidAttempts: number;
  finalizedAttempts: number;
  refundedAmount: bigint;
  starRefunded: boolean;
}

export function usePlayerEntry(
  challengeId: number | undefined,
  playerAddress: string | undefined,
) {
  const { daily } = useDailyController();
  const { publicKey } = useEmbeddedIdentity();
  const matches =
    challengeId !== undefined &&
    daily?.dayId === challengeId &&
    (!playerAddress || playerAddress === publicKey.toBase58());
  const player = matches ? daily.player : null;
  const entry: PlayerEntryView | null = player
    ? {
        bestScore: player.bestScore,
        rank: player.rank,
        prizeAmount: player.prizeAmount,
        claimed: player.claimed,
        freeAttemptUsed: player.freeAttemptUsed,
        paidAttempts: player.paidAttempts,
        finalizedAttempts: player.finalizedAttempts,
        refundedAmount: player.refundedAmount,
        starRefunded: player.starRefunded,
      }
    : null;
  return { entry, isRegistered: entry !== null };
}

export default usePlayerEntry;
