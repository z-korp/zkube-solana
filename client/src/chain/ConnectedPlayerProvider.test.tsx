import React, { type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  type AccountInfo,
} from "@solana/web3.js";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { WalletConnector } from "@/platform/walletStandard";
import { ConnectedPlayerProvider } from "./ConnectedPlayerProvider";
import { useConnectedPlayer } from "./connectedPlayerContext";
import { saveLastWallet, loadLastWallet } from "./lastWalletStore";
import type { DeviceSession } from "./deviceSessionStore";
import { ZKUBE_PROGRAM_ID } from "./constants";

interface Subscription {
  listener(accounts: readonly WalletAccount[]): void;
  unsubscribe: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
  connectors: [] as WalletConnector[],
  connectWalletStandard: vi.fn(),
  createWalletStandardWallet: vi.fn(),
  disconnectWalletStandard: vi.fn(async () => undefined),
  clearMobileWalletAuthorizationCache: vi.fn(async () => true),
  subscriptions: [] as Subscription[],
  registryUnsubscribers: [] as ReturnType<typeof vi.fn>[],
  clearDeviceSession: vi.fn(),
  loadDeviceSession: vi.fn<() => DeviceSession | null>(() => null),
  clearRunSession: vi.fn(),
  decodeSessionTokenV2Account: vi.fn(),
  connection: {
    getBalance: vi.fn(async () => 123_000_000),
    getMultipleAccountsInfo: vi.fn(),
    getMinimumBalanceForRentExemption: vi.fn(async () => 0),
  },
  protocolFetch: vi.fn(async () => ({
    playerFundingTargetLamports: { toString: () => "50000000" },
  })),
}));

vi.mock("@/platform/walletStandard", () => ({
  discoverWalletConnectors: () => mocks.connectors,
  walletRegistry: () => ({
    get: () => mocks.connectors.map((connector) => connector.wallet),
    on: () => {
      const unsubscribe = vi.fn();
      mocks.registryUnsubscribers.push(unsubscribe);
      return unsubscribe;
    },
  }),
  connectWalletStandard: mocks.connectWalletStandard,
  createWalletStandardWallet: mocks.createWalletStandardWallet,
  disconnectWalletStandard: mocks.disconnectWalletStandard,
  clearMobileWalletAuthorizationCache:
    mocks.clearMobileWalletAuthorizationCache,
  subscribeWalletAccounts: (
    _wallet: Wallet,
    listener: (accounts: readonly WalletAccount[]) => void,
  ) => {
    const subscription = { listener, unsubscribe: vi.fn() };
    mocks.subscriptions.push(subscription);
    return subscription.unsubscribe;
  },
}));

vi.mock("./connectionContext", () => ({
  useSolanaConnection: () => ({ connection: mocks.connection }),
}));

vi.mock("./deviceSessionStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./deviceSessionStore")>();
  return {
    ...actual,
    clearDeviceSession: mocks.clearDeviceSession,
    loadDeviceSession: mocks.loadDeviceSession,
  };
});

vi.mock("./runSessionStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runSessionStore")>();
  return { ...actual, clearRunSession: mocks.clearRunSession };
});

vi.mock("./sessionV2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sessionV2")>();
  return {
    ...actual,
    decodeSessionTokenV2Account: mocks.decodeSessionTokenV2Account,
  };
});

vi.mock("./runPlan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runPlan")>();
  return {
    ...actual,
    zkubeProgram: () => ({
      account: { protocolConfig: { fetch: mocks.protocolFetch } },
    }),
  };
});

vi.mock("./pdas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pdas")>();
  return {
    ...actual,
    derivePlayerFundingPda: () => PublicKey.default,
    deriveProtocolConfigPda: () => PublicKey.default,
  };
});

