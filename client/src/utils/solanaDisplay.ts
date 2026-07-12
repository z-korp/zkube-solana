export function bigintToSafeNumber(value: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  const min = BigInt(Number.MIN_SAFE_INTEGER);
  if (value > max) return Number.MAX_SAFE_INTEGER;
  if (value < min) return Number.MIN_SAFE_INTEGER;
  return Number(value);
}

export function truncatePublicKey(value: string): string {
  return value.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
}

export function highestClearedLevel(levelStars: readonly number[]): number {
  return levelStars.reduce(
    (highest, stars, index) => (stars > 0 ? index + 1 : highest),
    0,
  );
}
