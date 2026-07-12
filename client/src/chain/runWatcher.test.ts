// @vitest-environment node

import type { Connection } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import type { ResumedRun } from "./resumeRun";
import { PersistedRunWatcher } from "./runWatcher";

describe("PersistedRunWatcher", () => {
  it("subscribes, refreshes from notifications, and removes listeners on stop", async () => {
    let accountCallback: () => void = () => {};
    const remove = vi.fn().mockResolvedValue(undefined);
    const connection = {
      onAccountChange: vi.fn((_address, callback) => {
        accountCallback = callback;
        return 7;
      }),
      removeAccountChangeListener: remove,
    } as unknown as Connection;
    const state = {
      phase: "delegated",
      connection,
      marker: { addresses: { activeRun: {} } },
    } as ResumedRun;
    const resolve = vi.fn().mockResolvedValue(state);
    const onState = vi.fn();
    const watcher = new PersistedRunWatcher({ resolve, onState, pollMs: 60_000 });
    watcher.start();
    await vi.waitFor(() => expect(onState).toHaveBeenCalledOnce());

    accountCallback();
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
    await watcher.stop();
    expect(remove).toHaveBeenCalledWith(7);
  });

  it("reports reconnect attempts and recovers on the next poll", async () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const resolve = vi.fn()
      .mockRejectedValueOnce(new Error("router offline"))
      .mockResolvedValue({ phase: "none" } satisfies ResumedRun);
    const watcher = new PersistedRunWatcher({
      resolve,
      onState: vi.fn(),
      onStatus: (status) => statuses.push(status.phase),
      pollMs: 10,
    });
    watcher.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(statuses).toContain("reconnecting");
    await vi.advanceTimersByTimeAsync(10);
    expect(statuses).toContain("subscribed");
    await watcher.stop();
    vi.useRealTimers();
  });

  it("rebinds to a router-migrated ER and removes the stale listener", async () => {
    let firstCallback: () => void = () => {};
    const firstRemove = vi.fn().mockResolvedValue(undefined);
    const secondRemove = vi.fn().mockResolvedValue(undefined);
    const firstConnection = {
      onAccountChange: vi.fn((_address, callback) => {
        firstCallback = callback;
        return 11;
      }),
      removeAccountChangeListener: firstRemove,
    } as unknown as Connection;
    const secondConnection = {
      onAccountChange: vi.fn(() => 22),
      removeAccountChangeListener: secondRemove,
    } as unknown as Connection;
    const state = (connection: Connection) => ({
      phase: "delegated",
      connection,
      marker: { addresses: { activeRun: {} } },
    }) as ResumedRun;
    const resolve = vi.fn()
      .mockResolvedValueOnce(state(firstConnection))
      .mockResolvedValue(state(secondConnection));
    const watcher = new PersistedRunWatcher({ resolve, onState: vi.fn(), pollMs: 60_000 });
    watcher.start();
    await vi.waitFor(() => expect(firstConnection.onAccountChange).toHaveBeenCalledOnce());

    firstCallback();
    await vi.waitFor(() => expect(secondConnection.onAccountChange).toHaveBeenCalledOnce());
    expect(firstRemove).toHaveBeenCalledWith(11);
    await watcher.stop();
    expect(secondRemove).toHaveBeenCalledWith(22);
  });

  it("coalesces a notification storm into one queued authoritative refresh", async () => {
    let accountCallback: () => void = () => {};
    let releaseSecond: ((state: ResumedRun) => void) | null = null;
    const connection = {
      onAccountChange: vi.fn((_address, callback) => {
        accountCallback = callback;
        return 31;
      }),
      removeAccountChangeListener: vi.fn().mockResolvedValue(undefined),
    } as unknown as Connection;
    const state = {
      phase: "delegated",
      connection,
      marker: { addresses: { activeRun: {} } },
    } as ResumedRun;
    const second = new Promise<ResumedRun>((resolve) => {
      releaseSecond = resolve;
    });
    const resolve = vi.fn()
      .mockResolvedValueOnce(state)
      .mockReturnValueOnce(second)
      .mockResolvedValue(state);
    const watcher = new PersistedRunWatcher({ resolve, onState: vi.fn(), pollMs: 60_000 });
    watcher.start();
    await vi.waitFor(() => expect(connection.onAccountChange).toHaveBeenCalledOnce());

    accountCallback();
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
    for (let index = 0; index < 1_000; index += 1) accountCallback();
    expect(resolve).toHaveBeenCalledTimes(2);
    releaseSecond?.(state);
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(3));
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 0));
    expect(resolve).toHaveBeenCalledTimes(3);
    await watcher.stop();
  });

  it("caps repeated reconnect backoff and eventually recovers", async () => {
    vi.useFakeTimers();
    const attempts: number[] = [];
    const resolve = vi.fn()
      .mockRejectedValueOnce(new Error("router offline 1"))
      .mockRejectedValueOnce(new Error("router offline 2"))
      .mockRejectedValueOnce(new Error("router offline 3"))
      .mockRejectedValueOnce(new Error("router offline 4"))
      .mockResolvedValue({ phase: "none" } satisfies ResumedRun);
    const watcher = new PersistedRunWatcher({
      resolve,
      onState: vi.fn(),
      onStatus: (status) => {
        if (status.phase === "reconnecting") attempts.push(status.attempt);
      },
      pollMs: 10,
      maxBackoffMs: 25,
    });
    watcher.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toEqual([1]);
    await vi.advanceTimersByTimeAsync(10);
    expect(attempts).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(20);
    expect(attempts).toEqual([1, 2, 3]);
    await vi.advanceTimersByTimeAsync(25);
    expect(attempts).toEqual([1, 2, 3, 4]);
    await vi.advanceTimersByTimeAsync(25);
    expect(resolve).toHaveBeenCalledTimes(5);
    await watcher.stop();
    vi.useRealTimers();
  });
});
