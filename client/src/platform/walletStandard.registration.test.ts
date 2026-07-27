// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://play.zkube.test/arcade"}

import {
  SolanaSignAndSendTransaction,
  SolanaSignTransaction,
} from "@solana/wallet-standard-features";
import type { Wallet } from "@wallet-standard/base";
import { StandardConnect, StandardDisconnect } from "@wallet-standard/features";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capabilities: {
    kind: "desktop",
    secureContext: true,
    displayModeStandalone: false,
    twaSignal: false,
    androidWebView: false,
    solanaMobileWebShell: false,
    mobileWalletAdapterSupported: false,
    mobileWalletAdapterSupportReason: "not-android",
  },
  authorizationCache: {
    clear: vi.fn(async () => undefined),
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => undefined),
  },
  createDefaultAuthorizationCache: vi.fn(),
  createDefaultChainSelector: vi.fn(() => ({ type: "selector" })),
  getWallets: vi.fn(),
  registerMwa: vi.fn(),
}));

vi.mock("@solana-mobile/wallet-standard-mobile", () => ({
  createDefaultAuthorizationCache: mocks.createDefaultAuthorizationCache,
  createDefaultChainSelector: mocks.createDefaultChainSelector,
  registerMwa: mocks.registerMwa,
  SolanaMobileWalletAdapterWalletName: "Mobile Wallet Adapter",
}));

vi.mock("@wallet-standard/app", () => ({
  getWallets: mocks.getWallets,
}));

vi.mock("./capabilities", () => ({
  currentPlatformCapabilities: () => mocks.capabilities,
}));

beforeEach(() => {
  vi.resetModules();
  mocks.capabilities = {
    kind: "desktop",
    secureContext: true,
    displayModeStandalone: false,
    twaSignal: false,
    androidWebView: false,
    solanaMobileWebShell: false,
    mobileWalletAdapterSupported: false,
    mobileWalletAdapterSupportReason: "not-android",
  };
  mocks.createDefaultAuthorizationCache.mockClear();
  mocks.createDefaultAuthorizationCache.mockReturnValue(
    mocks.authorizationCache,
  );
  mocks.authorizationCache.clear.mockClear();
  mocks.authorizationCache.get.mockClear();
  mocks.authorizationCache.set.mockClear();
  mocks.createDefaultChainSelector.mockClear();
  mocks.getWallets.mockReset();
  mocks.registerMwa.mockReset();
});

