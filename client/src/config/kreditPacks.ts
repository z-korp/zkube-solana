/**
 * Kredit packs offered by the shop.
 *
 * A Kredit is never granted, discounted, or bundled as a bonus: the program
 * pins every purchase to the same unit price, so `purchase_kredits` cannot
 * express a cheaper bulk rate even if the client asked for one. A larger pack
 * therefore buys exactly one thing — fewer wallet approvals — and the shop says
 * so rather than implying a saving that does not exist.
 *
 * The sizes themselves are a balance pass. The systems contract is only that
 * every pack is a whole number of identically priced Kredits.
 */
export const KREDIT_PACK_SIZES: readonly number[] = [1, 5, 10, 25];

/** Lamports for a pack, at the protocol's fixed unit price. */
export function kreditPackLamports(
  kredits: number,
  unitLamports: bigint,
): bigint {
  return BigInt(kredits) * unitLamports;
}
