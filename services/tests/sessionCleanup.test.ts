// @vitest-environment node
import { Keypair, SystemProgram, type AccountInfo, type PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { ZKUBE_PROGRAM_ID } from "../src/arcadeChain";
import { assertKeeperPlanPolicy } from "../src/keeperPolicy";
import { materializeKeeperPlan } from "../src/planMaterializer";
import {
  REVOKE_SESSION_V2_DISCRIMINATOR,
  deriveSessionPda,
  discoverExpiredSessionPlans,
  SESSION_KEYS_PROGRAM_ID,
} from "../src/sessionCleanup";

describe("keeper expired-session cleanup", () => {
  it("keeps only two oldest owner-funded zKube sessions", async () => {
    const owner = Keypair.generate().publicKey;
    const sessions = [30, 10, 20].map((validUntil) => sessionFixture(owner, validUntil));
    const connection = {
      getProgramAccounts: async () => sessions,
      getMultipleAccountsInfo: async () => [systemAccount()],
    } as never;
    const keeper = Keypair.generate().publicKey;
    const plans = await discoverExpiredSessionPlans({
      connection,
      keeper,
      targetProgramId: ZKUBE_PROGRAM_ID,
      nowUnix: 100,
    });
    expect(plans).toHaveLength(2);
    for (const plan of plans) {
      expect(() => assertKeeperPlanPolicy({
        plan,
        keeper,
        programId: ZKUBE_PROGRAM_ID,
        connection,
        nowUnix: 100,
      })).not.toThrow();
    }
    const materialized = await materializeKeeperPlan(plans[0]!, {
      programId: ZKUBE_PROGRAM_ID,
      keeper,
      protocol: {
        materialize: async () => {
          throw new Error("session cleanup must not invoke the zKube materializer");
        },
      },
    });
    expect(materialized.instruction!.programId.equals(SESSION_KEYS_PROGRAM_ID)).toBe(true);
    expect(materialized.instruction!.data).toEqual(REVOKE_SESSION_V2_DISCRIMINATOR);
    expect(materialized.instruction!.keys).toEqual([
      { pubkey: plans[0]!.context!.sessionAddress, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);
  });
});

function sessionFixture(owner: PublicKey, validUntil: number) {
  const sessionSigner = Keypair.generate().publicKey;
  const pubkey = deriveSessionPda(ZKUBE_PROGRAM_ID, owner, sessionSigner);
  const data = Buffer.alloc(144);
  Buffer.from([178, 3, 85, 254, 13, 116, 128, 41]).copy(data);
  owner.toBuffer().copy(data, 8);
  ZKUBE_PROGRAM_ID.toBuffer().copy(data, 40);
  sessionSigner.toBuffer().copy(data, 72);
  owner.toBuffer().copy(data, 104);
  data.writeBigInt64LE(BigInt(validUntil), 136);
  return { pubkey, account: { ...systemAccount(), owner: SESSION_KEYS_PROGRAM_ID, data } };
}

function systemAccount(): AccountInfo<Buffer> {
  return { data: Buffer.alloc(0), executable: false, lamports: 1, owner: SystemProgram.programId, rentEpoch: 0 };
}
