// @vitest-environment node
import { createHash } from "node:crypto";

import { Keypair, type AccountInfo, type PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  PROTOCOL_ACCOUNT_VERSION,
  ZKUBE_PROGRAM_ID,
  validationOnlyPlan,
} from "../src/arcadeChain";
import {
  getDelegationStatus,
  resolveEphemeralConnectionForPlan,
} from "../src/router";

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
    const plan = validationOnlyPlan("commit_run", {
      owner,
      runId: 1n,
      runMode: "campaign",
      runLocation: "ephemeral_rollup",
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

  it("checks owner, discriminator, version, and bounded length on the ER", async () => {
    const owner = Keypair.generate().publicKey;
    const plan = validationOnlyPlan("commit_run", {
      owner,
      runId: 1n,
      runMode: "campaign",
      runLocation: "ephemeral_rollup",
      includeArenaPlayer: false,
    });
    const data = Buffer.alloc(128);
    createHash("sha256").update("account:ActiveRun").digest().subarray(0, 8).copy(data);
    data[8] = PROTOCOL_ACCOUNT_VERSION;
    const account = fixture(ZKUBE_PROGRAM_ID, data);
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
      connectionFactory: () => ({ getAccountInfo: async () => account }) as never,
    });
    expect(resolved).toBeTruthy();
  });
});

function fixture(owner: PublicKey, data: Buffer): AccountInfo<Buffer> {
  return { owner, data, executable: false, lamports: 1, rentEpoch: 0 };
}
