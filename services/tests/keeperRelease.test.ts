// @vitest-environment node
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { keeperReleaseRecord, KEEPER_RELEASE_POLICY } from "../src/keeperRelease";
import { KEEPER_EXPECTED_IDL_SHA256 } from "../src/anchorIdlAdapter";

describe("keeper release binding", () => {
  it("binds the native-SOL economy, ABI, replay, image, program, and signer", () => {
    const input = releaseInput();
    const first = keeperReleaseRecord(input);
    expect(keeperReleaseRecord(input)).toEqual(first);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.record).toMatchObject({
      schemaVersion: 3,
      programId: input.programId,
      keeper: input.keeperPublicKey,
      entryLamports: "20000000",
      entrySplitLamports: {
        followingDaily: "12000000",
        followingWeekly: "4000000",
        followingSeason: "2000000",
        operator: "2000000",
      },
      payoutUnitLamports: "1000000",
      replayVersion: 2,
      maximumWritesPerPass: 8,
      maximumExpiredSessionClosuresPerPass: 2,
      recentCadenceWindow: { dailies: 84, weeklies: 12, seasons: 3 },
      maximumSpendLamportsPerPass: 50_000_000,
      reserveFloorLamports: 100_000_000,
    });
    expect(KEEPER_RELEASE_POLICY.allowlist).toContain("finalize_season");
    expect(KEEPER_RELEASE_POLICY.denied).toContain("incident_or_refund");
  });

  it("rejects placeholders and malformed release inputs", () => {
    expect(() => keeperReleaseRecord({
      ...releaseInput(),
      deployedProgramDataSha256: "UNDEPLOYED_V4",
    })).toThrow("ProgramData");
    expect(() => keeperReleaseRecord({
      ...releaseInput(),
      programId: "not-a-program",
    })).toThrow("program ID");
    expect(() => keeperReleaseRecord({
      ...releaseInput(),
      idlHash: "04".repeat(32),
    })).toThrow("materializer");
  });
});

function releaseInput() {
  return {
    programId: Keypair.generate().publicKey.toBase58(),
    keeperPublicKey: Keypair.generate().publicKey.toBase58(),
    deployedProgramDataSha256: "ab".repeat(32),
    keeperImageDigest: `sha256:${"cd".repeat(32)}`,
    replayDomainHex: "01".repeat(32),
    rulesHash: "02".repeat(32),
    schemaHash: "03".repeat(32),
    idlHash: KEEPER_EXPECTED_IDL_SHA256,
    rulesVersion: 1,
  };
}
