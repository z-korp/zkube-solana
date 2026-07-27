import { describe, expect, it, vi } from "vitest";

import type { BeforeInstallPromptEvent } from "./installPrompt";

type InstallPromptModule = typeof import("./installPrompt");

async function freshModule(): Promise<InstallPromptModule> {
  vi.resetModules();
  return import("./installPrompt");
}

function installEvent(
  outcome: "accepted" | "dismissed" = "accepted",
): BeforeInstallPromptEvent & { prompt: ReturnType<typeof vi.fn> } {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  return Object.assign(event, {
    platforms: ["web"] as readonly string[],
    prompt: vi.fn(async () => undefined),
    userChoice: Promise.resolve({ outcome, platform: "web" }),
  });
}

describe("install prompt capture", () => {
  it("defers the browser prompt and notifies availability", async () => {
    const module = await freshModule();
    module.captureInstallPrompt();
    const listener = vi.fn();
    module.subscribeInstallPrompt(listener);

    expect(module.installPromptAvailable()).toBe(false);
    const event = installEvent();
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(module.installPromptAvailable()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("consumes the deferred event exactly once", async () => {
    const module = await freshModule();
    module.captureInstallPrompt();
    const event = installEvent("accepted");
    window.dispatchEvent(event);

    await expect(module.promptInstall()).resolves.toBe("accepted");
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(module.installPromptAvailable()).toBe(false);
    await expect(module.promptInstall()).resolves.toBe("unavailable");
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it("clears the deferred event once the app is installed", async () => {
    const module = await freshModule();
    module.captureInstallPrompt();
    window.dispatchEvent(installEvent());
    expect(module.installPromptAvailable()).toBe(true);

    const listener = vi.fn();
    module.subscribeInstallPrompt(listener);
    window.dispatchEvent(new Event("appinstalled"));

    expect(module.installPromptAvailable()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("registers the window listeners once", async () => {
    const module = await freshModule();
    const addEventListener = vi.spyOn(window, "addEventListener");
    module.captureInstallPrompt();
    module.captureInstallPrompt();

    const captured = addEventListener.mock.calls.filter(
      ([type]) => type === "beforeinstallprompt",
    );
    expect(captured).toHaveLength(1);
  });
});
