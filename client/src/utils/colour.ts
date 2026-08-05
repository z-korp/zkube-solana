/**
 * Hex colour mixing, shared by the theme palette and the effects that derive
 * shades from it (block bodies, bevels, burst tints).
 *
 * `lighten` and `darken` are mixes toward white and black, which is what the
 * theme table's own arithmetic already computed — `r * (1 - k)` and
 * `r + (255 - r) * k` — so these produce identical values to the versions they
 * replaced.
 */

/** Blend `color` toward `target` by `amount` (0 = unchanged, 1 = target). */
export function mixHex(color: string, target: string, amount: number): string {
  const channels = (hex: string) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const from = channels(color);
  const to = channels(target);
  return (
    "#" +
    from
      .map((value, i) =>
        Math.round(value + (to[i] - value) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

export const lighten = (color: string, amount: number) =>
  mixHex(color, "#ffffff", amount);

export const darken = (color: string, amount: number) =>
  mixHex(color, "#000000", amount);
