// @vitest-environment node
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  KEEPER_LIMITS,
  keeperKeypairFromEnv,
  keeperPublicKeyFromEnv,
  keeperSpendWithinLimit,
  predictedKeeperSpendLamports,
  predictedAccountSpendLamports,
} from "../src/keeper.js";

describe("keeper bounds", () => {
  it("pins reserve and spend limits", () => {
    expect(KEEPER_LIMITS.reserveLamports).toBe(100_000_000);
    expect(KEEPER_LIMITS.spendLamports).toBe(100_000_000);
    expect(keeperSpendWithinLimit(100_000_000, 100_000_000)).toBe(true);
    expect(keeperSpendWithinLimit(100_000_001, 100_000_000)).toBe(false);
  });

  it("accounts conservatively for fee and rent spend", () => {
    expect(predictedKeeperSpendLamports(100_000_000, 75_000_000, 5_000)).toBe(25_005_000);
    expect(predictedAccountSpendLamports(500_000_000, 447_424_160))
      .toBe(52_575_840);
    expect(() => predictedAccountSpendLamports(1, undefined))
      .toThrow("omitted");
    expect(() => predictedKeeperSpendLamports(1, -1, 5_000)).toThrow("invalid lamports");
  });

  it("pins loaded secret material to the configured public key", () => {
    const keeper = Keypair.generate();
    const encoded = JSON.stringify([...keeper.secretKey]);
    expect(keeperKeypairFromEnv({ KEEPER_SECRET_KEY: encoded, ZKUBE_KEEPER_PUBLIC_KEY: keeper.publicKey.toBase58() }).publicKey.equals(keeper.publicKey)).toBe(true);
    expect(() => keeperKeypairFromEnv({ KEEPER_SECRET_KEY: encoded, ZKUBE_KEEPER_PUBLIC_KEY: Keypair.generate().publicKey.toBase58() })).toThrow("does not match");
    expect(keeperPublicKeyFromEnv({
      ZKUBE_KEEPER_PUBLIC_KEY: keeper.publicKey.toBase58(),
    }).equals(keeper.publicKey)).toBe(true);
  });

});
