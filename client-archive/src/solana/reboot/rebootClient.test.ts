// @vitest-environment node

import { createHash } from "node:crypto";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { ZKUBE_PROGRAM_ID } from "../constants";
import { deriveRunAddresses } from "./pdas";
import { getDelegationStatus, MAGICBLOCK_DEVNET_ROUTER_RPC } from "./router";
import { buildCommitRunPlan } from "./runPlan";
import { buildCommitDailyRunPlan } from "./dailyClient";
import { SessionWallet } from "./sessionWallet";
import {
  buildCreateSessionV2Instruction,
  CREATE_SESSION_V2_DISCRIMINATOR,
  deriveSessionTokenV2Pda,
  SESSION_KEYS_PROGRAM_ID,
} from "./sessionV2";

describe("reboot client invariants", () => {
  it("derives distinct shell, active, and receipt addresses for each run", () => {
    const owner = Keypair.generate().publicKey;
    const first = deriveRunAddresses(owner, 1n);
    const second = deriveRunAddresses(owner, 2n);
    expect(
      new Set(Object.values(first).map((key) => key.toBase58())).size,
    ).toBe(3);
    expect(first.activeRun.equals(second.activeRun)).toBe(false);
  });

  it("pins the session-keys 3.1.1 V2 discriminator and account order", () => {
    const expected = [
      ...createHash("sha256")
        .update("global:create_session_v2")
        .digest()
        .subarray(0, 8),
    ];
    expect([...CREATE_SESSION_V2_DISCRIMINATOR]).toEqual(expected);

    const authority = new PublicKey("11111111111111111111111111111112");
    const signer = new PublicKey("11111111111111111111111111111113");
    const { sessionToken } = deriveSessionTokenV2Pda({
      authority,
      sessionSigner: signer,
    });
    const instruction = buildCreateSessionV2Instruction({
      authority,
      sessionSigner: signer,
      feePayer: authority,
      topUp: false,
      validUntil: 1_800_000_000,
    });
    expect(instruction.programId.equals(SESSION_KEYS_PROGRAM_ID)).toBe(true);
    expect([...instruction.data.subarray(0, 8)]).toEqual(expected);
    expect(instruction.keys).toEqual([
      { pubkey: sessionToken, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: ZKUBE_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);
  });

  it("keeps base-only Magic Action targets read-only on the ER", async () => {
    const owner = Keypair.generate();
    const wallet = new SessionWallet(owner);
    const connection = new Connection(
      "https://devnet-eu.magicblock.app",
      "confirmed",
    );
    const addresses = deriveRunAddresses(owner.publicKey, 1n);
    const campaign = await buildCommitRunPlan({
      owner: owner.publicKey,
      payerWallet: wallet,
      addresses,
      erConnection: connection,
    });
    const campaignKeys = campaign.transaction.instructions[0].keys;
    expect(campaignKeys[0]).toMatchObject({ isSigner: true, isWritable: true });
    expect(campaignKeys[1].isWritable).toBe(true);
    expect(campaignKeys.slice(2, 7).every((key) => !key.isWritable)).toBe(true);
    expect(campaignKeys[7].isWritable).toBe(true);

    const daily = await buildCommitDailyRunPlan({
      owner: owner.publicKey,
      payerWallet: wallet,
      addresses,
      dailyChallenge: Keypair.generate().publicKey,
      erConnection: connection,
    });
    const dailyKeys = daily.transaction.instructions[0].keys;
    expect(dailyKeys[0]).toMatchObject({ isSigner: true, isWritable: true });
    expect(dailyKeys[1].isWritable).toBe(true);
    expect(dailyKeys.slice(2, 9).every((key) => !key.isWritable)).toBe(true);
    expect(dailyKeys[9].isWritable).toBe(true);
  });

  it("parses and normalizes router delegation status", async () => {
    const account = Keypair.generate().publicKey;
    const validator = Keypair.generate().publicKey;
    const status = await getDelegationStatus(
      account,
      MAGICBLOCK_DEVNET_ROUTER_RPC,
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              isDelegated: true,
              fqdn: "https://validator.example",
              delegationRecord: {
                authority: validator.toBase58(),
                owner: ZKUBE_PROGRAM_ID.toBase58(),
                delegationSlot: 42,
                lamports: 1_000_000,
              },
            },
          }),
          { status: 200 },
        ),
    );
    expect(status.isDelegated).toBe(true);
    expect(status.fqdn).toBe("https://validator.example/");
    expect(status.delegationRecord?.authority).toBe(validator.toBase58());
  });
});
