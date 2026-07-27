import { describe, expect, it, vi } from "vitest";

describe("PWA network lifecycle", () => {
  it("publishes offline and restored-online transitions", async () => {
    vi.resetModules();
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    const lifecycle = await import("./pwaLifecycle");
    const listener = vi.fn();
    const unsubscribe = lifecycle.subscribePwaLifecycle(listener);
    lifecycle.initializePwaLifecycle();

    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    window.dispatchEvent(new Event("offline"));
    expect(lifecycle.getPwaLifecycleSnapshot()).toEqual({
      online: false,
      update: "idle",
    });

    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    window.dispatchEvent(new Event("online"));
    expect(lifecycle.getPwaLifecycleSnapshot()).toEqual({
      online: true,
      update: "idle",
    });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("bounds a failed activation and allows cancellation on success", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const lifecycle = await import("./pwaLifecycle");
    const worker = { postMessage: vi.fn() };
    const onTimeout = vi.fn();

    const cancel = lifecycle.requestServiceWorkerActivation(
      worker,
      onTimeout,
      1_000,
    );
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    await vi.advanceTimersByTimeAsync(999);
    expect(onTimeout).not.toHaveBeenCalled();
    cancel();
    await vi.advanceTimersByTimeAsync(1);
    expect(onTimeout).not.toHaveBeenCalled();

    lifecycle.requestServiceWorkerActivation(worker, onTimeout, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(onTimeout).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
