// @vitest-environment node

import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY,
  SystemProgram,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { ZKUBE_PROGRAM_ID, getDelegationRecord } from "./constants";
import {
  VRF_QUEUE,
  buildApplyBonusPlan,
  buildPlayMovePlan,
  decodeActiveRunAccount,
} from "./runPlan";
import { SessionWallet } from "./sessionWallet";

describe("atomic action + VRF plans", () => {
  it("keeps move signer/account positions exact and serializes a deterministic seed", async () => {
    const fixture = setup();
    const seed = new Uint8Array(32).fill(7);
    const first = await buildPlayMovePlan({
      ...fixture,
      expectedAction: 3,
      expectedMove: 2,
      row: 1,
      start: 2,
      destination: 4,
      clientSeed: seed,
    });
    const replay = await buildPlayMovePlan({
      ...fixture,
      expectedAction: 3,
      expectedMove: 2,
      row: 1,
      start: 2,
      destination: 4,
      clientSeed: seed,
    });

    expect(first.transaction.instructions[0]?.data).toEqual(
      replay.transaction.instructions[0]?.data,
    );
    expectVrfAccounts(first.transaction.instructions[0]!.keys, fixture);
  });

  it("gives bonus actions the same scoped VRF boundary", async () => {
    const fixture = setup();
    const plan = await buildApplyBonusPlan({
      ...fixture,
      expectedAction: 9,
      row: 2,
      column: 5,
      clientSeed: new Uint8Array(32).fill(11),
    });

    expectVrfAccounts(plan.transaction.instructions[0]!.keys, fixture);
  });

  it("rejects untrusted ActiveRun owners and malformed account lengths", () => {
    expect(() =>
      decodeActiveRunAccount(new Uint8Array(1), PublicKey.unique()),
    ).toThrow("not owned by the zKube program");
    expect(() =>
      decodeActiveRunAccount(new Uint8Array(1), ZKUBE_PROGRAM_ID),
    ).toThrow("account length is invalid");
  });
});

function setup() {
  const sessionWallet = new SessionWallet(Keypair.generate());
  return {
    owner: PublicKey.unique(),
    sessionWallet,
    sessionToken: PublicKey.unique(),
    activeRun: PublicKey.unique(),
    erConnection: new Connection("http://127.0.0.1:7799", "confirmed"),
  };
}

function expectVrfAccounts(
  keys: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>,
  fixture: ReturnType<typeof setup>,
): void {
  expect(keys).toHaveLength(10);
  expect(keys[0]).toMatchObject({
    pubkey: fixture.activeRun,
    isWritable: true,
  });
  expect(keys[1]?.pubkey.equals(fixture.owner)).toBe(true);
  expect(keys[2]?.pubkey.equals(fixture.sessionToken)).toBe(true);
  expect(keys[3]).toMatchObject({
    pubkey: fixture.sessionWallet.publicKey,
    isSigner: true,
    isWritable: true,
  });
  expect(keys[4]).toMatchObject({ pubkey: VRF_QUEUE, isWritable: true });
  expect(keys[5]?.pubkey.equals(getDelegationRecord(fixture.activeRun))).toBe(
    true,
  );
  const [programIdentity] = PublicKey.findProgramAddressSync(
    [Buffer.from("identity")],
    ZKUBE_PROGRAM_ID,
  );
  expect(keys[6]).toMatchObject({
    pubkey: programIdentity,
    isSigner: false,
    isWritable: false,
  });
  expect(keys[7]).toMatchObject({
    pubkey: new PublicKey("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"),
    isSigner: false,
    isWritable: false,
  });
  expect(keys[8]).toMatchObject({
    pubkey: SYSVAR_SLOT_HASHES_PUBKEY,
    isSigner: false,
    isWritable: false,
  });
  expect(keys[9]).toMatchObject({
    pubkey: SystemProgram.programId,
    isSigner: false,
    isWritable: false,
  });
}
