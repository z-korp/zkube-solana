// @vitest-environment node
import { describe, expect, it } from "vitest";

import { keeperReleaseRecord, KEEPER_RELEASE_POLICY } from "../src/keeperRelease";

describe("keeper release binding", () => {
  it("is deterministic and includes every recurring bound", () => {
    const hash = "ab".repeat(32);
    const image = `sha256:${"cd".repeat(32)}`;
    const first = keeperReleaseRecord(hash, image, 1);
    expect(keeperReleaseRecord(hash, image, 1)).toEqual(first);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.record).toMatchObject({
      maximumWritesPerPass: 8,
      maximumExpiredSessionClosuresPerPass: 2,
      maximumSpendLamportsPerPass: 50_000_000,
      reserveFloorLamports: 100_000_000,
    });
    expect(KEEPER_RELEASE_POLICY.denied).toContain("refund_stuck_arena_entry");
  });

  it("rejects an unverified fingerprint placeholder", () => {
    expect(() => keeperReleaseRecord("UNDEPLOYED_V4", `sha256:${"cd".repeat(32)}`, 1)).toThrow("ProgramData");
  });
});
