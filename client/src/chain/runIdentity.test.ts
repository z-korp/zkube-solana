// @vitest-environment node

import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import invariants from "../../../fixtures/protocol-invariants.json";
import { INITIAL_RUN_ID } from "./constants";
import { deriveRunAddresses } from "./pdas";
import { resolvePreparedRunAddresses } from "./runPlan";

describe("run identity invariants", () => {
  it("starts a fresh profile at the shared run ID and derives every PDA from it", () => {
    const owner = Keypair.generate().publicKey;
    const resolved = resolvePreparedRunAddresses(owner, null);
    const expected = deriveRunAddresses(owner, 1n);

    expect(INITIAL_RUN_ID).toBe(BigInt(invariants.initialRunId));
    expect(resolved.runId).toBe(1n);
    expect(resolved.addresses.runShell.equals(expected.runShell)).toBe(true);
    expect(resolved.addresses.activeRun.equals(expected.activeRun)).toBe(true);
    expect(resolved.addresses.runReceipt.equals(expected.runReceipt)).toBe(
      true,
    );
  });

  it("always prefers an existing profile's authoritative next run ID", () => {
    const owner = Keypair.generate().publicKey;
    const resolved = resolvePreparedRunAddresses(owner, {
      nextRunId: { toString: () => "42" },
    });

    expect(resolved.runId).toBe(42n);
    expect(
      resolved.addresses.activeRun.equals(
        deriveRunAddresses(owner, 42n).activeRun,
      ),
    ).toBe(true);
  });
});
