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
