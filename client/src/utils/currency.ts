const LAMPORTS_PER_SOL_BASE_UNITS = 1_000_000_000n;
const LAMPORTS_PER_SOL = 1_000_000_000;
const WHOLE_SOL_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

/** Fixed-decimal SOL amount from a numeric lamport balance. */
export function formatSol(lamports: number, decimals = 4): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(lamports / LAMPORTS_PER_SOL);
}

/**
 * Every displayed SOL amount is x.xxx: truncated (never rounded up) to three
 * decimals — the 0.001 SOL on-chain transfer floor, so nothing shown is finer
 * than anything that can move.
 */
export function formatSolBalance(lamports: number): string {
  const truncated = Math.floor(Math.max(0, lamports) / 1_000_000) / 1_000;
  return truncated.toFixed(3);
}

/** Bigint twin of formatSolBalance. */
export function formatSolBalanceLamports(value: bigint): string {
  const positive = value > 0n ? value : 0n;
  return (Number(positive / 1_000_000n) / 1_000).toFixed(3);
}

export function formatSolLamports(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / LAMPORTS_PER_SOL_BASE_UNITS;
  const fraction = (absolute % LAMPORTS_PER_SOL_BASE_UNITS)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  const groupedWhole = WHOLE_SOL_FORMATTER.format(whole);
  return `${sign}${fraction ? `${groupedWhole}.${fraction}` : groupedWhole}`;
}
