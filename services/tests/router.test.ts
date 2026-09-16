// @vitest-environment node

import { Keypair, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  ZKUBE_PROGRAM_ID,
  keeperPlan,
} from "../src/arcadeChain.js";
import {
  getDelegationStatus,
  resolveEphemeralConnectionForPlan,
} from "../src/router.js";

describe("MagicBlock Router boundary", () => {
  it("validates delegation status and normalizes the ER endpoint", async () => {
    const status = await getDelegationStatus(
      Keypair.generate().publicKey,
      "https://router.example",
      async () => new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          isDelegated: true,
          fqdn: "https://er.example",
          delegationRecord: {
            authority: Keypair.generate().publicKey.toBase58(),
            owner: ZKUBE_PROGRAM_ID.toBase58(),
            delegationSlot: 7,
            lamports: 1,
          },
        },
      }), { status: 200 }),
    );
    expect(status.isDelegated).toBe(true);
    expect(status.fqdn).toBe("https://er.example/");
  });

  it("rejects a Router owner mismatch before using the ER", async () => {
    const owner = Keypair.generate().publicKey;
    const plan = keeperPlan("commit_run", {
      owner,
      runId: 1n,
      includeArenaPlayer: false,
    });
    await expect(resolveEphemeralConnectionForPlan({
      plan,
      programId: ZKUBE_PROGRAM_ID,
      fetcher: async () => new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          isDelegated: true,
          fqdn: "https://er.example",
          delegationRecord: {
            authority: owner.toBase58(),
            owner: Keypair.generate().publicKey.toBase58(),
            delegationSlot: 1,
            lamports: 1,
          },
        },
      }), { status: 200 }),
    })).rejects.toThrow("owner");
  });

  it("uses the fresh Router location for a write connection", async () => {
    const owner = Keypair.generate().publicKey;
    const plan = keeperPlan("commit_run", {
      owner,
      runId: 1n,
      includeArenaPlayer: false,
    });
    const connection = { rpcEndpoint: "https://er.example/" } as Connection;
    const resolved = await resolveEphemeralConnectionForPlan({
      plan,
      programId: ZKUBE_PROGRAM_ID,
      fetcher: async () => new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          isDelegated: true,
          fqdn: "https://er.example",
          delegationRecord: {
            authority: owner.toBase58(),
            owner: ZKUBE_PROGRAM_ID.toBase58(),
            delegationSlot: 1,
            lamports: 1,
          },
        },
      }), { status: 200 }),
      connectionFactory: endpoint => { expect(endpoint).toBe("https://er.example/"); return connection; },
    });
    expect(resolved).toBe(connection);
  });
});
