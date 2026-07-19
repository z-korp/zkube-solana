// @vitest-environment node
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_KEEPER_SPEND_LAMPORTS,
  DEFAULT_MIN_KEEPER_LAMPORTS,
  expiredSessionCleanupAllowance,
  keeperKeypairFromEnv,
  keeperSpendWithinLimit,
  predictedKeeperSpendLamports,
} from "../src/keeper";

describe("v4 keeper bounds", () => {
  it("pins reserve, spend, and session cleanup limits", () => {
    expect(DEFAULT_MIN_KEEPER_LAMPORTS).toBe(100_000_000);
    expect(DEFAULT_MAX_KEEPER_SPEND_LAMPORTS).toBe(50_000_000);
    expect(keeperSpendWithinLimit(50_000_000, 50_000_000)).toBe(true);
    expect(keeperSpendWithinLimit(50_000_001, 50_000_000)).toBe(false);
    expect(expiredSessionCleanupAllowance(0, 8)).toBe(2);
    expect(expiredSessionCleanupAllowance(7, 8)).toBe(1);
    expect(expiredSessionCleanupAllowance(8, 8)).toBe(0);
  });

  it("accounts conservatively for fee and rent spend", () => {
    expect(predictedKeeperSpendLamports(100_000_000, 75_000_000, 5_000)).toBe(25_005_000);
    expect(() => predictedKeeperSpendLamports(1, -1, 5_000)).toThrow("invalid lamports");
  });

  it("pins loaded secret material to the configured public key", () => {
    const keeper = Keypair.generate();
    const encoded = JSON.stringify([...keeper.secretKey]);
    expect(keeperKeypairFromEnv({ KEEPER_SECRET_KEY: encoded, ZKUBE_KEEPER_PUBLIC_KEY: keeper.publicKey.toBase58() }).publicKey.equals(keeper.publicKey)).toBe(true);
    expect(() => keeperKeypairFromEnv({ KEEPER_SECRET_KEY: encoded, ZKUBE_KEEPER_PUBLIC_KEY: Keypair.generate().publicKey.toBase58() })).toThrow("does not match");
  });
});
