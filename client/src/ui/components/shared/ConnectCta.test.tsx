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

import type { PlatformKind } from "@/platform/capabilities";
import ConnectCta from "./ConnectCta";

interface ConnectorFixture {
  id: string;
  name: string;
  icon: string | undefined;
  kind: "mobile-wallet-adapter" | "wallet-standard";
  supportsV0Signing: boolean;
}

const MWA_NOT_FOUND_MESSAGE =
  "No compatible Android wallet was found. Seeker includes Seed Vault Wallet, and other installed compatible wallets may be used.";

const fixtures = vi.hoisted(() => ({
  player: {
    connectors: [] as {
      id: string;
      name: string;
      icon: string | undefined;
      kind: string;
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
      kind: string;
      supportsV0Signing: boolean;
    } | null,
    publicKey: null as PublicKey | null,
    sessionStatus: "missing" as
      | "missing"
      | "checking"
      | "ready"
      | "expired"
      | "needsRenewal",
    error: null as string | null,
    connectAndEnable: vi.fn(),
  },
  platformKind: "desktop" as string,
  secureContext: true,
  androidWebView: false,
  solanaMobileWebShell: false,
  walletAvailability: {
    status: "unknown",
    error: null,
  } as { status: string; error: { message: string } | null },
  installReady: false,
  promptInstall: vi.fn(),
}));

vi.mock("@/chain/connectedPlayerContext", async () =>
  (await import("@/test/mocks/contexts")).connectedPlayerMock(fixtures.player),
);

vi.mock("@/ui/elements/theme-provider/hooks", async () =>
  (await import("@/test/mocks/theme")).themeHooksMock(),
);

vi.mock("@/platform/capabilities", () => ({
  currentPlatformCapabilities: () => ({
    kind: fixtures.platformKind,
    secureContext: fixtures.secureContext,
    displayModeStandalone: false,
    twaSignal: fixtures.platformKind === "twa",
    androidWebView: fixtures.androidWebView,
    solanaMobileWebShell: fixtures.solanaMobileWebShell,
    mobileWalletAdapterSupported:
      fixtures.secureContext &&
      (!fixtures.androidWebView || fixtures.solanaMobileWebShell) &&
      (fixtures.platformKind === "android-browser" ||
        fixtures.platformKind === "android-pwa" ||
        fixtures.platformKind === "twa"),
    mobileWalletAdapterSupportReason: !fixtures.secureContext
      ? "insecure-context"
      : fixtures.androidWebView && !fixtures.solanaMobileWebShell
        ? "unsupported-android-webview"
        : fixtures.platformKind === "android-browser" ||
            fixtures.platformKind === "android-pwa" ||
            fixtures.platformKind === "twa"
          ? "available"
          : "not-android",
  }),
}));

vi.mock("@/platform/walletStandard", () => ({
  getWalletAvailabilityState: () => fixtures.walletAvailability,
  subscribeWalletAvailability: () => () => undefined,
}));

vi.mock("@/platform/installPrompt", () => ({
  installPromptAvailable: () => fixtures.installReady,
  subscribeInstallPrompt: () => () => undefined,
  promptInstall: fixtures.promptInstall,
}));

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
  fixtures.player.error = null;
  fixtures.secureContext = true;
  fixtures.androidWebView = false;
  fixtures.solanaMobileWebShell = false;
  fixtures.player.connectors = [phantom()];
  fixtures.player.connectAndEnable.mockResolvedValue(undefined);
  fixtures.platformKind = "desktop";
  fixtures.walletAvailability = { status: "unknown", error: null };
  fixtures.installReady = false;
});

function phantom(): ConnectorFixture {
  return {
    id: "phantom",
    name: "Phantom",
    icon: undefined,
    kind: "wallet-standard",
    supportsV0Signing: true,
  };
}

function mobileWalletAdapter(): ConnectorFixture {
  return {
    id: "mwa",
    name: "Use Installed Wallet",
    icon: undefined,
    kind: "mobile-wallet-adapter",
    supportsV0Signing: true,
  };
}

