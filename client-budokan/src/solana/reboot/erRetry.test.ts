// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { isTransientErError, withTransientErRetry } from "./erRetry";

describe("MagicBlock transient retry", () => {
  it("retries cloner lag with bounded exponential backoff", async () => {
    const action = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("Cloner error"))
      .mockRejectedValueOnce(new Error("pending request owner failed"))
      .mockResolvedValue("ready");
    const sleep = vi.fn(async () => undefined);
    await expect(
      withTransientErRetry(action, { sleep, baseDelayMs: 100 }),
    ).resolves.toBe("ready");
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([100, 200]);
  });

  it("never retries deterministic program errors", async () => {
    const action = vi.fn(async () => {
      throw new Error("AnchorError: InvalidMove");
    });
    await expect(
      withTransientErRetry(action, { sleep: async () => undefined }),
    ).rejects.toThrow("InvalidMove");
    expect(action).toHaveBeenCalledTimes(1);
    expect(isTransientErError(new Error("Blockhash not found"))).toBe(true);
  });
});
