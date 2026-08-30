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
  ACTIVE_RUN_FIELD_PROJECTIONS,
  VRF_QUEUE,
  buildApplyBonusPlan,
  buildPlayMovePlan,
  buildRequestRerollPlan,
  decodeActiveRunAccount,
} from "@/backend/solana/runs/runPlan";
import { IDL } from "../backend/solana/idl";
import { SessionWallet } from "../backend/solana/session/sessionWallet";

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

  it("builds reroll as its own action with the same scoped VRF boundary", async () => {
    const fixture = setup();
    const plan = await buildRequestRerollPlan({
      ...fixture,
      expectedAction: 9,
      clientSeed: new Uint8Array(32).fill(12),
    });

    expectVrfAccounts(plan.transaction.instructions[0]!.keys, fixture);
    const bonus = await buildApplyBonusPlan({
      ...fixture,
      expectedAction: 9,
      row: 0,
      column: 0,
      clientSeed: new Uint8Array(32).fill(12),
    });
    expect(plan.transaction.instructions[0]!.data).not.toEqual(
      bonus.transaction.instructions[0]!.data,
    );
  });

  it("rejects untrusted ActiveRun owners and malformed account lengths", () => {
    expect(() =>
      decodeActiveRunAccount(new Uint8Array(1), PublicKey.unique()),
    ).toThrow("not owned by the zKube program");
    expect(() =>
      decodeActiveRunAccount(new Uint8Array(1), ZKUBE_PROGRAM_ID),
    ).toThrow("account length is invalid");
  });

  it("rejects a pre-v3 ActiveRun fixture with the obsolete layout", () => {
    const serialized = Buffer.from(
      "EtVxKSwB9+kBe00aMMUkeud+8+ntXv5Bg81ujcY+PNRdthKPhrvAXf2PwsR11biNzPVMxuEJ536kRvCLbI/KC5Coe/ruwz86mQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAEAAACT8B6BIBMxJNQwF3/+ljzJNEi/JPlszCmQTRNeM8cUewEBAQoAAAAQAAAAAAAAAAABAgAPAB4AHgAPAAoAZABkAAAAAAB+AwEDAAEEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAEgAAAB4AAAAqAAAANgAAAEIAAABOAAAAZABuAH0AjACgALQA0gD6ABkAHgAZAA8ABQAWABwAGQASAAcAFAAZABkAFAAKABIAFgAYABYADgAQABQAFgAYABIADgASABQAGgAWAAwAEAASABwAGgAKAA4AEAAeAB4ABGQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAQEEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP4=",
      "base64",
    );
    const bytes = Buffer.concat([serialized, Buffer.alloc(4)]);
    expect(() => decodeActiveRunAccount(bytes, ZKUBE_PROGRAM_ID)).toThrow(
      "account length is invalid",
    );
  });

  it("active_run_view_projects_every_field", () => {
    const activeRunType = IDL.types.find(({ name }) => name === "ActiveRun");
    if (!activeRunType || activeRunType.type.kind !== "struct") {
      throw new Error("ActiveRun IDL type is missing");
    }
    const camelCase = (value: string) =>
      value.replace(/_([a-z])/g, (_match, letter: string) =>
        letter.toUpperCase(),
      );
    expect(
      activeRunType.type.fields.map(({ name }) => camelCase(name)).sort(),
    ).toEqual(Object.keys(ACTIVE_RUN_FIELD_PROJECTIONS).sort());
    expect(ACTIVE_RUN_FIELD_PROJECTIONS.grid).toBe("runToken");
    expect(ACTIVE_RUN_FIELD_PROJECTIONS.score).toBe("runToken");
    expect(ACTIVE_RUN_FIELD_PROJECTIONS.replayHash).toBe("runToken");
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
