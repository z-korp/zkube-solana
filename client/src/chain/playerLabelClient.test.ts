// @vitest-environment node

import { Keypair, SystemProgram, type Connection } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import {
  buildFundedCreatePlayerLabelPlan,
  buildSetPlayerLabelPlan,
  fetchPlayerLabels,
  validatePlayerLabel,
} from "./playerLabelClient";
import {
  derivePlayerFundingPda,
  derivePlayerLabelPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
} from "./pdas";
import { SessionWallet } from "./sessionWallet";
import { ZKUBE_PROGRAM_ID } from "./constants";

describe("cosmetic player label client", () => {
  it("validates the contract's case-preserving ASCII label", () => {
    expect(validatePlayerLabel("Wave_Rider7")).toBe("Wave_Rider7");
    for (const invalid of ["ab", "7waves", "wave-rider", "tiki🐢"]) {
      expect(() => validatePlayerLabel(invalid)).toThrow();
    }
  });

  it("creates one owner-keyed label through the session funding wrapper", async () => {
    const owner = Keypair.generate().publicKey;
    const wallet = new SessionWallet(Keypair.generate());
    const sessionToken = Keypair.generate().publicKey;
    const plan = await buildFundedCreatePlayerLabelPlan({
      connection: {} as Connection,
      wallet,
      ownerAuthority: owner,
      sessionToken,
      displayName: "Wave_Rider7",
    });
    const instruction = plan.transaction.instructions[0]!;

    expect(plan.feePayer.equals(wallet.publicKey)).toBe(true);
    expect(instruction.keys.map(({ pubkey }) => pubkey.toBase58())).toEqual(
      [
        deriveProtocolConfigPda(),
        derivePlayerStatePda(owner),
        derivePlayerLabelPda(owner),
        derivePlayerFundingPda(owner),
        owner,
        sessionToken,
        wallet.publicKey,
        SystemProgram.programId,
        ZKUBE_PROGRAM_ID,
      ].map((key) => key.toBase58()),
    );
    expect(instruction.keys.filter(({ isSigner }) => isSigner)).toEqual([
      expect.objectContaining({ pubkey: wallet.publicKey }),
    ]);
  });

  it("updates the same label without a payer, claim, cooldown, or Star account", async () => {
    const owner = Keypair.generate().publicKey;
    const wallet = new SessionWallet(Keypair.generate());
    const sessionToken = Keypair.generate().publicKey;
    const plan = await buildSetPlayerLabelPlan({
      connection: {} as Connection,
      wallet,
      ownerAuthority: owner,
      sessionToken,
      displayName: "Ocean_Tiki",
    });
    const keys = plan.transaction.instructions[0]!.keys;

    expect(keys.map(({ pubkey }) => pubkey.toBase58())).toEqual(
      [
        deriveProtocolConfigPda(),
        derivePlayerStatePda(owner),
        derivePlayerLabelPda(owner),
        owner,
        sessionToken,
        wallet.publicKey,
      ].map((key) => key.toBase58()),
    );
    expect(keys.filter(({ isSigner }) => isSigner)).toEqual([
      expect.objectContaining({ pubkey: wallet.publicKey }),
    ]);
  });

  it("ignores invalid optional label data instead of weakening wallet identity", async () => {
    const wallet = new SessionWallet(Keypair.generate());
    const connection = {
      rpcEndpoint: "https://example.invalid",
      getMultipleAccountsInfo: vi.fn().mockResolvedValue([
        {
          owner: SystemProgram.programId,
          executable: false,
          lamports: 1,
          data: Buffer.alloc(59),
          rentEpoch: 0,
        },
      ]),
    } as unknown as Connection;

    await expect(
      fetchPlayerLabels({
        connection,
        wallet,
        owners: [wallet.publicKey],
      }),
    ).resolves.toEqual([]);
  });
});
