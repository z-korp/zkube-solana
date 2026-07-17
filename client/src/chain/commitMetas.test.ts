// @vitest-environment node

import { createHash } from "node:crypto";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { ZKUBE_PROGRAM_ID } from "./constants";
import { deriveRunAddresses } from "./pdas";
import { buildCommitRunPlan } from "./runPlan";
import { buildCommitDailyRunPlan } from "./dailyClient";
import { SessionWallet } from "./sessionWallet";
import {
  buildCreateSessionV2Instruction,
  CREATE_SESSION_V2_DISCRIMINATOR,
  deriveSessionTokenV2Pda,
  SESSION_KEYS_PROGRAM_ID,
} from "./sessionV2";

describe("commit meta invariants", () => {
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

  it("commits only ActiveRun through the ER boundary", async () => {
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
    expect(campaignKeys).toHaveLength(4);
    expect(campaignKeys[2].isWritable).toBe(true);
    expect(campaignKeys[3].isWritable).toBe(false);

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
    expect(dailyKeys).toHaveLength(4);
    expect(dailyKeys[2].isWritable).toBe(true);
    expect(dailyKeys[3].isWritable).toBe(false);
  });
});
