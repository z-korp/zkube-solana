import { useProgressController } from "@/contexts/progress";
import { useEmbeddedIdentity } from "@/solana/reboot/embeddedIdentityContext";
import { bigintToSafeNumber } from "@/utils/solanaDisplay";

export interface PlayerStats {
  totalLines: number;
  totalBosses: number;
  maxCombo: number;
  /** Compatibility alias; presentation must label this as maximum combo. */
  combo4Count: number;
}

export const usePlayerStats = (overrideAddress?: string): PlayerStats => {
  const { publicKey } = useEmbeddedIdentity();
  const { progress } = useProgressController();
  if (overrideAddress && overrideAddress !== publicKey.toBase58()) {
    return { totalLines: 0, totalBosses: 0, maxCombo: 0, combo4Count: 0 };
  }
  const maxCombo = progress?.lifetime.maxCombo ?? 0;
  return {
    totalLines: bigintToSafeNumber(progress?.lifetime.linesCleared ?? 0n),
    totalBosses: bigintToSafeNumber(progress?.lifetime.bossesCleared ?? 0n),
    maxCombo,
    combo4Count: maxCombo,
  };
};
