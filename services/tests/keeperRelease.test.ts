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
      schemaVersion: 8,
      programId: input.programId,
      keeper: input.keeperPublicKey,
      entryLamports: "10000000",
      entrySplitLamports: {
        followingDaily: "6000000",
        followingWeekly: "2000000",
        followingSeason: "1000000",
        operator: "1000000",
      },
      payoutUnitLamports: "1000000",
      replayVersion: 2,
      maximumWritesPerPass: 8,
      maximumExpiredSessionClosuresPerPass: 2,
      maximumParticipantClosuresPerPass: 2,
      recentCadenceWindow: { dailies: 84, weeklies: 12, seasons: 3 },
      maximumSpendLamportsPerPass: 100_000_000,
      reserveFloorLamports: 100_000_000,
    });
    expect(KEEPER_RELEASE_POLICY.allowlist).toContain("finalize_season");
    expect(KEEPER_RELEASE_POLICY.allowlist).toContain("sync_daily_profile");
    expect(KEEPER_RELEASE_POLICY.allowlist).toContain("sync_weekly_profile");
    expect(KEEPER_RELEASE_POLICY.allowlist).toContain("sync_season_profile");
    expect(KEEPER_RELEASE_POLICY.allowlist).toContain("close_arena_player");
    expect(KEEPER_RELEASE_POLICY.allowlist).toContain("close_season_player");
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
  const programId = Keypair.generate().publicKey;
  return {
    programId: programId.toBase58(),
    keeperPublicKey: Keypair.generate().publicKey.toBase58(),
    deployedProgramDataSha256: "ab".repeat(32),
    keeperImageReference:
      "registry.fly.io/zkube-solana-devnet-keeper:deployment-01KY50T1AP5RKZ5K5ET0F50W9X",
    replayDomainHex: canonicalDevnetReplayDomainHex(programId),
    rulesCatalogHash: "02".repeat(32),
    idlHash: KEEPER_EXPECTED_IDL_SHA256,
    rulesVersion: 1,
    launchDayId: 20_656,
  };
}
