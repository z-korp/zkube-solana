// @vitest-environment node

import { Keypair, SystemProgram, type Connection } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import {
  buildRegisterUsernamePlan,
  buildRenameUsernamePlan,
  fetchPlayerIdentities,
  normalizeUsername,
  type PlayerIdentityView,
} from "./identityClient";
import {
  derivePlayerIdentityPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
  deriveUsernameClaimPda,
} from "./pdas";
import { SessionWallet } from "./sessionWallet";

describe("public username client", () => {
  it("normalizes only the contract's bounded ASCII namespace", () => {
    expect(normalizeUsername("Wave_Rider7")).toBe("wave_rider7");
    for (const invalid of ["ab", "7waves", "wave-rider", "tiki🐢"]) {
      expect(() => normalizeUsername(invalid)).toThrow();
    }
  });

  it("registers owner-paid identity and uniqueness accounts", async () => {
    const wallet = new SessionWallet(Keypair.generate());
    const connection = availableConnection();
    const plan = await buildRegisterUsernamePlan({
      connection,
      wallet,
      displayName: "Wave_Rider7",
    });
    const instruction = plan.transaction.instructions[0]!;

    expect(plan.feePayer.equals(wallet.publicKey)).toBe(true);
    expect(instruction.keys.map(({ pubkey }) => pubkey.toBase58())).toEqual(
      [
        deriveProtocolConfigPda(),
        derivePlayerStatePda(wallet.publicKey),
        derivePlayerIdentityPda(wallet.publicKey),
        deriveUsernameClaimPda("wave_rider7"),
        wallet.publicKey,
        SystemProgram.programId,
      ].map((key) => key.toBase58()),
    );
    expect(instruction.keys.filter(({ isSigner }) => isSigner)).toEqual([
      expect.objectContaining({ pubkey: wallet.publicKey }),
    ]);
  });

  it("keeps normal and moderated replacements on separate account paths", async () => {
    const wallet = new SessionWallet(Keypair.generate());
    const connection = availableConnection();
    const active = identity(wallet, false);
    const moderated = identity(wallet, true);
    const normal = await buildRenameUsernamePlan({
      connection,
      wallet,
      identity: active,
      displayName: "Ocean_Tiki",
    });
    const replacement = await buildRenameUsernamePlan({
      connection,
      wallet,
      identity: moderated,
      displayName: "Ocean_Tiki",
    });

    expect(normal.transaction.instructions[0]!.keys[3]).toMatchObject({
      pubkey: deriveUsernameClaimPda("wave_rider7"),
      isWritable: true,
    });
    expect(replacement.transaction.instructions[0]!.keys[3]).toMatchObject({
      pubkey: deriveUsernameClaimPda("wave_rider7"),
      isWritable: false,
    });
  });

  it("rejects a claimed or blocked username before owner approval", async () => {
    const wallet = new SessionWallet(Keypair.generate());
    const connection = {
      getAccountInfo: vi.fn().mockResolvedValue({}),
    } as unknown as Connection;
    await expect(
      buildRegisterUsernamePlan({
        connection,
        wallet,
        displayName: "Wave_Rider7",
      }),
    ).rejects.toThrow("already registered or blocked");
  });

  it("rejects invalid optional identity accounts instead of displaying them", async () => {
    const wallet = new SessionWallet(Keypair.generate());
    const connection = {
      getMultipleAccountsInfo: vi.fn().mockResolvedValue([
        {
          owner: SystemProgram.programId,
          executable: false,
          lamports: 1,
          data: Buffer.alloc(95),
          rentEpoch: 0,
        },
      ]),
    } as unknown as Connection;

    await expect(
      fetchPlayerIdentities({
        connection,
        wallet,
        owners: [wallet.publicKey],
      }),
    ).resolves.toEqual([]);
    expect(connection.getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
  });
});

function availableConnection(): Connection {
  return {
    getAccountInfo: vi.fn().mockResolvedValue(null),
  } as unknown as Connection;
}

function identity(
  wallet: SessionWallet,
  moderated: boolean,
): PlayerIdentityView {
  return {
    address: derivePlayerIdentityPda(wallet.publicKey),
    owner: wallet.publicKey,
    displayName: "Wave_Rider7",
    normalizedName: "wave_rider7",
    renameCount: 0,
    registeredAt: 1,
    lastRenamedAt: 1,
    moderated,
    moderationReason: moderated ? 1 : 0,
  };
}
