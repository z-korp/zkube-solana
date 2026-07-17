import { truncatePublicKey } from "@/utils/solanaDisplay";

/**
 * Leaderboard display name: the cosmetic label beside the authoritative
 * truncated wallet, or the wallet alone when no distinct label exists.
 */
export function playerLabelWithWallet(
  label: string | null,
  address: string,
): string {
  const shortened = truncatePublicKey(address);
  return label && label !== shortened ? `${label} · ${shortened}` : shortened;
}
