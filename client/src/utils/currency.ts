const LAMPORTS_PER_SOL_BASE_UNITS = 1_000_000_000n;
const LAMPORTS_PER_SOL = 1_000_000_000;

/** Fixed-decimal SOL amount from a numeric lamport balance. */
export function formatSol(lamports: number, decimals = 4): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(decimals);
}

export function formatSolLamports(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / LAMPORTS_PER_SOL_BASE_UNITS;
  const fraction = (absolute % LAMPORTS_PER_SOL_BASE_UNITS)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return `${sign}${fraction ? `${whole}.${fraction}` : whole.toString()}`;
}

export function splitStarPurchase(amount: bigint): {
  team: bigint;
  rewards: bigint;
  treasury: bigint;
} {
  if (amount < 0n) throw new Error("Purchase amount cannot be negative");
  const team = amount / 10n;
  const rewards = amount / 10n;
  return { team, rewards, treasury: amount - team - rewards };
}
