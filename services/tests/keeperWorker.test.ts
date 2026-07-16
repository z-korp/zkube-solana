// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  keeperWriteEnabledFromEnv,
  runKeeperWorker,
} from "../src/keeperWorker";

describe("keeper worker scheduling", () => {
  it("keeps writes fail-closed unless explicitly enabled", () => {
    expect(keeperWriteEnabledFromEnv({})).toBe(false);
    expect(keeperWriteEnabledFromEnv({ KEEPER_WRITE_ENABLED: "false" })).toBe(
      false,
    );
    expect(keeperWriteEnabledFromEnv({ KEEPER_WRITE_ENABLED: "TRUE" })).toBe(
      false,
    );
    expect(keeperWriteEnabledFromEnv({ KEEPER_WRITE_ENABLED: "true" })).toBe(
      true,
    );
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
});