describe("Mobile Wallet Adapter registration", () => {
  it("leaves desktop Wallet Standard discovery unchanged", async () => {
    const extensionWallet = walletStandardExtension();
    const registry = walletRegistry([extensionWallet]);
    mocks.getWallets.mockReturnValue(registry);
    const { discoverWalletConnectors, walletRegistry: getRegistry } =
      await import("./walletStandard");

    expect(getRegistry()).toBe(registry);
    expect(discoverWalletConnectors()).toEqual([
      expect.objectContaining({
        id: expect.stringContaining("Desktop Wallet:"),
        name: "Desktop Wallet",
        kind: "wallet-standard",
        supportsV0Signing: true,
        wallet: extensionWallet,
      }),
    ]);
    expect(mocks.registerMwa).not.toHaveBeenCalled();
    expect(mocks.getWallets).toHaveBeenCalledTimes(2);
  });

  it("marks a sign-and-send-only wallet unsupported without invoking it", async () => {
    const signAndSendTransaction = vi.fn();
    const sendOnlyWallet = {
      ...walletStandardExtension(),
      name: "Send Only Wallet",
      features: {
        [StandardConnect]: {
          version: "1.0.0",
          connect: vi.fn(),
        },
        [SolanaSignAndSendTransaction]: {
          version: "1.0.0",
          supportedTransactionVersions: [0],
          signAndSendTransaction,
        },
      },
    } as unknown as Wallet;
    mocks.getWallets.mockReturnValue(walletRegistry([sendOnlyWallet]));
    const { discoverWalletConnectors } = await import("./walletStandard");

    expect(discoverWalletConnectors()).toEqual([
      expect.objectContaining({
        name: "Send Only Wallet",
        supportsV0Signing: false,
        wallet: sendOnlyWallet,
      }),
    ]);
    expect(signAndSendTransaction).not.toHaveBeenCalled();
  });

  it("registers once before discovery when the capability module enables MWA", async () => {
    mocks.capabilities = {
      kind: "android-pwa",
      secureContext: true,
      displayModeStandalone: true,
      twaSignal: false,
      androidWebView: false,
      solanaMobileWebShell: false,
      mobileWalletAdapterSupported: true,
      mobileWalletAdapterSupportReason: "available",
    };
    const registry = walletRegistry([]);
    mocks.getWallets.mockReturnValue(registry);
    const { getMobileWalletRegistrationState, walletRegistry: getRegistry } =
      await import("./walletStandard");

    expect(getMobileWalletRegistrationState()).toEqual({
      status: "not-attempted",
    });
    expect(getRegistry()).toBe(registry);
    expect(getRegistry()).toBe(registry);
    expect(mocks.registerMwa).toHaveBeenCalledTimes(1);
    expect(mocks.registerMwa.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getWallets.mock.invocationCallOrder[0]!,
    );

    const config = registrationConfig();
    expect(config.appIdentity).toEqual({
      name: "zKube",
      uri: "https://play.zkube.test",
      icon: "https://play.zkube.test/assets/pwa-512x512.png",
    });
    expect(new URL(config.appIdentity.icon).origin).toBe(
      window.location.origin,
    );
    expect(config.chains).toEqual(["solana:devnet"]);
    expect(config.authorizationCache).toBe(mocks.authorizationCache);
    expect(getMobileWalletRegistrationState()).toEqual({
      status: "attempted",
    });
  });

  it("gates insecure Android and unsupported WebViews before registration", async () => {
    mocks.capabilities = {
      kind: "android-browser",
      secureContext: false,
      displayModeStandalone: false,
      twaSignal: false,
      androidWebView: false,
      solanaMobileWebShell: false,
      mobileWalletAdapterSupported: false,
      mobileWalletAdapterSupportReason: "insecure-context",
    };
    mocks.getWallets.mockReturnValue(walletRegistry([]));
    const { getMobileWalletRegistrationState, walletRegistry: getRegistry } =
      await import("./walletStandard");

    getRegistry();
    expect(mocks.registerMwa).not.toHaveBeenCalled();
    expect(getMobileWalletRegistrationState()).toEqual({
      status: "not-attempted",
    });

    mocks.capabilities = {
      ...mocks.capabilities,
      secureContext: true,
      androidWebView: true,
      mobileWalletAdapterSupportReason: "unsupported-android-webview",
    };
    getRegistry();
    expect(mocks.registerMwa).not.toHaveBeenCalled();
  });

  it("does not mark a thrown registration attempt and permits a retry", async () => {
    mocks.capabilities = {
      kind: "android-browser",
      secureContext: true,
      displayModeStandalone: false,
      twaSignal: false,
      androidWebView: false,
      solanaMobileWebShell: false,
      mobileWalletAdapterSupported: true,
      mobileWalletAdapterSupportReason: "available",
    };
    mocks.getWallets.mockReturnValue(walletRegistry([]));
    mocks.registerMwa
      .mockImplementationOnce(() => {
        throw new Error("registration failed");
      })
      .mockImplementationOnce(() => undefined);
    const { getMobileWalletRegistrationState, walletRegistry: getRegistry } =
      await import("./walletStandard");

    expect(() => getRegistry()).toThrow("registration failed");
    expect(getMobileWalletRegistrationState()).toEqual({
      status: "not-attempted",
    });
    expect(getRegistry()).toBeDefined();
    expect(mocks.registerMwa).toHaveBeenCalledTimes(2);
    expect(getMobileWalletRegistrationState()).toEqual({
      status: "attempted",
    });
  });

  it("awaits the supported MWA authorization cache clear on disconnect", async () => {
    mocks.capabilities = {
      kind: "android-browser",
      secureContext: true,
      displayModeStandalone: false,
      twaSignal: false,
      androidWebView: false,
      solanaMobileWebShell: false,
      mobileWalletAdapterSupported: true,
      mobileWalletAdapterSupportReason: "available",
    };
    const disconnect = vi.fn(async () => undefined);
    const mobileWallet = {
      ...walletStandardExtension(),
      name: "Mobile Wallet Adapter",
      features: {
        ...walletStandardExtension().features,
        [StandardDisconnect]: {
          version: "1.0.0",
          disconnect,
        },
      },
    } as unknown as Wallet;
    mocks.getWallets.mockReturnValue(walletRegistry([mobileWallet]));
    const {
      clearMobileWalletAuthorizationCache,
      disconnectWalletStandard,
      walletRegistry: getRegistry,
    } = await import("./walletStandard");
    getRegistry();

    await disconnectWalletStandard(mobileWallet, {
      clearMobileAuthorizationCache: true,
    });

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.authorizationCache.clear).toHaveBeenCalledTimes(1);
    await expect(clearMobileWalletAuthorizationCache()).resolves.toBe(true);
    expect(mocks.authorizationCache.clear).toHaveBeenCalledTimes(2);
  });

  it("throws a typed recoverable error and publishes wallet-not-found state", async () => {
    mocks.capabilities = {
      kind: "twa",
      secureContext: true,
      displayModeStandalone: true,
      twaSignal: true,
      androidWebView: false,
      solanaMobileWebShell: false,
      mobileWalletAdapterSupported: true,
      mobileWalletAdapterSupportReason: "available",
    };
    mocks.getWallets.mockReturnValue(walletRegistry([]));
    const {
      connectWalletStandard,
      WalletAvailabilityError,
      getWalletAvailabilityState,
      subscribeWalletAvailability,
      walletRegistry: getRegistry,
    } = await import("./walletStandard");
    getRegistry();
    const observed: Array<{ status: string; error: unknown }> = [];
    const unsubscribe = subscribeWalletAvailability((state) => {
      observed.push(state);
    });

    const rejection = registrationConfig().onWalletNotFound();

    await expect(rejection).rejects.toBeInstanceOf(WalletAvailabilityError);
    await expect(rejection).rejects.toMatchObject({
      name: "WalletAvailabilityError",
      code: "wallet-not-found",
      message:
        "No compatible Android wallet was found. Seeker includes Seed Vault Wallet, and other installed compatible wallets may be used.",
      recoverable: true,
      recoveryAction: "install-compatible-android-wallet",
      capabilities: mocks.capabilities,
    });
    expect(getWalletAvailabilityState()).toMatchObject({
      status: "unavailable",
      error: {
        code: "wallet-not-found",
        recoverable: true,
      },
    });
    expect(observed).toEqual([getWalletAvailabilityState()]);

    const anotherFailure = new Error("Association failed");
    await expect(
      connectWalletStandard({
        id: "mwa",
        name: "Use Installed Wallet",
        icon: "data:image/svg+xml,<svg />",
        kind: "mobile-wallet-adapter",
        supportsV0Signing: true,
        wallet: {
          version: "1.0.0",
          name: "Mobile Wallet Adapter",
          icon: "data:image/svg+xml,<svg />",
          chains: ["solana:devnet"],
          features: {
            [StandardConnect]: {
              version: "1.0.0",
              connect: vi.fn().mockRejectedValue(anotherFailure),
            },
          },
          accounts: [],
        } as unknown as Wallet,
      }),
    ).rejects.toBe(anotherFailure);
    expect(getWalletAvailabilityState()).toEqual({
      status: "unknown",
      error: null,
    });
    unsubscribe();
  });
});

function registrationConfig(): {
  appIdentity: { name: string; uri: string; icon: string };
  authorizationCache: unknown;
  chains: readonly string[];
  onWalletNotFound: () => Promise<void>;
} {
  const call = mocks.registerMwa.mock.calls[0];
  if (!call) throw new Error("MWA was not registered");
  return call[0] as {
    appIdentity: { name: string; uri: string; icon: string };
    authorizationCache: unknown;
    chains: readonly string[];
    onWalletNotFound: () => Promise<void>;
  };
}

function walletRegistry(wallets: readonly Wallet[]) {
  return {
    get: vi.fn(() => wallets),
    on: vi.fn(() => () => undefined),
  };
}

function walletStandardExtension(): Wallet {
  return {
    version: "1.0.0",
    name: "Desktop Wallet",
    icon: "data:image/svg+xml,<svg />",
    chains: ["solana:devnet"],
    features: {
      [StandardConnect]: {
        version: "1.0.0",
        connect: vi.fn(),
      },
      [SolanaSignTransaction]: {
        version: "1.0.0",
        supportedTransactionVersions: [0],
        signTransaction: vi.fn(),
      },
    },
    accounts: [],
  } as unknown as Wallet;
}
