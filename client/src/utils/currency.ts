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
