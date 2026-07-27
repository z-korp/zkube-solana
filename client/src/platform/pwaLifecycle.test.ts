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
});
