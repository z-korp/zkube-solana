// @vitest-environment node
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { KEEPER_EXPECTED_IDL_SHA256 } from "../src/anchorIdlAdapter";
import {
  KEEPER_INSTRUCTION_ALLOWLIST,
  KEEPER_PLAN_INSTRUCTION,
} from "../src/arcadeChain";
import {
  KEEPER_RELEASE_POLICY,
  keeperReleaseRecord,
} from "../src/keeperRelease";

const EXACT_ALLOWLIST = [
  "funded_prepare_arena_daily",
  "activate_arena_daily",
  "skip_suspended_arena_daily",
  "funded_finalize_arena_daily",
  "submit_arena_board_chunk",
  "archive_arena_daily",
  "expire_daily_claims",
  "close_arena_daily",
  "finish_run",
  "commit_run",
  "consume_arena_run",
  "expire_unresolved_arena_run",
  "cleanup_orphan_active_run",
] as const;

describe("keeper release binding", () => {
  it("binds every runtime-verified release field", () => {
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
      replayVersion: 2,
      maximumWritesPerPass: 6,
      maximumBoardWritesPerPass: 32,
      maximumBoardRentLamportsPerPass: 1_802_208_480,
      recentCadenceWindow: { dailies: 84 },
      maximumSpendLamportsPerPass: 100_000_000,
      reserveFloorLamports: 100_000_000,
      keeperImageReference: input.keeperImageReference,
      idlHash: KEEPER_EXPECTED_IDL_SHA256,
    });
    expect(first.record).not.toHaveProperty("denied");
    expect(first.record).not.toHaveProperty("materializedInstructionAllowlist");
    expect(first.record).not.toHaveProperty("replayDomainHex");
    expect(first.record).not.toHaveProperty("keeperImageDigest");
  });

  it("keeper_allowlist_is_exactly_its_plans", () => {
    expect(KEEPER_RELEASE_POLICY.allowlist).toEqual(EXACT_ALLOWLIST);
    expect(KEEPER_INSTRUCTION_ALLOWLIST).toEqual(EXACT_ALLOWLIST);
    expect(Object.keys(KEEPER_PLAN_INSTRUCTION)).toHaveLength(13);
    expect(new Set(Object.values(KEEPER_PLAN_INSTRUCTION)))
      .toEqual(new Set(EXACT_ALLOWLIST));
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
    keeperImageReference:
      "registry.fly.io/zkube-solana-devnet-keeper:deployment-01KY50T1AP5RKZ5K5ET0F50W9X",
    idlHash: KEEPER_EXPECTED_IDL_SHA256,
    launchDayId: 20_656,
  };
}
