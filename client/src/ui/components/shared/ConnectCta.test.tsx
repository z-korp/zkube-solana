import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ConnectCta from "./ConnectCta";

Object.assign(globalThis, { React });

const fixtures = vi.hoisted(() => ({
  player: {} as Record<string, unknown>,
  platform: {
    kind: "desktop",
    mobileWalletAdapterSupportReason: "not-android",
  } as Record<string, unknown>,
}));

vi.mock("@/backend/client", () => ({
  useConnectedPlayer: () => fixtures.player,
}));
vi.mock("@/platform/capabilities", () => ({
  currentPlatformCapabilities: () => fixtures.platform,
}));
vi.mock("@/platform/installPrompt", () => ({
  installPromptAvailable: () => false,
  promptInstall: vi.fn(),
  subscribeInstallPrompt: () => () => undefined,
}));

function player(overrides: Record<string, unknown> = {}) {
  return {
    connectors: [{ id: "wallet-1", name: "First wallet", platform: "browser" }],
    connectionStatus: "disconnected",
    connector: null,
    publicKey: null,
    sessionStatus: "missing",
    error: null,
    connectAndEnable: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("ConnectCta backend boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.player = player();
    fixtures.platform = {
      kind: "desktop",
      mobileWalletAdapterSupportReason: "not-android",
    };
  });

  it("connects the only backend-reported wallet directly", async () => {
    render(<ConnectCta label="Connect wallet" />);
    fireEvent.click(screen.getByRole("button", { name: /connect wallet/i }));
    await waitFor(() =>
      expect(fixtures.player.connectAndEnable).toHaveBeenCalledWith("wallet-1"),
    );
  });

  it("offers every public wallet choice when several are available", () => {
    fixtures.player = player({
      connectors: [
        { id: "wallet-1", name: "First wallet", platform: "browser" },
        { id: "wallet-2", name: "Second wallet", platform: "android" },
      ],
    });
    render(<ConnectCta />);
    fireEvent.click(screen.getByRole("button", { name: /connect account/i }));
    expect(screen.getByText("First wallet")).toBeInTheDocument();
    expect(screen.getByText("Second wallet")).toBeInTheDocument();
  });

  it("renders nothing once identity and session are ready", () => {
    fixtures.player = player({
      connectionStatus: "connected",
      publicKey: "player-address",
      sessionStatus: "ready",
    });
    const { container } = render(<ConnectCta />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps unsupported-platform guidance chain-neutral", () => {
    fixtures.player = player({ connectors: [] });
    fixtures.platform = {
      kind: "ios-browser",
      mobileWalletAdapterSupportReason: "not-android",
    };
    render(<ConnectCta />);
    expect(
      screen.getByText(/No wallet is available in this iOS browser/i),
    ).toBeInTheDocument();
  });
});
