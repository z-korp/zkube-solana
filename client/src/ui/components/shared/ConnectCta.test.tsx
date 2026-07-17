import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PublicKey } from "@solana/web3.js";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import ConnectCta from "./ConnectCta";

const fixtures = vi.hoisted(() => ({
  player: {
    connectors: [] as {
      id: string;
      name: string;
      icon: string | undefined;
      supportsV0Signing: boolean;
    }[],
    connectionStatus: "disconnected" as
      | "disconnected"
      | "connecting"
      | "connected",
    connector: null as {
      id: string;
      name: string;
      icon?: string;
      supportsV0Signing: boolean;
    } | null,
    publicKey: null as PublicKey | null,
    sessionStatus: "missing" as
      | "missing"
      | "checking"
      | "ready"
      | "expired"
      | "needsRenewal",
    connectAndEnable: vi.fn(),
  },
}));

vi.mock("@/chain/connectedPlayerContext", async () =>
  (await import("@/test/mocks/contexts")).connectedPlayerMock(fixtures.player),
);

vi.mock("@/ui/elements/theme-provider/hooks", async () =>
  (await import("@/test/mocks/theme")).themeHooksMock(),
);

beforeAll(() => {
  vi.stubGlobal("React", React);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.player.connectionStatus = "disconnected";
  fixtures.player.connector = null;
  fixtures.player.publicKey = null;
  fixtures.player.sessionStatus = "missing";
  fixtures.player.connectors = [
    { id: "phantom", name: "Phantom", icon: undefined, supportsV0Signing: true },
  ];
  fixtures.player.connectAndEnable.mockResolvedValue(undefined);
});

describe("ConnectCta", () => {
  it("connects directly when a single compatible wallet is installed", async () => {
    render(<ConnectCta label="PLAY NOW" />);

    fireEvent.click(screen.getByRole("button", { name: /play now/i }));
    await waitFor(() =>
      expect(fixtures.player.connectAndEnable).toHaveBeenCalledWith("phantom"),
    );
  });

  it("offers a wallet picker when several wallets are installed", async () => {
    fixtures.player.connectors = [
      { id: "phantom", name: "Phantom", icon: undefined, supportsV0Signing: true },
      { id: "solflare", name: "Solflare", icon: undefined, supportsV0Signing: true },
    ];

    render(<ConnectCta />);

    fireEvent.click(screen.getByRole("button", { name: /connect account/i }));
    expect(screen.getByText("Choose a wallet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /solflare/i }));
    await waitFor(() =>
      expect(fixtures.player.connectAndEnable).toHaveBeenCalledWith("solflare"),
    );
  });

  it("does not offer an incompatible connector as playable", () => {
    fixtures.player.connectors[0].supportsV0Signing = false;

    render(<ConnectCta />);

    fireEvent.click(screen.getByRole("button", { name: /connect account/i }));
    expect(screen.getByText("Choose a wallet")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /versioned transactions unsupported/i }),
    ).toBeDisabled();
    expect(fixtures.player.connectAndEnable).not.toHaveBeenCalled();
  });

  it("becomes the enable action for a connected wallet without a session", async () => {
    fixtures.player.connectionStatus = "connected";
    fixtures.player.publicKey = PublicKey.default;
    fixtures.player.connector = fixtures.player.connectors[0];
    fixtures.player.connectAndEnable.mockRejectedValue(
      new Error("The wallet rejected the request."),
    );

    render(<ConnectCta />);

    fireEvent.click(screen.getByRole("button", { name: /enable zkube/i }));
    expect(
      await screen.findByText(/wallet rejected the request/i),
    ).toBeInTheDocument();
    expect(fixtures.player.connectAndEnable).toHaveBeenCalledWith("phantom");
  });

  it("asks for renewal when the device session expires", () => {
    fixtures.player.connectionStatus = "connected";
    fixtures.player.publicKey = PublicKey.default;
    fixtures.player.connector = fixtures.player.connectors[0];
    fixtures.player.sessionStatus = "expired";

    render(<ConnectCta />);

    expect(screen.getByRole("button", { name: /renew zkube/i })).toBeEnabled();
  });

  it("asks for renewal when this origin's signer allowance is low", () => {
    fixtures.player.connectionStatus = "connected";
    fixtures.player.publicKey = PublicKey.default;
    fixtures.player.sessionStatus = "needsRenewal";
    render(<ConnectCta />);
    expect(screen.getByRole("button", { name: /renew zkube/i })).toBeEnabled();
  });

  it("renders nothing once the player is fully ready", () => {
    fixtures.player.connectionStatus = "connected";
    fixtures.player.publicKey = PublicKey.default;
    fixtures.player.sessionStatus = "ready";

    const { container } = render(<ConnectCta />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows wallet install guidance when none is available", () => {
    fixtures.player.connectors = [];

    render(<ConnectCta />);

    expect(
      screen.getByText(/no compatible wallet was found/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
