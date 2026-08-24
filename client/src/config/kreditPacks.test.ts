// @vitest-environment node

import { describe, expect, it } from "vitest";

import { KREDIT_PACK_SIZES, kreditPackLamports } from "./kreditPacks";

describe("Kredit shop packs", () => {
  it("offers exactly the approved packs at one invariant unit price", () => {
    const unitLamports = 10_000_000n;

    expect(KREDIT_PACK_SIZES).toEqual([1, 10, 25]);
    expect(KREDIT_PACK_SIZES.map((size) => kreditPackLamports(size, unitLamports)))
      .toEqual([10_000_000n, 100_000_000n, 250_000_000n]);
  });
});
