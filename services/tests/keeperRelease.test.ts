// @vitest-environment node
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  KEEPER_INSTRUCTION_ALLOWLIST,
  KEEPER_PLAN_INSTRUCTION,
} from "../src/arcadeChain.js";
import {
  keeperReleaseRecord,
} from "../src/keeperRelease.js";

const EXACT_ALLOWLIST = [
  "prepare_arena_daily",
  "activate_arena_daily",
  "skip_suspended_arena_daily",
  "finalize_arena_daily",
  "submit_arena_board_chunk",
  "archive_arena_daily",
  "expire_daily_claims",
  "close_arena_daily",
  "close_arena_player",
  "finish_run",
  "commit_run",
  "consume_arena_run",
  "expire_unresolved_arena_run",
] as const;

describe("keeper release binding", () => {
  it("binds the image, keeper key and launch day while reporting build identity", () => {
    const input = releaseInput();
    const first = keeperReleaseRecord(input);
    expect(keeperReleaseRecord(input)).toEqual(first);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.record.keeper).toBe(input.keeperPublicKey);
    expect(first.record.idlHash).toMatch(/^[0-9a-f]{64}$/);
    for (const changed of [
      { ...input, keeperPublicKey: Keypair.generate().publicKey.toBase58() },
      { ...input, launchDayId: input.launchDayId + 1 },
      { ...input, keeperImageReference: input.keeperImageReference.slice(0, -1) + "Y" },
    ]) expect(keeperReleaseRecord(changed).fingerprint).not.toBe(first.fingerprint);
  });

  it("keeper_allowlist_is_exactly_its_plans", () => {
    expect(KEEPER_INSTRUCTION_ALLOWLIST).toEqual(EXACT_ALLOWLIST);
    expect(Object.keys(KEEPER_PLAN_INSTRUCTION)).toHaveLength(13);
    expect(new Set(Object.values(KEEPER_PLAN_INSTRUCTION).map(({ instruction }) => instruction)))
      .toEqual(new Set(EXACT_ALLOWLIST));
  });

  it("rejects mutable images and malformed release inputs", () => {
    expect(() => keeperReleaseRecord({ ...releaseInput(), keeperImageReference: "latest" })).toThrow("Fly deployment");
    expect(() => keeperReleaseRecord({ ...releaseInput(), keeperPublicKey: "invalid" })).toThrow();
    for (const launchDayId of [-1, 0x100000000, 4.5]) {
      expect(() => keeperReleaseRecord({ ...releaseInput(), launchDayId })).toThrow("u32 day");
    }
  });
});

function releaseInput() {
  return {
    keeperPublicKey: Keypair.generate().publicKey.toBase58(),
    keeperImageReference:
      "registry.fly.io/zkube-solana-devnet-keeper:deployment-01KY50T1AP5RKZ5K5ET0F50W9X",
    launchDayId: 20_656,
  };
}
