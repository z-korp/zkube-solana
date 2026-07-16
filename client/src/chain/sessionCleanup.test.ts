// @vitest-environment node

import { createHash } from "node:crypto";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  type AccountInfo,
  type Connection,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import { ZKUBE_PROGRAM_ID } from "./constants";
import {
  buildRevokeExpiredSessionPlan,
  fetchExpiredZkubeSessions,
  REVOKE_SESSION_V2_DISCRIMINATOR,
} from "./sessionCleanup";
import { SessionWallet } from "./sessionWallet";
import {
  deriveSessionTokenV2Pda,
  SESSION_KEYS_PROGRAM_ID,
  SESSION_TOKEN_V2_ACCOUNT_BYTES,
  SESSION_TOKEN_V2_DISCRIMINATOR,
} from "./sessionV2";

describe("expired SessionTokenV2 cleanup", () => {
  it("pins the Session Keys discriminator and exact expired revoke metas", () => {
    const authority = Keypair.generate().publicKey;
    const sessionSigner = Keypair.generate().publicKey;
    const feePayer = Keypair.generate().publicKey;
    const address = deriveSessionTokenV2Pda({
      authority,
      sessionSigner,
    }).sessionToken;
    const connection = {} as Connection;
    const wallet = new SessionWallet(Keypair.generate());
    const plan = buildRevokeExpiredSessionPlan({
      connection,
      wallet,
      nowUnix: 101,
      session: {
        address,
        authority,
        sessionSigner,
        feePayer,
        targetProgram: ZKUBE_PROGRAM_ID,
        validUntil: 100,
      },
    });
    const instruction = plan.transaction.instructions[0]!;
    const expected = [
      ...createHash("sha256")
        .update("global:revoke_session_v2")
        .digest()
        .subarray(0, 8),
    ];
    expect([...REVOKE_SESSION_V2_DISCRIMINATOR]).toEqual(expected);
    expect([...instruction.data]).toEqual(expected);
    expect(instruction.programId.equals(SESSION_KEYS_PROGRAM_ID)).toBe(true);
    expect(instruction.keys).toEqual([
      { pubkey: address, isSigner: false, isWritable: true },
      { pubkey: feePayer, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);
    expect(plan.feePayer.equals(wallet.publicKey)).toBe(true);
  });

  it("discovers only expired zKube sessions with valid system relationships", async () => {
    const authority = Keypair.generate().publicKey;
    const feePayer = Keypair.generate().publicKey;
    const expired = sessionAccount({ authority, feePayer, validUntil: 100 });
    const active = sessionAccount({ authority, feePayer, validUntil: 102 });
    const otherTarget = sessionAccount({
      authority,
      feePayer,
      validUntil: 99,
      targetProgram: Keypair.generate().publicKey,
    });
    const malformed = sessionAccount({ authority, feePayer, validUntil: 98 });
    malformed.account.data[0] ^= 0xff;
    const connection = {
      getProgramAccounts: vi.fn().mockResolvedValue([
        expired,
        active,
        otherTarget,
        malformed,
      ]),
      getMultipleAccountsInfo: vi.fn().mockImplementation(
        async (addresses: PublicKey[]) =>
          addresses.map(() => systemAccount()),
      ),
    } as unknown as Connection;

    const candidates = await fetchExpiredZkubeSessions({
      connection,
      nowUnix: 101,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.address.equals(expired.pubkey)).toBe(true);
    expect(connection.getProgramAccounts).toHaveBeenCalledWith(
      SESSION_KEYS_PROGRAM_ID,
      expect.objectContaining({
        filters: [{ dataSize: SESSION_TOKEN_V2_ACCOUNT_BYTES }],
      }),
    );
  });

  it("refuses active, cross-program, and malformed candidates", () => {
    const authority = Keypair.generate().publicKey;
    const sessionSigner = Keypair.generate().publicKey;
    const address = deriveSessionTokenV2Pda({
      authority,
      sessionSigner,
    }).sessionToken;
    const common = {
      connection: {} as Connection,
      wallet: new SessionWallet(Keypair.generate()),
      nowUnix: 100,
      session: {
        address,
        authority,
        sessionSigner,
        feePayer: Keypair.generate().publicKey,
        targetProgram: ZKUBE_PROGRAM_ID,
        validUntil: 101,
      },
    };
    expect(() => buildRevokeExpiredSessionPlan(common)).toThrow("still active");
    expect(() =>
      buildRevokeExpiredSessionPlan({
        ...common,
        session: {
          ...common.session,
          validUntil: 99,
          targetProgram: Keypair.generate().publicKey,
        },
      }),
    ).toThrow("different program");
    expect(() =>
      buildRevokeExpiredSessionPlan({
        ...common,
        session: {
          ...common.session,
          validUntil: 99,
          address: Keypair.generate().publicKey,
        },
      }),
    ).toThrow("does not match");
  });
});

function sessionAccount(args: {
  authority: PublicKey;
  feePayer: PublicKey;
  validUntil: number;
  targetProgram?: PublicKey;
}) {
  const sessionSigner = Keypair.generate().publicKey;
  const targetProgram = args.targetProgram ?? ZKUBE_PROGRAM_ID;
  const pubkey = deriveSessionTokenV2Pda({
    authority: args.authority,
    sessionSigner,
    targetProgram,
  }).sessionToken;
  const data = Buffer.alloc(SESSION_TOKEN_V2_ACCOUNT_BYTES);
  Buffer.from(SESSION_TOKEN_V2_DISCRIMINATOR).copy(data, 0);
  args.authority.toBuffer().copy(data, 8);
  targetProgram.toBuffer().copy(data, 40);
  sessionSigner.toBuffer().copy(data, 72);
  args.feePayer.toBuffer().copy(data, 104);
  data.writeBigInt64LE(BigInt(args.validUntil), 136);
  return {
    pubkey,
    account: {
      executable: false,
      owner: SESSION_KEYS_PROGRAM_ID,
      lamports: 1_893_120,
      rentEpoch: 0,
      data,
    } satisfies AccountInfo<Buffer>,
  };
}

function systemAccount(): AccountInfo<Buffer> {
  return {
    executable: false,
    owner: SystemProgram.programId,
    lamports: 1,
    rentEpoch: 0,
    data: Buffer.alloc(0),
  };
}