vi.mock("./telemetry", () => ({
  createChainTraceId: () => "provider-test",
  emitChainMetric: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <ConnectedPlayerProvider>{children}</ConnectedPlayerProvider>;
}

beforeAll(() => {
  vi.stubGlobal("React", React);
});

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  mocks.subscriptions.length = 0;
  mocks.registryUnsubscribers.length = 0;
  mocks.loadDeviceSession.mockReturnValue(null);
  mocks.connectors = [connectorFixture()];
  mocks.createWalletStandardWallet.mockImplementation(
    (_wallet: Wallet, nextAccount: WalletAccount) =>
      walletLike(new PublicKey(nextAccount.publicKey)),
  );
  mocks.connection.getMultipleAccountsInfo.mockResolvedValue([
    accountInfo(1),
    accountInfo(50_000_000),
    accountInfo(5_000_000),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("ConnectedPlayerProvider wallet lifecycle", () => {
  it("refreshes the same account but disconnects a foreign account and cleans listeners", async () => {
    const owner = Keypair.generate().publicKey;
    const connector = mocks.connectors[0]!;
    saveLastWallet({ connectorId: connector.id, address: owner.toBase58() });
    mocks.connectWalletStandard.mockResolvedValue({
      account: walletAccount(owner),
      wallet: walletLike(owner),
    });

    const hook = renderHook(() => useConnectedPlayer(), { wrapper });
    await waitFor(() =>
      expect(hook.result.current.connectionStatus).toBe("connected"),
    );
    expect(mocks.connectWalletStandard).toHaveBeenCalledWith(connector, {
      silent: true,
    });
    expect(mocks.subscriptions).toHaveLength(1);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mocks.connectWalletStandard).toHaveBeenCalledTimes(1);
    expect(mocks.subscriptions).toHaveLength(1);

    const originalSubscription = mocks.subscriptions[0]!;
    act(() => {
      originalSubscription.listener([walletAccount(owner)]);
    });
    await waitFor(() => expect(mocks.subscriptions).toHaveLength(2));
    expect(hook.result.current.publicKey?.equals(owner)).toBe(true);
    expect(mocks.disconnectWalletStandard).not.toHaveBeenCalled();
    expect(originalSubscription.unsubscribe).toHaveBeenCalledTimes(1);

    // Even if an adapter delivers an already-queued callback after cleanup,
    // it cannot replace or disconnect the refreshed same-address account.
    act(() => {
      originalSubscription.listener([
        walletAccount(Keypair.generate().publicKey),
      ]);
    });
    expect(hook.result.current.publicKey?.equals(owner)).toBe(true);

    mocks.disconnectWalletStandard.mockImplementationOnce(async () => {
      // MWA emits its empty account list synchronously from disconnect.
      mocks.subscriptions.at(-1)!.listener([]);
    });
    act(() => {
      mocks.subscriptions
        .at(-1)!
        .listener([walletAccount(Keypair.generate().publicKey)]);
    });
    await waitFor(() =>
      expect(hook.result.current.connectionStatus).toBe("disconnected"),
    );
    expect(mocks.clearDeviceSession).toHaveBeenCalledWith(owner);
    expect(mocks.clearRunSession).toHaveBeenCalledWith(owner);
    expect(loadLastWallet()).toBeNull();
    expect(mocks.disconnectWalletStandard).toHaveBeenCalledWith(
      connector.wallet,
      { clearMobileAuthorizationCache: true },
    );
    expect(mocks.disconnectWalletStandard).toHaveBeenCalledTimes(1);

    hook.unmount();
    expect(
      mocks.subscriptions.every(
        ({ unsubscribe }) => unsubscribe.mock.calls.length === 1,
      ),
    ).toBe(true);
    expect(
      mocks.registryUnsubscribers.every(
        (unsubscribe) => unsubscribe.mock.calls.length === 1,
      ),
    ).toBe(true);
  });

  it("never adopts a foreign account from the silent authorization cache", async () => {
    const remembered = Keypair.generate().publicKey;
    const foreign = Keypair.generate().publicKey;
    const connector = mocks.connectors[0]!;
    saveLastWallet({
      connectorId: connector.id,
      address: remembered.toBase58(),
    });
    mocks.connectWalletStandard.mockResolvedValue({
      account: walletAccount(foreign),
      wallet: walletLike(foreign),
    });

    const { result } = renderHook(() => useConnectedPlayer(), { wrapper });

    await waitFor(() =>
      expect(result.current.error).toMatch(/previously connected player/i),
    );
    expect(result.current.connectionStatus).toBe("disconnected");
    expect(result.current.publicKey).toBeNull();
    expect(loadLastWallet()).toBeNull();
    expect(mocks.clearDeviceSession).not.toHaveBeenCalled();
    expect(mocks.clearRunSession).not.toHaveBeenCalled();
    expect(mocks.disconnectWalletStandard).toHaveBeenCalledWith(
      connector.wallet,
      { clearMobileAuthorizationCache: true },
    );
  });

  it("keeps explicit disconnect idempotent and ignores a stale silent result", async () => {
    const owner = Keypair.generate().publicKey;
    const connector = mocks.connectors[0]!;
    saveLastWallet({ connectorId: connector.id, address: owner.toBase58() });
    const pending = deferred<{
      account: WalletAccount;
      wallet: ReturnType<typeof walletLike>;
    }>();
    mocks.connectWalletStandard.mockReturnValue(pending.promise);

    const { result } = renderHook(() => useConnectedPlayer(), { wrapper });
    await waitFor(() =>
      expect(result.current.connectionStatus).toBe("connecting"),
    );

    await act(async () => {
      await result.current.disconnect();
      await result.current.disconnect();
    });
    expect(loadLastWallet()).toBeNull();
    expect(mocks.clearMobileWalletAuthorizationCache).toHaveBeenCalledTimes(2);

    await act(async () => {
      pending.resolve({
        account: walletAccount(owner),
        wallet: walletLike(owner),
      });
      await pending.promise;
    });
    await waitFor(() =>
      expect(result.current.connectionStatus).toBe("disconnected"),
    );
    expect(result.current.publicKey).toBeNull();
    expect(
      mocks.disconnectWalletStandard.mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("deduplicates foreground reconnect events and remains retryable", async () => {
    const owner = Keypair.generate().publicKey;
    const connector = mocks.connectors[0]!;
    saveLastWallet({ connectorId: connector.id, address: owner.toBase58() });
    const first = deferred<never>();
    mocks.connectWalletStandard
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({
        account: walletAccount(owner),
        wallet: walletLike(owner),
      });

    const { result } = renderHook(() => useConnectedPlayer(), { wrapper });
    await waitFor(() =>
      expect(mocks.connectWalletStandard).toHaveBeenCalledTimes(1),
    );
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mocks.connectWalletStandard).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.reject(new Error("silent cache unavailable"));
      await first.promise.catch(() => undefined);
    });
    await waitFor(() =>
      expect(result.current.connectionStatus).toBe("disconnected"),
    );

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() =>
      expect(result.current.connectionStatus).toBe("connected"),
    );
    expect(mocks.connectWalletStandard).toHaveBeenCalledTimes(2);
    expect(mocks.connectWalletStandard).toHaveBeenLastCalledWith(connector, {
      silent: true,
    });
  });
});

describe("ConnectedPlayerProvider device-session expiry", () => {
  it("routes startup expiry without signing or erasing recoverable runs", async () => {
    const now = Math.floor(Date.now() / 1_000);
    const { owner, session } = sessionFixture(now + 30);
    prepareStoredSession(owner, session);

    const { result } = renderHook(() => useConnectedPlayer(), { wrapper });
    await waitFor(() => expect(result.current.sessionStatus).toBe("expired"));

    expect(result.current.error).toMatch(/device session expired/i);
    expect(result.current.publicKey?.equals(owner)).toBe(true);
    expect(mocks.clearDeviceSession).not.toHaveBeenCalled();
    expect(mocks.clearRunSession).not.toHaveBeenCalled();
    expect(result.current.wallet?.signTransaction).not.toHaveBeenCalled();
  });

  it("detects expiry on foreground resume while preserving the stored session", async () => {
    const now = Math.floor(Date.now() / 1_000);
    const { owner, session } = sessionFixture(now + 3_600);
    prepareStoredSession(owner, session);

    const { result } = renderHook(() => useConnectedPlayer(), { wrapper });
    await waitFor(() => expect(result.current.sessionStatus).toBe("ready"));

    vi.spyOn(Date, "now").mockReturnValue((session.validUntil - 60) * 1_000);
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });
    await waitFor(() => expect(result.current.sessionStatus).toBe("expired"));

    expect(result.current.session).toBe(session);
    expect(mocks.clearDeviceSession).not.toHaveBeenCalled();
    expect(mocks.clearRunSession).not.toHaveBeenCalled();
    expect(result.current.wallet?.signTransaction).not.toHaveBeenCalled();
  });
});

