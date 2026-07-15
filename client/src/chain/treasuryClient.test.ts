// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  assertStarSalesAccounting,
  type StarSalesAccounting,
} from "./treasuryClient";

describe("Star sale accounting", () => {
  it("conserves every lamport across the 10/10/80 destinations", () => {
    const accounting: StarSalesAccounting = {
      lifetimeGrossSales: 1_000_001n,
      lifetimeTeamShare: 100_000n,
      lifetimeRewardShare: 100_000n,
      lifetimeTreasuryShare: 800_001n,
      lifetimeStarsSold: 100n,
      purchaseCount: 1n,
    };

    expect(() => assertStarSalesAccounting(accounting)).not.toThrow();
    expect(() =>
      assertStarSalesAccounting({
        ...accounting,
        lifetimeTreasuryShare: 800_000n,
      }),
    ).toThrow("does not conserve lamports");
  });

  it("rejects Stars sold without a recorded purchase", () => {
    expect(() =>
      assertStarSalesAccounting({
        lifetimeGrossSales: 0n,
        lifetimeTeamShare: 0n,
        lifetimeRewardShare: 0n,
        lifetimeTreasuryShare: 0n,
        lifetimeStarsSold: 10n,
        purchaseCount: 0n,
      }),
    ).toThrow("without a recorded purchase");
  });
});
