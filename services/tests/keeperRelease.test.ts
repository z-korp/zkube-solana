// @vitest-environment node
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  canonicalDevnetReplayDomainHex,
  keeperReleaseRecord,
  KEEPER_RELEASE_POLICY,
} from "../src/keeperRelease";
import { KEEPER_EXPECTED_IDL_SHA256 } from "../src/anchorIdlAdapter";

describe("keeper release binding", () => {
  it("binds the native-SOL economy, ABI, replay, image, program, and signer", () => {
    const input = releaseInput();
    const first = keeperReleaseRecord(input);
    expect(keeperReleaseRecord(input)).toEqual(first);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.record).toMatchObject({
      schemaVersion: 1,
      programId: input.programId,
      keeper: input.keeperPublicKey,
      entryLamports: "10000000",
      entrySplitLamports: {
        followingDaily: "9000000",
        operator: "1000000",
      },
      payoutUnitLamports: "1000000",
      arenaBoardCapacity: 1_536,
      maximumCadenceResultBytes: 300_000,
      replayVersion: 2,
      maximumWritesPerPass: 6,
      maximumExpiredSessionClosuresPerPass: 2,
      maximumParticipantClosuresPerPass: 1,
      recentCadenceWindow: { dailies: 84 },
      maximumSpendLamportsPerPass: 100_000_000,
      reserveFloorLamports: 100_000_000,
      archiveContractVersion: 1,
      maximumBoardWritesPerPass: 32,
      maximumBoardRentLamportsPerPass: 1_804_936_800,
      keeperImageReference: input.keeperImageReference,
      keeperImageDigest: input.keeperImageDigest,
    });
    expect(KEEPER_RELEASE_POLICY.allowlist).toContain("finalize_arena_daily");
    expect(KEEPER_RELEASE_POLICY.allowlist).toContain("skip_suspended_arena_daily");
    expect(KEEPER_RELEASE_POLICY.allowlist).toContain("expire_daily_claims");
    expect(KEEPER_RELEASE_POLICY.allowlist).toContain("sync_daily_profile");
    expect(KEEPER_RELEASE_POLICY.allowlist).toContain("close_arena_player");
    expect(KEEPER_RELEASE_POLICY.allowlist).not.toContain("finalize_season");
    expect(KEEPER_RELEASE_POLICY.allowlist).not.toContain("consume_practice_run");
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
    expect(() => keeperReleaseRecord({
      ...releaseInput(),
      keeperImageDigest: "cd".repeat(32),
    })).toThrow("sha256");
  });

  it("fingerprints an optional release-time digest without treating it as runtime proof", () => {
    const input = releaseInput();
    const withDigest = keeperReleaseRecord(input);
    const withoutDigest = keeperReleaseRecord({
      ...input,
      keeperImageDigest: undefined,
    });
    expect(withoutDigest.record).not.toHaveProperty("keeperImageDigest");
    expect(withoutDigest.record.keeperImageReference).toBe(input.keeperImageReference);
    expect(withoutDigest.fingerprint).not.toBe(withDigest.fingerprint);
    expect(keeperReleaseRecord({
      ...input,
      keeperImageDigest: `sha256:${"ef".repeat(32)}`,
    }).fingerprint).not.toBe(withDigest.fingerprint);
  });
});

function releaseInput() {
  const programId = Keypair.generate().publicKey;
  return {
    programId: programId.toBase58(),
    keeperPublicKey: Keypair.generate().publicKey.toBase58(),
    deployedProgramDataSha256: "ab".repeat(32),
    keeperImageReference:
      "registry.fly.io/zkube-solana-devnet-keeper:deployment-01KY50T1AP5RKZ5K5ET0F50W9X",
    keeperImageDigest: `sha256:${"cd".repeat(32)}`,
    replayDomainHex: canonicalDevnetReplayDomainHex(programId),
    idlHash: KEEPER_EXPECTED_IDL_SHA256,
    launchDayId: 20_656,
  };
}
