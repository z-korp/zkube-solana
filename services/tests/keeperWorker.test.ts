// @vitest-environment node

import { Keypair } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import {
  keeperReleaseFromEnv,
  keeperIntervalFromEnv,
  keeperWriteEnabledFromEnv,
  runKeeperWorker,
} from "../src/keeperWorker";
import { canonicalDevnetReplayDomainHex } from "../src/keeperRelease";
import { ZKUBE_PROGRAM_ID } from "../src/arcadeChain";

describe("keeper worker scheduling", () => {
  it("defaults to a one-minute normal cadence", () => {
    expect(keeperIntervalFromEnv({})).toBe(60_000);
  });

  it("keeps writes fail-closed unless explicitly enabled", () => {
    expect(keeperWriteEnabledFromEnv({})).toBe(false);
    expect(keeperWriteEnabledFromEnv({ KEEPER_WRITE_ENABLED: "false" })).toBe(
      false,
    );
    expect(keeperWriteEnabledFromEnv({ KEEPER_WRITE_ENABLED: "TRUE" })).toBe(
      false,
    );
    expect(keeperWriteEnabledFromEnv({ KEEPER_WRITE_ENABLED: "true" })).toBe(
      false,
    );
    expect(keeperWriteEnabledFromEnv({
      KEEPER_WRITE_ENABLED: "true",
      KEEPER_APPROVED_RELEASE_FINGERPRINT: "wrong-release",
    })).toBe(false);
    const releaseEnv = releaseEnvironment();
    const release = keeperReleaseFromEnv(releaseEnv);
    expect(keeperWriteEnabledFromEnv({
      ...releaseEnv,
      KEEPER_WRITE_ENABLED: "true",
      KEEPER_APPROVED_RELEASE_FINGERPRINT: release.fingerprint,
    })).toBe(true);
    expect(keeperWriteEnabledFromEnv({
      ...releaseEnv,
      FLY_IMAGE_REF: "registry.fly.io/zkube:mutable",
      KEEPER_WRITE_ENABLED: "true",
      KEEPER_APPROVED_RELEASE_FINGERPRINT: release.fingerprint,
    })).toBe(false);
  });

  it("stays inert while disabled without loading either signer", async () => {
    const controller = new AbortController();
    const log = vi.fn();
    await runKeeperWorker({
      env: { KEEPER_ENABLED: "false", KEEPER_INTERVAL_MS: "1" },
      signal: controller.signal,
      log,
      sleep: async () => controller.abort(),
      runPass: async () => {
        throw new Error("disabled worker must not run");
      },
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ event: "keeper_worker", outcome: "disabled" }),
    );
  });

  it("never overlaps passes and schedules from the prior pass start", async () => {
    const controller = new AbortController();
    let active = 0;
    let maximumActive = 0;
    let passes = 0;
    let clock = 0;
    const sleeps: number[] = [];
    await runKeeperWorker({
      env: { KEEPER_ENABLED: "true", KEEPER_INTERVAL_MS: "10" },
      signal: controller.signal,
      now: () => clock,
      runPass: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        passes += 1;
        clock += 4;
        await Promise.resolve();
        active -= 1;
      },
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        clock += milliseconds;
        if (passes === 2) controller.abort();
      },
      log: vi.fn(),
    });
    expect(passes).toBe(2);
    expect(maximumActive).toBe(1);
    expect(sleeps).toEqual([6, 6]);
  });

  it("starts the next pass promptly after an overrun", async () => {
    const controller = new AbortController();
    let clock = 100;
    const sleeps: number[] = [];
    await runKeeperWorker({
      env: { KEEPER_ENABLED: "true", KEEPER_INTERVAL_MS: "5" },
      signal: controller.signal,
      now: () => clock,
      runPass: async () => {
        clock += 8;
      },
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        controller.abort();
      },
      log: vi.fn(),
    });
    expect(sleeps).toEqual([0]);
  });

  it("runs bounded follow-up passes promptly while writes reveal more work", async () => {
    const controller = new AbortController();
    let passes = 0;
    const sleeps: number[] = [];
    await runKeeperWorker({
      env: { KEEPER_ENABLED: "true", KEEPER_INTERVAL_MS: "60000" },
      signal: controller.signal,
      runPass: async () => {
        passes += 1;
        return passes < 3
          ? { backlog: 0, writes: 1, plannedWrites: 0 }
          : { backlog: 0, writes: 0, plannedWrites: 0 };
      },
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        if (passes === 3) controller.abort();
      },
      log: vi.fn(),
    });
    expect(sleeps).toEqual([1_000, 1_000, expect.any(Number)]);
    expect(sleeps[2]).toBeGreaterThan(50_000);
  });
});

function releaseEnvironment(): Record<string, string> {
  return {
    FLY_IMAGE_REF:
      "registry.fly.io/zkube-solana-devnet-keeper:deployment-01KY50T1AP5RKZ5K5ET0F50W9X",
    ZKUBE_KEEPER_PUBLIC_KEY: Keypair.generate().publicKey.toBase58(),
    ZKUBE_REPLAY_DOMAIN_HEX: canonicalDevnetReplayDomainHex(ZKUBE_PROGRAM_ID),
    ZKUBE_ARENA_RULES_CATALOG_SHA256: "34".repeat(32),
    ZKUBE_ARENA_RULES_VERSION: "1",
    ZKUBE_LAUNCH_DAY_ID: "20656",
  };
}
