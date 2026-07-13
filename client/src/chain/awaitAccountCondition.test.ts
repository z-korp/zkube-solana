// @vitest-environment node

import type { Connection, PublicKey } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { awaitAccountCondition } from "./awaitAccountCondition";

const address = {} as PublicKey;

afterEach(() => {
  vi.useRealTimers();
});

describe("awaitAccountCondition", () => {
  it("resolves immediately when already satisfied (no notification needed)", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const connection = {
      onAccountChange: vi.fn(() => 7),
      removeAccountChangeListener: remove,
    } as unknown as Connection;

    await awaitAccountCondition({
      connection,
      address,
      isSatisfied: vi.fn().mockResolvedValue(true),
      timeoutMs: 5_000,
      timeoutMessage: "nope",
    });

    expect(remove).toHaveBeenCalledWith(7);
  });

  it("resolves when an account notification makes the predicate true", async () => {
    let notify: () => void = () => {};
    const remove = vi.fn().mockResolvedValue(undefined);
    const connection = {
      onAccountChange: vi.fn((_addr, cb) => {
        notify = cb;
        return 9;
      }),
      removeAccountChangeListener: remove,
    } as unknown as Connection;

    let ready = false;
    const promise = awaitAccountCondition({
      connection,
      address,
      isSatisfied: async () => ready,
      timeoutMs: 5_000,
      timeoutMessage: "nope",
      fallbackPollMs: 60_000, // keep the fallback out of the way
    });

    await Promise.resolve();
    ready = true;
    notify();
    await expect(promise).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith(9);
  });

  it("resolves via the fallback tick if no notification arrives", async () => {
    vi.useFakeTimers();
    const remove = vi.fn().mockResolvedValue(undefined);
    const connection = {
      onAccountChange: vi.fn(() => 3),
      removeAccountChangeListener: remove,
    } as unknown as Connection;

    let ready = false;
    const promise = awaitAccountCondition({
      connection,
      address,
      isSatisfied: async () => ready,
      timeoutMs: 5_000,
      timeoutMessage: "nope",
      fallbackPollMs: 1_000,
    });

    // initial check runs, predicate false
    await vi.advanceTimersByTimeAsync(0);
    ready = true;
    await vi.advanceTimersByTimeAsync(1_000); // one fallback tick
    await expect(promise).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith(3);
  });

  it("rejects with the message on timeout and unsubscribes", async () => {
    vi.useFakeTimers();
    const remove = vi.fn().mockResolvedValue(undefined);
    const connection = {
      onAccountChange: vi.fn(() => 5),
      removeAccountChangeListener: remove,
    } as unknown as Connection;

    const promise = awaitAccountCondition({
      connection,
      address,
      isSatisfied: async () => false,
      timeoutMs: 2_000,
      timeoutMessage: "timed out",
      fallbackPollMs: 10_000,
    });
    const assertion = expect(promise).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
    expect(remove).toHaveBeenCalledWith(5);
  });
});
