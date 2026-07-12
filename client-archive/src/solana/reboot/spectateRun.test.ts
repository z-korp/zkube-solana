// @vitest-environment node

import { Connection, Keypair } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { deriveRunAddresses } from "./pdas";
import { resolveSpectatedRun } from "./spectateRun";
import { ZKUBE_PROGRAM_ID } from "../constants";

const activeRunStub = (owner: Keypair, runId: bigint) => ({
  owner: owner.publicKey,
  runId,
  lifecycle: "playing",
  score: 12,
  actionCounter: 3,
  moves: 3,
  grid: new Array(80).fill(0),
  nextRow: new Array(8).fill(0),
  pendingVrfCounter: 0,
});

describe("spectated run resolution", () => {
  it("routes to the ER when the run is delegated, never the base copy", async () => {
    const owner = Keypair.generate();
    const addresses = deriveRunAddresses(owner.publicKey, 4n);
    const erConnection = {
      getAccountInfo: vi.fn().mockResolvedValue({ owner: ZKUBE_PROGRAM_ID }),
    } as unknown as Connection;
    const fetchRun = vi
      .fn()
      .mockResolvedValue(activeRunStub(owner, 4n));
    const result = await resolveSpectatedRun({
      baseConnection: {} as Connection,
      target: { player: owner.publicKey, runId: 4n },
      dependencies: {
        getStatus: vi
          .fn()
          .mockResolvedValue({ isDelegated: true, fqdn: "https://er.example/" }),
        makeErConnection: () => erConnection,
        fetchRun,
      },
    });
    expect(result.phase).toBe("delegated");
    expect(
      result.phase === "delegated" &&
        result.activeRunPda.equals(addresses.activeRun),
    ).toBe(true);
    // The single fetch went to the ER connection, not base.
    expect(fetchRun).toHaveBeenCalledTimes(1);
    expect(fetchRun.mock.calls[0][0]).toBe(erConnection);
  });

  it("prefers the consumed receipt on base and reports settled", async () => {
    const owner = Keypair.generate();
    const receipt = {
      owner: owner.publicKey,
      runId: 4n,
      mode: "campaign",
      score: 88,
      moves: 9,
      levelStars: 3,
      completed: true,
      consumed: true,
    };
    const result = await resolveSpectatedRun({
      baseConnection: {} as Connection,
      target: { player: owner.publicKey, runId: 4n },
      dependencies: {
        getStatus: vi.fn().mockResolvedValue({ isDelegated: false }),
        fetchRunReceipt: vi.fn().mockResolvedValue(receipt),
        fetchRun: vi.fn(),
      },
    });
    expect(result.phase).toBe("settled");
    expect(result.phase === "settled" && result.receipt.score).toBe(88);
  });

  it("derives the latest run from the player profile", async () => {
    const owner = Keypair.generate();
    const expected = deriveRunAddresses(owner.publicKey, 6n);
    const fetchRun = vi.fn().mockResolvedValue(activeRunStub(owner, 6n));
    const result = await resolveSpectatedRun({
      baseConnection: {} as Connection,
      target: { player: owner.publicKey },
      dependencies: {
        getStatus: vi.fn().mockResolvedValue({ isDelegated: false }),
        fetchNextRunId: vi.fn().mockResolvedValue(7n),
        fetchRunReceipt: vi.fn().mockResolvedValue(null),
        fetchRun,
      },
    });
    expect(result.phase).toBe("base");
    expect(
      result.phase === "base" && result.activeRunPda.equals(expected.activeRun),
    ).toBe(true);
  });

  it("reports not-found for a player with no runs", async () => {
    const owner = Keypair.generate();
    const result = await resolveSpectatedRun({
      baseConnection: {} as Connection,
      target: { player: owner.publicKey },
      dependencies: {
        getStatus: vi.fn(),
        fetchNextRunId: vi.fn().mockResolvedValue(1n),
      },
    });
    expect(result.phase).toBe("not-found");
  });

  it("rejects a delegated account not owned by zKube", async () => {
    const owner = Keypair.generate();
    const erConnection = {
      getAccountInfo: vi
        .fn()
        .mockResolvedValue({ owner: Keypair.generate().publicKey }),
    } as unknown as Connection;
    await expect(
      resolveSpectatedRun({
        baseConnection: {} as Connection,
        target: { player: owner.publicKey, runId: 2n },
        dependencies: {
          getStatus: vi
            .fn()
            .mockResolvedValue({ isDelegated: true, fqdn: "https://er.example/" }),
          makeErConnection: () => erConnection,
        },
      }),
    ).rejects.toThrow(/not owned by zKube/);
  });
});
