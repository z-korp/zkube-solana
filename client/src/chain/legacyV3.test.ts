// @vitest-environment node

import { Keypair, SystemProgram, type AccountInfo } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  buildLegacyV3FundingReclaimInstruction,
  LEGACY_ZKUBE_V3_PROGRAM_ID,
  legacyV3PlayerFundingPda,
} from "./legacyV3";

function fundingInfo(
  lamports: number,
  overrides: Partial<AccountInfo<Buffer>> = {},
): AccountInfo<Buffer> {
  return {
    data: Buffer.alloc(0),
    executable: false,
    lamports,
    owner: SystemProgram.programId,
    rentEpoch: 0,
    ...overrides,
  };
}

describe("legacy v3 player-funding reclaim", () => {
  it("builds an exact owner-signed full-balance reclaim", () => {
    const owner = Keypair.generate().publicKey;
    const instruction = buildLegacyV3FundingReclaimInstruction({
      owner,
      fundingInfo: fundingInfo(25_000_000),
    });

    expect(instruction).not.toBeNull();
    expect(instruction?.programId.equals(LEGACY_ZKUBE_V3_PROGRAM_ID)).toBe(true);
    expect(instruction?.keys).toEqual([
      {
        pubkey: legacyV3PlayerFundingPda(owner),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]);
    expect(instruction?.data.subarray(8).readBigUInt64LE()).toBe(25_000_000n);
  });

  it("skips an empty account and rejects untrusted account layouts", () => {
    const owner = Keypair.generate().publicKey;
    expect(
      buildLegacyV3FundingReclaimInstruction({
        owner,
        fundingInfo: fundingInfo(0),
      }),
    ).toBeNull();
    expect(() =>
      buildLegacyV3FundingReclaimInstruction({
        owner,
        fundingInfo: fundingInfo(1, { owner: owner }),
      }),
    ).toThrow("invalid account layout");
    expect(() =>
      buildLegacyV3FundingReclaimInstruction({
        owner,
        fundingInfo: fundingInfo(1, { data: Buffer.alloc(1) }),
      }),
    ).toThrow("invalid account layout");
  });
});
