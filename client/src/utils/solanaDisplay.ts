export function bigintToSafeNumber(value: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  const min = BigInt(Number.MIN_SAFE_INTEGER);
  if (value > max) return Number.MAX_SAFE_INTEGER;
  if (value < min) return Number.MIN_SAFE_INTEGER;
  return Number(value);
}

export function truncatePublicKey(
  value: string,
  { head = 4, tail = 4 }: { head?: number; tail?: number } = {},
): string {
  return value.length > head + tail
    ? `${value.slice(0, head)}…${value.slice(-tail)}`
    : value;
}

export function highestClearedLevel(levelStars: readonly number[]): number {
  return levelStars.reduce(
    (highest, stars, index) => (stars > 0 ? index + 1 : highest),
    0,
  );
}
