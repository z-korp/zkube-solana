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
