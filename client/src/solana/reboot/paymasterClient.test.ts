// @vitest-environment node

import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { assertClusterIdentity, assertPaymasterIdentity } from "./paymasterClient";

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
});
