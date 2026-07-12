import { useProgressController } from "@/contexts/progress";
import { useEmbeddedIdentity } from "@/solana/reboot/embeddedIdentityContext";
import { bigintToSafeNumber } from "@/utils/solanaDisplay";

export const useZStarBalance = (address: string | undefined) => {
  const { publicKey } = useEmbeddedIdentity();
  const controller = useProgressController();
  const isCurrentPlayer = !address || address === publicKey.toBase58();
  return {
    refetch: controller.refresh,
    isLoading: isCurrentPlayer && controller.loading,
    isError: isCurrentPlayer && controller.error !== null,
    error: isCurrentPlayer
      ? controller.error
      : "Other-player profiles are unavailable",
    balance: isCurrentPlayer
      ? bigintToSafeNumber(controller.progress?.starsBalance ?? 0n)
      : 0,
  };
};