function setupAndroid(kind: PlatformKind = "android-browser") {
  fixtures.platformKind = kind;
  fixtures.player.connectors = [mobileWalletAdapter()];
}

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
      phantom(),
      { ...phantom(), id: "solflare", name: "Solflare" },
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
      screen.getByRole("button", {
        name: /versioned transactions unsupported/i,
      }),
    ).toBeDisabled();
    expect(fixtures.player.connectAndEnable).not.toHaveBeenCalled();
  });

  it("maps a sign-only capability failure to compatibility recovery", async () => {
    fixtures.player.connectAndEnable.mockRejectedValue(
      new Error(
        "Send Only Wallet cannot sign versioned transactions without submitting them.",
      ),
    );

    render(<ConnectCta />);

    fireEvent.click(screen.getByRole("button", { name: /connect account/i }));

    expect(await screen.findByRole("alert")).toHaveAccessibleName(
      /this wallet is not compatible/i,
    );
    expect(
      screen.getByText(
        /requires sign-only versioned transaction support and cannot replace it with sign-and-send/i,
      ),
    ).toBeVisible();
  });

  it("becomes the enable action for a connected wallet without a session", async () => {
    fixtures.player.connectionStatus = "connected";
    fixtures.player.publicKey = PublicKey.default;
    fixtures.player.connector = fixtures.player.connectors[0];
    fixtures.player.connectAndEnable.mockRejectedValue(
      new Error("The wallet rejected the request."),
    );

    render(<ConnectCta />);

    fireEvent.click(screen.getByRole("button", { name: /connect account/i }));
    expect(await screen.findByRole("alert")).toHaveAccessibleName(
      /request declined/i,
    );
    expect(
      screen.getByText(/nothing was connected or approved/i),
    ).toBeVisible();
    expect(fixtures.player.connectAndEnable).toHaveBeenCalledWith("phantom");

    fireEvent.click(
      screen.getByRole("button", { name: /try wallet connection again/i }),
    );
    await waitFor(() =>
      expect(fixtures.player.connectAndEnable).toHaveBeenCalledTimes(2),
    );
  });

  it("routes an expired device session to typed explicit renewal", async () => {
    fixtures.player.connectionStatus = "connected";
    fixtures.player.publicKey = PublicKey.default;
    fixtures.player.connector = fixtures.player.connectors[0];
    fixtures.player.sessionStatus = "expired";
    fixtures.player.error =
      "The zKube device session expired. Renew it before continuing.";

    render(<ConnectCta />);

    expect(screen.getByRole("alert")).toHaveAccessibleName(
      /device session expired/i,
    );
    expect(
      screen.getByText(/needs a fresh zKube session approval/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /connect account/i }),
    ).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: /try wallet connection again/i }),
    );
    await waitFor(() =>
      expect(fixtures.player.connectAndEnable).toHaveBeenCalledWith("phantom"),
    );
  });

  it("asks for renewal when this origin's signer allowance is low", () => {
    fixtures.player.connectionStatus = "connected";
    fixtures.player.publicKey = PublicKey.default;
    fixtures.player.sessionStatus = "needsRenewal";
    render(<ConnectCta />);
    expect(
      screen.getByRole("button", { name: /connect account/i }),
    ).toBeEnabled();
  });

  it("requires an explicit retry after a foreign account event", () => {
    fixtures.player.error =
      "The wallet account changed. Connect and enable the new address.";

    render(<ConnectCta />);

    expect(screen.getByRole("alert")).toHaveAccessibleName(
      /wallet account changed/i,
    );
    expect(
      screen.getByText(/select the address you intend to use/i),
    ).toBeVisible();
  });

  it("renders nothing once the player is fully ready", () => {
    fixtures.player.connectionStatus = "connected";
    fixtures.player.publicKey = PublicKey.default;
    fixtures.player.sessionStatus = "ready";

    const { container } = render(<ConnectCta />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the caller label and shows no Seeker copy on desktop", () => {
    render(<ConnectCta />);

    expect(
      screen.getByRole("button", { name: /connect account/i }),
    ).toBeEnabled();
    expect(screen.queryByText(/seed vault/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/install zkube as an app/i),
    ).not.toBeInTheDocument();
  });

  it("shows desktop extension guidance when no wallet is available", () => {
    fixtures.player.connectors = [];

    render(<ConnectCta />);

    expect(
      screen.getByText(/no wallet extension was found/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("ConnectCta platform guidance", () => {
  it("leads with Use Installed Wallet and the Seeker wallet hint on Android", async () => {
    setupAndroid("twa");

    render(<ConnectCta label="Connect wallet" />);

    const button = screen.getByRole("button", {
      name: /use installed wallet/i,
    });
    expect(
      screen.getByText(
        /Seeker includes Seed Vault Wallet, and other installed compatible wallets may be used\. Phantom and Solflare are optional\./,
      ),
    ).toBeInTheDocument();

    fireEvent.click(button);
    await waitFor(() =>
      expect(fixtures.player.connectAndEnable).toHaveBeenCalledWith("mwa"),
    );
  });

  it("explains Android wallet-not-found once and keeps the retry path", async () => {
    setupAndroid("android-browser");
    fixtures.walletAvailability = {
      status: "unavailable",
      error: { message: MWA_NOT_FOUND_MESSAGE },
    };
    fixtures.player.connectAndEnable.mockRejectedValue(
      new Error(MWA_NOT_FOUND_MESSAGE),
    );

    render(<ConnectCta />);

    const guidance = screen.getByRole("alert");
    expect(guidance).toHaveAccessibleName(/no compatible wallet answered/i);
    expect(guidance).toHaveTextContent(
      /seed vault wallet is built into seeker/i,
    );
    expect(guidance).toHaveTextContent(/phantom and solflare are optional/i);

    const retry = screen.getByRole("button", {
      name: /try wallet connection again/i,
    });
    fireEvent.click(retry);
    await waitFor(() =>
      expect(fixtures.player.connectAndEnable).toHaveBeenCalledWith("mwa"),
    );
    await waitFor(() => expect(retry).toBeEnabled());
  });

  it("uses conservative Android recovery for an untyped error", async () => {
    setupAndroid("android-browser");
    fixtures.walletAvailability = {
      status: "unavailable",
      error: { message: MWA_NOT_FOUND_MESSAGE },
    };
    fixtures.player.connectAndEnable.mockRejectedValue(
      new Error("Session funding failed"),
    );

    render(<ConnectCta />);

    fireEvent.click(
      screen.getByRole("button", { name: /use installed wallet/i }),
    );
    expect(await screen.findByRole("alert")).toHaveAccessibleName(
      /wallet connection did not finish/i,
    );
    expect(
      screen.getByText(/return to android chrome and retry/i),
    ).toBeVisible();
    expect(
      screen.queryByText(/session funding failed/i),
    ).not.toBeInTheDocument();
  });

  it("explains Local Network Access recovery and safely retries", async () => {
    setupAndroid("android-browser");
    fixtures.player.connectAndEnable.mockRejectedValue(
      wrappedMwaError(
        "ERROR_LOOPBACK_ACCESS_BLOCKED",
        "Local Network Access permission denied",
      ),
    );

    render(<ConnectCta />);

    fireEvent.click(
      screen.getByRole("button", { name: /use installed wallet/i }),
    );
    const recovery = await screen.findByRole("alert");
    expect(recovery).toHaveAccessibleName(/allow local network access/i);
    expect(recovery).toHaveTextContent(
      /site settings → permissions → local network access/i,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /try wallet connection again/i }),
    );
    await waitFor(() =>
      expect(fixtures.player.connectAndEnable).toHaveBeenCalledTimes(2),
    );
  });

  it("explains an MWA association timeout without claiming LNA denial", async () => {
    setupAndroid("android-browser");
    fixtures.player.connectAndEnable.mockRejectedValue(
      wrappedMwaError(
        "ERROR_ASSOCIATION_CANCELLED",
        "Wallet connection timed out",
      ),
    );

    render(<ConnectCta />);

    fireEvent.click(
      screen.getByRole("button", { name: /use installed wallet/i }),
    );
    const recovery = await screen.findByRole("alert");
    expect(recovery).toHaveAccessibleName(/wallet handoff did not finish/i);
    expect(recovery).toHaveTextContent(
      /mwa-compatible wallet is installed, open, and unlocked/i,
    );
    expect(recovery).toHaveTextContent(/return to chrome and retry/i);
    expect(recovery).not.toHaveTextContent(/local network access/i);
  });

  it("does not claim LNA denial from a bare loopback code", async () => {
    setupAndroid("android-browser");
    fixtures.player.connectAndEnable.mockRejectedValue(
      wrappedMwaError(
        "ERROR_LOOPBACK_ACCESS_BLOCKED",
        "An arbitrary loopback failure",
      ),
    );

    render(<ConnectCta />);

    fireEvent.click(
      screen.getByRole("button", { name: /use installed wallet/i }),
    );
    const recovery = await screen.findByRole("alert");
    expect(recovery).toHaveAccessibleName(/wallet handoff did not finish/i);
    expect(recovery).not.toHaveTextContent(/local network access/i);
  });

  it("uses TWA-specific recovery for a grounded LNA denial", async () => {
    setupAndroid("twa");
    fixtures.player.connectAndEnable.mockRejectedValue(
      wrappedMwaError(
        "ERROR_LOOPBACK_ACCESS_BLOCKED",
        "Local Network Access permission denied",
      ),
    );

    render(<ConnectCta />);

    fireEvent.click(
      screen.getByRole("button", { name: /use installed wallet/i }),
    );
    const recovery = await screen.findByRole("alert");
    expect(recovery).toHaveTextContent(
      /zkube's android app or site permissions/i,
    );
    expect(recovery).toHaveTextContent(/trusted https url in android chrome/i);
  });

  it("offers the PWA install action only in an Android browser", () => {
    setupAndroid("android-browser");
    fixtures.installReady = true;

    const browser = render(<ConnectCta />);
    fireEvent.click(
      screen.getByRole("button", { name: /install zkube as an app/i }),
    );
    expect(fixtures.promptInstall).toHaveBeenCalledTimes(1);
    browser.unmount();

    setupAndroid("android-pwa");
    render(<ConnectCta />);
    expect(
      screen.queryByRole("button", { name: /install zkube as an app/i }),
    ).not.toBeInTheDocument();
  });

  it("explains that an insecure Android origin cannot register MWA", () => {
    setupAndroid();
    fixtures.player.connectors = [];
    fixtures.secureContext = false;

    render(<ConnectCta />);

    expect(screen.getByRole("status")).toHaveTextContent(
      /requires a trusted HTTPS page/i,
    );
  });

  it("redirects an unsupported Android WebView to a supported surface", () => {
    setupAndroid("android-pwa");
    fixtures.player.connectors = [];
    fixtures.androidWebView = true;

    render(<ConnectCta />);

    expect(screen.getByRole("status")).toHaveTextContent(
      /webview cannot register mobile wallet adapter/i,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /android chrome.*solana mobile webshell/i,
    );
  });

  it("shows honest iOS guidance instead of a dead mobile option", () => {
    fixtures.platformKind = "ios";
    fixtures.player.connectors = [];

    render(<ConnectCta />);

    const guidance = screen.getByRole("status");
    expect(guidance).toHaveTextContent(/iOS isn't a supported zKube surface/i);
    expect(guidance).toHaveTextContent(/android chrome or a desktop browser/i);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("preserves an injected wallet path on iOS", async () => {
    fixtures.platformKind = "ios";

    render(<ConnectCta />);

    fireEvent.click(screen.getByRole("button", { name: /connect account/i }));
    await waitFor(() =>
      expect(fixtures.player.connectAndEnable).toHaveBeenCalledWith("phantom"),
    );
    expect(screen.queryByText(/seed vault/i)).not.toBeInTheDocument();
  });

  it("uses the unsupported-surface fallback after an iOS connection error", async () => {
    fixtures.platformKind = "ios";
    fixtures.player.connectAndEnable.mockRejectedValue(
      new Error("Injected wallet failed"),
    );

    render(<ConnectCta />);

    fireEvent.click(screen.getByRole("button", { name: /connect account/i }));
    const recovery = await screen.findByRole("alert");
    expect(recovery).toHaveAccessibleName(/connection unavailable/i);
    expect(recovery).toHaveTextContent(
      /ios is not a supported zkube surface yet/i,
    );
    expect(recovery).toHaveTextContent(
      /android chrome or a desktop wallet standard extension/i,
    );
  });

  it("gives conservative guidance on an unidentified browser", () => {
    fixtures.platformKind = "unknown";
    fixtures.player.connectors = [];

    render(<ConnectCta />);

    const guidance = screen.getByRole("status");
    expect(guidance).toHaveTextContent(/isn't a verified zKube surface/i);
    expect(guidance).toHaveTextContent(/android chrome or a desktop browser/i);
  });
});

function wrappedMwaError(code: string, message: string): Error {
  const cause = Object.assign(new Error(message), {
    name: "SolanaMobileWalletAdapterError",
    code,
  });
  return Object.assign(new Error(message), { cause });
}
