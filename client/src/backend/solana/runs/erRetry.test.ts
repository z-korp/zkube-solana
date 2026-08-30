// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { isTransientErError, withTransientErRetry } from "./erRetry";

describe("MagicBlock transient retry", () => {
  it("retries cloner lag on the bounded Effect schedule", async () => {
    const action = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("Cloner error"))
      .mockRejectedValueOnce(new Error("pending request owner failed"))
      .mockResolvedValue("ready");
    await expect(
      withTransientErRetry(action, { baseDelayMs: 0 }),
    ).resolves.toBe("ready");
    expect(action).toHaveBeenCalledTimes(3);
  });

  it("never retries deterministic program errors", async () => {
    const action = vi.fn(async () => {
      throw new Error("AnchorError: InvalidMove");
    });
    await expect(
      withTransientErRetry(action, { baseDelayMs: 0 }),
    ).rejects.toThrow("InvalidMove");
    expect(action).toHaveBeenCalledTimes(1);
    expect(isTransientErError(new Error("Blockhash not found"))).toBe(true);
  });
});
