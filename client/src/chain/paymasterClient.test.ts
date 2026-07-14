// @vitest-environment node

import { Keypair, type Connection } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { SOLANA_DEVNET_GENESIS_HASH } from "./constants";
import {
  assertClusterIdentity,
  assertPaymasterIdentity,
  fetchPaymasterClient,
} from "./paymasterClient";

describe("paymaster client identity", () => {
  it("accepts only the paymaster configured by the canonical protocol account", () => {
    const configured = Keypair.generate().publicKey;
    expect(() => assertPaymasterIdentity(configured, configured)).not.toThrow();
    expect(() => assertPaymasterIdentity(Keypair.generate().publicKey, configured))
      .toThrow(/on-chain protocol configuration/);
  });

  it("fails closed when the RPC genesis does not match deployment configuration", () => {
    expect(() => assertClusterIdentity("devnet", "devnet")).not.toThrow();
    expect(() => assertClusterIdentity("localnet", null)).not.toThrow();
    expect(() => assertClusterIdentity("mainnet", "devnet")).toThrow(/genesis hash/);
  });

  it("reports an unavailable relay explicitly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const connection = {
      getGenesisHash: vi.fn().mockResolvedValue(SOLANA_DEVNET_GENESIS_HASH),
      getAccountInfo: vi.fn().mockResolvedValue({ executable: true }),
    } as unknown as Connection;
    try {
      await expect(fetchPaymasterClient(connection)).rejects.toThrow(
        "paymaster is unavailable",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
