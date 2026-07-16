// @vitest-environment node

import { Keypair, type AccountInfo, type Connection } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import invariants from "../../../fixtures/protocol-invariants.json";
import { INITIAL_RUN_ID } from "./constants";
import { deriveRunAddresses } from "./pdas";
import {
  assertPreparedRunAddressesAvailable,
  resolvePreparedRunAddresses,
} from "./runPlan";

function collisionConnection(
  occupiedIndexes: number[],
): Pick<Connection, "getMultipleAccountsInfo"> {
  return {
    getMultipleAccountsInfo: vi.fn(async () =>
      [0].map((index) =>
        occupiedIndexes.includes(index) ? ({} as AccountInfo<Buffer>) : null,
      ),
    ) as Connection["getMultipleAccountsInfo"],
  };
}

describe("run identity invariants", () => {
  it("starts a fresh profile at the shared run ID and derives every PDA from it", () => {
    const owner = Keypair.generate().publicKey;
    const resolved = resolvePreparedRunAddresses(owner, null);
    const expected = deriveRunAddresses(owner, 1n);

    expect(INITIAL_RUN_ID).toBe(BigInt(invariants.initialRunId));
    expect(resolved.runId).toBe(1n);
    expect(resolved.addresses.activeRun.equals(expected.activeRun)).toBe(true);
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

  it("keeps identical run IDs isolated by owner", () => {
    const firstOwner = Keypair.generate().publicKey;
    const secondOwner = Keypair.generate().publicKey;
    const first = deriveRunAddresses(firstOwner, 1n);
    const second = deriveRunAddresses(secondOwner, 1n);

    expect(first.activeRun.equals(second.activeRun)).toBe(false);
  });

  it("accepts an owner-scoped run ID only when all candidate accounts are free", async () => {
    const owner = Keypair.generate().publicKey;
    const addresses = deriveRunAddresses(owner, 1n);

    await expect(
      assertPreparedRunAddressesAvailable(
        collisionConnection([]),
        owner,
        1n,
        addresses,
      ),
    ).resolves.toBeUndefined();
  });

  it.each([[0, "active run"]])(
    "rejects an occupied candidate account at index %i (%s)",
    async (index, label) => {
      const owner = Keypair.generate().publicKey;
      const addresses = deriveRunAddresses(owner, 1n);

      await expect(
        assertPreparedRunAddressesAvailable(
          collisionConnection([index]),
          owner,
          1n,
          addresses,
        ),
      ).rejects.toThrow(
        `Run ID 1 is already occupied for ${owner.toBase58()} (${label})`,
      );
    },
  );
});