function prepareStoredSession(owner: PublicKey, session: DeviceSession): void {
  const connector = mocks.connectors[0]!;
  saveLastWallet({ connectorId: connector.id, address: owner.toBase58() });
  mocks.loadDeviceSession.mockReturnValue(session);
  mocks.connectWalletStandard.mockResolvedValue({
    account: walletAccount(owner),
    wallet: walletLike(owner),
  });
  mocks.decodeSessionTokenV2Account.mockReturnValue({
    authority: owner,
    sessionSigner: session.signer.publicKey,
    targetProgram: ZKUBE_PROGRAM_ID,
    feePayer: owner,
    validUntil: session.validUntil,
  });
}

function sessionFixture(validUntil: number): {
  owner: PublicKey;
  session: DeviceSession;
} {
  const owner = Keypair.generate().publicKey;
  const signer = Keypair.generate();
  return {
    owner,
    session: {
      owner,
      signer,
      sessionToken: Keypair.generate().publicKey,
      validUntil,
      createdAt: validUntil - 3_600,
    },
  };
}

function connectorFixture(): WalletConnector {
  const standardWallet = {
    version: "1.0.0",
    name: "Mobile Wallet Adapter",
    icon: "data:image/svg+xml,<svg />",
    chains: ["solana:devnet"],
    features: {},
    accounts: [],
  } as unknown as Wallet;
  return {
    id: "mwa",
    name: "Use Installed Wallet",
    icon: standardWallet.icon,
    kind: "mobile-wallet-adapter",
    supportsV0Signing: true,
    wallet: standardWallet,
  };
}

function walletAccount(publicKey: PublicKey): WalletAccount {
  return {
    address: publicKey.toBase58(),
    publicKey: publicKey.toBytes(),
    chains: ["solana:devnet"],
    features: ["solana:signTransaction"],
  };
}

function walletLike(publicKey: PublicKey) {
  return {
    publicKey,
    signTransaction: vi.fn(async <T,>(transaction: T) => transaction),
    signAllTransactions: vi.fn(async <T,>(transactions: T[]) => transactions),
  };
}

function accountInfo(lamports: number): AccountInfo<Buffer> {
  return {
    data: Buffer.alloc(0),
    executable: false,
    lamports,
    owner: SystemProgram.programId,
    rentEpoch: 0,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
