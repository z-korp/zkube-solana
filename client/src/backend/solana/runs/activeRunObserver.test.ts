// @vitest-environment node

import { PublicKey, type Connection } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActiveRunObserver } from "./activeRunObserver";

afterEach(() => vi.useRealTimers());

describe("ActiveRunObserver", () => {
  it("reuses one subscription and decodes notification data without another RPC read", async () => {
    let notify: ((info: { data: Buffer; owner: PublicKey }) => void) | null =
      null;
    const owner = PublicKey.unique();
    const fetch = vi.fn().mockResolvedValue({ counter: 1 });
    const connection = {
      onAccountChange: vi.fn((_address, callback) => {
        notify = callback;
        return 7;
      }),
      removeAccountChangeListener: vi.fn().mockResolvedValue(undefined),
    } as unknown as Connection;
    const observer = new ActiveRunObserver(
      connection,
      PublicKey.unique(),
      (data, accountOwner) => ({
        counter: data[0] ?? 0,
        owner: accountOwner,
      }),
      fetch,
    );
    await observer.start();

    const waiting = observer.waitFor((state) => state.counter === 2, {
      timeoutMs: 5_000,
      timeoutMessage: "timeout",
      fallbackPollMs: 60_000,
    });
    notify?.({ data: Buffer.from([2]), owner });
    const update = await waiting;

    expect(update.source).toBe("websocket");
    expect(update.state).toEqual({ counter: 2, owner });
    expect(fetch).toHaveBeenCalledOnce();
    expect(connection.onAccountChange).toHaveBeenCalledOnce();

    const second = await observer.waitFor((state) => state.counter === 2, {
      timeoutMs: 5_000,
      timeoutMessage: "timeout",
    });
    expect(second.source).toBe("websocket");
    expect(connection.onAccountChange).toHaveBeenCalledOnce();
  });

  it("uses a bounded fallback read when a websocket notification is missed", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ counter: 1 })
      .mockResolvedValueOnce({ counter: 2 });
    const connection = {
      onAccountChange: vi.fn(() => 9),
      removeAccountChangeListener: vi.fn().mockResolvedValue(undefined),
    } as unknown as Connection;
    const observer = new ActiveRunObserver(
      connection,
      PublicKey.unique(),
      (data) => ({ counter: data[0] ?? 0 }),
      fetch,
    );
    await observer.start();
    const waiting = observer.waitFor((state) => state.counter === 2, {
      timeoutMs: 5_000,
      timeoutMessage: "timeout",
      fallbackPollMs: 250,
    });

    await vi.advanceTimersByTimeAsync(250);
    await expect(waiting).resolves.toMatchObject({
      state: { counter: 2 },
      source: "fallback",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("recovers through the fallback after an initial RPC read fails", async () => {
    vi.useFakeTimers();
    const diagnostic = vi.fn();
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary RPC failure"))
      .mockResolvedValueOnce({ counter: 2 });
    const connection = {
      onAccountChange: vi.fn(() => 11),
      removeAccountChangeListener: vi.fn().mockResolvedValue(undefined),
    } as unknown as Connection;
    const observer = new ActiveRunObserver(
      connection,
      PublicKey.unique(),
      (data) => ({ counter: data[0] ?? 0 }),
      fetch,
      diagnostic,
    );
    await observer.start();
    const waiting = observer.waitFor((state) => state.counter === 2, {
      timeoutMs: 5_000,
      timeoutMessage: "timeout",
      fallbackPollMs: 250,
    });

    await vi.advanceTimersByTimeAsync(250);
    await expect(waiting).resolves.toMatchObject({
      state: { counter: 2 },
      source: "fallback",
    });
    expect(diagnostic).toHaveBeenCalledWith({
      event: "initial-error",
      error: "temporary RPC failure",
    });
  });
});
